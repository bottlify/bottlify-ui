/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Launching a title from the library, and driving it once it runs.
 *
 * Framework-free on purpose: everything here is the engine's business, and the
 * screen only subscribes to it through `report`.
 *
 * The engine is imported at run time rather than bundled with the launcher. It
 * is a tree of native ES modules served from the repository root by the dev
 * server, and loading it that way keeps the launcher's build out of the
 * engine's business entirely -- the browser resolves `./core.js` exactly as the
 * engine's own test page does.
 *
 * The engine runs in a worker the engine's own `createApp` spawns, and this
 * page keeps what only a page has: the speaker (the engine's `openSpeaker`,
 * opened inside the gesture that starts the run), the cursor, and the report. The worker opens its own GPU device and presents
 * straight into the canvas it was handed; this thread does nothing per frame,
 * and a click here is answered whatever the guest is doing. `?host=thread`
 * runs the same engine on this thread instead, for a comparison.
 */

import { discOptions, isDiscMedia } from "@bottlify/installer/disc";
import { prefixOptions } from "@bottlify/installer/prefix";
import { silentOptions } from "@bottlify/installer/silent";
import { getSidecarHooks, getSidecarSymbols } from "../api/bundles.js";
import { getConfig } from "../api/config.js";
import { mirrorChanges, mountOf, patchFor } from "./patches.js";
import { desktopPicture } from "./desktop.js";
import { bundleStart } from "./bottle.js";
import { bundleUrl, httpRanges, readBundle } from "./btl.js";
import { bottleFile } from "./bottles.js";
import { shownToThePerson } from "./boxes.js";
import { keepEnding, reportParts } from "./journal.js";
import { endRun, noteRun } from "./blackbox.js";
import { isTouchScreen } from "./touch.js";
import { phoneScreen, viewOf } from "../screen.js";
import {
  CHANGED, GPU_JOURNAL, SHADER_CHOICES, bottleConfigFor, driverRulesFor, loadSettings,
  multithreadingFor,
  memorySizeFor,
} from "../settings.js";

// The built, minified engine by default; `?engine=src` runs the source tree
// as it is, for work on the engine itself with no build step between edits.
const FROM_SOURCE = new URLSearchParams(window.location.search).get("engine") === "src";

/**
 * The virtual cores a page asks for, `?cores=N` (or `?executors=N`, its older
 * name), one or more; undefined when it names none and the engine chooses.
 * One is a choice like any other: the machine is told of one processor and
 * every thread runs on the process's own.
 *
 * @param {URLSearchParams} query
 * @returns {number | undefined}
 */
const coresAsked = (query) => {
  const named = query.get("cores") ?? query.get("executors");
  const cores = Math.floor(Number(named));
  return named !== null && cores >= 1 ? cores : undefined;
};

/**
 * From the console: `bottlifyRun({ cores: 3, checkReads: true })` reloads
 * this page with those run settings in its address, `bottlifyRun({})` with
 * none; `bottlifyRun()` says what this page runs with.
 *
 * @param {{ cores?: number, executors?: number, checkReads?: boolean }} [wanted]
 */
window.bottlifyRun = (wanted) => {
  const query = new URLSearchParams(window.location.search);
  if (wanted === undefined) {
    return {
      cores: coresAsked(query) ?? "chosen by the engine",
      checkReads: query.get("checkReads") === "1",
      isolated: window.crossOriginIsolated,
    };
  }
  query.delete("cores");
  query.delete("executors");
  query.delete("checkReads");
  const cores = wanted.cores ?? wanted.executors;
  if (cores !== undefined && cores >= 1) query.set("cores", String(cores));
  if (wanted.checkReads) query.set("checkReads", "1");
  window.location.search = query.toString();
  return wanted;
};
const ENGINE_URL = FROM_SOURCE ? "/source/modules/core/src/index.js" : "/engine/core.js";
const MEDIA_WASM_URL = "/engine/vendor/video-decoder.wasm";
/** Guest RAM for an installation: two gigabytes, the whole of a 32-bit user space. */
const INSTALLER_MEMORY = 2 * 1024 * 1024 * 1024;
const WORKLET_URL = FROM_SOURCE
  ? "/source/modules/core/src/layers/audio/output/worklet.js"
  : "/engine/worklet.js";

/** How often the guest's instruction count is read while it is still loading. */
const SAMPLE_MS = 400;

/** How long a launch waits for the audio thread before going on without it. */
const AUDIO_START_MS = 1000;


/** Engine events worth putting in front of a person while a title loads. */
const NOTED = [
  "bundle",
  "libraries",
  "libraries-missing",
  "libraries-attached",
  "library-loaded",
  "library-missing",
  "bundle-unavailable",
];

/** @param {number} bytes */
function megabytes(bytes) {
  return `${(bytes / (1 << 20)).toFixed(1)} MB`;
}

/** Where each title's measured first-frame times are kept, per bundle. */
const FIRST_FRAME_TIMES = "bottlify.first-frame-ms";

/**
 * How long this title's first frame has taken here before, in milliseconds.
 *
 * The launcher's own measurement, not a number from anywhere else: a range on
 * screen that nobody took the time to record would be a number invented, which
 * is worse than saying nothing.
 *
 * @param {string} id
 * @returns {number[]}
 */
