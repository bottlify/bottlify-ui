/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GameHub, when this browser has it: the Bottlify extension
 * (`modules/bridge` in the engine repository) that keeps the game stores'
 * accounts and speaks their protocols, the sessions kept in itself, out of the
 * page's reach. The page asks it over `window.postMessage` on its own origin,
 * with store-neutral ops (`src/protocol.js` there); the store is an argument.
 * A sign-in is not one of them: the page frames the store's sign-in page,
 * which is GameHub's own, and is told the account's name when it is done.
 */

const PEER = "bottlify-bridge";
let lastId = 0;

/**
 * Asks the bridge.
 *
 * @param {string} op
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<any>}
 */
export function ask(op, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++lastId;
    const heard = (/** @type {MessageEvent} */ event) => {
      const data = event.data;
      if (event.origin !== location.origin || data?.from !== PEER || data.id !== id
        || data.event) return;
      removeEventListener("message", heard);
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.result);
    };
    addEventListener("message", heard);
    postMessage({ to: PEER, id, op, args }, location.origin);
  });
}

/**
 * What GameHub says of itself: its version, its stores, and its origin, where
 * each store's sign-in page is.
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
  if (document.documentElement.dataset.bottlifyBridge === undefined) return Promise.resolve(null);
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
