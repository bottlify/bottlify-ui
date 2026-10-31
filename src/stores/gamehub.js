/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GameHub, when this browser has it: the Bottlify extension
 * (`modules/gamehub` in the engine repository) that keeps the game stores'
 * accounts and speaks their protocols, the sessions kept in itself, out of the
 * page's reach. The page asks with store-neutral ops (`src/protocol.js` there),
 * the store an argument, over `window.postMessage`: `hello` of the extension's
 * content script, on this page's origin; every other op of the store's
 * session frame, the extension's own page (`<origin>/<store>/session.html`)
 * embedded here, between this page's origin and the extension's alone. A
 * sign-in is not an op: the page frames the store's sign-in page, also the
 * extension's, and is told the account's name when it is done.
 */

const PEER = "bottlify-gamehub";
let lastId = 0;

/**
 * Asks a GameHub window: the answer is the one from that window and origin
 * with this request's id.
 *
 * @param {{ postMessage: (message: any, origin: string) => void }} target
 * @param {string} origin
 * @param {string} op
 * @param {Record<string, unknown>} args
 * @returns {Promise<any>}
 */
function askOf(target, origin, op, args) {
  return new Promise((resolve, reject) => {
    const id = ++lastId;
    const heard = (/** @type {MessageEvent} */ event) => {
      const data = event.data;
      if (event.origin !== origin || event.source !== target || data?.from !== PEER
        || data.id !== id || data.event) return;
      removeEventListener("message", heard);
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.result);
    };
    addEventListener("message", heard);
    target.postMessage({ to: PEER, id, op, args }, origin);
  });
}

/** Each store's session frame, embedded once it is first asked. @type {Map<string, Promise<{ target: any, origin: string }>>} */
const frames = new Map();

/**
 * A store's session frame, listening: embedded a pixel in size, shown but not
 * seen -- a frame not shown may be run at a background process's priority.
 *
 * @param {string} store
 */
function frameOf(store) {
  let made = frames.get(store);
  if (!made) {
    made = (async () => {
      const origin = (await gamehub())?.origin;
      if (typeof origin !== "string" || !origin.startsWith("chrome-extension://")) {
        throw new Error("this version of the Bottlify GameHub extension is too old; update it");
      }
      const frame = document.createElement("iframe");
      frame.src = `${origin}/${encodeURIComponent(store)}/session.html`;
      frame.title = "GameHub";
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;"
        + "opacity:0;pointer-events:none";
      await new Promise((ready) => {
        const heard = (/** @type {MessageEvent} */ event) => {
          if (event.source !== frame.contentWindow || event.origin !== origin
            || event.data?.from !== PEER || !event.data.ready) return;
          removeEventListener("message", heard);
          ready(undefined);
        };
        addEventListener("message", heard);
        document.body.append(frame);
      });
      return { target: frame.contentWindow, origin };
    })();
    made.catch(() => frames.delete(store));
    frames.set(store, made);
  }
  return made;
}

/**
 * Asks GameHub: `hello` of the content script, every other op of the store's
 * session frame.
 *
 * @param {string} op
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<any>}
 */
export async function ask(op, args = {}) {
  if (op === "hello") return askOf(window, location.origin, op, args);
  const { target, origin } = await frameOf(String(args.store));
  return askOf(target, origin, op, args);
}

/**
 * What GameHub says of itself: its version, its stores, and its origin, where
 * each store's pages are.
 *
 * @typedef {{ version: string, origin?: string,
 *   stores: { id: string, name: string, on: boolean }[] }} Hello
 */

/** @type {Promise<Hello | null> | null} */
let greeted = null;

/**
 * GameHub, when this browser has it: its version and the stores it has, each
 * said on or off for this site; null without it. The extension marks the root
 * element before any of this page's scripts runs, so a page without it does
 * not wait for an answer.
 *
 * @returns {Promise<Hello | null>}
 */
export function gamehub() {
  if (document.documentElement.dataset.bottlifyGamehub === undefined) return Promise.resolve(null);
  greeted ??= ask("hello").then((hello) => (Array.isArray(hello?.stores) ? hello : null))
    .catch(() => null);
  return greeted;
}

/**
 * Where a store's sign-in page is, to show in a frame; null without GameHub,
 * or with one too old to have it.
 *
 * @param {string} store
 * @returns {Promise<string | null>}
 */
export async function signInPage(store) {
  const origin = (await gamehub())?.origin;
  return typeof origin === "string" && origin.startsWith("chrome-extension://")
    ? `${origin}/${encodeURIComponent(store)}/signin.html` : null;
}

/**
 * The account's name a store's sign-in page posted once signed in, or null
 * for any other message: one from elsewhere, or of another store.
 *
 * @param {MessageEvent} event
 * @param {string} page  The page framed, from `signInPage`.
 * @param {string} store
 * @returns {string | null}
 */
export function signedInName(event, page, store) {
  const data = event.data;
  // Its origin by hand: a URL's origin is "null" for a scheme it does not know.
  const origin = page.split("/").slice(0, 3).join("/");
  return event.origin === origin && data?.from === "bottlify-signin"
    && data.store === store && typeof data.signedIn?.name === "string" ? data.signedIn.name : null;
}
