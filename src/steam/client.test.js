/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const ORIGIN = "https://play.bottlify.app";
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);

/**
 * A page with the bridge in it, signed in to an account that owns app 70, and
 * a server that answers the plan and takes the install; every request kept.
 */
async function bridgedPage() {
  const window = new EventTarget();
  /** @type {Array<{ url: string, init: any }>} */
  const requests = [];
  /** @type {Map<string, string>} */
  const stored = new Map();
  /** @type {Record<string, (args: any) => unknown>} */
  const ops = {
    hello: () => ({ version: "0.1.0", platforms: { steam: true } }),
    account: () => ({ steamId: "1", accountName: "someone", apps: [70] }),
    depotKey: () => KEY,
    manifestCode: ({ depot }) => `${depot}0042`,
  };
  Object.assign(globalThis, {
    location: { origin: ORIGIN },
    document: { documentElement: { dataset: { bottlifyBridge: "0.1.0" } } },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    localStorage: { getItem: (/** @type {string} */ k) => stored.get(k) ?? null,
      setItem: (/** @type {string} */ k, /** @type {string} */ v) => stored.set(k, v) },
    postMessage: (/** @type {any} */ data) => queueMicrotask(() => {
      if (data.to !== "bottlify-bridge") return;
      window.dispatchEvent(Object.assign(new Event("message"), { origin: ORIGIN,
        data: { from: "bottlify-bridge", id: data.id, result: ops[data.op](data.args) } }));
    }),
    fetch: async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
      requests.push({ url, init });
      if (url === "/steam/plan?app=70") {
        return Response.json({ appId: 70, depots: [{ depot: 101, gid: "1111" }] });
      }
      if (url === "/steam/install" && init.method === "POST") {
        return Response.json({ appId: 70, state: "downloading", done: 0, total: 1, message: "" });
      }
      return Response.json([]);
    },
  });
  return { requests, ...await import(`./client.js?page=${Math.random()}`) };
}

test("with the bridge, an install hands the server the planned depots' keys and codes, not a session", async () => {
  const { startInstall, steamJobs, requests } = await bridgedPage();
  const job = await startInstall(70);
  assert.equal(job.state, "downloading");
  const post = requests.find(({ init }) => init.method === "POST");
  assert.ok(post);
  assert.deepEqual(JSON.parse(post.init.body), { appId: 70, depots: [
    { depot: 101, gid: "1111", key: Buffer.from(KEY).toString("hex"), code: "1010042" }] });
  const installer = post.init.headers["x-steam-installer"];
  assert.match(installer, /^[0-9a-f]{32}$/);
  assert.equal(post.init.headers["x-steam-session"], undefined);

  await steamJobs();
  const followed = requests.at(-1);
  assert.equal(followed?.url, "/steam/install");
  assert.equal(followed?.init.headers["x-steam-installer"], installer, "the same id follows it");

  const before = requests.length;
  await assert.rejects(startInstall(71), /not the signed-in account's/);
  assert.equal(requests.length, before, "a game the account does not own is not asked for");
});
