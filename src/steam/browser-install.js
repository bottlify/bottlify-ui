/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A Steam game installed in this browser, by Steam's own files: GameHub's
 * `download` answers what an install needs -- the depots at their manifests,
 * each with its key and a request code, the content servers, the launch
 * option, the install script -- and the page downloads from Steam's content
 * servers itself (GameHub opens them to this origin), decodes in workers and
 * writes the bottle into this origin's file system (`install-worker.js`),
 * where the library lists it beside the bottles kept here. A run stopped part
 * way, by its signal or a closed tab, goes on where it was when the next one
 * starts.
 */

/** @typedef {import("../stores/providers.js").InstallProgress} InstallProgress */

/** @param {number} bytes */
const mib = (bytes) => Math.round(bytes / 2 ** 20);

/** What a run stopped by its signal says: the next one goes on from it. */
export const STOPPED = "Stopped — Install goes on from where it stopped";

/**
 * One of the install's workers. Written as the bundler recognises a worker,
 * the URL inside the constructor, so the script is built with what it imports.
 *
 * @param {string} name
 */
const spawn = (name) => new Worker(new URL("./install-worker.js", import.meta.url),
  { type: "module", name });

/**
 * How many decoders: the cores but one for the page, at most four -- past
 * that the network, not the decoding, is what an install waits on.
 */
const decoderCount = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

/**
 * Installs an app of the account's in this browser.
 *
 * @param {Object} task
 * @param {string} task.store  `steam`: the bottle's manifest names it.
 * @param {string} task.game  The app's id.
 * @param {{ name: string, launch: { executable: string, arguments: string } | null,
 *     installscript?: string, art: { header: string, cover: string, hero: string },
 *     servers: { host: string, vhost: string }[],
 *     depots: { depot: number, gid: string, key: Uint8Array, code: string, shared: boolean }[] }}
 *     task.download  What GameHub answered.
 * @param {(progress: InstallProgress) => void} task.onProgress
 * @param {AbortSignal} [task.signal]  Stops it; what it has done is kept.
 * @returns {Promise<string>}  The bottle it installed.
 */
export async function installSteamGame({ store, game, download: plan, onProgress, signal }) {
  const stopped = () => Object.assign(new Error(STOPPED), { stopped: true });
  if (!plan.launch) throw new Error(`${plan.name ?? game} has no Windows launch option`);
  if (!plan.servers?.length) throw new Error("Steam offered no content server this browser can reach");
  if (signal?.aborted) throw stopped();
  const servers = plan.servers;
  const depots = plan.depots.map((one) => ({ ...one, gid: BigInt(one.gid), code: BigInt(one.code) }));
  // Kept when the disk runs low, as a bottle a person chose is (bottles.js):
  // a game of gigabytes gone with the origin's storage is downloaded again.
  await navigator.storage?.persist?.().catch(() => false);

  const installer = spawn("steam-install");
  /** @type {Worker[]} */
  const workers = [installer];
  /** @type {MessagePort[]} */
  const ports = [];
  for (let at = 0; at < decoderCount(); at++) {
    const decoder = spawn("steam-decode");
    workers.push(decoder);
    const channel = new MessageChannel();
    decoder.postMessage({ serve: channel.port1 }, [channel.port1]);
    ports.push(channel.port2);
  }
  onProgress({ state: "downloading", done: 0, total: 0, message: "Reading the depots…" });
  const started = Date.now();
  let first = -1;
  const id = `${store}-${game}`;
  const executable = plan.launch.executable.replace(/\//g, "\\");
  const art = plan.art;
  const cancel = () => installer.postMessage({ cancel: true });
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await new Promise((resolve, reject) => {
      installer.onerror = (event) => reject(new Error(event.message || "the install's worker failed"));
      installer.onmessage = ({ data }) => {
        if (data.progress) {
          const { stage, done, total } = data.progress;
          if (stage === "finishing") {
            onProgress({ state: "packing", done: mib(done), total: mib(total),
              message: `Checking the files… ${total ? Math.floor((100 * done) / total) : 0}%` });
            return;
          }
          // The rate of this run, from what it had when it started downloading.
          first = first < 0 ? done : first;
          const seconds = Math.max(1, (Date.now() - started) / 1000);
          onProgress({ state: "downloading", done: mib(done), total: mib(total),
            message: `${((done - first) / 2 ** 20 / seconds).toFixed(1)} MiB/s` });
        } else if (data.done) {
          resolve(id);
        } else if (data.error !== undefined) {
          reject(data.stopped ? stopped() : new Error(data.error));
        }
      };
      installer.postMessage({ install: { id, depots, servers, executable,
        ...plan.installscript ? { installscript: plan.installscript } : {},
        manifest: {
          id,
          title: plan.name ?? `Steam app ${game}`,
          kind: "game",
          labels: [],
          entry: executable,
          revision: 1,
          store: { id: store, game },
          installedFrom: "Steam",
          ...plan.launch?.arguments ? { commandLine: plan.launch.arguments } : {},
          // Steam's own addresses: a bottle carries them wherever it goes.
          coverLarge: art.cover,
          coverSmall: art.cover,
          coverFallback: art.header,
          wallpaper: art.hero,
        } }, ports }, ports);
      // A stop asked while the workers were being started.
      if (signal?.aborted) cancel();
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
    workers.forEach((worker) => worker.terminate());
  }
}
