/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * What this person's runs are made of, kept between visits.
 *
 * One set for every title rather than one per title: these are decisions about
 * the machine -- how big its display is, how often it may draw, how much of
 * what it says is kept -- and a person who has chosen them once has chosen them
 * for whatever they launch next.
 *
 * Every default here is what the launcher did before there was a panel, so a
 * first visit and a cleared browser behave identically to the run this replaced
 * -- except the display, which follows the screen this page is on.
 */

import { SORTS, TAGS } from "./api/libraryView.js";
import { touchLayout } from "./engine/touch.js";

const KEY = "bottlify.settings";

/**
 * Fired on `window` whenever a setting is saved. The only subscriber today is
 * the running session's speaker: volume and mute are read live off this store
 * rather than passed to `createApp`, so a change made while a title is running
 * has nothing else to tell it the store just changed.
 */
export const CHANGED = "bottlify:settings-changed";

/**
 * The screen every bottle starts on, and not the person's to choose: one mode
 * for every run is one less thing that differs between two of them, and it is
 * a mode every program of this age knows. The stage scales the picture to the
 * page and to fullscreen; the game keeps its own resolution.
 */
const SCREEN = Object.freeze({ width: 1024, height: 768, bitsPerPixel: 32 });

/**
 * @typedef {Object} RunSettings
 * @property {{ width: number, height: number, bitsPerPixel: number }} screen
 *     Always `SCREEN`, and never stored.
 * @property {number} maxFps        Zero means every frame the guest presents.
 * @property {number} quantum       Guest instructions per scheduler turn.
 * @property {boolean} video        Whether the intro video decoder is loaded.
 * @property {boolean} sound        Whether an audio thread is started at all.
 * @property {boolean} muteWhenHidden Silence the output while the page is in the
 *                                  background. A host-side gate on the speaker,
 *                                  never told to the guest.
 * @property {number} volume        The speaker's gain, 0 to 1. A host-side control
 *                                  like `muteWhenHidden`: the guest never learns of it.
 * @property {boolean} muted        Silence the output until unmuted by hand. Survives
 *                                  a title restart because it is read live off this
 *                                  store, the same way `muteWhenHidden` is.
 * @property {boolean} traceStrings Keep the text a traced argument pointed at.
 * @property {boolean} cacheBundle  Copy the rest of the game to this machine in
 *                                  the background; what a run reads is kept
 *                                  either way.
 * @property {string} logLevel      The journal's level for uncategorised areas.
 * @property {string[]} logAreas    Call areas recorded from the first instruction.
 * @property {number} logCapacity   Records the journal's ring holds.
 * @property {boolean} logOpen      Whether a run opens with its log beside it.
 * @property {boolean} overlayOn    Whether the performance overlay (F3) is shown
 *                                  over the canvas. Off by default: it polls the
 *                                  engine once a second while it is on, and a
 *                                  person who never asked for it should pay
 *                                  nothing for it.
 * @property {boolean} profileCalls Whether every host call is timed as its own phase (next run)
 * @property {string[]} libraryTags The library's tags that are on (`TAGS` values): a
 *                                  bottle shows while all of its tags are, so
 *                                  none on shows nothing. Opens on `game`,
 *                                  `demo` and the playability marks.
 * @property {string[]} libraryTagsKnown The tags there were when the choice was
 *                                  stored, so one added later starts on.
 * @property {string} librarySort   The order the library is in (`SORTS` value).
 * @property {Record<string, Record<string, string>>} bottleFiles
 *                                  The person's own edits to a title's files, by
 *                                  bundle id and then by path under the title's
 *                                  directory (`realmlist.wtf`, `WTF/Config.wtf`),
 *                                  as text. Laid over the session's files at every
 *                                  start, so they win over what the game last
 *                                  saved; the bundle itself is never changed.
 * @property {Record<string, BottleConfig>} bottleConfig
 *                                  The person's own choices for a bottle, by bundle
 *                                  id, over what its manifest says.
 * @property {number} memory        The guest's memory, in megabytes (`MEMORY_CHOICES`),
 *                                  for every bottle that does not choose its own.
 */

