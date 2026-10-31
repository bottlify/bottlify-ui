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
 * With the Bottlify bridge in this browser (`bridge.js`) the session is the
 * extension's instead: the sign-in, the account and its games' ids come from
 * it, the token never reaches this page or the server, and the server is asked
 * only what Steam tells anyone -- the games' names, art and launch options --
 * and given, for an install, the depots' keys and manifest codes the bridge
 * answers for the account.
 *
 * Kept in this origin's IndexedDB, the refresh token encrypted with an
 * AES-GCM key made non-extractable and stored beside it: the storage files on
 * disk hold no token in the clear, and only this origin's code can have the
 * browser decrypt it.
 */

import { fetchClientFiles } from "@bottlify/core/steam";
import { INSTALLER_HEADER, SESSION_HEADER, encodeSession, readInstaller } from "./header.js";
import { ask, steamBridge } from "./bridge.js";
import { installRequest } from "./install.js";

/** @typedef {import("./header.js").SteamSession} SteamSession */
/** @typedef {import("../../steam-store.mjs").StoreGame} StoreGame */
/** @typedef {import("../../steam-store.mjs").InstallJob} InstallJob */
/** @typedef {{ steamId: string, accountName: string, apps: number[] }} SteamAccount */

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

/**
 * The headers that hand this browser's session to the server, or none --
 * none with the bridge, whatever was kept here before it came.
 */
export async function sessionHeaders() {
  if (await steamBridge()) return {};
  const session = await keptSession();
  return session ? { [SESSION_HEADER]: encodeSession(session) } : {};
}

/**
 * Signs in with a QR code, in the bridge, or else through the launcher's
 * server: it talks to Steam's connection manager -- which refuses a page from
 * anywhere but localhost -- relays the challenges, and hands the session to
 * this page alone, keeping nothing; it is kept here. Resolves once approved
 * in the Steam app.
 *
 * @param {Object} options
 * @param {(challengeUrl: string) => void} options.onChallenge
 * @param {() => void} [options.onScanned]
 * @param {AbortSignal} [options.signal]  Stops the sign-in where it runs too.
 * @returns {Promise<{ accountName: string }>}
 */
export async function signIn(options) {
  if (await steamBridge()) {
    return ask("signIn", {}, { signal: options.signal, onEvent: (name, data) => {
      if (name === "challenge") options.onChallenge(data.url);
      else if (name === "scanned") options.onScanned?.();
    } });
  }
  const session = await signInOnServer(options);
  await keepSession(session);
  return { accountName: session.accountName };
}

/**
 * @param {Parameters<typeof signIn>[0]} options
 * @returns {Promise<SteamSession>}
 */
