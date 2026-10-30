/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The settings are the one part of the launcher that outlives the page, so they
 * are the one part that has to survive being wrong: a value hand-edited in
 * developer tools, a browser that keeps nothing, a key left behind by an older
 * shape of this file. Every one of those has to come back as a launcher that
 * runs rather than an engine handed a width of null.
 *
 * Each case takes its own copy of the module, because the settings are cached
 * after the first read -- which is the behaviour being tested in the last two.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * A copy of the module with nothing remembered from another case.
 *
 * @param {number} nth
 */
function fresh(nth) {
  return import(`./settings.js?case=${nth}`);
}

/** @param {Record<string, string>} store */
function fakeStorage(store) {
  return {
    /** @param {string} key */
    getItem: (key) => (key in store ? store[key] : null),
    /** @param {string} key @param {string} value */
    setItem: (key, value) => { store[key] = value; },
    /** @param {string} key */
    removeItem: (key) => { delete store[key]; },
  };
}

/**
 * A stand-in for the window `saveSettings` dispatches on: Node's `globalThis`
 * has no `addEventListener`/`dispatchEvent` of its own, unlike the page this
 * module actually runs on.
 */
function fakeWindow() {
  const handlers = new Set();
  return {
    /** @param {string} _type @param {() => void} fn */
    addEventListener: (_type, fn) => handlers.add(fn),
    /** @param {string} _type @param {() => void} fn */
    removeEventListener: (_type, fn) => handlers.delete(fn),
    dispatchEvent: () => handlers.forEach((fn) => fn()),
  };
}

test("nothing stored is the launcher as it was before there was a panel", async () => {
  const { normalise, DEFAULTS } = await fresh(1);
  assert.deepEqual(normalise(null), DEFAULTS);
  assert.deepEqual(normalise("not an object"), DEFAULTS);
  assert.deepEqual(normalise({}), DEFAULTS);
});

test("a value the engine could not be handed is replaced, not passed on", async () => {
  const { normalise, DEFAULTS } = await fresh(2);

  // The shape a half-typed field or a hand-edited key leaves behind. None of
  // these may reach `createApp`: a width of null is a surface nobody can
  // allocate, and it would fail a long way from the panel that wrote it.
  const wrong = normalise({
    screen: { width: null, height: "tall", bitsPerPixel: 24 },
    maxFps: -1,
    quantum: 0,
    logCapacity: Number.NaN,
    logLevel: "shout",
    logAreas: "call.gpu",
    sound: "yes",
  });
  assert.deepEqual(wrong.screen, DEFAULTS.screen);
  assert.equal(wrong.maxFps, DEFAULTS.maxFps);
  assert.equal(wrong.quantum, DEFAULTS.quantum);
  assert.equal(wrong.logCapacity, DEFAULTS.logCapacity);
  assert.equal(wrong.logLevel, DEFAULTS.logLevel);
  assert.deepEqual(wrong.logAreas, []);
  assert.equal(wrong.sound, DEFAULTS.sound);
});

test("what a person actually chose is kept as chosen", async () => {
  const { normalise } = await fresh(3);
  const chosen = normalise({
    screen: { width: 1024, height: 768, bitsPerPixel: 16 },
    // Zero is a real answer here and must not read as absent: it means every
    // frame the guest presents.
    maxFps: 0,
    quantum: 20000,
    video: false,
    sound: false,
    traceStrings: false,
    cacheBundle: true,
    logLevel: "trace",
    logAreas: ["call.gpu", "call.com"],
    logCapacity: 40000,
    logOpen: true,
  });
  assert.deepEqual(chosen.screen, { width: 1024, height: 768, bitsPerPixel: 32 },
    "the screen is not among what a person chooses");
  assert.equal(chosen.maxFps, 0);
  assert.equal(chosen.quantum, 20000);
  assert.equal(/** @type {any} */ (normalise({ engine: "emulator" })).engine, undefined,
    "the engine is not a choice any more: an old stored one is dropped");
  assert.equal(chosen.video, false);
  assert.equal(chosen.cacheBundle, true);
  assert.equal(chosen.logLevel, "trace");
  assert.deepEqual(chosen.logAreas, ["call.gpu", "call.com"]);
  assert.equal(chosen.logOpen, true);
});

test("a saved setting is what the next visit reads back", async () => {
  const store = {};
  globalThis.localStorage = /** @type {any} */ (fakeStorage(store));

  const first = await fresh(4);
  first.saveSettings({ maxFps: 30, logAreas: ["call.gpu"] });

  // A second copy of the module is a second visit: it has nothing in memory and
  // has to find the choice in storage or it was never really saved.
  const second = await fresh(5);
  const held = second.loadSettings();
  assert.equal(held.maxFps, 30);
  assert.deepEqual(held.logAreas, ["call.gpu"]);
  assert.equal(held.quantum, second.DEFAULTS.quantum, "and everything else is untouched");

  delete globalThis.localStorage;
});

