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

test("an answer is its own request's: the result or the error", async () => {
  const { ask, dispatch } = await page({ answer: (request, reply) => {
    if (request.op === "list") {
      // Another request's answer, one from elsewhere, and an event, are not its answer.
      dispatch({ from: "bottlify-bridge", id: request.id + 100, result: "other" });
      dispatch({ from: "bottlify-bridge", id: request.id, result: "forged" }, "https://evil.example");
      reply({ event: "progress", data: {} });
      reply({ result: [{ id: "70" }] });
    } else {
      reply({ error: "Steam is switched off for this site" });
    }
  } });
  assert.deepEqual(await ask("list", { store: "steam" }), [{ id: "70" }]);
  await assert.rejects(ask("account", { store: "steam" }), /switched off/);
});

const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

test("a store's sign-in page is GameHub's, at its origin by the store's id", async () => {
  const stores = [{ id: "steam", name: "Steam", on: true }];
  const { signInPage } = await page({ answer: (_request, reply) =>
    reply({ result: { version: "0.2.0", origin: EXTENSION, stores } }) });
  assert.equal(await signInPage("steam"), `${EXTENSION}/steam/signin.html`);
  const older = await page({ answer: (_request, reply) => reply({ result: { version: "0.1.0", stores } }) });
  assert.equal(await older.signInPage("steam"), null, "an extension without the page");
  const forged = await page({ answer: (_request, reply) =>
    reply({ result: { version: "0.2.0", origin: "https://evil.example", stores } }) });
  assert.equal(await forged.signInPage("steam"), null, "only an extension's page is framed");
});

test("the page learns the account's name from the store's sign-in page alone", async () => {
  const { signedInName } = await page({ answer: () => {} });
  const framed = `${EXTENSION}/steam/signin.html`;
  const said = { from: "bottlify-signin", store: "steam", signedIn: { name: "someone" } };
  /** @param {any} data @param {string} origin */
  const event = (data, origin) => /** @type {MessageEvent} */ (/** @type {unknown} */ ({ data, origin }));
  assert.equal(signedInName(event(said, EXTENSION), framed, "steam"), "someone");
  assert.equal(signedInName(event(said, "https://evil.example"), framed, "steam"), null,
    "from elsewhere");
  assert.equal(signedInName(event(said, EXTENSION), framed, "gog"), null, "another store's");
  assert.equal(signedInName(event({ ...said, signedIn: null }, EXTENSION), framed, "steam"), null);
});