/**
 * @typedef {Object} BottleConfig
 * @property {string} [windows]   One of `WINDOWS_CHOICES`.
 * @property {string} [graphics]  One of `GRAPHICS_CHOICES`, `all` for everything.
 * @property {string} [shaders]   One of `SHADER_CHOICES`, the video adapter's profile.
 * @property {number} [memory]    One of `MEMORY_CHOICES`, in megabytes.
 * @property {string} [driverRules] One of `DRIVER_RULES_CHOICES`; absent, legacy.
 * @property {boolean} [multithreading] Whether its threads run on several cores
 *     at once; absent, the manifest's, else not.
 * @property {ReturnType<typeof touchLayout>} [touch] Its controls on a touch
 *     screen (`engine/touch.js`); absent, the defaults.
 */

/**
 * Which drivers' answers a bottle's Direct3D gives where Direct3D left a
 * behaviour to the driver, by the engine's `driverRules` names: the drivers of
 * the shader-model-1 and 2 years, or later drivers' and Wine's.
 */
export const DRIVER_RULES_CHOICES = [
  { value: "legacy", label: "Legacy (drivers of the time)" },
  { value: "current", label: "Stable (later drivers, as Wine)" },
];

/** The Windows a bottle may run as, by the engine's names. */
export const WINDOWS_CHOICES = [
  { value: "win2000", label: "Windows 2000" },
  { value: "winxp", label: "Windows XP" },
  { value: "win7", label: "Windows 7" },
  { value: "win10", label: "Windows 10" },
];

/**
 * The graphics a bottle may prefer: every DirectX up to the one chosen, or
 * OpenGL alone, is on the bottle's machine, and the registry names that DirectX.
 */
export const GRAPHICS_CHOICES = [
  { value: "all", label: "Default (all)" },
  { value: "directx7", label: "DirectX 7" },
  { value: "directx8", label: "DirectX 8" },
  { value: "directx9", label: "DirectX 9" },
  { value: "directx10", label: "DirectX 10" },
  { value: "opengl", label: "OpenGL" },
];

/**
 * The profile the bottle's video adapter is shown with, by shader model: a
 * card of that model its programs know, by the engine's `gpuProfile` names. A
 * game picks its render path from the card it is told of, and takes its
 * weakest on one it does not know; model 2 is the one most of the games of
 * DirectX 9's years know best.
 */
export const SHADER_CHOICES = [
  { value: "sm1", label: "Shader model 1 (GeForce4 Ti)" },
  { value: "sm2", label: "Shader model 2 (Radeon 9800 Pro)" },
  { value: "sm3", label: "Shader model 3 (GeForce 7800 GTX)" },
  { value: "sm4", label: "Shader model 4 (GeForce 8800 GTX)" },
  { value: "host", label: "As the browser's GPU" },
];

/** The profile a bottle that chooses none is shown with. */
export const DEFAULT_SHADERS = "sm2";

/**
 * How much memory the guest machine has, in megabytes. A game sizes its caches
 * from it and some refuse to start below what they ask for; two gigabytes is
 * all a program on Windows XP may address. Only what a program touches costs
 * anything.
 */
export const MEMORY_CHOICES = [
  { value: 512, label: "512 MB" },
  { value: 1024, label: "1 GB" },
  { value: 1536, label: "1.5 GB" },
  { value: 2048, label: "2 GB" },
];

