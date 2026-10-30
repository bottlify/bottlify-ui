/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { createServer, request } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createRelayServer, permits } from "@bottlify/networking/server";
import { programIcon } from "@bottlify/core/icon";
import { openBundle } from "@bottlify/core/bundle/node";
import { connectCm, library, logOn } from "@bottlify/core/steam";
import { ICON_SIZES, headForBottle, homeManifest, iconFile, iconPath } from "./src/engine/home-screen.js";

/**
 * Dev server for the UI.
 *
 * Serves on one origin:
 *  - `/`              → the React app (built to `dist/` by `npm run build`);
 *  - `/engine/...`    → the engine package's build (`@bottlify/core`'s `dist/`),
 *                       so its relative imports resolve beside it;
 *  - `/networking/...`→ the networking package's sources, the relay client the
 *                       engine loads by URL (`/networking/client/index.js`), and
 *                       the relay's own socket at `/networking/relay`;
 *  - `/cork/...`      → the translator package (`@bottlify/cork`), which the
 *                       engine imports from `../../cork/src/index.js` beside
 *                       its own build when a launch selects it; absent when the
 *                       package is not installed, and only that engine fails;
 *  - `/bundles/...`   → the game bundles, from `BUNDLES_DIR` (by default the
 *                       engine repository's `bundles/` beside this one);
 *  - `/source/...`    → the engine repository's sources, only when
 *                       `BOTTLIFY_SOURCE` names it: the legacy `/debug/` page and
 *                       `?engine=src` run the engine unbuilt. Local only.
 *
 * Every file is served with byte ranges honoured. That is not a nicety here: a
 * game's bundle is over a gigabyte, the engine reads it one block at a time,
 * and a server that answered 200 to a range would hand the whole thing to a
 * browser tab at once.
 */

const UI_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
/** The directory a package's exported module lies in, wherever npm put it. @param {string} name */
const directoryOf = name=>dirname(fileURLToPath(import.meta.resolve(name)));
const ENGINE = directoryOf("@bottlify/core");
const NETWORKING = directoryOf("@bottlify/networking/protocol");
/** The translator package's root, or null when it is not installed. */
const CORK = (()=>{
  try {
    return dirname(directoryOf("@bottlify/cork"));
  } catch {
    return null;
  }
})();
const BUNDLES = resolve(process.env.BUNDLES_DIR ?? resolve(UI_ROOT, "..", "bottlify", "bundles"));
const SOURCE = process.env.BOTTLIFY_SOURCE ? resolve(process.env.BOTTLIFY_SOURCE) : null;
const DIST = resolve(UI_ROOT, "dist");
const DEBUG = resolve(UI_ROOT, "debug");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

/** @param {string} path @returns {Promise<number | null>} the file's size */
async function sizeOf(path){
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * Sends a file, honouring a byte range when one is asked for.
 *
 * Streamed rather than read in: a bundle is larger than anything a process
 * should hold, and the engine reads it a range at a time precisely so that it
 * never has to be held whole at either end.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string} path
 * @param {number} size
 * @param {boolean} [code]  the engine's or the app's own code: asked again at
 *     every load, so a rebuild is what the next page runs rather than whatever
 *     the browser kept
 */
function sendFile(req, res, path, size, code = false){
  const headers = {
    ...commonHeaders(MIME[extname(path)] ?? "application/octet-stream"),
    "Accept-Ranges": "bytes",
    ...(code ? { "Cache-Control": "no-cache" } : {}),
  };
  const asked = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!asked){
    res.writeHead(200, { ...headers, "Content-Length": size });
    createReadStream(path).pipe(res);
    return;
  }

  const [, from, to] = asked;
  const start = from === "" ? Math.max(0, size - Number(to || 0)) : Number(from);
  const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (!(start <= end && start < size)){
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }).end();
    return;
  }
  res.writeHead(206, {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": end - start + 1,
  });
  createReadStream(path, { start, end }).pipe(res);
}

