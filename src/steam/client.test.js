/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const ORIGIN = "https://play.bottlify.app";
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const SERVERS = [{ host: "a:443", vhost: "cache1-fra1.steamcontent.com", type: "CDN" }];

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

/** What Steam tells anyone of the apps, as the bridge answers it. */
const INFO = {
  70: { common: { type: "Game", name: "A Game" },
    config: { launch: { 0: { executable: "bin/game.exe", arguments: "-windowed" } } },
    extended: { installscript: "install.vdf" },
    depots: { 101: { manifests: { public: { gid: "1111", size: "3145728" } } },
      228990: { depotfromapp: "228980" } } },
  71: { common: { type: "Tool", name: "A Tool" }, depots: {} },
  72: { common: { type: "game", name: "Another" }, config: { launch: {} }, depots: {} },
  228980: { common: { type: "Config" }, depots: { 228990: { manifests: { public: { gid: "2222" } } } } },
};

/**
 * A page signed in to an account that owns apps 70 to 72, with the bridge in
 * it or not; every request and every bridge question kept.
 */
async function page({ bridge = true } = {}) {
  const window = new EventTarget();
  /** @type {Array<{ url: string, init: any }>} */
  const requests = [];
  /** @type {Array<[string, any]>} */
  const asked = [];
  /** @type {Record<string, (args: any) => unknown>} The bridge's Steam ops, and its hello. */
  const ops = {
    hello: () => ({ version: "0.1.0", platforms: { steam: true } }),
    appOwnershipTicket: ({ app }) => Uint8Array.of(app & 0xff),
    account: () => ({ steamId: "1", accountName: "someone", apps: [72, 70, 71] }),
    productInfo: ({ apps }) => Object.fromEntries(apps.flatMap((/** @type {number} */ id) =>
      (/** @type {any} */ (INFO)[id] ? [[id, /** @type {any} */ (INFO)[id]]] : []))),
    depotKey: () => KEY,
    manifestCode: ({ depot }) => `${depot}0042`,
    contentServers: () => SERVERS,
  };
  FakeWorker.made = [];
  Object.defineProperty(globalThis, "navigator",
    { value: { hardwareConcurrency: 4 }, configurable: true });
  Object.assign(globalThis, {
    Worker: FakeWorker,
    location: { origin: ORIGIN },
    document: { documentElement: { dataset: bridge ? { bottlifyBridge: "0.1.0" } : {} } },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    postMessage: (/** @type {any} */ data) => queueMicrotask(() => {
      if (data.to !== "bottlify-bridge") return;
      const op = data.op.replace(/^steam\./, "");
      assert.ok(op === "hello" || data.op.startsWith("steam."), `${data.op} is a Steam op`);
      asked.push([op, data.args]);
      window.dispatchEvent(Object.assign(new Event("message"), { origin: ORIGIN,
        data: { from: "bottlify-bridge", id: data.id, result: ops[op](data.args) } }));
    }),
    fetch: async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
      requests.push({ url, init });
      return new Response(null, { status: 404 });
    },
  });
  const stamp = Math.random();
  return { requests, asked, ...await import(`./client.js?page=${stamp}`),
    ...await import(`./browser-install.js?page=${stamp}`) };
}

/** @param {() => boolean} done */
async function until(done) {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(done(), "in time");
}

test("the library's games are the account's, as Steam tells anyone of them through the bridge", async () => {
  const { steam, requests, asked } = await page();
  assert.equal(await steam.available(), true);
  assert.deepEqual(await steam.auth.account(), { name: "someone" });
  const games = await steam.getList();
  assert.deepEqual(games.map((/** @type {any} */ game) => [game.id, game.name, game.bytes, game.installable]),
    [["70", "A Game", 3145728, true], ["72", "Another", 0, false]], "the games, by name; not a tool");
  assert.match(steam.getCover(games[0], "capsule"), /steamstatic\.com\/.*\/70\/library_600x900\.jpg$/);
  assert.match(steam.getCover(games[0], "hero"), /\/70\/library_hero\.jpg$/);
  assert.deepEqual(asked.filter(([op]) => op === "productInfo"), [["productInfo", { apps: [72, 70, 71] }]]);
  assert.equal(steam.gameOf({ steam: { appId: 70 } }), "70");
  assert.equal(steam.gameOf({ title: "Quake" }), null);
  const run = await steam.runData({ steam: { appId: 70 } });
  assert.deepEqual([run.win32.steam.appId, run.win32.steam.accountName, run.win32.steam.ownershipTickets],
    [70, "someone", { 70: Uint8Array.of(70) }], "a run with Steam running for the account");
  assert.ok(requests.every(({ url }) => String(url).includes("steamstatic.com")),
    "the launcher's server is asked nothing; Valve's client files come from Valve's CDN");
});