/** @type {RunSettings} */
export const DEFAULTS = Object.freeze({
  screen: SCREEN,
  maxFps: 60,
  quantum: 100000,
  video: true,
  sound: true,
  muteWhenHidden: true,
  volume: 1,
  muted: false,
  traceStrings: false,
  cacheBundle: false,
  logLevel: "info",
  logAreas: [],
  logCapacity: 4096,
  logOpen: false,
  overlayOn: false,
  profileCalls: false,
  libraryTags: ["game", "demo", "playable", "start-only", "non-playable", "unchecked"],
  libraryTagsKnown: TAGS.map((one) => one.value),
  librarySort: SORTS[0].value,
  bottleFiles: {},
  bottleConfig: {},
  // Two gigabytes: reserved, not committed, so it costs what the guest touches --
  // and a title of this era picks its whole preset from the physical memory it is
  // told of, the lowest one below a gigabyte.
  memory: 2048,
});

/** The journal's severities in its own order: error is 1, trace is 5. */
export const LEVELS = ["error", "warn", "info", "debug", "trace"];

/**
 * The call areas that exist before an engine does.
 *
 * Named here as well as in the engine because the only useful moment to switch
 * one on is before the run starts -- everything a program decides about a
 * device it decides while starting up -- and at that moment there is no engine
 * to ask. A running one is asked anyway and its answer is merged in, so an area
 * the engine grows shows up here without this list being touched.
 */
export const AREAS = [
  "call.cpu", "call.gpu", "call.audio", "call.video",
  "call.input", "call.net", "call.com",
  "input.press", "input.message",
];

/**
 * The journal's own size while `call.gpu` is being recorded: a heavy frame
 * runs to about 27,000 GL calls (`report-glcalls.md`), so three of them need
 * roughly this many records, and this many bytes behind them -- a call area
 * logging every argument as a string fills the byte ring long before the
 * record count does (`docs/core/host.md`'s `log.bytes`).
 */
export const GPU_JOURNAL = { capacity: 100000, bytes: 32 * (1 << 20) };

/** Bounds that keep a hand-edited or half-written entry from reaching the engine. */
const LIMITS = {
  width: [16, 4096], height: [16, 4096],
  maxFps: [0, 1000], quantum: [4096, 100000000],
  logCapacity: [64, 2000000],
};

/**
 * @param {any} value
 * @param {number} fallback
 * @param {[number, number]} range
 * @returns {number}
 */
function whole(value, fallback, [low, high]) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= low && number <= high ? number : fallback;
}

/**
 * @param {any} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function flag(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * A number in [0, 1], such as a gain: unlike `whole`, kept as typed rather
 * than rounded to an integer.
 *
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
function fraction(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
}

// A tag the library gained after the choice was stored starts as the defaults
// have it: off, it would hide every bottle marked with it behind a chip never
// let go of. A store from before the list was kept knew the first five.
function tagsSince(known) {
  const seen = Array.isArray(known) ? known : ["game", "application", "demo", "benchmark", "test"];
  return DEFAULTS.libraryTags.filter((tag) => !seen.includes(tag));
}

/**
 * A stored blob turned into settings the engine can be handed.
 *
 * Every field is checked rather than trusted: this is a string a person can
 * edit, and a width of `null` reaches the graphics layer as a surface nobody
 * can allocate long after the panel that wrote it is gone.
 *
 * @param {any} raw
 * @returns {RunSettings}
 */
