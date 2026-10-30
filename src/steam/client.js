/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * This browser's Steam session: signed in for itself, kept by itself, handed
 * to the launcher's server with each request that needs it and never left
 * there. One browser signed in is not every device that opens the launcher.
 *
 * Kept in this origin's IndexedDB, the refresh token encrypted with an
 * AES-GCM key made non-extractable and stored beside it: the storage files on
 * disk hold no token in the clear, and only this origin's code can have the
 * browser decrypt it.
 */

import { SESSION_HEADER, encodeSession } from "./header.js";

/** @typedef {import("./header.js").SteamSession} SteamSession */

const DB = "bottlify-steam";
const STORE = "kept";
/** Where the launcher kept the session in the clear before; read once, then removed. */
const LEGACY = "bottlify.steam.session";

/** @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {"readonly" | "readwrite"} mode
 * @param {(store: IDBObjectStore) => IDBRequest | void} work
 * @returns {Promise<any>}
 */
async function inStore(mode, work) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** The key, made the first time a session is kept. @returns {Promise<CryptoKey>} */
async function key() {
  const stored = await inStore("readonly", (store) => store.get("key"));
  if (stored) return stored;
  const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false,
    ["encrypt", "decrypt"]);
  await inStore("readwrite", (store) => store.put(made, "key"));
  return made;
}

/** @param {SteamSession | null} session */
async function write(session) {
  if (!session) {
    await inStore("readwrite", (kept) => kept.delete("session"));
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(),
    new TextEncoder().encode(JSON.stringify(session)));
  await inStore("readwrite", (kept) => kept.put({ iv, data }, "session"));
}

/** @returns {Promise<SteamSession | null>} */
async function load() {
  /** @type {SteamSession | null} */
  let legacy = null;
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY) ?? "null");
    legacy = value?.accountName && value?.refreshToken ? value : null;
  } catch {
    // no storage, or nothing readable in it
  }
  if (legacy) {
    await write(legacy);
    localStorage.removeItem(LEGACY);
    return legacy;
  }
  const kept = await inStore("readonly", (one) => one.get("session"));
  if (!kept) return null;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: kept.iv }, await key(), kept.data);
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * Read once a page: the session, or a kept one that cannot be read (storage
 * refused, a private window) taken as none.
 *
 * @type {Promise<SteamSession | null> | null}
 */
let current = null;

/** @returns {Promise<SteamSession | null>} */
export function keptSession() {
  current ??= load().catch(() => null);
  return current;
}

/**
 * Keeps a session signed in here, or forgets it. Where nothing can be stored
 * it still lasts as long as the page.
 *
 * @param {SteamSession | null} session
 */
export async function keepSession(session) {
  current = Promise.resolve(session);
  await write(session).catch(() => {});
}

/** The headers that hand this browser's session to the server, or none. */
export async function sessionHeaders() {
  const session = await keptSession();
  return session ? { [SESSION_HEADER]: encodeSession(session) } : {};
}

/**
 * Signs in with a QR code through the launcher's server: it talks to Steam's
 * connection manager -- which refuses a page from anywhere but localhost --
 * relays the challenges, and hands the session to this page alone, keeping
 * nothing. Resolves once approved in the Steam app.
 *
 * @param {Object} options
 * @param {(challengeUrl: string) => void} options.onChallenge
 * @param {() => void} [options.onScanned]
 * @param {AbortSignal} [options.signal]  Stops the sign-in on the server too.
 * @returns {Promise<SteamSession>}
 */
export function signIn({ onChallenge, onScanned, signal }) {
  return new Promise((resolve, reject) => {
    const events = new EventSource("/steam/signin");
    const end = (/** @type {() => void} */ then) => {
      events.close();
      then();
    };
    signal?.addEventListener("abort", () => end(() => reject(signal.reason)), { once: true });
    events.addEventListener("challenge", (event) => onChallenge(event.data));
    events.addEventListener("scanned", () => onScanned?.());
    events.addEventListener("session", (event) => end(() => resolve(JSON.parse(event.data))));
    events.addEventListener("failed", (event) => end(() => reject(new Error(event.data))));
    // A dropped stream would be reopened by the browser as a new sign-in; it is
    // the caller's to start again.
    events.onerror = () => end(() => reject(new Error("the sign-in's connection to the server dropped")));
  });
}
