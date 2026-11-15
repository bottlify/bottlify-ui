/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A layer built in this browser, the first time a bottle needs one the server
 * does not have: the runtime's own setup, run silently with no picture on an
 * empty Windows machine, and what its runs wrote kept as the layer
 * (`@bottlify/installer`'s `collectLayer`, `saveLayer`) in the origin's file
 * system beside the bottles, once for every bottle.
 *
 * The build is a session of its own (`layer-build-<id>`), saved as it goes,
 * and goes by stages written down here: a page closed while the setup runs
 * starts the setup again on an empty machine; one closed after it goes on
 * with what is left (ngen's queue lives in the session's registry). A process
 * cannot be resumed in the middle of its run.
 */

import { collectLayer, saveLayer } from "@bottlify/installer";
import { opfsSession } from "@bottlify/core/storage";
import { systemProgramImage } from "@bottlify/core/programs";
import { NETFX48, fetchRedistributable } from "./redist.js";

/** Where layers are kept: a folder of the origin's file system, one folder a layer. */
const FOLDER = "layers";
/** Where a build keeps the machine's hive it started from, until the layer is kept. */
const BEFORE = "before.json";
const STAGES_KEY = "bottlify.layer-builds";
/**
 * Guest RAM for each of the build's processes: the engine's default, what the
 * setup and ngen were run on in Node. At 2 GiB each on two cores the page's
 * renderer held over 8 GB committed on Windows while the engine's own account
 * said 1.6 GB, and a browser with a ceiling took the page.
 */
const MEMORY = 1024 * 1024 * 1024;
/**
 * The tab's memory for every process of the build together, by the engine's
 * account: the setup, the installers it starts, ngen's workers; past it the
 * translator lets its coldest modules go, and an allocation past it is refused.
 * Unbounded, the setup's run grew until the browser took the page.
 */
const MACHINE = 5 * 1024 * 1024 * 1024;
const REG = "C:\\WINDOWS\\system32\\reg.exe";

/**
 * @typedef {Object} LayerRecipe
 * @property {string} title
 * @property {string} version
 * @property {"win7"} windows  The machine the setup runs on: one it supports.
 * @property {import("./redist.js").Redistributable} setup
 * @property {string} arguments  Its silent mode.
 * @property {string[]} then  The programs of the volume run after it, each to its exit.
 */

/** The layers this browser can build, by id. @type {Record<string, LayerRecipe>} */
export const LAYER_RECIPES = {
  "dotnet48-x86": {
    title: ".NET Framework 4.8 (x86)",
    version: "4.8",
    windows: "win7",
    setup: NETFX48,
    arguments: "/q /norestart",
    // The native images 4.8's setup queues and leaves to the ngen service, which
    // never runs here: made now, every program on the layer starts from them.
    then: ["C:\\WINDOWS\\Microsoft.NET\\Framework\\v4.0.30319\\ngen.exe executeQueuedItems"],
  },
};

/** @returns {Promise<FileSystemDirectoryHandle>} */
async function layersFolder() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(FOLDER, { create: true });
}

/**
 * A layer kept in this browser, as `bundle.layers` takes it, or null.
 *
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function keptLayer(id) {
  try {
    const folder = await (await layersFolder()).getDirectoryHandle(id);
    const manifest = JSON.parse(await (await (await folder.getFileHandle("manifest.json"))
      .getFile()).text());
    const file = await (await folder.getFileHandle("bundle.btl")).getFile();
    return {
      file,
      id,
      // Here already: nothing of it is fetched, so nothing is kept again.
      store: null,
      ...(manifest.bundle?.indexSha256 ? { indexSha256: manifest.bundle.indexSha256 } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The stage a build of a layer stands at: `install` (from an empty machine),
 * `then` (the setup is done; `next` is the program of `then` to run), or none.
 *
 * @param {Pick<Storage, "getItem">} storage
 * @param {string} id
 * @returns {{ stage: "install" | "then", next?: number, started?: number } | null}
 */