test("without the bridge Steam says the extension is needed and asks nobody", async () => {
  const { steam, NEEDS_BRIDGE, requests, asked } = await page({ bridge: false });
  const needed = new RegExp(NEEDS_BRIDGE.replace(".", "\\."));
  assert.match(NEEDS_BRIDGE, /Bottlify extension/);
  assert.equal(steam.unavailable, NEEDS_BRIDGE);
  assert.equal(await steam.available(), false);
  await assert.rejects(steam.auth.signIn({ onChallenge: () => {} }), needed);
  await assert.rejects(steam.getList(), needed);
  await assert.rejects(steam.install({ id: "70" }, () => {}, new AbortController().signal), needed);
  assert.equal(await steam.auth.account(), null);
  assert.deepEqual(await steam.runData({ steam: { appId: 70 } }), {});
  assert.deepEqual([requests, asked], [[], []]);
});

test("with the bridge, an install runs in this browser: keys and codes to its worker, none to the server",
  async () => {
    const { steam, requests, asked, STOPPED } = await page();
    /** @type {any[]} */
    const progress = [];
    const done = steam.install({ id: "70" }, (one) => progress.push(one), new AbortController().signal);
    await until(() => FakeWorker.made.some((one) => one.sent.some((data) => data.install)));
    const [installer, ...decoders] = FakeWorker.made;
    assert.equal(installer.name, "steam-install");
    assert.match(installer.url, /install-worker\.js$/);
    assert.equal(decoders.length, 3, "a decoder a core but the page's");
    assert.ok(decoders.every((one) => one.sent[0].serve instanceof MessagePort));

    const { install, ports } = installer.sent[0];
    assert.equal(ports.length, 3);
    assert.deepEqual(install.depots, [
      { depot: 101, gid: 1111n, shared: false, key: KEY, code: 1010042n },
      { depot: 228990, gid: 2222n, shared: true, key: KEY, code: 2289900042n },
    ]);
    assert.deepEqual(asked.filter(([op]) => op === "depotKey").map(([, args]) => args),
      [{ app: 70, depot: 101 }, { app: 228980, depot: 228990 }], "a redistributable under its owner");
    assert.deepEqual(install.servers, SERVERS);
    assert.equal(install.executable, "bin\\game.exe");
    assert.equal(install.installscript, "install.vdf");
    assert.equal(install.id, "steam-70");
    assert.deepEqual([install.manifest.title, install.manifest.steam, install.manifest.entry,
      install.manifest.commandLine], ["A Game", { appId: 70 }, "bin\\game.exe", "-windowed"]);
    assert.match(install.manifest.coverSmall, /steamstatic\.com\/.*\/70\/library_600x900\.jpg$/);
    assert.deepEqual(asked.filter(([op]) => op === "productInfo").map(([, args]) => args),
      [{ apps: [70] }, { apps: [228980] }], "the plan from the bridge: the app, then its redistributables' owner");
    assert.deepEqual(requests, [], "the launcher's server is asked nothing");

    const send = (/** @type {any} */ data) => /** @type {any} */ (installer.onmessage)({ data });
    send({ progress: { stage: "downloading", done: 3 * 2 ** 20, total: 8 * 2 ** 20 } });
    assert.deepEqual([progress.at(-1).state, progress.at(-1).done, progress.at(-1).total],
      ["downloading", 3, 8]);
    send({ progress: { stage: "finishing", done: 4, total: 8 } });
    assert.equal(progress.at(-1).state, "packing");
    assert.match(progress.at(-1).message, /50%/);
    send({ done: { id: "steam-70" } });
    assert.equal(await done, "steam-70");
    assert.ok(FakeWorker.made.every((one) => one.terminated), "its workers go with it");

    const before = asked.length;
    await assert.rejects(steam.install({ id: "80" }, () => {}, new AbortController().signal),
      /not the signed-in account's/);
    assert.deepEqual(asked.slice(before).map(([op]) => op), ["account"],
      "a game the account does not own is not asked for");

    // Stopped by its signal, in its worker: what was done is kept for the next.
    const stop = new AbortController();
    const again = steam.install({ id: "70" }, () => {}, stop.signal);
    await until(() => FakeWorker.made.length === 8 && FakeWorker.made[4].sent.length > 0);
    stop.abort();
    assert.deepEqual(FakeWorker.made[4].sent.at(-1), { cancel: true });
    /** @type {any} */ (FakeWorker.made[4].onmessage)({ data: { error: "the install was stopped",
      stopped: true } });
    await assert.rejects(again, new RegExp(STOPPED));
  });