export function normalise(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    // A screen stored by an earlier launcher is not one any more.
    screen: SCREEN,
    maxFps: whole(source.maxFps, DEFAULTS.maxFps, LIMITS.maxFps),
    quantum: whole(source.quantum, DEFAULTS.quantum, LIMITS.quantum),
    video: flag(source.video, DEFAULTS.video),
    sound: flag(source.sound, DEFAULTS.sound),
    muteWhenHidden: flag(source.muteWhenHidden, DEFAULTS.muteWhenHidden),
    volume: fraction(source.volume, DEFAULTS.volume),
    muted: flag(source.muted, DEFAULTS.muted),
    traceStrings: flag(source.traceStrings, DEFAULTS.traceStrings),
    cacheBundle: flag(source.cacheBundle, DEFAULTS.cacheBundle),
    logLevel: LEVELS.includes(source.logLevel) ? source.logLevel : DEFAULTS.logLevel,
    logAreas: Array.isArray(source.logAreas)
      ? source.logAreas.filter((area) => typeof area === "string")
      : [],
    logCapacity: whole(source.logCapacity, DEFAULTS.logCapacity, LIMITS.logCapacity),
    logOpen: flag(source.logOpen, DEFAULTS.logOpen),
    overlayOn: flag(source.overlayOn, DEFAULTS.overlayOn),
    profileCalls: flag(source.profileCalls, DEFAULTS.profileCalls),
    // Only tags and an order the library knows: one it has since dropped would
    // otherwise hold every bottle back behind a chip nobody can see to clear.
    // Nothing stored opens on the defaults; every chip let go of is a choice
    // and stays one.
    libraryTags: Array.isArray(source.libraryTags)
      ? [...new Set([...source.libraryTags, ...tagsSince(source.libraryTagsKnown)]
        .filter((tag) => TAGS.some((one) => one.value === tag)))]
      : [...DEFAULTS.libraryTags],
    libraryTagsKnown: DEFAULTS.libraryTagsKnown,
    librarySort: SORTS.some((one) => one.value === source.librarySort)
      ? source.librarySort : DEFAULTS.librarySort,
    bottleFiles: bottleFilesOf(source.bottleFiles),
    bottleConfig: bottleConfigOf(source.bottleConfig),
    memory: MEMORY_CHOICES.some((one) => one.value === source.memory)
      ? source.memory : DEFAULTS.memory,
  };
}

/**
 * Only a bundle id mapping to names the engine knows survives the read.
 *
 * @param {unknown} raw
 * @returns {Record<string, BottleConfig>}
 */
function bottleConfigOf(raw) {
  /** @type {Record<string, BottleConfig>} */
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [bundle, config] of Object.entries(raw)) {
    if (!config || typeof config !== "object") continue;
    /** @type {BottleConfig} */
    const kept = {};
    if (WINDOWS_CHOICES.some((one) => one.value === config.windows)) kept.windows = config.windows;
    if (GRAPHICS_CHOICES.some((one) => one.value === config.graphics)) kept.graphics = config.graphics;
    if (SHADER_CHOICES.some((one) => one.value === config.shaders)) kept.shaders = config.shaders;
    if (MEMORY_CHOICES.some((one) => one.value === config.memory)) kept.memory = config.memory;
    if (config.driverRules === "current") kept.driverRules = config.driverRules;
    if (typeof config.multithreading === "boolean") kept.multithreading = config.multithreading;
    if (config.touch && typeof config.touch === "object") kept.touch = touchLayout(config.touch);
    if (Object.keys(kept).length > 0) out[bundle] = kept;
  }
  return out;
}

/**
 * What a bottle runs as, in `createApp`'s terms: the person's choice, else its
 * manifest's, else nothing -- the engine's default; and the profile its video
 * adapter is shown with, which falls back to `DEFAULT_SHADERS` instead.
 *
 * @param {RunSettings} settings
 * @param {{ id: string, windows?: string, graphics?: string, shaders?: string }} bundle
 * @returns {{ windows?: string, graphicsApi?: string }}
 */
export function bottleConfigFor(settings, bundle) {
  const own = settings.bottleConfig[bundle.id] ?? {};
  const windows = own.windows ?? bundle.windows;
  const graphics = own.graphics ?? bundle.graphics;
  const shaders = own.shaders ?? bundle.shaders ?? DEFAULT_SHADERS;
  return {
    ...(windows ? { windows } : {}),
    ...(graphics && graphics !== "all" ? { graphicsApi: graphics } : {}),
    gpuProfile: shaders,
  };
}

/**
 * The driver rules a bottle runs under: `current` when its settings say so,
 * else nothing, the engine's default (legacy).
 *
 * @param {RunSettings} settings
 * @param {{ id: string }} bundle
 * @returns {"current" | undefined}
 */
