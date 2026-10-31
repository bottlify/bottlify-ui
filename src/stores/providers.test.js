/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The stores as GameHub has them (providers.js): a provider a store GameHub
 * lists, every op store-neutral, none to the launcher's server; and Steam's
 * install, which the page runs with what `download` answers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const ORIGIN = "https://play.bottlify.app";
const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const SERVERS = [{ host: "a:443", vhost: "cache1-fra1.steamcontent.com", type: "CDN" }];
const ART = "https://shared.steamstatic.com/store_item_assets/steam/apps/70";

/** A worker as far as the page drives one: what it was sent, kept. */
class FakeWorker {
  /** @type {FakeWorker[]} */
  static made = [];
  /** @param {URL} url @param {{ name: string }} options */
  constructor(url, options) {
    this.url = String(url);
    this.name = options.name;
    /** @type {any[]} */
    this.sent = [];
    this.terminated = false;
    /** @type {((event: { data: any }) => void) | null} */
    this.onmessage = null;
    FakeWorker.made.push(this);
  }

  /** @param {any} data */
  postMessage(data) {
    this.sent.push(data);
  }

  terminate() {
    this.terminated = true;
  }
}

/** What GameHub answers for Steam: the ops a page may ask, each keyed by the store. */
const OPS = {
  hello: () => ({ version: "0.2.0", origin: EXTENSION, stores: [{ id: "steam", name: "Steam", on: true },
    { id: "gog", name: "GOG", on: false }] }),
  account: () => ({ name: "someone" }),
  list: () => [{ id: "70", name: "A Game", bytes: 3, exact: false, installable: true,
    covers: { header: `${ART}/header.jpg`, capsule: `${ART}/library_600x900.jpg`, hero: `${ART}/library_hero.jpg` } }],
  download: () => ({ name: "A Game", launch: { executable: "bin/game.exe", arguments: "-windowed" },
    installscript: "install.vdf", servers: SERVERS,
    art: { header: `${ART}/header.jpg`, cover: `${ART}/library_600x900.jpg`, hero: `${ART}/library_hero.jpg` },
    depots: [{ depot: 101, gid: "1111", key: KEY, code: "1010042", shared: false },
      { depot: 228990, gid: "2222", key: KEY, code: "2289900042", shared: true }] }),
  runData: (/** @type {any} */ args) => ({ win32: { steam: { appId: Number(args.game), accountName: "someone" } } }),
};

/**
 * A page with GameHub in it or not -- its content script answering `hello` on
 * the page's origin, each store's session frame every other op from the
 * extension's -- every request and every op asked kept.
 */
/**
 * One page's events for the whole file: gamehub.js, which providers.js
 * imports, is one module for every test here and keeps the frames it made, so
 * a frame made in one test answers the next one's ops through `current`.
 */
const events = new EventTarget();
/** @type {{ asked: Array<[string, any]> }} */
const current = { asked: [] };

async function page({ gamehub = true } = {}) {
  /** @type {string[]} */
  const requests = [];
  /** @type {Array<[string, any]>} */
  const asked = [];
  current.asked = asked;
  /** @type {Map<string, string>} */
  const stored = new Map();
  FakeWorker.made = [];
  const dispatch = (/** @type {any} */ data, /** @type {string} */ origin, /** @type {any} */ source) =>
    events.dispatchEvent(Object.assign(new Event("message"), { data, origin, source }));
  /** An op asked of the content script or a frame, answered as GameHub would. @param {any} data @param {string} origin @param {any} source */
  const answer = (data, origin, source) => queueMicrotask(() => {
    if (data.to !== "bottlify-gamehub") return;
    current.asked.push([data.op, data.args]);
    const result = /** @type {any} */ (OPS)[data.op]?.(data.args);
    dispatch({ from: "bottlify-gamehub", id: data.id, result }, origin, source);
  });
  /** @type {any} */
  const win = { postMessage: (/** @type {any} */ data) => answer(data, ORIGIN, win) };
  Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 4 }, configurable: true });
  Object.assign(globalThis, {
    Worker: FakeWorker,
    location: { origin: ORIGIN },
    window: win,
    document: {
      documentElement: { dataset: gamehub ? { bottlifyGamehub: "0.2.0" } : {} },
      createElement: () => {
        const frameWindow = { postMessage: (/** @type {any} */ data) => answer(data, EXTENSION, frameWindow) };
        return { style: {}, setAttribute: () => {}, contentWindow: frameWindow };
      },
      body: { append: (/** @type {any} */ frame) => queueMicrotask(() =>
        dispatch({ from: "bottlify-gamehub", ready: true }, EXTENSION, frame.contentWindow)) },
    },
    localStorage: { getItem: (/** @type {string} */ key) => stored.get(key) ?? null,
      setItem: (/** @type {string} */ key, /** @type {string} */ value) => stored.set(key, value) },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    fetch: async (/** @type {string} */ url) => {
      requests.push(String(url));
      return new Response(null, { status: 404 });
    },
  });
  const stamp = Math.random();
  return { requests, asked, stored, ...await import(`./providers.js?page=${stamp}`),
    ...await import(`../steam/browser-install.js?page=${stamp}`) };
}

