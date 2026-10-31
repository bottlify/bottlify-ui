/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A Steam game installed in this browser, with the Bottlify bridge: the bridge
 * answers each depot's key and manifest code, and the page downloads from
 * Steam's content servers itself (the bridge opens them to this origin),
 * decodes in workers and writes the bottle into this origin's file system
 * (`install-worker.js`), where the library lists it beside the bottles kept
 * here. No game byte, key or code reaches the launcher's server; it is asked
 * only what Steam tells anyone of the app (`/steam/plan`). A run stopped part
 * way, by Cancel or a closed tab, goes on where it was when Install is pressed
 * again.
 */

import { depotOpenings, steamArt } from "./install.js";

/** @typedef {import("../../steam-store.mjs").InstallJob} InstallJob */

/**
 * The installs running or run in this page, by app id.
 *
 * @type {Map<number, { job: InstallJob, cancel: () => void }>}
 */
const running = new Map();

/** The installs of this page, as the store shows them. @returns {InstallJob[]} */
export const browserJobs = () => [...running.values()].map(({ job }) => ({ ...job }));

/** Stops an install of this page; what it has done is kept. @param {number} appId */
export const cancelBrowserInstall = (appId) => running.get(appId)?.cancel();

/** @param {number} bytes */
const mib = (bytes) => Math.round(bytes / 2 ** 20);

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
 * Installs an app of the account's in this browser, unless it is being
 * installed here already: then that run's job. Answers at once; the job
 * changes as the install goes.
 *
 * @param {number} appId
 * @param {(op: string, args?: Record<string, unknown>) => Promise<any>} ask  The bridge's.
 * @returns {InstallJob}
 */
export function installInBrowser(appId, ask) {
  const now = running.get(appId);
  if (now && (now.job.state === "downloading" || now.job.state === "packing")) return now.job;
  /** @type {InstallJob} */
  const job = { appId, state: "downloading", done: 0, total: 0, message: "Asking Steam…",
    local: true };
  /** @type {Worker[]} */
  const workers = [];
  let cancelled = false;
  running.set(appId, { job, cancel: () => {
    cancelled = true;
    workers[0]?.postMessage({ cancel: true });
  } });
  const end = () => workers.forEach((worker) => worker.terminate());

  (async () => {
    const plan = await fetch(`/steam/plan?app=${appId}`)
      .then(async (answer) => (answer.ok ? answer.json() : Promise.reject(new Error(await answer.text()))));
    if (!plan.launch) throw new Error(`${plan.name ?? appId} has no Windows launch option`);
    const [depots, servers] = await Promise.all([depotOpenings(plan, ask), ask("contentServers")]);
    if (!servers?.length) throw new Error("Steam offered no content server this browser can reach");
    if (cancelled) throw Object.assign(new Error("stopped"), { stopped: true });
    // Kept when the disk runs low, as a bottle a person chose is (bottles.js):
    // a game of gigabytes gone with the origin's storage is downloaded again.
    await navigator.storage?.persist?.().catch(() => false);

    const installer = spawn("steam-install");
    workers.push(installer);
    /** @type {MessagePort[]} */
    const ports = [];
    for (let at = 0; at < decoderCount(); at++) {
      const decoder = spawn("steam-decode");
      workers.push(decoder);
      const channel = new MessageChannel();
      decoder.postMessage({ serve: channel.port1 }, [channel.port1]);
      ports.push(channel.port2);
    }
    job.message = "Reading the depots…";
    const started = Date.now();
    let first = -1;
    const id = `steam-${appId}`;
    const executable = plan.launch.executable.replace(/\//g, "\\");
    return new Promise((resolve, reject) => {
      installer.onerror = (event) => reject(new Error(event.message || "the install's worker failed"));
      installer.onmessage = ({ data }) => {
        if (data.progress) {
          const { stage, done, total } = data.progress;
          job.state = stage === "finishing" ? "packing" : "downloading";
          job.done = mib(done);
          job.total = mib(total);
          if (stage === "finishing") {
            job.message = `Checking the files… ${total ? Math.floor((100 * done) / total) : 0}%`;
          } else {
            // The rate of this run, from what it had when it started downloading.
            first = first < 0 ? done : first;
            const seconds = (Date.now() - started) / 1000;
            job.message = `${((done - first) / 2 ** 20 / Math.max(1, seconds)).toFixed(1)} MiB/s`;
          }
        } else if (data.done) {
          resolve(id);
        } else if (data.error !== undefined) {
          reject(Object.assign(new Error(data.error), { stopped: data.stopped }));
        }
      };
      installer.postMessage({ install: { id, depots, servers, executable,
        ...plan.installscript ? { installscript: plan.installscript } : {},
        manifest: {
          id,
          title: plan.name ?? `Steam app ${appId}`,
          kind: "game",
          labels: [],
          entry: executable,
          revision: 1,
          steam: { appId },
          installedFrom: "Steam",
          ...plan.launch.arguments ? { commandLine: plan.launch.arguments } : {},
          ...steamArt(appId),
        } }, ports }, ports);
      // A Cancel while the worker was being started.
      if (cancelled) installer.postMessage({ cancel: true });
    });
  })().then((id) => {
    Object.assign(job, { state: "done", bundle: id, message: "Installed" });
  }, (/** @type {any} */ e) => {
    Object.assign(job, { state: "failed", message: e?.stopped || cancelled
      ? "Stopped — Install goes on from where it stopped" : String(e?.message ?? e) });
  }).finally(end);
  return job;
}