export function driverRulesFor(settings, bundle) {
  return settings.bottleConfig[bundle.id]?.driverRules === "current" ? "current" : undefined;
}

/**
 * Whether a bottle's threads run on several cores at once: what its settings
 * here say, else what its manifest says, said as true or false; else not --
 * a bottle runs on one core until someone says it does better on more.
 *
 * @param {RunSettings} settings
 * @param {{ id: string, multithreading?: unknown }} bundle
 * @returns {boolean}
 */
export function multithreadingFor(settings, bundle) {
  const own = settings.bottleConfig[bundle.id]?.multithreading;
  if (typeof own === "boolean") return own;
  return typeof bundle.multithreading === "boolean" ? bundle.multithreading : false;
}

/**
 * The controls a bottle plays with on a touch screen.
 *
 * @param {RunSettings} settings
 * @param {{ id: string }} bundle
 */
export function touchLayoutFor(settings, bundle) {
  return touchLayout(settings.bottleConfig[bundle.id]?.touch);
}

/**
 * The memory a bottle's machine has, in bytes for `createApp`: the bottle's own
 * choice, else the one in the general settings.
 *
 * @param {RunSettings} settings
 * @param {{ id: string }} bundle
 */
export function memorySizeFor(settings, bundle) {
  return (settings.bottleConfig[bundle.id]?.memory ?? settings.memory) * 1024 * 1024;
}

/**
 * Only what is a bundle id mapping paths to text survives the read: anything
 * else stored under the name is dropped rather than handed to the engine.
 *
 * @param {unknown} raw
 * @returns {Record<string, Record<string, string>>}
 */
function bottleFilesOf(raw) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [bundle, files] of Object.entries(raw)) {
    if (!files || typeof files !== "object") continue;
    /** @type {Record<string, string>} */
    const kept = {};
    for (const [path, text] of Object.entries(files)) {
      if (typeof text === "string" && path.trim() !== "") kept[path] = text;
    }
    if (Object.keys(kept).length > 0) out[bundle] = kept;
  }
  return out;
}

/**
 * Settings as they are written down: the screen is nobody's choice, so it is
 * not among them.
 *
 * @param {RunSettings} settings
 */
function unresolved(settings) {
  const stored = { ...settings };
  delete stored.screen;
  return stored;
}

/** @type {RunSettings | null} */
let held = null;

/**
 * What this browser has been told to run with.
 *
 * Read once and remembered, because the launch path asks for it in the middle
 * of assembling a process and the panel asks for it on every render. A private
 * window, blocked site data or a corrupt entry all answer the same way: the
 * defaults, which is a working launcher rather than a broken one.
 *
 * @returns {RunSettings}
 */
export function loadSettings() {
  if (held) return held;
  try {
    held = normalise(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    held = normalise(null);
  }
  return held;
}

/**
 * Keeps a changed setting, and hands back the whole set as it now stands.
 *
 * Storage failing is not an error a person can act on -- a private window
 * simply has nowhere to put this -- so the change still takes effect for the
 * rest of this visit and is only lost when the page is.
 *
 * @param {Partial<RunSettings>} patch
 * @returns {RunSettings}
 */
export function saveSettings(patch) {
  // Patched over the stored shape rather than the live one: normalised, a
  // display-derived size is a number like any other and would read as chosen.
  held = normalise({ ...unresolved(loadSettings()), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(unresolved(held)));
  } catch {
    // Nowhere to keep it; the run still gets it.
  }
  globalThis.dispatchEvent?.(new Event(CHANGED));
  return held;
}

/**
 * Whether anything written here would survive a reload.
 *
 * Asked so the panel can say so out loud: settings that quietly evaporate read
 * from the outside as settings that were never applied.
 *
 * @returns {boolean}
 */
export function storagePersists() {
  try {
    localStorage.setItem(`${KEY}.probe`, "1");
    localStorage.removeItem(`${KEY}.probe`);
    return true;
  } catch {
    return false;
  }
}
