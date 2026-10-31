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

/**
 * A page with the bridge in it, signed in to an account that owns app 70, and
 * a server that answers the plan; every request and every bridge question kept.
 */
async function bridgedPage() {
  const window = new EventTarget();
  /** @type {Array<{ url: string, init: any }>} */
  const requests = [];
  /** @type {Array<[string, any]>} */
  const asked = [];
  /** @type {Record<string, (args: any) => unknown>} */
  const ops = {
    hello: () => ({ version: "0.1.0", platforms: { steam: true } }),
    account: () => ({ steamId: "1", accountName: "someone", apps: [70] }),
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
    document: { documentElement: { dataset: { bottlifyBridge: "0.1.0" } } },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    postMessage: (/** @type {any} */ data) => queueMicrotask(() => {
      if (data.to !== "bottlify-bridge") return;
      asked.push([data.op, data.args]);
      window.dispatchEvent(Object.assign(new Event("message"), { origin: ORIGIN,
        data: { from: "bottlify-bridge", id: data.id, result: ops[data.op](data.args) } }));
    }),
    fetch: async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
      requests.push({ url, init });
      if (url === "/steam/plan?app=70") {
        return Response.json({ appId: 70, name: "A Game", depots: [{ depot: 101, gid: "1111" }],
          shared: [{ depot: 228990, app: 228980, gid: "2222" }], installscript: "install.vdf",
          launch: { executable: "bin/game.exe", arguments: "-windowed" } });
      }
      return Response.json([]);
    },
  });
  return { requests, asked, ...await import(`./client.js?page=${Math.random()}`) };
}

/** @param {() => boolean} done */
async function until(done) {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(done(), "in time");
}

test("with the bridge, an install runs in this browser: keys and codes to its worker, none to the server",
  async () => {
    const { startInstall, steamJobs, cancelInstall, requests, asked } = await bridgedPage();
    const job = await startInstall(70);
    assert.equal(job.local, true);
    assert.equal(await startInstall(70), job, "Install again while it runs is the same install");
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
    assert.deepEqual(requests.map(({ url }) => url), ["/steam/plan?app=70"],
      "the server is asked the plan and nothing else");

    const send = (/** @type {any} */ data) => /** @type {any} */ (installer.onmessage)({ data });
    send({ progress: { stage: "downloading", done: 3 * 2 ** 20, total: 8 * 2 ** 20 } });
    assert.deepEqual((await steamJobs()).map(({ state, done, total }) => [state, done, total]),
      [["downloading", 3, 8]]);
    send({ progress: { stage: "finishing", done: 4, total: 8 } });
    assert.equal((await steamJobs())[0].state, "packing");
    assert.match((await steamJobs())[0].message, /50%/);
    send({ done: { id: "steam-70" } });
    await until(() => job.state === "done");
    assert.equal(job.bundle, "steam-70");
    assert.ok(FakeWorker.made.every((one) => one.terminated), "its workers go with it");

    const before = requests.length;
    await assert.rejects(startInstall(71), /not the signed-in account's/);
    assert.equal(requests.length, before, "a game the account does not own is not asked for");

    // Install again after it ended is a new run; Cancel stops it in its worker.
    const again = await startInstall(70);
    assert.notEqual(again, job);
    await until(() => FakeWorker.made.length === 8 && FakeWorker.made[4].sent.length > 0);
    cancelInstall(70);
    assert.deepEqual(FakeWorker.made[4].sent.at(-1), { cancel: true });
    /** @type {any} */ (FakeWorker.made[4].onmessage)({ data: { error: "the install was stopped",
      stopped: true } });
    await until(() => again.state === "failed");
    assert.match(again.message, /goes on from where it stopped/);
  });