function signInOnServer({ onChallenge, onScanned, signal }) {
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

/** Signs out: in the bridge, or the server told first, with the session, to drop what it read. */
export async function signOut() {
  if (await steamBridge()) {
    await ask("signOut");
    return;
  }
  await fetch("/steam/session", { method: "DELETE", headers: await sessionHeaders() })
    .catch(() => {});
  await keepSession(null);
}

/**
 * The account signed in in this browser and the games its licences grant,
 * which a bottle that needs Steam running is started with; null for nobody.
 *
 * @returns {Promise<SteamAccount | null>}
 */
export async function steamAccount() {
  if (await steamBridge()) return ask("account");
  if (!await keptSession()) return null;
  const answer = await fetch("/steam/account", { headers: await sessionHeaders() });
  return answer.ok ? answer.json() : null;
}

/**
 * What a Steam app's DRM asks the client it runs beside, with the bridge: the
 * app's ownership ticket as Steam signed it for the account (none for an app
 * it does not own), and Valve's own client DLLs, which a wrapper reads to
 * check the client it loaded -- data the engine never runs, fetched from
 * Valve's CDN here (the bridge opens it to this page) and kept in this
 * browser's cache, never sent to the server. Empty without the bridge.
 *
 * @param {number} appId
 * @returns {Promise<{ ownershipTickets?: Record<number, Uint8Array>,
 *     clientFiles?: Record<string, Uint8Array> }>}
 */
export async function steamRunData(appId) {
  if (!await steamBridge()) return {};
  const [ticket, client] = await Promise.all([
    ask("appOwnershipTicket", { app: appId }).catch(() => null),
    // The package's name carries its hash, so a cached one is the one the
    // manifest names; the manifest itself is asked each time.
    fetchClientFiles({ fetch: async (url) => {
      if (!String(url).endsWith(".zip")) return fetch(url);
      const cache = await caches.open("steam-client");
      const kept = await cache.match(url);
      if (kept) return kept;
      const fresh = await fetch(url);
      if (fresh.ok) await cache.put(url, fresh.clone());
      return fresh;
    } }).catch((error) => {
      console.warn("steam client files:", error);
      return null;
    }),
  ]);
  return {
    ...(ticket ? { ownershipTickets: { [appId]: ticket } } : {}),
    ...(client ? { clientFiles: client.files } : {}),
  };
}

/** The signed-in account's name, or null for nobody. @returns {Promise<string | null>} */
export async function steamAccountName() {
  if (await steamBridge()) return (await ask("account"))?.accountName ?? null;
  return (await keptSession())?.accountName ?? null;
}

/**
 * The signed-in account's games as the store shows them. With the bridge the
 * account's app ids are all the server is given.
 *
 * @returns {Promise<StoreGame[]>}
 */
export async function steamGames() {
  const account = await steamBridge() ? await ask("account") : null;
  const answer = account
    ? await fetch("/steam/apps", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ apps: account.apps }) })
    : await fetch("/steam/library", { headers: await sessionHeaders() });
  if (!answer.ok) throw new Error(await answer.text());
  return answer.json();
}

/** Where this browser's installer id is kept. */
const INSTALLER = "bottlify.steam.installer";
/** @type {string | null} */
let installer = null;

/**
 * The id the installs this browser starts through the bridge are followed by:
 * made here once, naming no account. Where nothing can be stored it lasts as
 * long as the page.
 */
function installerHeaders() {
  if (!installer) {
    try {
      installer = localStorage.getItem(INSTALLER);
    } catch {
      // no storage
    }
    if (!readInstaller(installer ?? undefined)) {
      installer = Array.from(crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, "0")).join("");
      try {
        localStorage.setItem(INSTALLER, installer);
      } catch {
        // kept for the page alone
      }
    }
  }
  return { [INSTALLER_HEADER]: /** @type {string} */ (installer) };
}

/**
 * The installs this browser asked the server for: by its session, or with the
 * bridge by its installer id.
 *
 * @returns {Promise<InstallJob[]>}
 */
export async function steamJobs() {
  const headers = await steamBridge() ? installerHeaders() : await sessionHeaders();
  return fetch("/steam/install", { headers })
    .then((r) => (r.ok ? r.json() : [])).catch(() => []);
}

/**
 * Asks the server to install a game of the account's. With the bridge the
 * server has no session: it is told what its plan for the app downloads opens
 * with -- each depot's key and its manifest's request code, from the bridge --
 * and the token stays there.
 *
 * @param {number} appId
 * @returns {Promise<InstallJob>}
 */
export async function startInstall(appId) {
  /** @type {Record<string, string>} */
  let headers;
  /** @type {unknown} */
  let body = { appId };
  if (await steamBridge()) {
    const account = await ask("account");
    if (!account?.apps?.includes(appId)) throw new Error("the game is not the signed-in account's");
    const plan = await fetch(`/steam/plan?app=${appId}`);
    if (!plan.ok) throw new Error(await plan.text());
    body = await installRequest(await plan.json(), ask);
    headers = installerHeaders();
  } else {
    headers = await sessionHeaders();
  }
  const answer = await fetch("/steam/install", { method: "POST",
    headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!answer.ok) throw new Error(await answer.text());
  return answer.json();
}
