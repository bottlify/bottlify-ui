/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A GOG game installed in this browser: GameHub's `download` answers the
 * build GOG installs and a secure link to each product's chunks; the install's
 * worker (`steam/install-worker.js`, its GOG role) reads the manifests and
 * chunks from GOG's CDN -- GameHub opens it to this origin -- and writes the
 * bottle into this origin's file system, where the library lists it. A run
 * stopped part way goes on where it was when the next one starts.
 */

import { STOPPED } from "../steam/browser-install.js";

/** @typedef {import("../stores/providers.js").InstallProgress} InstallProgress */

/** @param {number} bytes */
const mib = (bytes) => Math.round(bytes / 2 ** 20);

/**
 * The language a GOG build is installed in: the browser's, as GOG names
 * languages (`de-DE`); a build without it falls back to English
 * (`@bottlify/core/gog`, pickDepots).
 */
const language = () => {
  const [lang, region] = String(navigator.language || "en-US").split("-");
  return `${lang.toLowerCase()}-${(region ?? lang).toUpperCase()}`;
};

/**
 * Installs a game of the account's in this browser.
 *
 * @param {Object} task
 * @param {string} task.store  `gog`: the bottle's manifest names it.
 * @param {string} task.game  The product's id.
 * @param {import("@bottlify/core/gog/install").InstallPlan & { name: string,
 *     art: { header: string, capsule: string, hero: string } }} task.download
 *     What GameHub answered.
 * @param {(progress: InstallProgress) => void} task.onProgress
 * @param {AbortSignal} [task.signal]  Stops it; what it has done is kept.
 * @returns {Promise<string>}  The bottle it installed.
 */
export async function installGogGame({ store, game, download: plan, onProgress, signal }) {
  const stopped = () => Object.assign(new Error(STOPPED), { stopped: true });
  if (signal?.aborted) throw stopped();
  // Kept when the disk runs low, as a bottle a person chose is (bottles.js).
  await navigator.storage?.persist?.().catch(() => false);
  const installer = new Worker(new URL("../steam/install-worker.js", import.meta.url),
    { type: "module", name: "gog-install" });
  onProgress({ state: "downloading", done: 0, total: 0, message: "Reading the build…" });
  const started = Date.now();
  let first = -1;
  const id = `${store}-${game}`;
  const art = plan.art;
  const cancel = () => installer.postMessage({ cancel: true });
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await new Promise((resolve, reject) => {
      installer.onerror = (event) => reject(new Error(event.message || "the install's worker failed"));
      installer.onmessage = ({ data }) => {
        if (data.said) {
          console.info(`GOG install of ${plan.name}: ${data.said}`);
        } else if (data.progress) {
          const { stage, done, total } = data.progress;
          if (stage === "finishing") {
            onProgress({ state: "packing", done: mib(done), total: mib(total),
              message: `Checking the files… ${total ? Math.floor((100 * done) / total) : 0}%` });
            return;
          }
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
      installer.postMessage({ installGog: { id, language: language(),
        plan: { build: plan.build, links: plan.links,
          ...plan.dependencies ? { dependencies: plan.dependencies } : {} },
        manifest: {
          id,
          title: plan.name,
          kind: "game",
          labels: [],
          revision: 1,
          store: { id: store, game },
          installedFrom: "GOG",
          // GOG's own addresses: a bottle carries them wherever it goes.
          coverLarge: art.capsule,
          coverSmall: art.capsule,
          coverFallback: art.header,
          wallpaper: art.hero,
        } } });
      // A stop asked while the worker was being started.
      if (signal?.aborted) cancel();
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
    installer.terminate();
  }
}
