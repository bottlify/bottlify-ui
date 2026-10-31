/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const ORIGIN = "https://play.bottlify.app";

/**
 * A page with the bridge's content script in it, as far as bridge.js sees:
 * every message posted is heard by the page's listeners, as a window's own
 * are, and `answer` replies to a request the way the bridge does.
 *
 * @param {{ marked?: boolean, answer: (request: any, reply: (body: object) => void) => void }} options
 */
async function page({ marked = true, answer }) {
  const window = new EventTarget();
  /** @type {any[]} */
  const posted = [];
  const dispatch = (/** @type {any} */ data, origin = ORIGIN) => window.dispatchEvent(
    Object.assign(new Event("message"), { data, origin }));
  Object.assign(globalThis, {
    location: { origin: ORIGIN },
    document: { documentElement: { dataset: marked ? { bottlifyBridge: "0.1.0" } : {} } },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    postMessage: (/** @type {any} */ data, /** @type {string} */ origin) => {
      assert.equal(origin, ORIGIN, "posted to this origin alone");
      posted.push(data);
      queueMicrotask(() => {
        dispatch(data);
        if (data.to === "bottlify-bridge") {
          answer(data, (body) => dispatch({ from: "bottlify-bridge", id: data.id, ...body }));
        }
      });
    },
  });
  // A fresh module a page: what it learnt of the bridge is kept per page.
  const module = await import(`./gamehub.js?page=${Math.random()}`);
  return { ...module, posted, dispatch };
}

test("no mark on the page: no bridge, and nothing is asked", async () => {
  const { gamehub, posted } = await page({ marked: false, answer: () => assert.fail() });
  assert.equal(await gamehub(), null);
  assert.deepEqual(posted, []);
});

test("GameHub says which stores it has, and which the site has on", async () => {
  const stores = [{ id: "steam", name: "Steam", on: true }, { id: "gog", name: "GOG", on: false }];
  const { gamehub } = await page({ answer: (request, reply) => {
    assert.equal(request.op, "hello");
    reply({ result: { version: "0.2.0", stores } });
  } });
  assert.deepEqual(await gamehub(), { version: "0.2.0", stores });
  const older = await page({ answer: (_request, reply) => reply({ result: { version: "0.1.0",
    platforms: { steam: true } } }) });
  assert.equal(await older.gamehub(), null, "an extension that does not list stores is none");
});

test("an answer is its own request's: events first, then the result or the error", async () => {
  const { ask, dispatch } = await page({ answer: (request, reply) => {
    if (request.op === "signIn") {
      // Another request's answer, and one from elsewhere, are not this one's.
      dispatch({ from: "bottlify-bridge", id: request.id + 100, result: "other" });
      dispatch({ from: "bottlify-bridge", id: request.id, result: "forged" }, "https://evil.example");
      reply({ event: "challenge", data: { url: "https://s.team/q/1/1" } });
      reply({ event: "scanned", data: {} });
      reply({ result: { accountName: "someone" } });
    } else {
      reply({ error: "Steam is switched off for this site" });
    }
  } });
  /** @type {any[]} */
  const events = [];
  assert.deepEqual(await ask("signIn", { store: "steam" }, { onEvent: (name, data) => events.push([name, data]) }),
    { accountName: "someone" });
  assert.deepEqual(events, [["challenge", { url: "https://s.team/q/1/1" }], ["scanned", {}]]);
  await assert.rejects(ask("account", { store: "steam" }), /switched off/);
});

test("an aborted request is cancelled in the bridge by its id", async () => {
  const stop = new AbortController();
  /** @type {any[]} */
  const cancelled = [];
  const { ask, posted } = await page({ answer: (request, reply) => {
    if (request.op === "cancel") {
      cancelled.push(request.args.target);
      reply({ result: {} });
    }
  } });
  const going = ask("signIn", { store: "steam" }, { signal: stop.signal });
  stop.abort();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(cancelled, [posted.find((one) => one.op === "signIn").id]);
  going.catch(() => {});
});
