/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { LABELS, STATUSES } from "./bundles.js";

/**
 * What a bottle can be tagged with in the library: its kind and its labels.
 * A bottle has its kind and each of its labels as tags.
 */
export const TAGS = [
  { value: "game", label: "Game" },
  { value: "application", label: "App" },
  ...LABELS,
  ...STATUSES,
  { value: "unchecked", label: "Not checked" },
];

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
 * What the library shows. A tag is a switch for what carries it: with `demo`
 * on the demos are there, with it off everything marked demo is gone, whatever
 * else it is marked. So a bottle shows only while every one of its tags is on;
 * with none on, nothing does. The search then keeps the bottles whose title
 * holds `query`. The result is in the order `sort` names.
 *
 * @param {import("./bundles.js").BundleManifest[]} bundles
 * @param {{ query: string, tags: string[], sort: string }} view  `tags` the ones on.
 * @returns {import("./bundles.js").BundleManifest[]}
 */
export function viewLibrary(bundles, { query, tags, sort }) {
  const needle = query.trim().toLowerCase();
  return bundles
    .filter((bundle) => (needle === "" || bundle.title.toLowerCase().includes(needle))
      && [bundle.kind, ...bundle.labels, bundle.status ?? "unchecked"]
        .every((tag) => tags.includes(tag)))
    .sort(COMPARE[sort] ?? byName);
}
