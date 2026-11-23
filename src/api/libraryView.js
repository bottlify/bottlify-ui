/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { gameIdOf, storeOf } from "../stores/providers.js";

/**
 * The library with every store's games beside the bottles: a game not
 * installed is a card standing for its bottle until it is one (`store`: its
 * provider and the game); an installed one is its bottle already. A game with
 * no build an install here can start is left out -- a card for it is a
 * promise Install cannot keep.
 *
 * @param {import("./bundles.js").BundleManifest[]} bundles
 * @param {{ provider: import("../stores/providers.js").StoreProvider,
 *     games: import("../stores/providers.js").StoreGame[] }[]} stores
 * @returns {any[]}
 */
export function withStoreGames(bundles, stores) {
  /** @type {Map<string, Set<string>>} Each store's games the account owns. */
  const owned = new Map(stores.map(({ provider, games }) =>
    [provider.id, new Set(games.map((game) => game.id))]));
  /** @param {any} bottle */
  const ownedBottle = (bottle) => {
    const store = storeOf(bottle);
    return !store || bottle.store?.demo === true
      || Boolean(owned.get(store)?.has(/** @type {string} */ (gameIdOf(bottle))));
  };
  // A store's bottle shows only while the account signed in owns it: without
  // the store -- without GameHub, or signed out -- it could not start, and
  // another account's is not this one's. A demo is anyone's: it shows signed
  // out too (`store.demo`, which its install writes).
  return [
    ...bundles.filter(ownedBottle),
    ...stores.flatMap(({ provider, games }) => games.filter((game) => game.installable
      && !bundles.some((one) => storeOf(one) === provider.id && gameIdOf(one) === game.id))
      .map((game) => ({
        id: `${provider.id}:${game.id}`, title: game.name, version: "", labels: [], status: null,
        kind: "game", coverSmall: provider.getCover(game, "capsule"),
        coverLarge: provider.getCover(game, "capsule"),
        coverFallback: provider.getCover(game, "header"),
        wallpaper: provider.getCover(game, "hero"),
        store: { provider: provider.id, game },
      }))),
  ];
}

const byName = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

/**
 * What the library shows for a search: the titles that hold `query`, in any
 * case, by name with numbers read as numbers. The list given is not reordered.
 *
 * @template {{ title: string }} T
 * @param {T[]} items
 * @param {string} query
 * @returns {T[]}
 */
export function searchLibrary(items, query) {
  const needle = query.trim().toLowerCase();
  return items.filter((one) => needle === "" || one.title.toLowerCase().includes(needle)).sort(byName);
}

/**
 * How far a bottle was found to run, as the library colours it: into its game
 * and fine, into it with something wrong, or not into it; null while nobody
 * has checked.
 *
 * @param {{ status?: string | null }} bundle
 * @returns {"works" | "issues" | "fails" | null}
 */
export function statusOf(bundle) {
  return { playable: "works", "start-only": "issues", "non-playable": "fails" }[bundle.status ?? ""]
    ?? null;
}
