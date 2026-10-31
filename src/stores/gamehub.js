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
 */

const PEER = "bottlify-bridge";
let lastId = 0;

/**
 * Asks the bridge. An op that goes on (a sign-in) sends events before its
 * answer; aborted, it is cancelled in the bridge too.
 *
 * @param {string} op
 * @param {Record<string, unknown>} [args]
 * @param {{ onEvent?: (name: string, data: any) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<any>}
 */
export function ask(op, args = {}, { onEvent, signal } = {}) {
  return new Promise((resolve, reject) => {
    const id = ++lastId;
    const heard = (/** @type {MessageEvent} */ event) => {
      const data = event.data;
      if (event.origin !== location.origin || data?.from !== PEER || data.id !== id) return;
      if (data.event) {
        onEvent?.(data.event, data.data);
        return;
      }
      removeEventListener("message", heard);
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.result);
    };
    addEventListener("message", heard);
    signal?.addEventListener("abort", () => {
      ask("cancel", { target: id }).catch(() => {});
    }, { once: true });
    postMessage({ to: PEER, id, op, args }, location.origin);
  });
}

/** @type {Promise<{ version: string, stores: { id: string, name: string, on: boolean }[] } | null> | null} */
let greeted = null;

/**
 * GameHub, when this browser has it: its version and the stores it has, each
 * said on or off for this site; null without it. The extension marks the root
 * element before any of this page's scripts runs, so a page without it does
 * not wait for an answer.
 *
 * @returns {Promise<{ version: string, stores: { id: string, name: string, on: boolean }[] } | null>}
 */
export function gamehub() {
  if (document.documentElement.dataset.bottlifyBridge === undefined) return Promise.resolve(null);
  greeted ??= ask("hello").then((hello) => (Array.isArray(hello?.stores) ? hello : null))
    .catch(() => null);
  return greeted;
}
