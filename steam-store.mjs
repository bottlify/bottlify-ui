/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The launcher's Steam store, on the machine that runs it: the signed-in
 * account's library (each game's name, art, size and how Steam starts it) and
 * installs, each one downloaded with the account's own session and packed into
 * a bottle the library lists. The session's token stays on this machine; the
 * page is told games and progress.
 *
 * An install runs the engine repository's own tools as processes of their
 * own -- tools/steam-install.mjs downloads the depots, tools/make-btl.mjs
 * packs them -- so a download of gigabytes neither holds this server up nor
 * dies with a page.
 */

import { spawn } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FILE_FLAG_DIRECTORY, connectCm, contentServers, depotKey, library, logOn, manifest,
  manifestRequestCode,
} from "@bottlify/core/steam";

/** Steam's own art for an app, from its CDN, which answers any page. */
const ART = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps";

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
 * @param {{ session: string, bundles: string, language?: string }} where
 *     The kept session's file, and the directory bottles are kept in (the
 *     engine repository's `bundles/`, whose tools run from its parent).
 */
export function createSteamStore({ session, bundles, language = "english" }){
  const engine = dirname(bundles);
  /**
   * The account's games as Steam describes them, read at most every ten minutes.
   *
   * @type {{ at: number, games: (StoreGame & { build: string,
   *     depots: { id: number, gid: bigint }[] })[] } | null}
   */
  let cached = null;
  /** @type {Map<number, InstallJob>} */
  const jobs = new Map();
  /**
   * What each app takes installed, by app id, for the build it was measured
   * at, kept beside the session so a library is measured once. Null for one
   * whose manifests could not be had.
   *
   * @type {Map<number, { build: string, bytes: number | null }>}
   */
  const sizes = new Map();
  const sizesFile = join(dirname(session), "sizes.json");
  const sizesRead = readFile(sizesFile, "utf8").then((text) => {
    for (const [app, size] of Object.entries(JSON.parse(text))) sizes.set(Number(app), size);
  }).catch(() => {});
  let measuring = false;

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

  /** A connection logged on with the kept session. */
  async function signedIn(){
    const connection = await connect();
    try {
      const result = await logOn(connection, JSON.parse(await readFile(session, "utf8")));
      return { connection, licenses: result.licenses };
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
   * The depots an install takes -- Windows', the language's and those for every
   * language, not a DLC's -- their sizes added up, and Steam's launch option.
   *
   * @param {any} info  An app's product info.
   */
  function describe(info){
    const depots = info?.depots ?? {};
    let bytes = 0;
    /** @type {{ id: number, gid: bigint }[]} */
    const chosen = [];
    for (const [id, depot] of Object.entries(depots)){
      const size = Number(depot?.manifests?.public?.size ?? 0);
      const gid = depot?.manifests?.public?.gid;
      const os = String(depot?.config?.oslist ?? "");
      const lang = String(depot?.config?.language ?? "");
      if (/^[0-9]+$/.test(id) && size > 0 && gid && (!os || os.split(",").includes("windows"))
        && (!lang || lang === language) && !depot?.dlcappid){
        bytes += size;
        chosen.push({ id: Number(id), gid: BigInt(gid) });
      }
    }
    const launch = Object.values(info?.config?.launch ?? {}).find((option) => {
      const os = String(/** @type {any} */ (option)?.config?.oslist ?? "");
      return /** @type {any} */ (option)?.executable && (!os || os.split(",").includes("windows"));
    });
    return {
      bytes,
      depots: chosen,
      build: String(depots?.branches?.public?.buildid ?? ""),
      launch: launch ? {
        executable: String(/** @type {any} */ (launch).executable),
        arguments: String(/** @type {any} */ (launch).arguments ?? ""),
      } : null,
    };
  }

  /**
   * Measures, one at a time, every game whose size for its build is not known:
   * its depots' manifests, each path counted once -- a later depot that ships
   * a path replaces the earlier's, as an install writes it. Kept as it goes.
   */
  async function measure(){
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
            connection = (await signedIn()).connection;
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
        await writeFile(sizesFile, JSON.stringify(Object.fromEntries(sizes))).catch(() => {});
      }
    } finally {
      connection?.close?.();
      measuring = false;
    }
  }

  return {
    /**
     * The account's games, as the store shows them. Signed in afresh at most
     * every ten minutes; what is installed and what is measured is read each
     * time, and what is not measured yet is measured in the background.
     *
     * @returns {Promise<StoreGame[]>}
     */
    async library(){
      if (!cached || Date.now() - cached.at > 10 * 60_000){
        const { connection, licenses } = await signedIn();
        try {
          const games = await library(connection, licenses);
          cached = { at: Date.now(), games: games.map((game) => ({
            appId: game.appid,
            name: game.name,
            exact: false,
            ...describe(game.info),
            header: `${ART}/${game.appid}/header.jpg`,
            capsule: `${ART}/${game.appid}/library_600x900.jpg`,
            hero: `${ART}/${game.appid}/library_hero.jpg`,
            bundle: null,
          })) };
        } finally {
          connection.close();
        }
      }
      await sizesRead;
      measure().catch(() => {});
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

    /** Every install there has been since the server started. */
    jobs: () => [...jobs.values()],

    /** Signed out: what was read for the account goes with it. */
    forget(){
      cached = null;
    },

    /**
     * Downloads an app and packs it into a bottle, unless it is being done.
     *
     * @param {number} appId
     * @returns {Promise<InstallJob>}
     */
    async install(appId){
      const running = jobs.get(appId);
      if (running && (running.state === "downloading" || running.state === "packing")){
        return running;
      }
      const game = (await this.library()).find((one) => one.appId === appId);
      if (!game) throw new Error(`app ${appId} is not in the account's library`);
      if (!game.launch) throw new Error(`${game.name} has no Windows launch option`);
      /** @type {InstallJob} */
      const job = { appId, state: "downloading", done: 0, total: Math.round(game.bytes / 2 ** 20),
        message: "Connecting to Steam…" };
      jobs.set(appId, job);
      const id = `steam-${appId}`;
      const staging = join(bundles, ".staging", id);
      /**
       * A tool's run, its output read line by line.
       *
       * @param {string[]} args @param {(line: string) => void} onLine
       */
      const run = (args, onLine) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { cwd: engine });
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
        await run(["tools/steam-install.mjs", "--session", session, "--app", String(appId),
          "--out", staging, "--language", language], (line) => {
          const progress = /([0-9]+) of ([0-9]+) MiB \(([0-9.]+) MiB\/s\)/.exec(line);
          if (progress){
            job.done = Number(progress[1]);
            job.total = Number(progress[2]) || job.total;
            job.message = `${progress[3]} MiB/s`;
          } else if (line.trim()){
            job.message = line.trim();
          }
        });
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
          coverLarge: game.capsule,
          coverSmall: game.capsule,
          wallpaper: game.hero,
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
    },
  };
}