test("the library opens whole, and what is checked after is kept", async () => {
  const { normalise, DEFAULTS, saveSettings } = await fresh(30);
  assert.deepEqual(DEFAULTS.libraryFilters, []);
  assert.equal(DEFAULTS.librarySort, "name");
  assert.deepEqual(normalise({}).libraryFilters, []);
  // Values the library does not have, repeats and a wrong shape are not passed on.
  assert.deepEqual(normalise({ libraryFilters: ["test", "nonsense", "test", 7, "steam"] }).libraryFilters,
    ["test", "steam"]);
  assert.deepEqual(normalise({ libraryFilters: "demo" }).libraryFilters, []);
  assert.equal(normalise({ librarySort: "random" }).librarySort, "name");

  const store = {};
  globalThis.localStorage = /** @type {any} */ (fakeStorage(store));
  saveSettings({ libraryFilters: ["demo", "playable"], librarySort: "year-desc" });
  const next = await fresh(31);
  assert.deepEqual(next.loadSettings().libraryFilters, ["demo", "playable"]);
  assert.equal(next.loadSettings().librarySort, "year-desc");
  delete globalThis.localStorage;
});

test("the tags a browser kept before the filters are dropped, and the library opens whole", async () => {
  // The old shape: what was on, with games-and-demos the default. Read as
  // filters it would hide every application and benchmark.
  const old = {
    libraryTags: ["game", "demo", "playable", "start-only", "non-playable", "unchecked"],
    libraryTagsKnown: ["game", "application", "demo", "benchmark", "test", "unchecked"],
    librarySort: "year-asc",
  };
  const store = { "bottlify.settings": JSON.stringify(old) };
  globalThis.localStorage = /** @type {any} */ (fakeStorage(store));
  const { loadSettings, saveSettings } = await fresh(32);
  assert.deepEqual(loadSettings().libraryFilters, []);
  assert.equal(loadSettings().librarySort, "year-asc", "the order is the same setting and is kept");
  saveSettings({ maxFps: 30 });
  const written = JSON.parse(store["bottlify.settings"]);
  assert.equal("libraryTags" in written, false);
  assert.equal("libraryTagsKnown" in written, false);
  delete globalThis.localStorage;
});

test("a browser that keeps nothing still launches", async () => {
  globalThis.localStorage = /** @type {any} */ ({
    getItem: () => { throw new Error("site data is blocked"); },
    setItem: () => { throw new Error("site data is blocked"); },
    removeItem: () => { throw new Error("site data is blocked"); },
  });

  const { loadSettings, saveSettings, storagePersists, DEFAULTS } = await fresh(6);
  assert.deepEqual(loadSettings(), DEFAULTS, "reading through a refusal is the defaults");
  assert.equal(storagePersists(), false, "and the panel is told so, so it can say so");

  // The change still takes effect for this visit: refusing to apply it because
  // it cannot be remembered would make a private window a launcher whose
  // settings do nothing.
  assert.equal(saveSettings({ maxFps: 24 }).maxFps, 24);
  assert.equal(loadSettings().maxFps, 24);

  delete globalThis.localStorage;
});

test("a stored blob that is not settings at all is ignored", async () => {
  globalThis.localStorage = /** @type {any} */ (fakeStorage({ "bottlify.settings": "{ not json" }));
  const { loadSettings, DEFAULTS } = await fresh(7);
  assert.deepEqual(loadSettings(), DEFAULTS);
  delete globalThis.localStorage;
});

test("every bottle starts on 1024x768 at 32 bits, and no screen is written down", async () => {
  const store = {};
  globalThis.localStorage = /** @type {any} */ (fakeStorage(store));

  const first = await fresh(8);
  const screen = { width: 1024, height: 768, bitsPerPixel: 32 };
  assert.deepEqual(first.loadSettings().screen, screen);
  // A screen an earlier launcher stored is not one any more.
  const saved = first.saveSettings({ screen: { width: 1920, height: 1080, bitsPerPixel: 16 } });
  assert.deepEqual(saved.screen, screen);
  assert.equal(JSON.parse(store["bottlify.settings"]).screen, undefined);

  const second = await fresh(9);
  assert.deepEqual(second.loadSettings().screen, screen);

  delete globalThis.localStorage;
});

test("volume is kept only inside [0, 1], and mute is its own flag", async () => {
  const { normalise, DEFAULTS } = await fresh(11);
  assert.equal(normalise({ volume: 0.3 }).volume, 0.3);
  assert.equal(normalise({ volume: -1 }).volume, DEFAULTS.volume, "out of range falls back");
  assert.equal(normalise({ volume: 2 }).volume, DEFAULTS.volume);
  assert.equal(normalise({ volume: "loud" }).volume, DEFAULTS.volume);
  assert.equal(normalise({ muted: true, volume: 0.8 }).volume, 0.8,
    "muted does not touch the volume it would return to");
});

test("saving a setting tells whoever is reading the store live", async () => {
  globalThis.localStorage = /** @type {any} */ (fakeStorage({}));
  Object.assign(globalThis, fakeWindow());
  const { CHANGED, saveSettings } = await fresh(12);
  let heard = 0;
  globalThis.addEventListener(CHANGED, () => { heard += 1; });
  saveSettings({ muted: true });
  assert.equal(heard, 1, "a running session's speaker has nothing else telling it to reread the store");
  delete globalThis.localStorage;
  delete globalThis.addEventListener;
  delete globalThis.removeEventListener;
  delete globalThis.dispatchEvent;
});

