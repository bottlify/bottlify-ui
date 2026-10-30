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
import { connectCm, library, logOn } from "@bottlify/core/steam";

/** Steam's own art for an app, from its CDN, which answers any page. */
const ART = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps";

/**
 * @typedef {Object} StoreGame
 * @property {number} appId
 * @property {string} name
 * @property {number} bytes      What its Windows depots hold, the language's and none.
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
  /** @type {{ at: number, games: StoreGame[] } | null} */
  let cached = null;
  /** @type {Map<number, InstallJob>} */
  const jobs = new Map();

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

  /** The bottles there are that are Steam apps, by app id. */
  async function installed(){
    /** @type {Map<number, string>} */
    const found = new Map();
    for (const entry of await readdir(bundles, { withFileTypes: true }).catch(() => [])){
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await readFile(join(bundles, entry.name, "manifest.json"), "utf8"));
        if (manifest.steam?.appId) found.set(Number(manifest.steam.appId), entry.name);
      } catch {
        // no manifest
      }
    }
    return found;
  }

  /** @param {any} info  An app's product info. */
  function describe(info){
    const depots = info?.depots ?? {};
    let bytes = 0;
    for (const [id, depot] of Object.entries(depots)){
      const size = Number(depot?.manifests?.public?.size ?? 0);
      const os = String(depot?.config?.oslist ?? "");
      const lang = String(depot?.config?.language ?? "");
      if (/^\d+$/.test(id) && size > 0 && (!os || os.split(",").includes("windows"))
        && (!lang || lang === language) && !depot?.dlcappid){
        bytes += size;
      }
    }
    const launch = Object.values(info?.config?.launch ?? {}).find((option) => {
      const os = String(/** @type {any} */ (option)?.config?.oslist ?? "");
      return /** @type {any} */ (option)?.executable && (!os || os.split(",").includes("windows"));
    });
    return { bytes, launch: launch ? {
      executable: String(/** @type {any} */ (launch).executable),
      arguments: String(/** @type {any} */ (launch).arguments ?? ""),
    } : null };
  }

  return {
    /**
     * The account's games, as the store shows them. Signed in afresh at most
     * every ten minutes; what is installed is read each time.
     *
     * @returns {Promise<StoreGame[]>}
     */
    async library(){
      if (!cached || Date.now() - cached.at > 10 * 60_000){
        const kept = JSON.parse(await readFile(session, "utf8"));
        const connection = await connect();
        try {
          const { licenses } = await logOn(connection, kept);
          const games = await library(connection, licenses);
          cached = { at: Date.now(), games: games.map((game) => ({
            appId: game.appid,
            name: game.name,
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
      const bottles = await installed();
      return cached.games.map((game) => ({ ...game, bundle: bottles.get(game.appId) ?? null }));
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
          const progress = /(\d+) of (\d+) MiB \(([\d.]+) MiB\/s\)/.exec(line);
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
        const manifest = JSON.parse(await readFile(path, "utf8"));
        Object.assign(manifest, {
          title: game.name,
          kind: "game",
          steam: { appId },
          ...game.launch?.arguments ? { commandLine: game.launch.arguments } : {},
          coverLarge: game.capsule,
          coverSmall: game.capsule,
          wallpaper: game.hero,
        });
        await writeFile(path, `${JSON.stringify(manifest, null, 4)}\n`);
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
