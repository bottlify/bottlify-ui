/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GameHub, when this browser has it: the Bottlify extension
 * (`gamehub/` in this repository) that keeps the game stores'
 * accounts and speaks their protocols, the sessions kept in itself, out of the
 * page's reach. The page asks with store-neutral ops (`gamehub/src/protocol.js`),
 * the store an argument, over `window.postMessage`: `hello` of the extension's
 * content script, on this page's origin; every other op of the store's
 * session frame, the extension's own page (`<origin>/<store>/session.html`)
 * embedded here, between this page's origin and the extension's alone. A
 * sign-in is not an op: the page frames the store's sign-in page, also the
 * extension's, and is told the account's name when it is done.
 *
 * Where the extension's own pages cannot reach a store (Safari: its rules do
 * not apply to the extension's own requests), it runs each store in a tab of
 * the store's site and says so (`transport: 'tab'`): every op is then asked
 * of the content script, which passes it on, and a sign-in is a window of
 * the store's site the extension opens, `signIn` answering once it is done.
 */

import { fromWire } from "../../gamehub/src/wire.js";

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
 * @param {{ onEvent?: (event: string, data: any) => void, ms?: number }} [how]
 *     What the op tells before its answer, and how long it is waited on.
 * @returns {Promise<any>}
 */
function askOf(target, origin, op, args, { onEvent, ms } = {}) {
  return new Promise((resolve, reject) => {
    const id = ++lastId;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const heard = (/** @type {MessageEvent} */ event) => {
      const data = event.data;
      if (event.origin !== origin || event.source !== target || data?.from !== PEER
        || data.id !== id) return;
      // What crossed an extension's port carries its bytes as base64 (wire.js).
      if (data.event) {
        onEvent?.(data.event, fromWire(data.data));
        return;
      }
      removeEventListener("message", heard);
      clearTimeout(timer);
      if ("error" in data) reject(new Error(data.error));
      else resolve(fromWire(data.result));
    };
    addEventListener("message", heard);
    if (ms) {
      timer = setTimeout(() => {
        removeEventListener("message", heard);
        reject(new Error(`GameHub did not answer ${op} in ${ms / 1000} s`));
      }, ms);
    }
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
  if (op === "hello" || (await gamehub())?.transport === "tab") {
    return askOf(window, location.origin, op, args);
  }
  const { target, origin } = await frameOf(String(args.store));
  return askOf(target, origin, op, args);
}

/**
 * What GameHub says of itself: its version, its stores, its origin, where
 * each store's pages are, and where it runs the stores: `frame` (or nothing
 * said, by an older one) or `tab`.
 *
 * @typedef {{ version: string, origin?: string, transport?: "frame" | "tab",
 *   stores: { id: string, name: string, on: boolean }[] }} Hello
 */

/** @type {Promise<Hello | null> | null} */
let greeted = null;

/** How long a page waits for GameHub's mark on its root element once its document is read. */
const MARK_MS = 1000;

/**
 * The extension's mark on the root element, or none: Chrome sets it before
 * any of this page's scripts runs, Safari at times only after the first of
 * them has (a library reloaded asked before it and showed Steam's art as
 * though there were no GameHub). Waited for while the document is read, and
 * a moment after; a page without GameHub learns so in that time.
 *
 * @returns {Promise<boolean>}
 */
function marked() {
  const root = document.documentElement;
  if (root.dataset.bottlifyGamehub !== undefined) return Promise.resolve(true);
  return new Promise((resolve) => {
    const watch = new MutationObserver(() => {
      if (root.dataset.bottlifyGamehub === undefined) return;
      watch.disconnect();
      resolve(true);
    });
    watch.observe(root, { attributes: true, attributeFilter: ["data-bottlify-gamehub"] });
    const give = () => setTimeout(() => {
      watch.disconnect();
      resolve(root.dataset.bottlifyGamehub !== undefined);
    }, MARK_MS);
    if (document.readyState === "loading") {
      addEventListener("DOMContentLoaded", give, { once: true });
    } else give();
  });
}

/** Whether this page has waited for the mark and none came: asked again only if one does. */
let unmarked = false;

/**
 * GameHub, when this browser has it: its version and the stores it has, each
 * said on or off for this site; null without it. The extension marks the root
 * element, so a page without it waits for no answer, only a moment for the
 * mark (`marked`).
 *
 * @returns {Promise<Hello | null>}
 */
export function gamehub() {
  if (document.documentElement.dataset.bottlifyGamehub === undefined) {
    if (unmarked) return Promise.resolve(null);
    return marked().then((there) => {
      unmarked = !there;
      return there ? gamehub() : null;
    });
  }
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
  const hello = await gamehub();
  return hello?.transport !== "tab" && typeof hello?.origin === "string"
    && hello.origin.startsWith("chrome-extension://")
    ? `${hello.origin}/${encodeURIComponent(store)}/signin.html` : null;
}

/**
 * A sign-in in a window of the store's site, where GameHub runs the store in a
 * tab: `done` the account's name once it is signed in, rejected when the
 * window is closed first. Null where GameHub signs in in a frame (`signInPage`).
 *
 * @param {string} store
 * @returns {Promise<{ done: Promise<string> } | null>}
 */
export async function signInWindow(store) {
  if ((await gamehub())?.transport !== "tab") return null;
  return { done: ask("signIn", { store }).then((answer) => String(answer?.name ?? "")) };
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

/**
 * A store's content server or art as this page may read it: through GameHub
 * where it runs the stores in a tab (Safari lets the extension read them, and
 * applies no ruleset's response headers to an isolated page), the page's own
 * fetch elsewhere, where GameHub's rules open them to it.
 *
 * @param {string} url
 * @returns {Promise<Response>}
 */
export async function storeFetch(url) {
  if ((await gamehub())?.transport !== "tab") return fetch(url);
  /** @type {Uint8Array[]} */
  const parts = [];
  const answer = await askOf(window, location.origin, "fetch", { url }, {
    onEvent: (event, data) => event === "part" && parts.push(data.body), ms: FETCH_MS });
  if (answer.parts !== undefined && parts.length !== answer.parts) {
    throw new Error(`GameHub handed ${parts.length} of ${answer.parts} parts of ${url}`);
  }
  const body = answer.parts === undefined ? answer.body : new Blob(parts);
  return new Response(answer.status === 204 || answer.status === 304 ? null : body,
    { status: answer.status });
}

/** How long a fetch through GameHub is waited on: a stall is said, not waited on. */
const FETCH_MS = 180_000;

/** Art read through GameHub, as the page's own URLs, by its address. @type {Map<string, Promise<string>>} */
const arts = new Map();

/**
 * Where this page shows a picture from a store: its own address, or where
 * GameHub runs the stores in a tab, a URL of this page's for the bytes GameHub
 * read -- an isolated page in Safari may show no other. A picture GameHub
 * cannot read is its address, which shows as the browser shows it.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function artUrl(url) {
  if (!/^https:\/\//.test(url ?? "") || (await gamehub())?.transport !== "tab") return url;
  let made = arts.get(url);
  if (!made) {
    made = storeFetch(url).then(async (answer) => {
      if (!answer.ok) throw new Error(`${url} answered ${answer.status}`);
      return URL.createObjectURL(await answer.blob());
    });
    made.catch(() => arts.delete(url));
    arts.set(url, made);
  }
  return made.catch(() => url);
}