test("an earlier launcher's file edits are kept by bundle until the patch takes them", async () => {
  // The patch over a bottle (engine/patches.js) adopts these the first time
  // it is opened; until then they are read as they were written.
  const { normalise } = await fresh(9);
  const settings = normalise({
    bottleFiles: {
      "world-of-warcraft-classic": { "realmlist.wtf": "set realmlist play.example", "": "dropped" },
      "other": "not an object",
      "empty": {},
    },
  });
  assert.deepEqual(settings.bottleFiles, {
    "world-of-warcraft-classic": { "realmlist.wtf": "set realmlist play.example" },
  });
});

test("a bottle's Windows and graphics are the person's, else its manifest's, else the engine's", async () => {
  const { normalise, bottleConfigFor } = await fresh(10);
  const settings = normalise({
    bottleConfig: {
      benchmark: { windows: "win98", graphics: "directx7" },
      game: { graphics: "all" },
      other: "not an object",
      unknown: { graphics: "d3d8" },
    },
  });
  assert.deepEqual(settings.bottleConfig, {
    benchmark: { graphics: "directx7" },
    game: { graphics: "all" },
  }, "only names the engine knows are kept");
  assert.deepEqual(bottleConfigFor(settings, { id: "benchmark", windows: "win2000" }),
    { windows: "win2000", graphicsApi: "directx7", gpuProfile: "sm3" });
  assert.deepEqual(bottleConfigFor(settings, { id: "game", graphics: "directx8" }),
    { gpuProfile: "sm3" }, "every API chosen over the manifest's one passes none");
  assert.deepEqual(bottleConfigFor(settings, { id: "plain", graphics: "directx9" }),
    { graphicsApi: "directx9", gpuProfile: "sm3" },
    "the manifest's own when the person chose nothing");
  assert.deepEqual(bottleConfigFor(settings, { id: "plain" }), { gpuProfile: "sm3" },
    "the adapter's profile is model 3's unless a bottle chooses another");
  const chosen = normalise({ bottleConfig: { mine: { shaders: "sm1" }, junk: { shaders: "sm9" } } });
  assert.deepEqual(chosen.bottleConfig, { mine: { shaders: "sm1" } });
  assert.equal(bottleConfigFor(chosen, { id: "mine", shaders: "sm3" }).gpuProfile, "sm1",
    "the person's profile over the manifest's");
  assert.equal(bottleConfigFor(chosen, { id: "theirs", shaders: "sm3" }).gpuProfile, "sm3");
});

test("a bottle's memory is its own, else the general setting's, and only a size offered", async () => {
  const { normalise, memorySizeFor, DEFAULTS } = await fresh(11);
  assert.equal(DEFAULTS.memory, 2048, "two gigabytes: a title's preset reads physical memory");
  const settings = normalise({
    memory: 2048,
    bottleConfig: { small: { memory: 512 }, odd: { memory: 3000 } },
  });
  assert.equal(memorySizeFor(settings, { id: "small" }), 512 * 1024 * 1024);
  assert.equal(memorySizeFor(settings, { id: "odd" }), 2048 * 1024 * 1024,
    "a size not offered is not kept");
  assert.equal(memorySizeFor(settings, { id: "plain" }), 2048 * 1024 * 1024);
  assert.equal(normalise({ memory: 999 }).memory, 2048);
});

test("a bottle's driver rules are kept only as current, and read back as current or the default", async () => {
  const { normalise, driverRulesFor } = await fresh(10);
  const settings = normalise({
    bottleConfig: { water: { driverRules: "current" }, fog: { driverRules: "legacy" },
      junk: { driverRules: "newest" } },
  });
  assert.deepEqual(settings.bottleConfig, { water: { driverRules: "current" } },
    "legacy is the engine's default and is not kept");
  assert.equal(driverRulesFor(settings, { id: "water" }), "current");
  assert.equal(driverRulesFor(settings, { id: "fog" }), undefined);
});

test("a bottle's multithreading is what is said, here or in its manifest, and off when nothing is", async () => {
  const { normalise, multithreadingFor } = await fresh(11);
  const settings = normalise({
    bottleConfig: { on: { multithreading: true }, off: { multithreading: false },
      junk: { multithreading: "yes" } },
  });
  assert.deepEqual(settings.bottleConfig, { on: { multithreading: true }, off: { multithreading: false } },
    "a boolean is kept, anything else dropped");
  assert.equal(multithreadingFor(settings, { id: "on" }), true);
  assert.equal(multithreadingFor(settings, { id: "off", multithreading: true }), false,
    "the browser's word over the manifest's");
  assert.equal(multithreadingFor(settings, { id: "manifest", multithreading: true }), true);
  assert.equal(multithreadingFor(settings, { id: "silent" }), false, "nothing said: one core");
  assert.equal(multithreadingFor(settings, { id: "junk", multithreading: "yes" }), false);
});
