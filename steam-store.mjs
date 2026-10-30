/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The launcher's Steam store, on the machine that runs it: a QR sign-in
 * relayed for a page, a signed-in account's library (each game's name, art,
 * size and how Steam starts it) and installs, each one downloaded with the
 * account's own session and packed into a bottle the library lists.
 *
 * The session is the asking browser's, handed over with each request: used
 * for that request or that install's run and written nowhere. A browser whose
 * session the Bottlify bridge keeps hands over none: it is told what Steam
 * tells anyone of its games (`apps`), by their ids, and installs one with the
 * depots' keys and manifest request codes the bridge gives it (`plan`,
 * `installWithKeys`), held for the run alone as a session is. What is cached
 * from it -- the account, its library, its installs -- is kept per session
 * (a bridged browser's installs: per its installer id), so one browser's
 * account is never answered to another.
 *
 * An install runs the engine repository's own tools as processes of their
 * own -- tools/steam-install.mjs downloads the depots, tools/make-btl.mjs
 * packs them -- so a download of gigabytes neither holds this server up nor
 * dies with a page.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FILE_FLAG_DIRECTORY, connectCm, contentServers, depotKey, library, logOn, logOnAnonymously,
  manifest, manifestRequestCode, productInfo, signInWithQr,
} from "@bottlify/core/steam";
import { checkInstallRequest, describeApp } from "./src/steam/install.js";

/**
 * Steam's own art for an app, on its CDN. Kept in a bottle's manifest as it
 * is; a page is given it through this server (`art`), because the CDN sends
 * no Cross-Origin-Resource-Policy, which the launcher's cross-origin isolated
 * page needs of an image from elsewhere.
 */
const ART = "https://shared.steamstatic.com/store_item_assets/steam/apps";
/** The same picture, from this server. @param {number} appId @param {string} file */
const artHere = (appId, file) => `/steam/art/${appId}/${file}`;

/** @typedef {import("./src/steam/header.js").SteamSession} SteamSession */

/**
 * What a session's caches are kept under: its token, hashed, so a browser
 * that names an account without its token is not answered for it. A bridged
 * browser's installs are kept under its installer id, hashed apart from any token.
 *
 * @param {SteamSession | string} who  A session, or an installer id.
 */
const ownerOf = (who) => createHash("sha256")
  .update(typeof who === "string" ? `installer\0${who}` : who.refreshToken).digest("hex");

/**
 * A request this server turns down, rather than Steam failing it: answered as
 * the asker's mistake.
 *
 * @param {string} message
 */
const refused = (message) => Object.assign(new Error(message), { refused: true });

/** A connection to the first connection manager that answers. */
async function connect(){
  const directory = await (await fetch("https://api.steampowered.com/ISteamDirectory/"
    + "GetCMListForConnect/v1/?cellid=0&cmtype=websockets")).json();
  for (const server of directory.response.serverlist.slice(0, 8)){
    try {
      return await connectCm({ endpoint: server.endpoint });
    } catch {
      // the next one
    }
  }
  throw new Error("no Steam connection manager answered");
}

/**
 * What Steam tells an anonymous logon of apps, by app id.
 *
 * @param {number[]} appIds
 * @returns {Promise<Map<number, any>>}
 */
async function anonymousAppInfo(appIds){
  const connection = await connect();
  try {
    await logOnAnonymously(connection);
    return (await productInfo(connection, { apps: appIds })).apps;
  } finally {
    connection.close();
  }
}

/**
 * @typedef {Object} StoreGame
 * @property {number} appId
 * @property {string} name
 * @property {number} bytes      What it takes once installed: its files, a path two
 *     depots both ship counted once -- measured from the depots' manifests, or the
 *     bottle's own size once installed; till then the depots' sizes added up.
 * @property {boolean} exact     Whether `bytes` is measured rather than added up.
 * @property {{ executable: string, arguments: string } | null} launch  Steam's first
 *     Windows launch option.
 * @property {string} header     Art: the store's wide header.
 * @property {string} capsule    Art: the library's tall cover.
 * @property {string} hero       Art: the library's wide background.
 * @property {string | null} bundle  The bottle it is installed as, if it is.
 */

/**
 * @typedef {Object} InstallJob
 * @property {number} appId
 * @property {"downloading" | "packing" | "done" | "failed"} state
 * @property {number} done   MiB downloaded.
 * @property {number} total  MiB to download, once known.
 * @property {string} message
 * @property {string} [bundle]  The bottle, once packed.
 */