/** @param {string} pathname @param {string} root @param {string} [index] */
function joined(pathname, root, index = "index.html"){
  const rel = pathname.replace(/^\/+/, "");
  const abs = resolve(root, rel || index);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

// Served over TLS when a certificate is put in front of it, because a page
// reached by anything but localhost is not a secure context otherwise, and
// without one there is no SharedArrayBuffer and so no sound and no shared
// log. `TLS_DIR` is a directory holding a key and a certificate; both of the
// naming conventions a local certificate arrives under are accepted, because
// the alternative is renaming someone's files to use them.
const TLS_NAMES = [["cert.pem", "key.pem"], ["server.crt", "server.key"]];
const TLS_DIR = process.env.TLS_DIR ?? "";

/** @param {string} dir @returns {{ cert: Buffer, key: Buffer } | null} */
function certificateIn(dir){
  for (const [certName, keyName] of TLS_NAMES){
    try {
      return { cert: readFileSync(resolve(dir, certName)),
        key: readFileSync(resolve(dir, keyName)) };
    } catch { /* the next convention, then */ }
  }
  throw new Error(`no ${TLS_NAMES.map(pair=>pair.join("/")).join(" or ")} in ${dir}`);
}

const tls = TLS_DIR ? certificateIn(TLS_DIR) : null;

/** A bottle's id as it may appear in an address: nothing that climbs out of its directory. */
const BOTTLE_ID = /^[A-Za-z0-9._-]+$/;

/** @param {string} id @returns {Promise<any>} the bottle's manifest under BUNDLES_DIR, or null */
async function bottleManifest(id){
  if (!BOTTLE_ID.test(id) || id.startsWith(".")) return null;
  try {
    return JSON.parse(await readFile(join(BUNDLES, id, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Each bottle's program icon, read once from its executable inside its bundle
 * and kept for as long as that bundle is the same file.
 *
 * @type {Map<string, Promise<any>>}
 */
const programIcons = new Map();

/** @param {string} id @returns {Promise<any>} the icon, or null for none */
async function bottleIcon(id){
  const manifest = await bottleManifest(id);
  if (!manifest?.entry) return null;
  const path = join(BUNDLES, id, manifest.bundle?.file ?? "bundle.btl");
  const info = await stat(path).catch(()=>null);
  if (!info) return null;
  const key = `${id}:${info.mtimeMs}`;
  if (!programIcons.has(key)){
    programIcons.set(key, (async()=>{
      const bundle = await openBundle(path);
      try {
        return programIcon(new Uint8Array(await bundle.read(manifest.entry)));
      } finally {
        await bundle.close();
      }
    })().catch(()=>null));
  }
  return programIcons.get(key);
}

/**
 * A bottle's bookmark: the manifest a home screen opens it by and its
 * program's icon at the sizes a tab and a home screen ask for, answered from
 * the bundle before the bottle is ever started; and its address's page with a
 * head that already names it. A bottle whose program has no icon is drawn as
 * the launcher.
 *
 * @returns {Promise<boolean>} whether the request was one of these and was answered
 */
async function answerBookmark(req, res, pathname){
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const file = /^\/bundles\/([^/]+)\/(home\.webmanifest|icon-(\d+)\.png)$/.exec(pathname);
  if (file){
    const [, id, name, size] = file;
    const manifest = await bottleManifest(id);
    if (!manifest) return false;
    if (name === "home.webmanifest"){
      res.writeHead(200, { ...commonHeaders(MIME[".webmanifest"]), "Cache-Control": "no-cache" })
        .end(JSON.stringify(homeManifest({ id, title: manifest.title ?? id,
          icons: [192, 512].map(each=>({ src: iconPath(id, each), size: each })) })));
      return true;
    }
    const box = Number(size);
    if (!ICON_SIZES.includes(box)) return false;
    const icon = await bottleIcon(id);
    if (!icon){
      res.writeHead(302, { Location: `/icons/icon-${box <= 180 ? 180 : box}.png` }).end();
      return true;
    }
    const png = iconFile(icon, box, deflateSync);
    res.writeHead(200, { ...commonHeaders(MIME[".png"]), "Content-Length": png.length,
      "Cache-Control": "no-cache" }).end(png);
    return true;
  }
  const play = /^\/play\/([^/]+)$/.exec(pathname);
  if (play){
    const id = (()=>{
      try {
        return decodeURIComponent(play[1]);
      } catch {
        return "";
      }
    })();
    const manifest = await bottleManifest(id);
    const html = manifest && await readFile(resolve(DIST, "index.html"), "utf8").catch(()=>null);
    if (!html) return false;
    res.writeHead(200, { ...commonHeaders("text/html; charset=utf-8"), "Cache-Control": "no-cache" })
      .end(headForBottle(html, { id, title: manifest.title ?? id }));
    return true;
  }
  return false;
}

/**
 * Where the Steam sign-in page (/steam) keeps the session it was given, for
 * the tools on this machine (`tools/steam-signin.mjs --token` reads the same
 * form). A credential: outside the repository, readable by its owner alone,
 * and never answered back to a page.
 */
const STEAM_SESSION = resolve(UI_ROOT, ".steam", "session.json");
/** @type {{ at: number, list: string[] } | null} */
let steamManagers = null;
/** @type {{ at: number, account: any } | null} */
let steamAccount = null;

/**
 * The kept session's account and the games it owns, signed in afresh.
 *
 * @returns {Promise<{ steamId: string, accountName: string, apps: number[] }>}
 */
async function signedInAccount(){
  const session = JSON.parse(await readFile(STEAM_SESSION, "utf8"));
  const directory = await (await fetch("https://api.steampowered.com/ISteamDirectory/"
    + "GetCMListForConnect/v1/?cellid=0&cmtype=websockets")).json();
  let connection = null;
  for (const server of directory.response.serverlist.slice(0, 8)){
    try {
      connection = await connectCm({ endpoint: server.endpoint });
      break;
    } catch {
      // the next one
    }
  }
  if (!connection) throw new Error("no Steam connection manager answered");
  try {
    const { steamId, licenses } = await logOn(connection, session);
    const games = await library(connection, licenses);
    return { steamId: String(steamId), accountName: session.accountName,
      apps: games.map((game) => game.appid).sort((a, b) => a - b) };
  } finally {
    connection.close();
  }
}

/**
 * The Steam page, the connection managers' WebSocket addresses -- Steam's
 * directory answers no page from another origin, so this process asks it --
 * and the session the page hands over or takes back.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string} pathname
 */
async function answerSteam(req, res, pathname){
  if (pathname === "/steam" && (req.method === "GET" || req.method === "HEAD")){
    const page = resolve(DIST, "steam.html");
    const size = await sizeOf(page);
    if (size === null || size === undefined){ res.writeHead(404).end("the UI is not built"); return true; }
    sendFile(req, res, page, size);
    return true;
  }
  if (pathname === "/steam/managers" && req.method === "GET"){
    try {
      if (!steamManagers || Date.now() - steamManagers.at > 10 * 60_000){
        const directory = await (await fetch("https://api.steampowered.com/ISteamDirectory/"
          + "GetCMListForConnect/v1/?cellid=0&cmtype=websockets")).json();
        /** @type {string[]} */
        const list = directory.response.serverlist.map((/** @type {any} */ s)=>s.endpoint);
        // Port 443 first: the one a firewall least often closes.
        list.sort((a, b)=>Number(!a.endsWith(":443")) - Number(!b.endsWith(":443")));
        steamManagers = { at: Date.now(), list: list.slice(0, 12) };
      }
      res.writeHead(200, { ...commonHeaders("application/json"), "Cache-Control": "no-store" })
        .end(JSON.stringify(steamManagers.list));
    } catch (e){
      res.writeHead(502, commonHeaders("text/plain; charset=utf-8"))
        .end(`Steam's directory did not answer: ${/** @type {Error} */ (e).message}`);
    }
    return true;
  }
  // The signed-in account and the games its licences grant, which a bottle
  // that needs Steam running is started with (createApp's win32.steam): signed
  // in here with the kept session, whose token never leaves this machine.
  if (pathname === "/steam/account" && req.method === "GET"){
    try {
      steamAccount = steamAccount && Date.now() - steamAccount.at < 10 * 60_000
        ? steamAccount : { at: Date.now(), account: await signedInAccount() };
      res.writeHead(200, commonHeaders("application/json; charset=utf-8"))
        .end(JSON.stringify(steamAccount.account));
    } catch (e){
      steamAccount = null;
      res.writeHead(e?.code === "ENOENT" ? 404 : 502, commonHeaders("text/plain; charset=utf-8"))
        .end(e?.code === "ENOENT" ? "nobody is signed in to Steam (/steam)"
          : `Steam did not answer: ${/** @type {Error} */ (e).message}`);
    }
    return true;
  }
  if (pathname === "/steam/session" && req.method === "DELETE"){
    steamAccount = null;
    await rm(STEAM_SESSION, { force: true });
    res.writeHead(204).end();
    return true;
  }
  if (pathname === "/steam/session" && req.method === "POST"){
    const chunks = [];
    let length = 0;
    for await (const chunk of req){
      length += chunk.length;
      if (length > 16_384){ res.writeHead(413).end(); return true; }
      chunks.push(chunk);
    }
    let session;
    try {
      session = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      session = null;
    }
    if (typeof session?.accountName !== "string" || typeof session?.refreshToken !== "string"){
      res.writeHead(400, commonHeaders("text/plain; charset=utf-8"))
        .end("a session is { accountName, refreshToken }");
      return true;
    }
    await mkdir(dirname(STEAM_SESSION), { recursive: true });
    await writeFile(STEAM_SESSION, JSON.stringify({ accountName: session.accountName,
      refreshToken: session.refreshToken }), { mode: 0o600 });
    res.writeHead(204).end();
    return true;
  }
  return false;
}

const handler = async(req, res)=>{
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // Legacy page stays reachable under /debug.
  if (pathname === "/debug" || pathname.startsWith("/debug/")) {
    const abs = joined(pathname.replace(/^\/debug/, ""), DEBUG);
    const size = abs && (await sizeOf(abs));
    if (size === null || size === undefined){ res.writeHead(404).end("not found: /debug/*"); return; }
    sendFile(req, res, abs, size);
    return;
  }

  // A bottle on its way to the bottle server, a change to the settings or the
  // pictures of one already there, or its removal; that server runs beside this
  // one on its own port.
  // Passed through here so the page talks to one origin: the bottle server
  // answers no preflight, and a browser would refuse the cross-origin POST
  // before it ever reached it.
  if ((/^\/bottles\/[^/]+\/(blocks|finish|manifest|art\/(cover|wallpaper))$/.test(pathname)
    && req.method === "POST") || (/^\/bottles\/[^/]+$/.test(pathname) && req.method === "DELETE")){
    const upstream = request({
      host: "127.0.0.1", port: BOTTLE_PORT, method: req.method, path: req.url,
      headers: req.headers,
    }, answer=>{
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", e=>{
      res.writeHead(502, commonHeaders("text/plain; charset=utf-8"))
        .end(`the bottle server on port ${BOTTLE_PORT} did not answer: ${e.message}`);
    });
    req.pipe(upstream);
    return;
  }

  // Which bottles there are: every directory under bundles/ with a manifest.
  // Listed by this process because a page cannot read a directory, and a
  // list kept by hand in the page is stale the moment a bottle is sent.
  if (pathname === "/bundles/index.json"){
    const ids = [];
    for (const name of await readdir(BUNDLES, { withFileTypes: true }).catch(()=>[])){
      if (name.isDirectory() && await sizeOf(join(BUNDLES, name.name, "manifest.json"))){
        ids.push(name.name);
      }
    }
    res.writeHead(200, { ...commonHeaders("application/json"), "Cache-Control": "no-store" })
      .end(JSON.stringify(ids));
    return;
  }

  if (await answerSteam(req, res, pathname)) return;

  if (await answerBookmark(req, res, pathname)) return;

  // Built app assets first, so dist/ wins over duplicated repo-root files.
  const distAbs = joined(pathname, DIST);
  const distSize = distAbs && (await sizeOf(distAbs));
  if (distSize !== null && distSize !== undefined){ sendFile(req, res, distAbs, distSize, true); return; }

  // The engine, the relay client, the bundles, and -- when asked for -- the
  // engine's sources, each from the directory that holds it.
  for (const [prefix, root] of [["/engine/", ENGINE], ["/networking/", NETWORKING],
    ["/cork/", CORK], ["/bundles/", BUNDLES], ["/source/", SOURCE]]){
    if (root && pathname.startsWith(prefix)){
      const abs = joined(pathname.slice(prefix.length - 1), root);
      const size = abs && (await sizeOf(abs));
      if (size !== null && size !== undefined){ sendFile(req, res, abs, size, prefix !== "/bundles/"); return; }
      res.writeHead(404).end(`not found: ${pathname}`);
      return;
    }
  }

  // SPA fallback: the app routes by pathname, so a reload on any of its pages
  // must land on the built entry. Anything with an extension is a missing
  // asset and stays a 404.
  if ((req.method === "GET" || req.method === "HEAD") && extname(pathname) === ""){
    const index = resolve(DIST, "index.html");
    const size = await sizeOf(index);
    if (size !== null){ sendFile(req, res, index, size); return; }
    res.writeHead(200, commonHeaders("text/html; charset=utf-8")).end(`
        <!doctype html><meta charset="utf-8"><title>Bottlify</title>
        <p>The UI is not built. Run <code>npm run build</code>, then reload.</p>`);
    return;
  }

  res.writeHead(404).end(`not found: ${pathname}`);
};

/**
 * Cross-origin isolation, which is what makes SharedArrayBuffer available and
 * the engine's `isolated` mode possible. `ISOLATION=off` serves without it, so
 * the `compatible` mode -- what a page embedded elsewhere gets -- can be run
 * from this same launcher.
 */
const isolated = process.env.ISOLATION !== "off";

/** @param {string} contentType */
function commonHeaders(contentType){
  return {
    "Content-Type": contentType,
    ...(isolated
      ? {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      }
      : {}),
    // The browser grants its JavaScript sampler (the engine's `sampleJs`) only
    // to a document or worker script served with this; it asks nothing of a
    // run that does not sample.
    "Document-Policy": "js-profiling",
  };
}

const port = Number(process.env.PORT ?? 5180);
/** Where the bottle server listens (`@bottlify/installer`'s `src/server/cli.js --port`). */
const BOTTLE_PORT = Number(process.env.BOTTLE_PORT ?? 8788);
const server = tls ? createSecureServer(tls, handler) : createServer(handler);
// Bound to every address when a certificate is in use, so another machine --
// or this one's own browser reaching it by name -- can open it.
const host = tls ? "0.0.0.0" : "127.0.0.1";
const scheme = tls ? "https" : "http";

// The network relay Winsock reaches the world through, on this same server at
// /networking/relay -- a page served over TLS may only open wss://, and this is
// the server that holds the certificate. Peers naming the same room share a
// private network; anything outside a room is refused unless `RELAY_ALLOW`
// names the host (`a.example.com,*.example.net`, or `*` for any), so an
// unconfigured launcher is a LAN between tabs and not an open proxy. Only `*`
// also reaches this machine and its private networks. `RELAY_RESUME_SECONDS`
// is how long a game whose link dropped is kept for its page to come back to.
const allow = (process.env.RELAY_ALLOW ?? "").split(",").map(rule=>rule.trim()).filter(Boolean);

/**
 * The hosts a bottle's manifest limits it to (`network.allow`), or null for a
 * bottle that names none. A title joins the room named after its bottle, so
 * the room says whose manifest to read; anything that is not a bottle's id --
 * the installer's room, a name with a path in it -- has none.
 *
 * @param {string} room
 * @returns {Promise<string[] | null>}
 */
const bottleAllow = async room=>{
  if (!/^[A-Za-z0-9._-]+$/.test(room) || room.startsWith(".")){
    return null;
  }
  try {
    const manifest = JSON.parse(await readFile(join(BUNDLES, room, "manifest.json"), "utf8"));
    const hosts = manifest?.network?.allow;
    return Array.isArray(hosts) ? hosts.map(String) : null;
  } catch {
    return null;
  }
};

/** Room and host pairs already written to the log. @type {Set<string>} */
const askedFor = new Set();

const relay = createRelayServer({
  server, path: "/networking/relay",
  // Only this launcher's own pages, at whatever address it was reached by: a
  // browser opens a WebSocket to any origin, so without this every site the
  // person visits could reach the relay on 127.0.0.1 -- and through it, with
  // `RELAY_ALLOW=*`, the machine's own networks.
  origins: asked=>asked.headers.origin === `${scheme}://${asked.headers.host}`,
  privateNetworks: allow.includes("*"),
  resumeWindowMs: Number(process.env.RELAY_RESUME_SECONDS ?? 10) * 1000,
  // A bottle that names its hosts reaches those and no others, whatever the
  // launcher allows; every other run goes by `RELAY_ALLOW`.
  policy: async asked=>{
    const room = String(asked.room ?? "");
    const ok = permits(await bottleAllow(room) ?? allow, asked.host);
    // Each host a room asks for, once, and the answer: where a program goes.
    // Once for each answer, so a host refused and then let in says both.
    const seen = `${room} ${asked.protocol} ${asked.host}${asked.port ? `:${asked.port}` : ""}`
      + ` ${ok ? "allowed" : "refused"}`;
    if (!askedFor.has(seen)){
      askedFor.add(seen);
      console.log(`relay: ${seen}`);
    }
    return ok;
  },
});
server.listen(port, host, async()=>{
  await relay.listen();
  console.log(
    `ui: ${scheme}://127.0.0.1:${port}/  debug: ${scheme}://127.0.0.1:${port}/debug/`
    + `  relay: ${scheme === "https" ? "wss" : "ws"}://127.0.0.1:${port}/networking/relay`
    + (allow.length > 0 ? ` (outbound to ${allow.join(", ")})` : " (rooms only)"));
});
