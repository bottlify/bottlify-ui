/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const ORIGIN = "https://play.bottlify.app";
const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const PEER = "bottlify-bridge";

/**
 * A page with GameHub in it, as far as gamehub.js sees: the content script,
 * which `answer` answers on the page's own origin, and each store's session
 * frame the page embeds, which `frameAnswer` answers from the extension's
 * origin. Every message carries its window and origin, as a browser's do.
 *
 * @param {{ marked?: boolean, answer: (request: any, reply: (body: object) => void) => void,
 *   frameAnswer?: (request: any, reply: (body: object) => void) => void }} options
 */
async function page({ marked = true, answer, frameAnswer = () => {} }) {
  const events = new EventTarget();
  /** @type {any[]} What the content script was posted. */
  const posted = [];
  /** @type {any[]} What the frames were posted. */
  const toFrames = [];
  /** @type {any[]} The frames embedded. */
  const frames = [];
  /** @type {any} */
  let win = null;
  const dispatch = (/** @type {any} */ data, origin = ORIGIN, source = win) => events.dispatchEvent(
    Object.assign(new Event("message"), { data, origin, source }));
  win = {
    postMessage: (/** @type {any} */ data, /** @type {string} */ origin) => {
      assert.equal(origin, ORIGIN, "posted to this origin alone");
      posted.push(data);
      queueMicrotask(() => {
        dispatch(data);
        if (data.to === PEER) answer(data, (body) => dispatch({ from: PEER, id: data.id, ...body }));
      });
    },
  };
  const document = {
    documentElement: { dataset: marked ? { bottlifyBridge: "0.1.0" } : {} },
    createElement: () => {
      const frameWindow = {
        postMessage: (/** @type {any} */ data, /** @type {string} */ origin) => {
          assert.equal(origin, EXTENSION, "posted to the extension's frame alone");
          toFrames.push(data);
          queueMicrotask(() => frameAnswer(data,
            (body) => dispatch({ from: PEER, id: data.id, ...body }, EXTENSION, frameWindow)));
        },
      };
      const frame = { style: {}, setAttribute: () => {}, contentWindow: frameWindow };
      frames.push(frame);
      return frame;
    },
    body: { append: (/** @type {any} */ frame) => queueMicrotask(() =>
      dispatch({ from: PEER, ready: true }, EXTENSION, frame.contentWindow)) },
  };
  Object.assign(globalThis, {
    window: win,
    location: { origin: ORIGIN },
    document,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  // A fresh module a page: what it learnt of GameHub is kept per page.
  const module = await import(`./gamehub.js?page=${Math.random()}`);
  return { ...module, posted, toFrames, frames, dispatch };
}

/** The content script's hello, with the extension's origin. @param {any} request @param {(body: object) => void} reply */
const hello = (request, reply) => reply(request.op === "hello"
  ? { result: { version: "0.2.0", origin: EXTENSION, stores: [{ id: "steam", name: "Steam", on: true }] } }
  : { error: `${request.op} is asked of a store's frame` });

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

test("every op but hello is the store's session frame's, embedded once from the extension", async () => {
  const { ask, frames, toFrames, posted } = await page({ answer: hello, frameAnswer: (request, reply) => {
    reply(request.op === "list" ? { result: [{ id: "70" }] } : { error: "Steam is switched off for this site" });
  } });
  assert.deepEqual(await ask("list", { store: "steam" }), [{ id: "70" }]);
  await assert.rejects(ask("account", { store: "steam" }), /switched off/);
  assert.equal(frames.length, 1, "one frame for the store");
  assert.equal(frames[0].src, `${EXTENSION}/steam/session.html`);
  assert.deepEqual(toFrames.map((one) => one.op), ["list", "account"]);
  assert.deepEqual(posted.map((one) => one.op), ["hello"], "the content script is asked hello alone");
});

test("an answer is its own request's: from its frame, its origin, its id", async () => {
  const { ask, dispatch, frames } = await page({ answer: hello, frameAnswer: (request, reply) => {
    const frame = frames[0].contentWindow;
    // Another request's answer, one from another origin or window, and an event, are not its answer.
    dispatch({ from: PEER, id: request.id + 100, result: "other" }, EXTENSION, frame);
    dispatch({ from: PEER, id: request.id, result: "forged" }, "https://evil.example", frame);
    dispatch({ from: PEER, id: request.id, result: "forged" }, EXTENSION, {});
    dispatch({ from: PEER, id: request.id, result: "forged" }, ORIGIN);
    reply({ event: "progress", data: {} });
    reply({ result: [{ id: "70" }] });
  } });
  assert.deepEqual(await ask("list", { store: "steam" }), [{ id: "70" }]);
});

test("a GameHub without session frames is said to be too old", async () => {
  const { ask } = await page({ answer: (_request, reply) =>
    reply({ result: { version: "0.1.0", stores: [{ id: "steam", name: "Steam", on: true }] } }) });
  await assert.rejects(ask("list", { store: "steam" }), /too old/);
});

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
