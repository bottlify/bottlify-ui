/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { LABELS, STATUSES } from "./bundles.js";

/**
 * What the library can be narrowed by, in groups: where a bottle comes from,
 * what kind of program it is (its kind and its labels), how far it was found
 * to run. `of` is what a bottle answers in that group.
 *
 * @type {{ key: string, title: string,
 *   options: { value: string, label: string }[],
 *   of: (bundle: import("./bundles.js").BundleManifest) => string[] }[]}
 */
export const FILTER_GROUPS = [
  {
    key: "source",
    title: "Source",
    options: [{ value: "steam", label: "Steam" }, { value: "other", label: "Other" }],
    // A Steam game counts as Steam's whether installed or still only a card.
    of: (bundle) => [bundle.steam?.appId ? "steam" : "other"],
  },
  {
    key: "kind",
    title: "Kind",
    options: [{ value: "game", label: "Game" }, { value: "application", label: "App" }, ...LABELS],
    of: (bundle) => [bundle.kind, ...bundle.labels],
  },
  {
    key: "status",
    title: "Status",
    options: [...STATUSES, { value: "unchecked", label: "Not checked" }],
    of: (bundle) => [bundle.status ?? "unchecked"],
  },
];

/** Every value a filter can hold, across the groups. */
export const FILTERS = FILTER_GROUPS.flatMap((group) => group.options);

/**
 * The library with the Steam account's games beside the bottles: a game not
 * installed is a card standing for its bottle until it is one; an installed
 * one is its bottle already. A game with no Windows launch option is left
 * out -- nothing here could ever start it, so a card for it is a promise
 * Install cannot keep.
 *
 * @param {import("./bundles.js").BundleManifest[]} bundles
 * @param {import("../../steam-store.mjs").StoreGame[]} games
 * @returns {any[]}
 */
export function withSteamGames(bundles, games) {
  // A bottle of a Steam game shows only while the account signed in owns it:
  // without Steam it could not start, and another account's is not this one's.
  const owned = new Set(games.map((game) => game.appId));
  return [
    ...bundles.filter((one) => !one.steam?.appId || owned.has(one.steam.appId)),
    ...games.filter((game) => game.launch && !game.bundle
      && !bundles.some((one) => one.steam?.appId === game.appId)).map((game) => ({
      id: `steam:${game.appId}`, title: game.name, version: "", labels: [], status: null,
      kind: "game", coverSmall: game.capsule, steam: { appId: game.appId }, store: game,
    })),
  ];
}

/** The orders the library can be put in. The first is how it opens. */
export const SORTS = [
  { value: "name", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "year-desc", label: "Year, newest" },
  { value: "year-asc", label: "Year, oldest" },
];

const byName = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

// A bottle with no year goes last either way: it has no place on the line, and
// putting it first would bury the ones that do.
const byYear = (direction) => (a, b) => {
  if (!a.year && !b.year) return byName(a, b);
  if (!a.year) return 1;
  if (!b.year) return -1;
  return direction * (a.year - b.year) || byName(a, b);
};

const COMPARE = {
  name: byName,
  "name-desc": (a, b) => byName(b, a),
  "year-desc": byYear(-1),
  "year-asc": byYear(1),
};

/**
 * What the library shows. The filters only ever add: within a group a bottle
 * shows when it answers any of the values checked there, across groups it has
 * to pass every group, and a group with nothing checked lets everything
 * through -- so with nothing checked at all the library is whole, and a
 * value added later cannot hide what nobody chose to hide. The search then keeps the
 * bottles whose title holds `query`. The result is in the order `sort` names.
 *
 * @param {import("./bundles.js").BundleManifest[]} bundles
 * @param {{ query: string, filters: string[], sort: string }} view
 *     `filters` the values checked (`FILTERS`).
 * @returns {import("./bundles.js").BundleManifest[]}
 */
export function viewLibrary(bundles, { query, filters, sort }) {
  const needle = query.trim().toLowerCase();
  const groups = FILTER_GROUPS
    .map((group) => ({ of: group.of, checked: group.options.map((one) => one.value)
      .filter((value) => filters.includes(value)) }))
    .filter((group) => group.checked.length > 0);
  return bundles
    .filter((bundle) => (needle === "" || bundle.title.toLowerCase().includes(needle))
      && groups.every((group) => group.of(bundle).some((value) => group.checked.includes(value))))
    .sort(COMPARE[sort] ?? byName);
}
