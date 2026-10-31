/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The Bottlify bridge, when this browser has it: an extension
 * (`modules/bridge` in the engine repository) that talks to Steam for this
 * page and keeps the session in itself, out of the page's reach. The page asks
 * it over `window.postMessage` on its own origin; the protocol is the
 * extension's (`src/protocol.js` there).
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

/** @type {Promise<{ version: string, platforms: Record<string, boolean> } | null> | null} */
let greeted = null;

/**
 * Whether the bridge is here and the site has a platform switched on in it;
 * false otherwise, and there is no such platform in this browser. The
 * extension marks the root element before any of this page's scripts runs, so
 * a page without it does not wait for an answer.
 *
 * @param {string} platform  `steam`, as the bridge names its ops `steam.…`.
 * @returns {Promise<boolean>}
 */
export function platformOn(platform) {
  if (document.documentElement.dataset.bottlifyBridge === undefined) return Promise.resolve(false);
  greeted ??= ask("hello").catch(() => null);
  return greeted.then((hello) => Boolean(hello?.platforms?.[platform]));
}
