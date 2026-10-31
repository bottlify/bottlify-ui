/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The game stores, as GameHub has them: one provider of one shape for each
 * store its `hello` lists on for this site -- the library shows every
 * provider's games beside the bottles, Settings → Game Accounts signs in to
 * each, and a run of a store's bottle takes what its provider says it needs.
 * Every provider is the same few store-neutral ops asked of GameHub; what the
 * page does itself is an install, by the store's own files (`installers.js`).
 * Without GameHub there are no stores.
 */

import { ask, gamehub, signInPage } from "./gamehub.js";
import { INSTALLERS } from "./installers.js";

/** What the page says of stores without GameHub. */
export const NEEDS_GAMEHUB = "Game stores need the Bottlify GameHub extension in this browser.";

/**
 * @typedef {Object} StoreGame  A game of the account's, as the library shows it.
 * @property {string} id  The store's id of it.
 * @property {string} name
 * @property {number} bytes  What it takes installed, as far as the store says.
 * @property {boolean} exact  Whether `bytes` is measured rather than added up.
 * @property {boolean} installable  Whether it has a build an install here can start.
 * @property {{ header?: string, capsule?: string, hero?: string }} [covers]
 */

/**
 * @typedef {Object} InstallProgress
 * @property {"downloading" | "packing"} state
 * @property {number} done  MiB.
 * @property {number} total  MiB, once known.
 * @property {string} message
 */

/**
 * @typedef {Object} StoreProvider
 * @property {string} id  Its name in GameHub, in a bottle's manifest and in the library's filters.
 * @property {string} name  As a person knows it.
 * @property {() => Promise<boolean>} available  Whether it can be used in this browser now.
 * @property {string} unavailable  What the page says while it cannot.
 * @property {{
 *   account: () => Promise<{ name: string } | null>,
 *   signInPage: () => Promise<string | null>,
 *   signOut: () => Promise<void>,
 * }} auth  The account: a sign-in is GameHub's page for the store, shown in a frame.
 * @property {(options?: { fresh?: boolean }) => Promise<StoreGame[]>} getList  The account's games.
 * @property {(game: StoreGame, kind: "header" | "capsule" | "hero") => string} getCover
 * @property {(game: StoreGame, onProgress: (progress: InstallProgress) => void,
 *     signal: AbortSignal) => Promise<string>} install  Into this browser; the bottle's id.
 * @property {(bottle: Record<string, any>) => string | null} gameOf  The store's id of the
 *     game a bottle is, or null for a bottle not the store's.
 * @property {(bottle: Record<string, any>) => Promise<Record<string, any>>} runData  What a
 *     run of the store's bottle adds to createApp's options.
 */

/**
 * The store a bottle is a game of, by the store's name, or null: `store: { id, game }`
 * in its manifest, or as bottles installed before said it, its name holding the
 * game's `appId`.
 *
 * @param {Record<string, any> | null | undefined} bottle
 * @returns {string | null}
 */
export function storeOf(bottle) {
  if (!bottle) return null;
  if (typeof bottle.store?.id === "string") return bottle.store.id;
  return Object.keys(bottle).find((key) => key !== "store" && bottle[key] !== null
    && typeof bottle[key] === "object" && Number.isInteger(bottle[key].appId)) ?? null;
}

/**
 * The store's id of the game a bottle is, or null for a bottle of no store.
 *
 * @param {Record<string, any> | null | undefined} bottle
 * @returns {string | null}
 */
export function gameIdOf(bottle) {
  const store = storeOf(bottle);
  if (!store || !bottle) return null;
  return bottle.store?.id === store ? String(bottle.store.game) : String(bottle[store].appId);
}

/**
 * A store of GameHub's as a provider.
 *
 * @param {{ id: string, name: string }} store
 * @returns {StoreProvider}
 */
export function storeProvider({ id, name }) {
  /** @param {Record<string, any>} bottle */
  const gameOf = (bottle) => (storeOf(bottle) === id ? gameIdOf(bottle) : null);
  return {
    id,
    name,
    available: async () => Boolean((await gamehub())?.stores.some((one) => one.id === id && one.on)),
    unavailable: NEEDS_GAMEHUB,
    auth: {
      account: () => ask("account", { store: id }),
      signInPage: () => signInPage(id),
      signOut: async () => {
        await ask("signOut", { store: id });
      },
    },
    getList: ({ fresh = false } = {}) => ask("list", { store: id, ...fresh ? { fresh } : {} }),
    getCover: (game, kind) => game.covers?.[kind] ?? "",
    install: async (game, onProgress, signal) => {
      const installer = INSTALLERS[id];
      if (!installer) throw new Error(`this launcher cannot install ${name}'s games`);
      onProgress({ state: "downloading", done: 0, total: 0, message: `Asking ${name}…` });
      // Asked each time: a manifest's request code lasts minutes, and a run
      // stopped part way goes on with new ones.
      const download = await ask("download", { store: id, game: game.id });
      return installer({ store: id, game: game.id, download, onProgress, signal });
    },
    gameOf,
    runData: async (bottle) => {
      const game = gameOf(bottle);
      return game ? ask("runData", { store: id, game }) : {};
    },
  };
}

/** Where the stores GameHub last listed are kept, so a reload shows them at once. */
const KNOWN = "bottlify.stores";

/** The stores GameHub listed last time, as providers; none where nothing was kept. */
export function knownProviders() {
  try {
    const kept = JSON.parse(globalThis.localStorage?.getItem(KNOWN) ?? "[]");
    return Array.isArray(kept) ? kept.filter((one) => typeof one?.id === "string"
      && typeof one?.name === "string").map(storeProvider) : [];
  } catch {
    return [];
  }
}

/**
 * The stores GameHub has on for this site, as providers; none without GameHub.
 *
 * @returns {Promise<StoreProvider[]>}
 */
export async function loadProviders() {
  const hub = await gamehub();
  const on = (hub?.stores ?? []).filter((one) => one.on).map(({ id, name }) => ({ id, name }));
  try {
    globalThis.localStorage?.setItem(KNOWN, JSON.stringify(on));
  } catch {
    // Not kept: the next visit asks GameHub again, as it does anyway.
  }
  return on.map(storeProvider);
}

/**
 * The provider a bottle is a game of, among those given, or null.
 *
 * @param {Record<string, any> | null | undefined} bottle
 * @param {StoreProvider[]} providers
 */
export const providerOf = (bottle, providers) =>
  (bottle ? providers.find((provider) => provider.gameOf(bottle) !== null) ?? null : null);