export function buildStage(storage, id) {
  try {
    return JSON.parse(storage.getItem(STAGES_KEY) ?? "{}")[id] ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {Pick<Storage, "getItem" | "setItem">} storage
 * @param {string} id
 * @param {object | null} stage
 */
function writeStage(storage, id, stage) {
  let all = {};
  try {
    all = JSON.parse(storage.getItem(STAGES_KEY) ?? "{}");
  } catch {
    // A record that cannot be read is started again.
  }
  if (stage) all[id] = stage;
  else delete all[id];
  try {
    storage.setItem(STAGES_KEY, JSON.stringify(all));
  } catch {
    // Nowhere to keep it: a closed page starts the build again.
  }
}

/** The command line a program of the volume is started with, and its image's path. @param {string} line */
function split(line) {
  const [, quoted, bare] = /^\s*(?:"([^"]+)"|(\S+))/.exec(line) ?? [];
  const path = quoted ?? bare ?? "";
  return { path, commandLine: `"${path}"${line.slice(line.indexOf(path) + path.length).replace(/^"/, "")}` };
}

/**
 * @typedef {Object} BuildReport
 * @property {string} stage  What it is doing: `download`, `install`, `then`, `pack`, `done`.
 * @property {string} detail
 * @property {number} [step]   Which of `steps` it is at.
 * @property {number} [steps]
 * @property {{ read: number, total: number }} [progress]  Where there is a measure.
 * @property {Record<string, number>} [seconds]  How long each stage took, once over.
 */

/**
 * Builds a layer in this browser and keeps it; resolves to it as
 * `bundle.layers` takes it. A build a closed page left goes on from its stage.
 *
 * @param {string} id
 * @param {Object} deps
 * @param {(options: object) => Promise<any>} deps.createApp  The engine's.
 * @param {(report: BuildReport) => void} deps.report
 * @param {Storage} [deps.storage]  Where the stage is written down; localStorage.
 * @returns {Promise<object>}
 */
export async function buildLayer(id, { createApp, report, storage = localStorage }) {
  const recipe = LAYER_RECIPES[id];
  if (!recipe) throw new Error(`no recipe builds the layer ${id} in the browser`);
  const session = `layer-build-${id}`;
  const folder = await layersFolder();
  const work = await folder.getDirectoryHandle(`.build-${id}`, { create: true });
  const steps = 2 + recipe.then.length;
  /** @type {Record<string, number>} */
  const seconds = {};
  const timed = async (name, fn) => {
    const began = performance.now();
    try {
      return await fn();
    } finally {
      seconds[name] = Math.round((performance.now() - began) / 1000);
    }
  };
  /**
   * One program to its exit on the build's machine, with no picture.
   *
   * @param {Uint8Array} executable @param {string} imagePath @param {string} commandLine
   * @param {object} [more]
   * @param {((detail: string) => void) | null} [told]  What it is doing, as it goes.
   */
  const runOne = async (executable, imagePath, commandLine, more = {}, told = null) => {
    const app = await createApp({
      executable, imagePath, commandLine,
      windows: recipe.windows,
      storage: "opfs",
      id: session,
      memorySize: MEMORY,
      machineMemory: MACHINE,
      // One core, as a bottle with nothing said of its threads has: an executor's
      // worker more is memory more, and the setup gains nothing by it.
      cpu: { cores: 1 },
      unattended: true,
      ...more,
    });
    // The build's engine, for a person at the console or a script watching the
    // build, as a run's own is `globalThis.app`.
    globalThis.layerBuild = app;
    // A run with no picture says what it is doing by what it starts and writes:
    // a setup's helpers, ngen's workers, the files they leave.
    let written = 0;
    let latest = "";
    const tell = () => told?.(`${latest}${latest ? " - " : ""}${written} files saved so far`);
    if (told) {
      app.on("process-create", ({ image }) => {
        latest = String(image ?? "").split("\\").pop() ?? "";
        tell();
      });
      app.on("session", ({ changes }) => {
        written += Array.isArray(changes) ? changes.length : 0;
        tell();
      });
    }
    try {
      const code = await app.run({ maxTurns: Number.MAX_SAFE_INTEGER });
      return { code: code >>> 0, registry: app.registry().toJSON() };
    } finally {
      await app.dispose();
    }
  };

  let stage = buildStage(storage, id);
  if (!stage || stage.stage === "install") {
    // An empty machine: what a page closed in the middle of the setup left is not one.
    const root = await navigator.storage.getDirectory();
    for (const name of [`${session}.files`, `${session}.session`]) {
      await root.removeEntry(name, { recursive: true }).catch(() => {});
    }
    stage = { stage: "install", started: Date.now() };
    writeStage(storage, id, stage);

    report({ stage: "download", step: 1, steps, detail: recipe.setup.name });
    const setup = await timed("download", () => fetchRedistributable(recipe.setup,
      (read, total) => report({ stage: "download", step: 1, steps, detail: recipe.setup.name,
        progress: { read, total } })));

    // The machine's own hive, which every bottle has already: a layer carries only
    // what the runs add to it. A fresh machine of that Windows is always the same.
    const before = (await runOne(systemProgramImage(REG), REG, `"${REG}" query HKLM`,
      { storage: null, id: undefined })).registry;
    const keep = await (await work.getFileHandle(BEFORE, { create: true })).createWritable();
    await keep.write(JSON.stringify(before));
    await keep.close();

    report({ stage: "install", step: 2, steps, detail: `${recipe.title}: its setup, silently` });
    const imagePath = `C:\\Install\\${recipe.setup.name}`;
    const { code } = await timed("install", () => runOne(setup, imagePath,
      `"${imagePath}" ${recipe.arguments}`, { files: [{ path: imagePath, bytes: setup }] },
      (detail) => report({ stage: "install", step: 2, steps, detail })));
    // 3010: done, and a restart asked for, which a machine that starts afresh each run has.
    if (code !== 0 && code !== 3010) {
      throw new Error(`${recipe.setup.name} ended with ${code} (0x${code.toString(16)})`);
    }
    stage = { stage: "then", next: 0, started: stage.started };
    writeStage(storage, id, stage);
  }

  /** @type {any} */
  let registry = null;
  for (let at = stage.next ?? 0; at < recipe.then.length; at++) {
    const { path, commandLine } = split(recipe.then[at]);
    report({ stage: "then", step: 3 + at, steps, detail: commandLine });
    const files = (await opfsSession(session).load({ lazy: true })).files;
    const program = files.find((one) => one.path.toLowerCase() === path.toLowerCase());
    if (!program) throw new Error(`${path} is not among the files the setup left`);
    const executable = await /** @type {any} */ (program).read();
    const ran = await timed(`then${at}`, () => runOne(executable, path, commandLine, {},
      (detail) => report({ stage: "then", step: 3 + at, steps, detail })));
    if (ran.code !== 0) throw new Error(`${commandLine} ended with ${ran.code}`);
    registry = ran.registry;
    stage = { ...stage, next: at + 1 };
    writeStage(storage, id, stage);
  }

  report({ stage: "pack", step: steps, steps, detail: "keeping the layer in this browser" });
  const held = await opfsSession(session).load({ lazy: true });
  const before = JSON.parse(await (await (await work.getFileHandle(BEFORE)).getFile()).text());
  const files = collectLayer({ files: /** @type {any} */ (held.files),
    registry: registry ?? held.registry, before, leave: ["C:\\Install"] });
  const total = files.reduce((sum, one) => sum + (one.size ?? one.bytes?.length ?? 0), 0);
  const { packed } = await timed("pack", () => saveLayer({ files, directory: folder, id,
    manifest: { title: recipe.title, version: recipe.version },
    report: (packing) => report({ stage: "pack", step: steps, steps,
      detail: packing.detail ?? "", progress: { read: packing.bytes ?? 0, total } }) }));

  // What the build needed is gone with it: the layer is what stays.
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(`${session}.files`, { recursive: true }).catch(() => {});
  await folder.removeEntry(`.build-${id}`, { recursive: true }).catch(() => {});
  writeStage(storage, id, null);
  report({ stage: "done", steps, step: steps, seconds,
    detail: `${files.length - 1} files, ${packed.bytes} bytes kept` });
  const kept = await keptLayer(id);
  if (!kept) throw new Error(`the layer ${id} was packed and is not there`);
  return kept;
}