function readFirstFrameTimes(id) {
  try {
    const all = JSON.parse(localStorage.getItem(FIRST_FRAME_TIMES) ?? "{}");
    const list = all?.[id];
    return Array.isArray(list) ? list.filter((ms) => Number.isFinite(ms) && ms > 0) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} id
 * @param {number} ms
 */
function rememberFirstFrameTime(id, ms) {
  try {
    const all = JSON.parse(localStorage.getItem(FIRST_FRAME_TIMES) ?? "{}") ?? {};
    // The last few rather than every run: a title started twenty times would
    // otherwise be judged by runs from months ago, on another machine.
    all[id] = (Array.isArray(all[id]) ? all[id] : []).concat(Math.round(ms)).slice(-8);
    localStorage.setItem(FIRST_FRAME_TIMES, JSON.stringify(all));
  } catch {
    // Nowhere to keep it; the next launch simply has no range to show.
  }
}

/**
 * One table out of what `app.diagnostics()` answers.
 *
 * The worker host answers only the named layer; the same-thread host answers
 * every table because its `diagnostics` takes no argument. Finding by name
 * works for both, so the caller does not have to know which host it is on.
 *
 * @param {any} tables
 * @param {string} name
 * @returns {any}
 */
function tableNamed(tables, name) {
  if (!Array.isArray(tables)) return tables;
  return tables.find((table) => table?.name === name) ?? null;
}

/**
 * A failure a person can act on: the reason first, the detail after.
 *
 * @param {string} reason
 * @param {string} message
 * @param {string} [trace]
 */
function failure(reason, message, trace) {
  const error = new Error(message);
  Object.assign(error, { reason, traceText: trace });
  return error;
}

/** The engine's module, imported once and kept: the speaker is opened from it inside a gesture. */
/** @type {Promise<any> | null} */
let engineModule = null;
/** @type {any} */
let engineLoaded = null;

/**
 * Imports the engine, once. A page that will start a run calls it early, so
 * the engine is at hand by the time a person's gesture opens the speaker.
 *
 * @returns {Promise<any>}
 */
export function loadEngine() {
  engineModule ??= import(/* @vite-ignore */ ENGINE_URL).then((loaded) => {
    engineLoaded = loaded;
    return loaded;
  }, (e) => {
    engineModule = null;
    throw e;
  });
  return engineModule;
}

/**
 * The engine's module if it is loaded already, for what has to be called
 * inside a gesture (fullscreen) and cannot wait for an import; null before.
 *
 * @returns {any}
 */
export function engineNow() {
  return engineLoaded;
}

/**
 * Whether a run started now would have sound: the settings, under the page's
 * own `?sound=0`.
 */
export function soundWanted() {
  return loadSettings().sound && new URLSearchParams(window.location.search).get("sound") !== "0";
}

/**
 * The run's speaker, opened now: call it inside the gesture that starts the
 * run, before any await -- a phone starts sound there and nowhere else. Null
 * when no sound is wanted or the engine is not loaded yet.
 *
 * @returns {any}
 */
export function openRunSpeaker() {
  if (!soundWanted() || !engineLoaded?.openSpeaker) return null;
  return engineLoaded.openSpeaker({ worklet: WORKLET_URL });
}


/**
 * Fetches a whole resource, reporting how much of it has arrived.
 *
 * The total is whatever the response named; zero means the server did not say,
 * and the caller shows a count without a bar rather than a bar without a
 * denominator.
 *
 * @param {string} url
 * @param {string} label
 * @param {(read: number, total: number) => void} progress
 * @returns {Promise<Uint8Array>}
 */
async function fetchBytes(url, label, progress) {
  const response = await fetch(url);
  if (!response.ok) {
    throw failure(
      `${label} could not be read`,
      `${url} answered ${response.status} ${response.statusText}.`,
    );
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    read += value.length;
    progress(read, total);
  }
  const bytes = new Uint8Array(read);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/**
 * The cursor over the canvas, as the program would have it.
 *
 * The arrow until the program says otherwise, as on Windows: an installer or
 * a windowed program never touches the cursor and is owed the system's. A
 * game of this era hides it (ShowCursor, a null cursor, a device cursor) and
 * draws its own into the frame, and then "none" is honoured everywhere, in
 * the windowed view as much as in fullscreen. Over a locked pointer the
 * browser shows no cursor at all, so the session draws this one itself.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} wanted  A CSS cursor: "none", or a bitmap of the program's.
 */
function applyCursor(canvas, wanted) {
  canvas.style.cursor = wanted;
}

/**
 * The arrow, for a cursor shown with no bitmap of its own: a program that
 * hides and shows the arrow through user32 and never hands a device a cursor.
 */
const ARROW = {
  url: "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="19">'
    + '<path d="M.5.5v16l4-4 3 6 2-1-3-6h5.5z" fill="#fff" stroke="#000"/></svg>'),
  x: 0,
  y: 0,
};

/**
 * The program's cursor as a picture: an image address and its hot spot.
 *
 * The device is given a bitmap and a hot spot and asked to draw them over
 * its frames; nothing in the engine composites one, so the engine hands the
 * bitmap here and the page shows it -- as the canvas's own cursor, or drawn
 * over a locked pointer.
 *
 * @param {{ width?: number, height?: number, hotSpot?: { x: number, y: number },
 *     bgra?: Uint8Array }} cursor
 * @returns {{ url: string, x: number, y: number }}
 */
function cursorPicture(cursor) {
  if (!cursor.bgra) return ARROW;
  const image = new ImageData(cursor.width, cursor.height);
  for (let at = 0; at < image.data.length; at += 4) {
    image.data[at] = cursor.bgra[at + 2];
    image.data[at + 1] = cursor.bgra[at + 1];
    image.data[at + 2] = cursor.bgra[at];
    image.data[at + 3] = cursor.bgra[at + 3];
  }
  const sheet = document.createElement("canvas");
  sheet.width = cursor.width;
  sheet.height = cursor.height;
  sheet.getContext("2d")?.putImageData(image, 0, 0);
  return { url: sheet.toDataURL("image/png"), x: cursor.hotSpot.x, y: cursor.hotSpot.y };
}

/**
 * The program's cursor, as CSS. Hidden means no cursor at all over the
 * canvas, which is what the program asked.
 *
 * @param {{ bgra?: Uint8Array, shown: boolean }} cursor
 * @param {{ url: string, x: number, y: number }} picture
 * @returns {string}
 */
function cursorStyle(cursor, picture) {
  if (!cursor.shown) return "none";
  if (!cursor.bgra) return "auto";
  return `url(${picture.url}) ${picture.x} ${picture.y}, auto`;
}

/**
 * @typedef {Object} SessionReport
 * @property {"fetch"|"init"|"loading"|"running"|"paused"|"stopped"|"exited"|"failed"} [stage]
 * @property {string} [detail]   What this stage is doing right now.
 * @property {{ label: string, read: number, total: number } | null} [progress]
 *            A named fetch still arriving: bytes read, and its total when the
 *            server named one (zero means it did not).
 * @property {number} [elapsed]  Seconds since the launch began.
 * @property {{ low: number, high: number } | null} [usual]
 *            How long this title's first frame has taken here before, in
 *            seconds. Null until a previous run was timed.
 * @property {number} [images]   PE images the loader has placed so far.
 * @property {number} [blocks]   Distinct bundle blocks the guest has read.
 * @property {string} [note]     The last thing the engine said about itself.
 * @property {{ width: number, height: number, rgba?: Uint8ClampedArray, png?: Uint8Array } | null} [icon]
 *            The program's own icon (the engine's `programIcon`), null when it has none.
 * @property {string} [off]      A subsystem that has switched itself off for the
 *                               whole run. Unlike a note, which is the latest
 *                               line of a running log and is replaced by the
 *                               next one, this stays in front of the person: a
 *                               decline nobody is told about reads from the
 *                               outside as the engine being broken and silent.
 * @property {{ width: number, height: number }} [frame]
 * @property {{ width: number, height: number, bitsPerPixel: number }} [screen]
 *            The display the program is told it has, before it has drawn.
 * @property {{ reason: string, message: string, trace: string }} [error]
 * @property {{ id: number, text: string, caption: string, type: number,
 *             buttons: { id: number, label: string }[], defaultButton: number,
 *             icon: string | null, trace: string | null } | null} [messageBox]
 * @property {number} [exitCode]
 * @property {string} [trace]    The journal's tail, for a run that ended on its own.
 * @property {{ count: number }} [system]  How many files the DirectX runtime mounted.
 * @property {string} [hooks]  What the bundle's sidecar hooks bound and refused, for
 *                             the whole run; absent when the bundle carries no sidecar.
 */

/**
 * The last of what the engine logged, as the Logs panel would print it.
 *
 * @param {any} app
 */
async function journalTail(app) {
  const records = await app.log.recent(200);
  return records
    .map((record) => `${(record.time / 1000).toFixed(3)} ${record.levelName.slice(0, 4)} ${record.category} ${record.text}`)
    .join("\n");
}

/**
 * @typedef {Object} SessionControls
 * @property {any} app
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {(on: boolean) => void} showCursorAlways  On a touch screen, draws a cursor
 *     where the program's is even while the program hides it: the virtual cursor a
 *     touchpad is steered by.
 * @property {() => Promise<void>} stop
 */

/**
 * What is recorded from the first instruction, and how much of it is kept.
 *
 * The saved settings are the base; the address bar adds to them and wins on the
 * ring's size. A harness driving this page asks for exactly the areas its
 * scenario is about and cannot know what the person at this browser last chose,
 * so an explicit `?log=` is never narrowed by a stored preference -- and a run
 * asking for areas that way still gets the big ring it always got.
 *
 * @param {import("../settings.js").RunSettings} settings
 * @returns {{ categories: Record<string, string>, capacity: number, bytes?: number }}
 */
function requestedLog(settings) {
  const asked = new URLSearchParams(window.location.search);
  const areas = (asked.get("log") ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const all = settings.logAreas.concat(areas);
  // The ring is sized for a capture of a few heavy frames of `call.gpu`
  // (tens of thousands of calls each) whether or not that area is on at
  // launch: an area switched on while a title runs cannot grow the ring
  // after the fact, and a ring that holds what the panel shows costs memory
  // only -- nothing runs for a category that is off.
  return {
    categories: Object.fromEntries(all.map((area) => [area, "trace"])),
    capacity: Number(asked.get("logSize") ?? 0) || GPU_JOURNAL.capacity,
    bytes: GPU_JOURNAL.bytes,
  };
}

/**
 * Starts a title and hands back the controls for it.
 *
 * Resolves once the guest is running -- not once it has finished -- so the
 * caller has something to press while it loads.
 *
 * Either a bundle or a distribution: a bundle is a finished game, mounted
 * read-only under a writable layer, and a distribution is a program run in a
 * prefix with nothing beneath it at all -- an installer, or a disc image, which
 * the engine mounts as a CD-ROM drive of its own and starts the program it
 * names from. Everything between those lines -- the device, the sound, the
 * input, the frames -- is the same run, which is why there is one function
 * rather than several.
 *
 * @param {Object} options
 * @param {import("../api/bundles.js").BundleManifest} [options.bundle]
 * @param {import("@bottlify/installer/prefix").InstallMedia
 *     | import("@bottlify/installer/disc").DiscMedia} [options.media]
 * @param {HTMLCanvasElement} options.canvas
 * @param {(report: SessionReport) => void} options.report
 * @param {boolean} [options.silentInstall]  Run an installer in its silent mode, with no
 *     dialogs: for installs with no screen. The launcher has one, and leaves it off.
 * @param {any} [options.speaker]  The speaker `openRunSpeaker` opened inside the gesture
 *     that started the run; the run owns it from here and closes it.
 * @returns {Promise<SessionControls>}
 */
export async function launch(options) {
  const box = openBox(options.bundle);
  try {
    return await run(options, box);
  } catch (e) {
    box.end();
    // Opened for a run that never got as far as playing; closing twice is nothing.
    options.speaker?.close();
    throw e;
  }
}

/**
 * Where a run is, written down once a second while it goes (`blackbox.js`):
 * a page the browser kills for its memory leaves no other trace. The record
 * is closed by every end the page sees, a reload or a navigation among them.
 *
 * @param {import("../api/bundles.js").BundleManifest | undefined} bundle
 */
function openBox(bundle) {
  if (!bundle) return { update() {}, end() {} };
  const began = performance.now();
  /** @type {import("./blackbox.js").RunRecord} */
  const record = { id: bundle.id, title: bundle.title ?? bundle.id, startedAt: Date.now(),
    elapsed: 0, stage: "fetch", query: window.location.search };
  const write = () => {
    record.elapsed = (performance.now() - began) / 1000;
    noteRun(localStorage, record);
  };
  write();
  const timer = setInterval(write, 1000);
  let open = true;
  const end = () => {
    if (!open) return;
    open = false;
    clearInterval(timer);
    window.removeEventListener("pagehide", end);
    endRun(localStorage);
  };
  window.addEventListener("pagehide", end);
  return {
    /** @param {Partial<import("./blackbox.js").RunRecord>} patch */
    update(patch) {
      if (open) Object.assign(record, patch);
    },
    end,
  };
}

/**
 * @param {Parameters<typeof launch>[0]} options
 * @param {ReturnType<typeof openBox>} box
 */
async function run({ bundle, media, canvas, report: show, silentInstall = false, speaker = null }, box) {
  /** @param {SessionReport} patch */
  const report = (patch) => {
    if (patch.stage || patch.detail) {
      box.update({
        ...(patch.stage ? { stage: patch.stage } : {}),
        ...(patch.detail ? { detail: patch.detail } : {}),
      });
    }
    show(patch);
  };
  const asked = new URLSearchParams(window.location.search);
  // `?sound=0`, `?video=0`, `?memory=256`: a run without the audio thread,
  // without the decoder, or with that many megabytes of guest memory, over the
  // settings -- one part taken out at a time, for a device that says nothing
  // of why it took the page away.
  const settings = {
    ...loadSettings(),
    ...(asked.get("sound") === "0" ? { sound: false } : {}),
    ...(asked.get("video") === "0" ? { video: false } : {}),
  };
  const memoryAsked = Number(asked.get("memory")) * 1024 * 1024;
  // A phone is told a desktop of its own landscape shape (`screen.js`);
  // everything else the screen of the settings.
  const screen = isTouchScreen(window) ? phoneScreen(viewOf(window)) : settings.screen;
  report({ screen });
  const { networking, cork: corkConfig, graphics: graphicsConfig, cpu: cpuConfig } = await getConfig();
  // The clock the loader's "elapsed" line reads, started before the engine is
  // even imported: fetching it is part of the wait the person is in.
  const beganAt = performance.now();
  // What this title has taken here before, so the wait can be given a range
  // rather than a vague reassurance. A media install has no id to name it by.
  const past = bundle ? readFirstFrameTimes(bundle.id) : [];
  const usual = past.length > 0
    ? { low: Math.min(...past) / 1000, high: Math.max(...past) / 1000 }
    : null;
  report({ stage: "fetch", detail: "loading the engine", progress: null, usual });
  // The bottle's desktop -- its wallpaper, or our mark on black -- made first,
  // so the engine paints the guest's desktop with it. The stage itself shows
  // none of it before the first frame. A picture that cannot be made leaves
  // the desktop its colour; it is never a reason not to start.
  const backdrop = bundle
    ? await desktopPicture(bundle, screen).catch(() => null)
    : null;

  // The engine and the frames it presents while the work below is still going.
  // Declared here so the timer started next can read them without waiting for
  // an assignment that is seconds away.
  /** @type {any} */
  let app = null;
  let frames = 0;
  let stopping = false;

  // What the run held by its own account, written to the black box every few
  // seconds for as long as it runs: a phone ends the tab for its memory
  // without a word, and this is what the next visit can say of where it was.
  let memoryAt = 0;
  const noteMemory = async () => {
    const [zones, cpu, counters] = await Promise.all([
      app.diagnostics("zones").catch(() => []),
      app.diagnostics("cpu").catch(() => []),
      app.log.counters("cpu").catch(() => ({})),
    ]);
    const z = tableNamed(zones, "zones")?.metrics?.zones;
    const c = tableNamed(cpu, "cpu")?.metrics ?? {};
    const held = (zone) => (z?.[zone] ? megabytes(z[zone].bytes) : "?");
    box.update({
      instructions: counters.instructions ?? 0,
      memory: `guest ${held("guest")}, translation ${held("translation")}, heaps ${held("heaps")}`
        + `, collector nudges ${c.gcNudges ?? "none"} (${c.gcNudgesRefused ?? 0} refused)`,
    });
  };

  // One timer for the whole wait, running from before the engine exists. The
  // first stage reports nothing of its own but time, and a stage with no
  // number to show is still a stage the person is sitting in.
  const progressTimer = setInterval(async () => {
    if (stopping) return;
    const elapsed = (performance.now() - beganAt) / 1000;
    if (app && elapsed - memoryAt >= 5) {
      memoryAt = elapsed;
      noteMemory().catch(() => {});
    }
    if (!app || frames > 0) {
      report({ elapsed });
      return;
    }
    try {
      // The loader's image count and the app's own block read counters, beside
      // the guest's retired instructions: three real measures, each of the
      // path it describes. Read together, once per tick, because each is a
      // round trip to the engine's thread.
      const [cpu, loader, appTables] = await Promise.all([
        app.log.counters("cpu").catch(() => ({})),
        app.diagnostics("loader").catch(() => []),
        app.diagnostics("app").catch(() => []),
      ]);
      if (stopping || frames > 0) return;
      const images = tableNamed(loader, "loader")?.metrics?.images ?? 0;
      const bundleReads = tableNamed(appTables, "app")?.metrics?.bundle ?? {};
      const blocks = bundleReads.distinct ?? 0;
      const fetched = bundleReads.rangeBytes ?? 0;
      box.update({ instructions: cpu.instructions ?? 0 });
      const parts = [`${(cpu.instructions ?? 0).toLocaleString()} guest instructions`];
      if (images > 0) parts.push(`${images} PE image${images === 1 ? "" : "s"} loaded`);
      if (blocks > 0) parts.push(`${blocks.toLocaleString()} bundle blocks read`);
      if (fetched > 0) parts.push(`${megabytes(fetched)} fetched`);
      report({ detail: parts.join(" · "), elapsed, images, blocks });
    } catch {
      // The engine is going; there is no progress left to report.
      report({ elapsed });
    }
  }, SAMPLE_MS);

  const engine = await loadEngine().catch((e) => {
    clearInterval(progressTimer);
    throw failure(
      "the engine did not load",
      `${ENGINE_URL} could not be imported (${e.message}). The launcher has to be `
        + "served by ui/server.mjs, which serves the repository root beside it.",
    );
  });
  const { createApp, openSpeaker, keepScreenAwake, exitFullscreen, watchFullscreen } = engine;

  // A disc is read here only as far as finding the program it starts: its
  // descriptors, its directories, autorun.inf and that program. The image
  // itself goes to the engine as the file the person chose, read a range at a
  // time from there.
  const disc = media && isDiscMedia(media)
    ? await discOptions(media, { silent: silentInstall, entry: media.entry }).catch((e) => {
      clearInterval(progressTimer);
      throw failure("the disc could not be started", e.message);
    })
    : null;
  const prefix = disc ?? (media ? prefixOptions(media) : null);
  // An installer runs with its own windows on the canvas, the person clicking
  // through it as on a real machine. Its silent mode is for installs with no
  // screen at all -- a terminal, a script -- and the launcher always has one.
  const unattended = disc
    ? disc.unattended
    : media && silentInstall ? silentOptions(media, { silent: true }) : null;
  // A bottle kept in this browser keeps the program it starts beside it; any
  // other's is read out of its bundle by this page, from wherever the bundle is.
  const kept = !prefix && bundle?.local === true;
  const executable = prefix
    ? prefix.executable
    : kept
      ? new Uint8Array(await (await bottleFile(bundle.id, "entry")).arrayBuffer())
      : await readBundle(httpRanges(bundleUrl(bundle)))
        .then((read) => read.read(bundle.entry, (done, total) => report({
          detail: `entry image — ${megabytes(done)} of ${megabytes(total)}`,
          progress: { label: "entry image", read: done, total },
        })))
        .catch((e) => {
          throw failure("entry image could not be read", `${bundleUrl(bundle)}: ${e.message}`);
        });
  // The program's own icon, for the tab and the home screen to show the game by.
  if (bundle) report({ icon: engine.programIcon?.(executable) ?? null });
  // Beside the bundle's manifest, never inside it -- absent for most bundles.
  const sidecarHooks = bundle && !kept ? await getSidecarHooks(bundle.id) : undefined;
  // Same convention: the perf overlay's "guest code" block folds the cpu
  // layer's raw address buckets through this when there is one.
  const sidecarSymbols = bundle && !kept ? await getSidecarSymbols(bundle.id) : undefined;
  // Optional: a build without it runs everything that
  // never plays a video, and the media layer says so in its own diagnostics.
  // Refusing to launch over a missing decoder would be a worse answer than the
  // one the panel already gives.
  const decoder = settings.video
    ? await fetchBytes(MEDIA_WASM_URL, "video decoder", (read, total) => report({
      detail: `video decoder — ${megabytes(read)}${total ? ` of ${megabytes(total)}` : ""}`,
      progress: { label: "video decoder", read, total },
    }))
      .catch((e) => {
        report({ off: `No video decoder: ${e.message}` });
        return null;
      })
    : null;
  // Said as loudly as a decoder that failed to arrive. A person who switched
  // this off a week ago and is now watching a game skip its intro deserves the
  // same sentence as one whose decoder is missing.
  if (!settings.video) {
    report({ off: "No video decoder: switched off in settings." });
  }

  // The speaker the gesture opened; one opened here, past every await, runs
  // only where the browser lets a page that was clicked once start sound
  // whenever it likes -- which is what `ready` says.
  let audio = settings.sound
    ? speaker ?? openSpeaker?.({ worklet: WORKLET_URL }) ?? null
    : (await speaker?.close(), null);
  if (audio) {
    const { running, reason } = await audio.ready(AUDIO_START_MS);
    if (!running) {
      report({ off: `No sound: ${reason}.` });
      await audio.close();
      audio = null;
    }
  }
  if (!settings.sound) {
    report({ off: "No sound: switched off in settings." });
  }

  report({
    stage: "init",
    detail: "building the process, mapping its images and binding imports",
    // The byte bar belongs to the fetch stage; the machine's own build reports
    // nothing of its own, which the copy says rather than dressing up.
    progress: null,
  });


  const query = new URLSearchParams(window.location.search);
  const setCursor = (wanted) => applyCursor(canvas, wanted);

  // Diagnostic: `?hook=Module:offset:label:argBytes:len,len[:strings];...` puts
  // a watch in front of routines inside a program's own module the moment that
  // module is loaded, so calls the program makes into its own code -- and their
  // answers -- appear in the trace from the first one. The instruction lengths
  // of the moved prefix come from a disassembly; `strings` names arguments to
  // show as C strings, stack slots by number or `ecx`/`edx`, joined by `+`.
  // Local instrument only.
  const hooks = (query.get("hook") ?? "")
    .split(";").filter(Boolean).map((spec) => {
      const [module, offset, label, argBytes, lengths, strings] = spec.split(":");
      return { module: module.toLowerCase(), offset: Number(offset), label,
        argBytes: Number(argBytes), lengths: lengths.split(",").map(Number),
        strings: (strings ?? "").split("+").filter(Boolean)
          .map((s) => (/^\d+$/.test(s) ? Number(s) : s)) };
    });

  // Diagnostic: `?watch=mss32.dll,storm.dll` puts a watch in front of every
  // decorated stdcall import the program binds from those libraries, so calls
  // from one guest module into another appear in the trace. `lib.dll#268+279`
  // watches only those ordinals, for a library whose every call would drown
  // the log; `watchStrings=0,2` names which arguments of an ordinal watch are
  // C strings. Local instrument only.
  const watched = (query.get("watch") ?? "").split(",").filter(Boolean).map((spec) => {
    const [dll, ords] = spec.split("#");
    return [dll.toLowerCase(), ords ? ords.split("+").map(Number) : null];
  });

  // Where the engine mounts a bundle, and the program is told it was loaded
  // from (`bundleStart`). A distribution says where it was put instead,
  // because it reads its own file.
  const started = prefix ? null
    : bundleStart(bundle, settings, kept ? await bottleFile(bundle.id, "bundle.btl") : null);
  // `?preload=1`, what the library's Download asks for: the bundle comes in
  // whole before the program starts, told as it goes.
  if (started && query.get("preload") === "1") started.bundle.preload = true;
  const patch = prefix ? null : await patchFor(bundle.id);
  const imagePath = prefix ? prefix.imagePath : started.imagePath;

  // The signed-in Steam account, for a bottle that is a Steam app; null when
  // nobody is signed in, and the program finds no Steam running.
  const steamAccount = bundle?.steam?.appId
    ? await fetch("/steam/account").then((r) => (r.ok ? r.json() : null)).catch(() => null)
    : null;
  /** @type {Record<string, any>} */
  const options = {
    // Where the engine runs: a worker of its own unless asked otherwise.
    host: query.get("host") === "thread" ? "thread" : "worker",
    // How much rides on shared memory: the engine's own `auto` -- isolated
    // on this page when it is cross-origin isolated, compatible when it is
    // not -- unless `?mode=compatible` or `?mode=isolated` forces one;
    // isolated on a page that cannot share memory is refused rather than run.
    mode: ["compatible", "isolated"].includes(query.get("mode") ?? "") ? query.get("mode") : "auto",
    // `?guestCode=off`: Direct3D 8 and 9 trap every call rather than record
    // and answer in the guest, for telling a fault in that guest code apart.
    // `?guestTraps=getters,ring` keeps those parts of it, or methods named, as
    // traps while the rest stays in the guest.
    graphics: {
      // The deployment's own settings (`config.json`'s `graphics`), under
      // what the address asks for.
      ...graphicsConfig,
      ...(query.get("guestCode") === "off" ? { guestCode: false } : {}),
      ...(query.get("guestTraps") ? { guestTraps: (query.get("guestTraps") ?? "").split(",") } : {}),
      // `?lendMemory=off`: what a Direct3D 8 or 9 program unlocks is copied
      // to the graphics worker rather than read in place.
      ...(query.get("lendMemory") === "off" ? { lendMemory: false } : {}),
      // `?bc=on`: block-compressed textures go to the GPU as BC blocks where
      // the adapter samples them, rather than decoded into RGBA first.
      ...(query.get("bc") === "on" ? { compressedTextures: true } : {}),
      // `?keepMemory=1`: what a released Direct3D resource held is never
      // given back to the guest's heap.
      ...(query.get("keepMemory") === "1" ? { keepMemory: true } : {}),
      // `?rereadBuffers=1`: every Direct3D draw reads the vertices it reaches
      // from guest memory again (with `graphicsWorker=off`).
      ...(query.get("rereadBuffers") === "1" ? { rereadBuffers: true } : {}),
      // `?driverRules=current`: where Direct3D left a behaviour to the driver,
      // later drivers' and Wine's answer rather than the shader-model-1 era's.
      ...((query.get("driverRules") ?? (bundle ? driverRulesFor(settings, bundle) : undefined))
        === "current" ? { driverRules: "current" } : {}),
    },
    // `?blockProfile=SECONDS`: the translator counts every block it runs from
    // that many seconds into the run (0 from the start), and a report names
    // the hottest -- where the guest's own time goes, past a long load. Asked
    // for, never by default: counted code is kept in no store, so such a run
    // translates everything again and plays slower for it.
    // `?checkReads=1`: a read of a page reserved without access faults in
    // translated code too, for a program that pages its data in from its
    // own exception handler.
    // `?traceStore=1`: every translation-store key put and missed, with the
    // region's entry and blocks, in the cpu diagnostics (`cork.storeTrace`) --
    // two runs' lists say whether a miss was never put, put and lost, or put
    // under another key.
    // The deployment's own settings for the translator (`config.json`'s
    // `cork`), under what the address asks for.
    // `?translate=0`: every instruction interpreted, nothing compiled to wasm;
    // `?translateWorker=0`: translated on the engine's own thread, no worker.
    ...(query.has("blockProfile") || query.get("checkReads") === "1"
      || query.get("traceStore") === "1" || query.get("translate") === "0"
      || query.get("translateWorker") === "0" || Object.keys(corkConfig).length > 0
      ? { cork: { config: {
        ...corkConfig,
        ...(query.has("blockProfile")
          ? { blockProfile: true, blockProfileFrom: Number(query.get("blockProfile")) || 0 } : {}),
        ...(query.get("checkReads") === "1" ? { checkReads: true } : {}),
        ...(query.get("traceStore") === "1" ? { traceStore: true } : {}),
        ...(query.get("translate") === "0" ? { translate: false } : {}),
        ...(query.get("translateWorker") === "0" ? { worker: false } : {}),
      } } }
      : {}),
    // `?cores=3` (`?executors=3` of old): the virtual cores the machine has,
    // its threads that are ready together running at once on that many; one
    // is asked for as plainly as three. They share memory, so a page that is
    // not cross-origin isolated runs on one and the engine's diagnostics say
    // why. Named none, the engine chooses.
    // Without it, the bottle's `multithreading`: false -- also when it says
    // nothing -- runs on one core; true leaves the cores to the engine.
    // The deployment's own settings (`config.json`'s `cpu`), under the cores
    // the address or the title's settings ask for.
    ...(coresAsked(query) !== undefined ? { cpu: { ...cpuConfig, cores: coresAsked(query) } }
      : bundle && multithreadingFor(settings, bundle)
        ? Object.keys(cpuConfig).length > 0 ? { cpu: cpuConfig } : {}
        : { cpu: { ...cpuConfig, cores: 1 } }),
    canvas,
    // Handed over rather than copied: the binary is megabytes nothing on this
    // side reads again.
    transfer: decoder ? [decoder.buffer] : [],
    executable,
    media: decoder ? { wasmBytes: decoder.buffer } : undefined,
    imagePath,
    // The relay on this page's own origin, where the configuration says there
    // is one: the client module served from the repository, the socket beside
    // the page, and the bundle as the room -- two tabs playing the same title
    // are on one LAN, and a host outside it is reached only if the server was
    // started allowing it. Without it the program has no network.
    // A Steam app is started with Steam running for the account signed in on
    // /steam, the app's ownership answered from that account's licences.
    ...(steamAccount ? { win32: { steam: { ...steamAccount, appId: bundle?.steam?.appId } } } : {}),
    ...(networking ? { network: {
      module: new URL("/networking/client/index.js", window.location.href).href,
      url: `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/networking/relay`,
      room: bundle?.id ?? "installer",
    } } : {}),
    // An unattended install answers for itself, and a disc says what its
    // program is started with; otherwise a bundle's own manifest may carry the
    // arguments its program is started with, appended after the quoted image
    // path the same way createApp's own default is built.
    // `?args=` adds to them, for a run that wants a setting the program takes
    // on its command line (`?args=+set r_fastSkin 0`).
    commandLine: unattended
      ? unattended.commandLine
      : disc
        ? disc.commandLine
        : bundle?.commandLine || query.get("args")
          ? `"${imagePath}" ${[bundle?.commandLine, query.get("args")].filter(Boolean).join(" ")}`
          : undefined,
    // The disc image as the file the person chose: it crosses to the worker
    // by reference, and the engine mounts it as D:, read-only. A bottle whose
    // program reads its disc while it plays keeps the image beside its bundle,
    // read a range at a time from there.
    discs: disc?.discs ?? bundle?.discs?.map((name) => ({
      image: { url: new URL(`/bundles/${encodeURIComponent(bundle.id)}/`
        + `${name.split("/").map(encodeURIComponent).join("/")}`, location.href).href },
    })),
    // A disc's program starts in the disc's root, as AutoPlay starts it.
    startDirectory: disc?.startDirectory,
    traceStrings: settings.traceStrings,
    // `?profile=calls`: every host call timed as a phase of its own, for a
    // cost per API; it costs two clock readings a call, so only when asked.
    profileCalls: query.get("profile") === "calls" || settings.profileCalls,
    // `?drive=0`: host calls written as steps go through promises, a turn
    // a guest call, rather than in the slice they came in (`driveGuestCalls`).
    ...(query.get("drive") === "0" ? { driveGuestCalls: false } : {}),
    // What the program is told its display is. Handed over even when it is the
    // default, because the default here and the engine's are the same number
    // and a screen the person chose has to reach every layer that answers for
    // one, not only the ones a launch happens to mention.
    screen,
    maxFps: settings.maxFps,
    quantum: settings.quantum,
    // The Windows and the graphics API the bottle runs as (`bottleConfigFor`).
    ...(prefix || !bundle ? {} : bottleConfigFor(settings, bundle)),
    // `?gpu=sm1` .. `sm4` or `host`: the video adapter's profile, over the bottle's.
    ...(SHADER_CHOICES.some((one) => one.value === query.get("gpu"))
      ? { gpuProfile: query.get("gpu") } : {}),
    // The saved areas, plus whatever `?log=call.audio,call.com&logSize=40000`
    // on the launcher's own address asks for. Everything a program decides
    // about a device it decides while starting up, and a category switched on
    // once the engine exists is switched on after all of that has happened --
    // which is why this is a setting rather than only a row of chips.
    log: requestedLog(settings),
    watch: watched.length > 0
      ? {
        libraries: Object.fromEntries(watched),
        strings: (query.get("watchStrings") ?? "").split(",").filter(Boolean).map(Number),
      }
      : undefined,
    hooks,
    sidecarHooks,
    audio: {
      // Something drains the ring, at the device's own rate so nothing between
      // the mixer and the speakers resamples, and the port for the mix where
      // memory is not shared.
      ...(audio ? audio.audioOptions() : { drained: false }),
      // A run without the hosted MPEG provider, for comparison: the program
      // then decodes with the library it ships.
      mp3: query.get("mp3") !== "off",
    },
    // Diagnostic knobs, from the page's own query so a run can be made
    // without one texture's draws or without fog: two runs then differ by
    // that and nothing else, which is how one draw's contribution is seen.
    device: {
      skipTexture: query.get("skipTexture") ?? null,
      probeTexture: query.get("probeTexture") ?? null,
      fog: query.get("fog") !== "off",
      mips: query.get("mips") !== "off",
      // `?nanProbe=1`: a pixel a shader made NaN or infinite is drawn magenta.
      nanProbe: query.get("nanProbe") === "1",
      dumpDraws: query.get("dumpDraws") === "1",
      // The same account for every this-many-th frame, the last of them kept:
      // what is wrong in one frame of a few is caught with its draws.
      dumpEvery: Number(query.get("dumpEvery") ?? 0) || 0,
      maxDraws: Number(query.get("maxDraws") ?? -1),
      // `?graphicsWorker=off` draws on the engine's own thread, `=pixels`
      // brings each frame back as read-back bytes rather than a bitmap: the
      // same title three ways, for where a frame's time goes.
      graphicsWorker: query.get("graphicsWorker") === "off" ? false
        : query.get("graphicsWorker") === "pixels" ? "pixels" : undefined,
    },
    // No bundle under a prefix: the writable layer is the whole volume, so
    // everything in it afterwards is what the installer produced.
    bundle: prefix ? undefined : started.bundle,
    // What the engine tells while it starts, before there is an app to ask.
    on: {
      "bundle-preload": (state) => {
        if (stopping) return;
        if (state.unbacked) {
          report({ off: `The game could not be kept on this device (${state.unbacked}); `
            + "it loads while you play." });
          return;
        }
        report({
          detail: `downloading the game: ${megabytes(state.bytes)} of ${megabytes(state.total)}`,
          progress: { label: "download", read: state.bytes, total: state.total },
        });
      },
    },
    // A bundle's session -- saves, settings, the registry -- stays on this
    // machine, in the origin's file system where it is not capped, named by
    // the bundle so two games never read each other's. A distribution is
    // seeded with its own file and nothing beneath it.
    storage: prefix
      ? { files: [...(await prefix.storage.load()), ...(unattended ? unattended.seeded : [])] }
      : "opfs",
    id: prefix ? undefined : bundle.id,
    // The person's own patch over the title's files, over the session's, at
    // every start: the bundle stays as it shipped. It follows the game below,
    // or what the game saved into a patched file would be put back at the next
    // start.
    files: patch ? await patch.files(mountOf(bundle)) : undefined,
    // What the desktop shows where no window is.
    ...(backdrop ? { desktop: { picture: backdrop.picture } } : {}),
    // What an installer left on the volume is the whole point of having run
    // it, so it comes back with the exit.
    collectOnExit: Boolean(prefix),
    // An installer checks the machine's memory before it starts, and some ask
    // for more than the gigabyte a game gets. Reserved, not committed: only
    // what it touches costs anything.
    // A game, as much as the person gave it or its bottle.
    ...(prefix ? { memorySize: INSTALLER_MEMORY }
      : memoryAsked > 0 ? { memorySize: memoryAsked }
        : bundle ? { memorySize: memorySizeFor(settings, bundle) } : {}),
  };

  app = await createApp(options).catch((e) => {
    clearInterval(progressTimer);
    throw failure(e.reason ?? "the engine did not start", e.message);
  });
  // The running engine, for a person at the console or a script driving the
  // page: `app.debug.read(address, length)` reads what a program waits on.
  globalThis.app = app;

  // What the game writes into a file the patch holds is the patch's from then
  // on: the patch is laid over the session at every start, so one that kept
  // the person's old edit would undo every setting the game has saved since
  // (a resolution in Config.wtf). One change at a time, in the order the game
  // made them, or a late read of an early write would be kept over a later one.
  if (patch) {
    const mount = mountOf(bundle);
    let following = Promise.resolve();
    app.on("session", ({ changes }) => {
      following = following
        .then(() => mirrorChanges(patch, mount, changes, (path) => app.files.read(path)))
        .catch(() => {});
    });
  }

  // The journal's level for every category that has not been set on its own.
  // Applied here rather than passed in because the engine takes categories and
  // a capacity from its configuration but not a default level, and a run that
  // has been asked for debug should be at debug before its first frame.
  app.log.setDefaultLevel(settings.logLevel);

  // Keyboard, mouse and pointer lock, on the canvas and nothing else: the
  // viewport and the input target are the same rectangle on purpose, and an
  // unfocused one leaves the page behaving like a page. A click on the canvas
  // takes the pointer and keeps it until Escape, whatever the program does
  // with its cursor: a lock that followed the cursor let go of the mouse in
  // the middle of a drag that hides it, and the program saw the button lift.
  app.input.attach(canvas, { pointerLock: true });
  let attached = true;

  const releasePointerLock = () => {
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  };

  // A locked pointer has no cursor of the browser's, so the program's is
  // drawn over the canvas where the engine says it is (`cursor-moved`): the
  // engine keeps the position, because the program places it too, and keeps
  // it inside the canvas however far the mouse goes.
  const drawnCursor = document.createElement("img");
  drawnCursor.alt = "";
  drawnCursor.src = ARROW.url;
  drawnCursor.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;"
    + "display:none;image-rendering:pixelated";
  canvas.parentElement?.appendChild(drawnCursor);
  let cursorShown = true;
  // A touch screen has no cursor of its own either, so there the program's is
  // drawn whenever the program shows one: moved by the touchpad, it is the
  // only way to see where a tap will click.
  const touchScreen = isTouchScreen(window);
  // The program's picture of its cursor, and whether a cursor is drawn where
  // the program's is even while it hides it (`showCursorAlways`).
  let picture = ARROW;
  let cursorAlways = false;
  const showDrawnCursor = () => {
    const virtual = touchScreen && cursorAlways && !cursorShown;
    // A hidden cursor's picture may be the blank one a program hides it with:
    // the virtual cursor is the arrow.
    const shown = virtual ? ARROW : picture;
    if (drawnCursor.src !== shown.url) drawnCursor.src = shown.url;
    drawnCursor.style.translate = `${-shown.x}px ${-shown.y}px`;
    drawnCursor.style.display = virtual
      || (cursorShown && (touchScreen || document.pointerLockElement === canvas)) ? "block" : "none";
  };
  document.addEventListener("pointerlockchange", showDrawnCursor);
  showDrawnCursor();
  app.on("cursor-moved", ({ x, y }) => {
    drawnCursor.style.left = `${x * 100}%`;
    drawnCursor.style.top = `${y * 100}%`;
  });

  // Entering fullscreen is a gesture, and the screen handed to the program
  // takes the pointer with it at once rather than on the next click.
  const stopWatchingFullscreen = watchFullscreen((element) => {
    if (element !== null && attached) {
      canvas.requestPointerLock?.()?.catch?.(() => {});
    }
  });

  /** @type {(() => void) | null} */
  let stopMuting = null;
  if (audio) {
    try {
      audio.connect(app);
      // The page silences or turns down what is heard without touching the
      // engine: the guest keeps running and its cursors keep advancing. When
      // the page goes to the background and the person asked for it, the
      // output is muted; the guest never learns that the tab is hidden, which
      // is a page's business and not the program's, and the same is true of
      // the header's own mute and volume.
      const speaking = audio;
      const applyGain = () => {
        // Read live off the store rather than kept in a variable, so a change
        // from the header takes effect without a restart and a muted state
        // survives one: this is a playback choice, not something the engine
        // was assembled around.
        const current = loadSettings();
        const silent = current.muted || (current.muteWhenHidden && document.hidden);
        speaking.volume(silent ? 0 : current.volume);
      };
      applyGain();
      document.addEventListener("visibilitychange", applyGain);
      window.addEventListener(CHANGED, applyGain);
      stopMuting = () => {
        document.removeEventListener("visibilitychange", applyGain);
        window.removeEventListener(CHANGED, applyGain);
      };
    } catch (e) {
      // Refused rather than carried on with. The engine has already been told
      // that something drains the ring, so a program would sit waiting on a
      // play cursor nobody moves -- a hang with no visible cause, which is
      // worse than stopping here and saying why.
      await audio.close();
      await app.dispose();
      throw failure(
        "the sound output could not be attached",
        `${e.message}. The engine was built expecting an audio thread, so the run was `
          + "stopped rather than left waiting on a play cursor nothing advances.",
      );
    }
  }

  for (const name of NOTED) {
    app.on(name, (payload) => {
      report({ note: `${name}: ${JSON.stringify(payload).slice(0, 160)}` });
    });
  }

  // Put in front of the person rather than into the journal with everything
  // else: this is the program's own account of why it is stopping, and the
  // backtrace with it exists only because something was listening here.
  app.on("message-box", (notice) => {
    if (shownToThePerson(notice)) report({ messageBox: notice });
  });
  // A copy inside the program is a copy the person expects to paste outside
  // it. The click that made it is a user gesture, so the write is normally
  // allowed; when it is not, the text is shown where it can be copied by hand.
  app.on("clipboard", ({ text }) => {
    (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard")))
      .catch(() => report({ messageBox: {
        text: "The program copied text, but the browser did not let the page put it on the clipboard.",
        caption: "Copied by the program",
        type: 0x40,
        trace: text,
      } }));
  });
  app.on("cursor", (cursor) => {
    picture = cursorPicture(cursor);
    cursorShown = cursor.shown;
    showDrawnCursor();
    setCursor(cursorStyle(cursor, picture));
  });

  app.on("hook", (hook) => {
    report({ note: hook.refused
      ? `hook: ${hook.label} refused: ${hook.refused}`
      : `hook: ${hook.label} at 0x${hook.address.toString(16)}` });
  });

  // The sidecar's own hooks (`sidecarHooks` above), a different mechanism
  // from the `hook` diagnostic above it: what a bundle's hooks.json actually
  // bound against the loaded image, and what it could not. Sent once, so the
  // panel's line holds for the whole run rather than being erased by the
  // next note the way `report({ note })` alone would be.
  /** @param {string[]} bound @param {string[]} refused @param {string[]} pending */
  const reportHooksBound = (bound, refused, pending) => {
    const waiting = pending.length ? `, ${pending.length} waiting for a library` : "";
    report({
      note: `hooks: ${bound.length} bound, ${refused.length} refused${waiting}`
        + (refused.length ? ` — ${refused.join("; ")}` : ""),
      hooks: refused.length === 0
        ? `${bound.length} bound${waiting}`
        : `${bound.length} bound, ${refused.length} refused (${refused.join("; ")})${waiting}`,
    });
  };
  // The sidecar binds per image -- the program first, then each library the
  // program loads at run time -- so the line is refreshed from the loader's
  // accumulated account on every binding, not from one event's own slice.
  const refreshHooksLine = async () => {
    const [loaderLayer] = await app.diagnostics("loader").catch(() => []);
    if (loaderLayer?.metrics) {
      reportHooksBound(loaderLayer.metrics.hooksBound ?? [], loaderLayer.metrics.hooksRefused ?? [],
        loaderLayer.metrics.hooksPending ?? []);
    }
  };
  app.on("hooks-bound", () => { void refreshHooksLine(); });
  // A sidecar kernel threw; the call already fell through to the guest's own
  // function, so this is a diagnostic rather than a failure. Capped per
  // kernel the way any repeated engine chatter would flood the log otherwise.
  const hookErrorCounts = new Map();
  app.on("hook-error", ({ kernel, message }) => {
    const count = (hookErrorCounts.get(kernel) ?? 0) + 1;
    hookErrorCounts.set(kernel, count);
    if (count > 10) return;
    report({ note: `hook ${kernel}: ${message}` });
  });
  // The event above is what `docs/core/host.md` documents, but `hooks-bound`
  // is emitted inside `buildApp` before `createApp()`'s own promise settles
  // (`src/app.js`, `buildApp` at `createApp`'s line ~5092, the emit at
  // line 3712) -- no subscriber registered after `await createApp(...)`,
  // this one included, can ever see it. Verified in a headed run against this
  // launcher (the panel line never appeared for a bundle with a two-entry
  // sidecar) and independently confirmed in this project's own harness
  // evidence (`dbg/opengl/profile/hooks2-2026-09-18T06-01-37-068Z.log`: its
  // `collected.events`, filled by the identical `app.on('hooks-bound', ...)`
  // pattern, has no such entry even though the run's own journal recorded
  // one at sequence 36). `diagnostics('loader')` is a request answered fresh
  // from the loader's own held state rather than a stream, so it sidesteps
  // the race; this is what actually makes the panel line appear.
  if (sidecarHooks) {
    await refreshHooksLine();
  }
  // A stall while the bundle's next part comes over the network: the page says
  // so, or the person takes it for the game hanging.
  app.on("bundle-fetching", ({ fetching }) => {
    report({ fetchingBundle: fetching === true });
  });
  app.on("present-failed", ({ index, message }) => {
    report({ note: `frame ${index} could not be shown: ${message}` });
  });
  // Sent on the first frame and whenever the frame's size changes, never per
  // frame: the page has nothing to do per frame.
  app.on("frame", ({ width, height, presented }) => {
    report({ frame: { width, height } });
    if (frames === 0) {
      // The wait is over, so the loader stops polling and its first frame
      // time is recorded: the range the next launch shows comes only from
      // launches on this machine, never from a number written in by hand.
      clearInterval(progressTimer);
      if (bundle) rememberFirstFrameTime(bundle.id, performance.now() - beganAt);
      report({
        stage: "running",
        detail: "",
        progress: null,
        elapsed: (performance.now() - beganAt) / 1000,
      });
    }
    frames = presented;
    box.update({ frames: presented });
  });

  /** @type {number | null} */
  let painting = null;

  // A gamepad has no events of its own and has to be sampled; once a frame is
  // where that belongs, and a scheduler turn is thousands of times too often.
  const paint = () => {
    painting = requestAnimationFrame(paint);
    if (attached) app.input.poll();
  };
  painting = requestAnimationFrame(paint);

  // The program is gone, so the screen it was handed goes back: a pointer
  // still locked and a page still fullscreen over a canvas nobody draws to is
  // a person stuck looking at black.
  const handBackTheScreen = () => {
    releasePointerLock();
    exitFullscreen();
    awake.release();
  };

  // A game watched rather than played -- an intro, a cutscene, a demo -- is a
  // screen nobody touches, and a phone dims and locks one of those: the run
  // holds it lit, as a video does, and lets it go when paused or over.
  const awake = keepScreenAwake();

  app
    .run({ maxTurns: Number.MAX_SAFE_INTEGER })
    .then(async (code) => {
      box.end();
      if (stopping) return;
      handBackTheScreen();
      // The journal's tail goes with it: an exit has no backtrace, and what the
      // engine said on the way out is the closest thing to one.
      keepEnding(await reportParts(app, GPU_JOURNAL.capacity));
      report({ stage: "exited", exitCode: code, detail: "", trace: await journalTail(app) });
    })
    .catch(async (e) => {
      box.end();
      if (stopping) return;
      handBackTheScreen();
      // Taken now, while what is left of the engine still answers.
      keepEnding(await reportParts(app, GPU_JOURNAL.capacity));
      report({
        stage: "failed",
        error: {
          reason: e.reason ?? "the run stopped",
          message: e.message ?? String(e),
          // Both: where the guest stood, and where the host code threw -- a
          // failure of the host's own (a storage call) shows only in the second.
          trace: [e.traceText, e.stack && `host stack:\n${e.stack}`].filter(Boolean).join("\n\n"),
        },
      });
    });

  report(unattended
    ? { stage: "installing", detail: `${unattended.family} installer, silent mode`, progress: null }
    : { stage: "loading", detail: "the guest is running but has not presented a frame", progress: null });

  // The one way in from outside the page. A launcher that cannot be reached by
  // a harness cannot be measured, and the questions worth asking of a run --
  // what the engine counted, what it logged -- are all on the app object,
  // answered as promises because the engine is on another thread.
  // `report` is here so a harness can push a synthetic one and see the screen
  // render it: a message box is raised by the guest and cannot be arranged
  // from outside, so this is the only way that path is ever exercised.
  // `canvas` and `audio` are here because they are exactly what this path has
  // and the headless scenario does not: a suspended audio context says the
  // sound the engine was told to expect is not being drained.
  globalThis.__bottlify__ = {
    app,
    frames: () => app.presented().then((shown) => shown.count),
    report,
    canvas,
    audio: () => (audio ? { state: audio.state(), sampleRate: audio.context.sampleRate } : null),
    // What actually reached the canvas, so a blink can be matched against it.
    presented: () => app.presented().then((shown) => shown.history),
  };

  return {
    // Handed out so that what a run left behind can be read once it is over --
    // which for an install is the whole point of having run it.
    app,
    // For the perf overlay's "guest code" block, undefined when this bundle
    // carries none -- addresses print as `image+0xrva` instead.
    symbols: sidecarSymbols,
    showCursorAlways(on) {
      cursorAlways = on;
      showDrawnCursor();
    },
    pause() {
      app.pause();
      // Suspended, not muted: a paused guest writes no frames, and a worklet
      // left running would drain what is in the ring and then play the gap.
      // Asked for, so the speaker leaves this suspension be.
      audio?.suspend();
      awake.pause();
      // Detached, not ignored: a paused game must not eat the keyboard, and
      // letting go also releases whatever was held down when it stopped. The
      // pointer goes the same way -- the controls on the page are the only way
      // back, and a locked pointer cannot reach them.
      app.input.detach();
      attached = false;
      releasePointerLock();
      report({ stage: "paused" });
    },
    resume() {
      app.resume();
      audio?.resume();
      awake.resume();
      app.input.attach(canvas, { pointerLock: true });
      attached = true;
      // Pressing resume is a request to go on playing, and nothing is captured
      // while the viewport is unfocused -- which it is, because the button that
      // was just pressed took the focus.
      canvas.focus();
      report({ stage: frames > 0 ? "running" : "loading" });
    },
    /**
     * The button a person pressed in a message box. The engine's MessageBox
     * call returns this id to the program, which is what the box was waiting
     * on; the box on the page goes away with it.
     *
     * @param {number} id @param {number} button
     */
    answerMessageBox(id, button) {
      app.answerMessageBox(id, button);
      report({ messageBox: null });
    },
    async stop() {
      if (stopping) return;
      stopping = true;
      box.end();
      clearInterval(progressTimer);
      if (painting !== null) cancelAnimationFrame(painting);
      stopMuting?.();
      await audio?.close();
      stopWatchingFullscreen();
      awake.release();
      document.removeEventListener("pointerlockchange", showDrawnCursor);
      drawnCursor.remove();
      releasePointerLock();
      app.input.detach();
      attached = false;
      // Resumed before stopping: a paused run loop is waiting on a gate, and a
      // gate nobody opens is a promise nobody settles and a graph nobody
      // disposes of.
      await app.resume().catch(() => {});
      await app.stop().catch(() => {});
      // Taken down without waiting for the run to admit it is over. Halting the
      // machine does not settle the loop -- the loop finds out only when
      // something it calls fails -- so disposing is what actually ends it, and
      // the failure it then reports is expected and already swallowed above.
      await app.dispose().catch(() => {});
      report({ stage: "stopped", detail: "" });
    },
  };
}