/** @param {() => boolean} done */
async function until(done) {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(done(), "in time");
}

test("each store GameHub has on is a provider, asked with store-neutral ops and nothing else", async () => {
  const { loadProviders, knownProviders, requests, asked } = await page();
  const providers = await loadProviders();
  assert.deepEqual(providers.map(({ id, name }) => [id, name]), [["steam", "Steam"]], "not one the site has off");
  assert.deepEqual(knownProviders().map(({ id }) => id), ["steam"], "kept for the next visit");
  const [steam] = providers;
  assert.equal(await steam.available(), true);
  assert.deepEqual(await steam.auth.account(), { name: "someone" });
  const [game] = await steam.getList({ fresh: true });
  assert.equal(steam.getCover(game, "capsule"), `${ART}/library_600x900.jpg`);
  assert.equal(steam.gameOf({ store: { id: "steam", game: "70" } }), "70");
  assert.equal(steam.gameOf({ steam: { appId: 220 } }), "220", "a bottle installed before");
  assert.equal(steam.gameOf({ title: "Quake" }), null);
  assert.deepEqual(await steam.runData({ store: { id: "steam", game: "70" } }),
    { win32: { steam: { appId: 70, accountName: "someone" } } });
  assert.deepEqual(asked.map(([op]) => op), ["hello", "account", "list", "runData"]);
  assert.ok(asked.slice(1).every(([, args]) => args.store === "steam"), "the store an argument");
  assert.deepEqual(asked[2][1], { store: "steam", fresh: true });
  assert.deepEqual(requests, [], "the launcher's server is asked nothing");
});

test("without GameHub there are no stores, and nobody is asked", async () => {
  const { loadProviders, storeProvider, NEEDS_GAMEHUB, requests, asked } = await page({ gamehub: false });
  assert.deepEqual(await loadProviders(), []);
  const steam = storeProvider({ id: "steam", name: "Steam" });
  assert.equal(await steam.available(), false);
  assert.equal(steam.unavailable, NEEDS_GAMEHUB);
  assert.match(NEEDS_GAMEHUB, /Bottlify GameHub extension/);
  assert.deepEqual([requests, asked], [[], []]);
});

test("an install: GameHub's download, then the page's own workers with its keys and codes", async () => {
  const { loadProviders, STOPPED, requests, asked } = await page();
  const [steam] = await loadProviders();
  /** @type {any[]} */
  const progress = [];
  const done = steam.install({ id: "70", name: "A Game", bytes: 3, exact: false, installable: true },
    (one) => progress.push(one), new AbortController().signal);
  await until(() => FakeWorker.made.some((one) => one.sent.some((data) => data.install)));
  assert.deepEqual(asked.filter(([op]) => op === "download"), [["download", { store: "steam", game: "70" }]]);
  const [installer, ...decoders] = FakeWorker.made;
  assert.equal(installer.name, "steam-install");
  assert.equal(decoders.length, 3, "a decoder a core but the page's");
  const { install, ports } = installer.sent[0];
  assert.equal(ports.length, 3);
  assert.deepEqual(install.depots, [
    { depot: 101, gid: 1111n, shared: false, key: KEY, code: 1010042n },
    { depot: 228990, gid: 2222n, shared: true, key: KEY, code: 2289900042n },
  ]);
  assert.deepEqual(install.servers, SERVERS);
  assert.equal(install.executable, "bin\\game.exe");
  assert.equal(install.installscript, "install.vdf");
  assert.equal(install.id, "steam-70");
  assert.deepEqual([install.manifest.title, install.manifest.store, install.manifest.entry,
    install.manifest.commandLine, install.manifest.coverSmall, install.manifest.coverFallback],
  ["A Game", { id: "steam", game: "70" }, "bin\\game.exe", "-windowed", `${ART}/library_600x900.jpg`,
    `${ART}/header.jpg`]);

  const send = (/** @type {any} */ data) => /** @type {any} */ (installer.onmessage)({ data });
  send({ progress: { stage: "downloading", done: 3 * 2 ** 20, total: 8 * 2 ** 20 } });
  assert.deepEqual([progress.at(-1).state, progress.at(-1).done, progress.at(-1).total], ["downloading", 3, 8]);
  send({ progress: { stage: "finishing", done: 4, total: 8 } });
  assert.match(progress.at(-1).message, /50%/);
  send({ done: { id: "steam-70" } });
  assert.equal(await done, "steam-70");
  assert.ok(FakeWorker.made.every((one) => one.terminated), "its workers go with it");

  const stop = new AbortController();
  const again = steam.install({ id: "70", name: "A Game", bytes: 3, exact: false, installable: true },
    () => {}, stop.signal);
  await until(() => FakeWorker.made.length === 8 && FakeWorker.made[4].sent.length > 0);
  stop.abort();
  assert.deepEqual(FakeWorker.made[4].sent.at(-1), { cancel: true });
  /** @type {any} */ (FakeWorker.made[4].onmessage)({ data: { error: "the install was stopped", stopped: true } });
  await assert.rejects(again, new RegExp(STOPPED));
  assert.equal(asked.filter(([op]) => op === "download").length, 2, "asked again: codes last minutes");
  assert.deepEqual(requests, [], "the launcher's server is asked nothing");
});
