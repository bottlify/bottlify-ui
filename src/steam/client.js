/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Steam as a store of the launcher's (`stores/providers.js`), through the
 * Bottlify bridge (`bridge.js`) and nothing else: the extension signs in,
 * keeps the session -- its token never reaches this page -- and answers the
 * account, what Steam tells anyone of its apps, and the depots' keys and
 * manifest codes an install opens them with. A game installs in this browser
 * (`browser-install.js`). The launcher's server has no part in it; without the
 * bridge there is no Steam here, and the page says the extension is needed.
 */

import { fetchClientFiles, steamArt } from "@bottlify/core/steam";
import { ask, platformOn } from "./bridge.js";
import { installInBrowser } from "./browser-install.js";
import { storeGame } from "./install.js";

/** @typedef {import("../stores/providers.js").StoreProvider} StoreProvider */
/** @typedef {{ steamId: string, accountName: string, apps: number[], licenses?: number }} SteamAccount */

/** What Steam in the launcher says without the bridge. */
export const NEEDS_BRIDGE = "Steam needs the Bottlify GameHub extension in this browser.";

/**
 * The bridge's Steam ops.
 *
 * @param {string} op @param {Record<string, unknown>} [args]
 * @param {Parameters<typeof ask>[2]} [options]
 */
const askSteam = (op, args = {}, options) => ask(`steam.${op}`, args, options);

const available = () => platformOn("steam");

/** @returns {Promise<never>} */
const needsBridge = () => Promise.reject(new Error(NEEDS_BRIDGE));

/**
 * Where the launcher kept a session of its own before the bridge did Steam:
 * nothing reads them now, and a token is not left behind in them.
 */
function dropOldSession() {
  try {
    globalThis.localStorage?.removeItem("bottlify.steam.session");
    globalThis.localStorage?.removeItem("bottlify.steam.installer");
    globalThis.indexedDB?.deleteDatabase("bottlify-steam");
  } catch {
    // no storage
  }
}
let dropped = false;

/**
 * The account signed in in the bridge and every app its licences grant; null
 * for nobody, or no bridge.
 *
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<SteamAccount | null>}
 */
async function account({ fresh = false } = {}) {
  if (!dropped) {
    dropped = true;
    dropOldSession();
  }
  return await available() ? askSteam("account", fresh ? { fresh } : {}) : null;
}

/**
 * What a Steam app's DRM asks the client it runs beside: the app's ownership
 * ticket as Steam signed it for the account (none for an app it does not
 * own), and Valve's own client DLLs, which a wrapper reads to check the client
 * it loaded -- data the engine never runs, fetched from Valve's CDN here (the
 * bridge opens it to this page) and kept in this browser's cache.
 *
 * @param {number} appId
 * @returns {Promise<{ ownershipTickets?: Record<number, Uint8Array>,
 *     clientFiles?: Record<string, Uint8Array> }>}
 */
async function clientData(appId) {
  const [ticket, client] = await Promise.all([
    askSteam("appOwnershipTicket", { app: appId }).catch(() => null),
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

/** @type {StoreProvider} */
export const steam = {
  id: "steam",
  name: "Steam",
  available,
  unavailable: NEEDS_BRIDGE,

  auth: {
    account: async () => {
      const now = await account();
      return now ? { name: now.accountName } : null;
    },
    signIn: async ({ onChallenge, onScanned, signal }) => {
      if (!await available()) return needsBridge();
      const { accountName } = await askSteam("signIn", {}, { signal, onEvent: (name, data) => {
        if (name === "challenge") onChallenge(data.url);
        else if (name === "scanned") onScanned?.();
      } });
      return { name: accountName };
    },
    signOut: async () => {
      if (await available()) await askSteam("signOut");
    },
  },

  // Every app the licences grant, of which the games, as Steam tells anyone of them.
  getList: async ({ fresh = false } = {}) => {
    if (!await available()) return needsBridge();
    const now = await account({ fresh });
    if (!now?.apps?.length) return [];
    const infos = await askSteam("productInfo", { apps: now.apps });
    return now.apps.flatMap((appId) => {
      const game = storeGame(appId, infos?.[appId]);
      return game ? [game] : [];
    }).sort((a, b) => a.name.localeCompare(b.name));
  },

  getCover: (game, kind) => steamArt(Number(game.id))[kind === "capsule" ? "cover" : kind],

  install: async (game, onProgress, signal) => {
    if (!await available()) return needsBridge();
    const appId = Number(game.id);
    if (!(await account())?.apps?.includes(appId)) {
      throw new Error("the game is not the signed-in account's");
    }
    return installInBrowser(appId, askSteam, onProgress, signal);
  },

  gameOf: (bottle) => (Number.isInteger(bottle?.steam?.appId) ? String(bottle.steam.appId) : null),

  // A Steam app starts with Steam running for the account signed in in this
  // browser; nobody signed in, and the program finds no Steam running.
  runData: async (bottle) => {
    const appId = Number(bottle?.steam?.appId);
    const now = await account().catch(() => null);
    if (!now) return {};
    return { win32: { steam: { ...now, ...await clientData(appId), appId } } };
  },
};