/**
 * @param {{ cache: string, bundles: string, language?: string,
 *     appInfo?: (appIds: number[]) => Promise<Map<number, any>> }} where
 *     The directory kept caches go in -- sizes and art, nothing of an
 *     account -- and the directory bottles are kept in (the engine
 *     repository's `bundles/`, whose tools run from its parent). `appInfo`
 *     reads what Steam tells anyone of apps: an anonymous logon, unless a
 *     test answers for Steam.
 */
export function createSteamStore({ cache, bundles, language = "english", appInfo = anonymousAppInfo }){
  const engine = dirname(bundles);
  /**
   * Each session's games as Steam describes them, read at most every ten minutes.
   *
   * @type {Map<string, { at: number, games: (StoreGame & { build: string,
   *     depots: { id: number, gid: bigint }[] })[] }>}
   */
  const libraries = new Map();
  /**
   * Each session's account and the apps its licences grant, read at most
   * every ten minutes.
   *
   * @type {Map<string, { at: number, account: { steamId: string, accountName: string,
   *     apps: number[] } }>}
   */
  const accounts = new Map();
  /**
   * Every install there has been since the server started, by app id, and the
   * sessions that asked for it: each is shown its own.
   *
   * @type {Map<number, { job: InstallJob, owners: Set<string> }>}
   */
  const jobs = new Map();
  /**
   * What each app takes installed, by app id, for the build it was measured
   * at, so a library is measured once. Null for one whose manifests could not
   * be had. Kept by app rather than by account: it says nothing of who owns
   * it, and a size is only answered for a game in the asking account's library.
   *
   * @type {Map<number, { build: string, bytes: number | null }>}
   */
  const sizes = new Map();
  const sizesFile = join(cache, "sizes.json");
  const sizesRead = readFile(sizesFile, "utf8").then((text) => {
    for (const [app, size] of Object.entries(JSON.parse(text))) sizes.set(Number(app), size);
  }).catch(() => {});
  let measuring = false;
  /**
   * What Steam tells anyone of an app, by app id, read at most every ten
   * minutes: the game as the store shows it, or null for an app that is not a
   * game or that Steam does not describe to an anonymous logon.
   *
   * @type {Map<number, { at: number, game: ReturnType<typeof storeGame> | null }>}
   */
  const publicApps = new Map();
  /** Art being fetched or kept, by file. @type {Map<string, Promise<string | null>>} */
  const artFetches = new Map();

  /** A connection logged on with a session. @param {SteamSession} session */
  async function signedIn(session){
    const connection = await connect();
    try {
      const result = await logOn(connection, session);
      return { connection, steamId: result.steamId, licenses: result.licenses };
    } catch (e){
      connection.close();
      throw e;
    }
  }

  /** The bottles there are that are Steam apps, by app id: their id and size. */
  async function installed(){
    /** @type {Map<number, { id: string, bytes: number }>} */
    const found = new Map();
    for (const entry of await readdir(bundles, { withFileTypes: true }).catch(() => [])){
      if (!entry.isDirectory()) continue;
      try {
        const kept = JSON.parse(await readFile(join(bundles, entry.name, "manifest.json"), "utf8"));
        if (kept.steam?.appId){
          found.set(Number(kept.steam.appId),
            { id: entry.name, bytes: Number(kept.bundle?.uncompressedBytes ?? 0) });
        }
      } catch {
        // no manifest
      }
    }
    return found;
  }

  /**
   * A game as the store shows it, before what is installed and measured.
   *
   * @param {number} appId @param {string} name @param {any} info  Its product info.
   */
  function storeGame(appId, name, info){
    return {
      appId,
      name,
      exact: false,
      ...describeApp(info, language),
      header: artHere(appId, "header.jpg"),
      capsule: artHere(appId, "library_600x900.jpg"),
      hero: artHere(appId, "library_hero.jpg"),
      bundle: null,
    };
  }

  /**
   * Measures, one at a time, every game whose size for its build is not known:
   * its depots' manifests, each path counted once -- a later depot that ships
   * a path replaces the earlier's, as an install writes it. Kept as it goes.
   *
   * @param {SteamSession} session  The one whose library it is, held for the run.
   */
  async function measure(session){
    const cached = libraries.get(ownerOf(session));
    if (measuring || !cached) return;
    measuring = true;
    await sizesRead;
    /** @type {any} */
    let connection = null;
    /** @type {any[]} */
    let servers = [];
    try {
      for (const game of cached.games){
        if (sizes.get(game.appId)?.build === game.build || game.depots.length === 0) continue;
        try {
          if (!connection || connection.closed){
            connection = (await signedIn(session)).connection;
            servers = await contentServers(connection);
          }
          /** @type {Map<string, number>} */
          const files = new Map();
          for (const depot of game.depots){
            const key = await depotKey(connection, game.appId, depot.id);
            const code = await manifestRequestCode(connection, game.appId, depot.id, depot.gid);
            const listed = await manifest(servers[0], { depot: depot.id, gid: depot.gid, code, key });
            for (const file of listed.files){
              if (!(file.flags & FILE_FLAG_DIRECTORY) && !file.link){
                files.set(file.name.toLowerCase(), file.size);
              }
            }
          }
          sizes.set(game.appId, { build: game.build,
            bytes: [...files.values()].reduce((sum, size) => sum + size, 0) });
        } catch {
          // A depot this account cannot open, or a manager gone: added up it stays.
          sizes.set(game.appId, { build: game.build, bytes: null });
          connection?.close?.();
          connection = null;
        }
        await mkdir(cache, { recursive: true }).catch(() => {});
        await writeFile(sizesFile, JSON.stringify(Object.fromEntries(sizes))).catch(() => {});
      }
    } finally {
      connection?.close?.();
      measuring = false;
    }
  }

  /**
   * What Steam tells anyone of the apps not read in the last ten minutes, read.
   *
   * @param {number[]} appIds
   */
  async function readPublic(appIds){
    const stale = appIds.filter((id) => !(Date.now() - (publicApps.get(id)?.at ?? 0) < 10 * 60_000));
    if (stale.length === 0) return;
    const apps = await appInfo(stale);
    for (const id of stale){
      const info = /** @type {any} */ (apps.get(id));
      const game = String(info?.common?.type ?? "").toLowerCase() === "game"
        ? storeGame(id, String(info.common.name ?? id), info) : null;
      publicApps.set(id, { at: Date.now(), game });
    }
  }

  /**
   * Downloads an app with the engine's steam-install.mjs and packs it into a
   * bottle, unless it is being done: then the owner is shown that run.
   *
   * @param {string} owner
   * @param {{ appId: number, name: string, bytes: number,
   *     launch: { executable: string, arguments: string } | null }} game
   * @param {string[]} opens  How the download opens the depots: `--session -`
   *     or `--keys -`, and what goes with it.
   * @param {string} input  The session or the keys, for the download's stdin.
   * @returns {InstallJob}
   */
  function start(owner, game, opens, input){
    const appId = game.appId;
    const running = jobs.get(appId);
    if (running && (running.job.state === "downloading" || running.job.state === "packing")){
      running.owners.add(owner);
      return running.job;
    }
    if (!game.launch) throw refused(`${game.name} has no Windows launch option`);
    /** @type {InstallJob} */
    const job = { appId, state: "downloading", done: 0, total: Math.round(game.bytes / 2 ** 20),
      message: "Connecting to Steam…" };
    jobs.set(appId, { job, owners: new Set([owner]) });
    const id = `steam-${appId}`;
    const staging = join(bundles, ".staging", id);
    /**
     * A tool's run, its output read line by line.
     *
     * @param {string[]} args @param {(line: string) => void} onLine
     * @param {string} [stdin]  Written to its stdin.
     */
    const run = (args, onLine, stdin = "") => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: engine });
      // A tool that ends before reading its stdin breaks the pipe: its exit
      // code says what happened, and the error would otherwise end this server.
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
      let rest = "";
      const read = (/** @type {Buffer} */ chunk) => {
        rest += chunk.toString("utf8");
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        lines.forEach(onLine);
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(undefined)
        : reject(new Error(`${args[0]} ended with ${code}: ${rest.trim() || job.message}`))));
    });
    (async () => {
      // The session or the keys on stdin, never in a file or the command line
      // another process could read.
      await run(["tools/steam-install.mjs", ...opens, "--app", String(appId), "--out", staging],
        (line) => {
          const progress = /([0-9]+) of ([0-9]+) MiB \(([0-9.]+) MiB\/s\)/.exec(line);
          if (progress){
            job.done = Number(progress[1]);
            job.total = Number(progress[2]) || job.total;
            job.message = `${progress[3]} MiB/s`;
          } else if (line.trim()){
            job.message = line.trim();
          }
        }, input);
      job.state = "packing";
      job.message = "Packing the bottle…";
      const entry = /** @type {{ executable: string }} */ (game.launch).executable;
      await run(["tools/make-btl.mjs", "pack", staging, id, `--entry=${entry}`], (line) => {
        if (line.trim()) job.message = line.trim().slice(-120);
      });
      const path = join(bundles, id, "manifest.json");
      const kept = JSON.parse(await readFile(path, "utf8"));
      Object.assign(kept, {
        title: game.name,
        kind: "game",
        steam: { appId },
        ...game.launch?.arguments ? { commandLine: game.launch.arguments } : {},
        // Steam's own addresses: a bottle carries them wherever it goes, and
        // the launcher shows them through its own (`art`).
        coverLarge: `${ART}/${appId}/library_600x900.jpg`,
        coverSmall: `${ART}/${appId}/library_600x900.jpg`,
        wallpaper: `${ART}/${appId}/library_hero.jpg`,
      });
      await writeFile(path, `${JSON.stringify(kept, null, 4)}\n`);
      await rm(staging, { recursive: true, force: true });
      job.state = "done";
      job.bundle = id;
      job.message = "Installed";
    })().catch((/** @type {Error} */ e) => {
      job.state = "failed";
      job.message = e.message;
    });
    return job;
  }

  return {
    /**
     * Signs in with a QR code for a page: Steam's connection managers refuse a
     * page from anywhere but localhost, and do not refuse this process. The
     * session is resolved to the caller and kept nowhere here.
     *
     * @param {{ onChallenge: (url: string) => void, onScanned?: () => void,
     *     signal?: AbortSignal }} options
     * @returns {Promise<SteamSession>}
     */
    async signIn(options){
      /** @type {any} */
      let connection = null;
      // A manager drops a connection not logged on after a minute or so; the
      // sign-in goes on over the next.
      const next = async () => {
        if (!connection || connection.closed) connection = await connect();
        return connection;
      };
      options.signal?.addEventListener("abort", () => connection?.close(), { once: true });
      try {
        return await signInWithQr(next, { deviceName: "Bottlify", ...options });
      } finally {
        connection?.close();
      }
    },

    /**
     * The session's account and the games its licences grant, which a bottle
     * that needs Steam running is started with (createApp's `win32.steam`).
     *
     * @param {SteamSession} session
     */
    async account(session){
      const owner = ownerOf(session);
      const kept = accounts.get(owner);
      if (kept && Date.now() - kept.at < 10 * 60_000) return kept.account;
      const { connection, steamId, licenses } = await signedIn(session);
      try {
        const games = await library(connection, licenses);
        const account = { steamId: String(steamId), accountName: session.accountName,
          apps: games.map((game) => game.appid).sort((a, b) => a - b) };
        accounts.set(owner, { at: Date.now(), account });
        return account;
      } finally {
        connection.close();
      }
    },

    /**
     * The session's games, as the store shows them. Signed in afresh at most
     * every ten minutes; what is installed and what is measured is read each
     * time, and what is not measured yet is measured in the background.
     *
     * @param {SteamSession} session
     * @returns {Promise<StoreGame[]>}
     */
    async library(session){
      const owner = ownerOf(session);
      let cached = libraries.get(owner);
      if (!cached || Date.now() - cached.at > 10 * 60_000){
        const { connection, licenses } = await signedIn(session);
        try {
          const games = await library(connection, licenses);
          cached = { at: Date.now(),
            games: games.map((game) => storeGame(game.appid, game.name, game.info)) };
          libraries.set(owner, cached);
        } finally {
          connection.close();
        }
      }
      await sizesRead;
      measure(session).catch(() => {});
      const bottles = await installed();
      // The depots and the build are the server's to measure by, not the page's.
      // eslint-disable-next-line no-unused-vars
      return cached.games.map(({ depots, build, ...game }) => {
        const bottle = bottles.get(game.appId);
        const measured = sizes.get(game.appId);
        const bytes = bottle?.bytes || (measured?.build === build ? measured.bytes : null);
        return { ...game, bundle: bottle?.id ?? null, bytes: bytes ?? game.bytes,
          exact: bytes !== null && bytes !== undefined };
      });
    },

    /**
     * Games by app id, as the store shows them, from what Steam tells an
     * anonymous logon: for a browser whose session the bridge keeps, which
     * knows the account's app ids and hands over nothing else. Sizes stay the
     * depots added up -- measuring takes the account's depot keys -- but for
     * a game installed here.
     *
     * @param {number[]} appIds
     * @returns {Promise<StoreGame[]>}
     */
    async apps(appIds){
      const wanted = [...new Set(appIds)];
      await readPublic(wanted);
      const bottles = await installed();
      return wanted.flatMap((id) => {
        const kept = publicApps.get(id)?.game;
        if (!kept) return [];
        // eslint-disable-next-line no-unused-vars
        const { depots, build, ...game } = kept;
        const bottle = bottles.get(id);
        return [{ ...game, bundle: bottle?.id ?? null, bytes: bottle?.bytes || game.bytes,
          exact: Boolean(bottle?.bytes) }];
      }).sort((a, b) => a.name.localeCompare(b.name));
    },

    /**
     * The installs a session, or a bridged browser by its installer id, asked
     * for since the server started.
     *
     * @param {SteamSession | string} who
     * @returns {InstallJob[]}
     */
    jobs(who){
      const owner = ownerOf(who);
      return [...jobs.values()].filter((one) => one.owners.has(owner)).map((one) => one.job);
    },

    /**
     * Signed out: what was read for the session goes with it.
     *
     * @param {SteamSession} session
     */
    forget(session){
      const owner = ownerOf(session);
      libraries.delete(owner);
      accounts.delete(owner);
      for (const one of jobs.values()) one.owners.delete(owner);
    },

    /**
     * Steam's picture for an app, fetched once and kept on disk -- art is not
     * secret, and a library asks for every cover at once. A cover or a
     * background the app does not have is its header instead.
     *
     * @param {number} appId
     * @param {string} file  `header.jpg`, `library_600x900.jpg`, `library_hero.jpg`, …
     * @returns {Promise<string | null>} the file it is kept in, or null for none
     */
    art(appId, file){
      const path = join(cache, "art", String(appId), file);
      if (!artFetches.has(path)){
        artFetches.set(path, (async () => {
          if (await stat(path).catch(() => null)) return path;
          for (const name of file === "header.jpg" ? [file] : [file, "header.jpg"]){
            const answer = await fetch(`${ART}/${appId}/${name}`);
            if (!answer.ok) continue;
            await mkdir(dirname(path), { recursive: true });
            // Written whole under another name first: a request at the same
            // moment never reads half a picture.
            await writeFile(`${path}.part`, Buffer.from(await answer.arrayBuffer()));
            await rename(`${path}.part`, path);
            return path;
          }
          return null;
        })().catch(() => {
          // Steam unreachable: asked again next time rather than remembered as none.
          artFetches.delete(path);
          return null;
        }));
      }
      return /** @type {Promise<string | null>} */ (artFetches.get(path));
    },

    /**
     * Downloads an app and packs it into a bottle, unless it is being done.
     * The session is held for the run and handed to the download on its stdin.
     *
     * @param {SteamSession} session
     * @param {number} appId
     * @returns {Promise<InstallJob>}
     */
    async install(session, appId){
      // Asked of the session's own library first: an app is installed for an
      // account that owns it, and its progress shown to one.
      const game = (await this.library(session)).find((one) => one.appId === appId);
      if (!game) throw new Error(`app ${appId} is not in the account's library`);
      return start(ownerOf(session), game, ["--session", "-", "--language", language],
        JSON.stringify({ accountName: session.accountName, refreshToken: session.refreshToken }));
    },

    /**
     * What an install of an app downloads, from what Steam tells anyone: the
     * depots whose keys and manifest request codes a bridged browser asks its
     * bridge for (`installWithKeys`).
     *
     * @param {number} appId
     * @returns {Promise<import("./src/steam/install.js").InstallPlan>}
     */
    async plan(appId){
      await readPublic([appId]);
      const game = publicApps.get(appId)?.game;
      if (!game) throw refused(`app ${appId} is not a game Steam describes`);
      return { appId, depots: game.depots.map(({ id, gid }) => ({ depot: id, gid: String(gid) })) };
    },

    /**
     * Downloads an app with the depots' keys and manifest request codes a
     * bridged browser's account was given, checked against this server's own
     * plan, and packs it into a bottle. They are held for the run and handed
     * to the download on its stdin; the download logs on as nobody.
     *
     * @param {string} installer  The browser's installer id: its progress is shown to it.
     * @param {unknown} request  `{ appId, depots: [{ depot, gid, key, code }] }`, from the network.
     * @returns {Promise<InstallJob>}
     */
    async installWithKeys(installer, request){
      const appId = /** @type {any} */ (request)?.appId;
      if (!Number.isInteger(appId) || appId <= 0) throw refused("an install is { appId, depots }");
      const plan = await this.plan(appId);
      /** @type {ReturnType<typeof checkInstallRequest>} */
      let access;
      try {
        access = checkInstallRequest(request, plan);
      } catch (e){
        throw refused(/** @type {Error} */ (e).message);
      }
      const game = /** @type {ReturnType<typeof storeGame>} */ (publicApps.get(appId)?.game);
      return start(ownerOf(installer), game, ["--keys", "-"], JSON.stringify(access));
    },
  };
}
