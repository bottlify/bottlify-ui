/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { viewLibrary, withStoreGames } from "./libraryView.js";

const bottle = (title, kind, labels, year) => ({ id: title, title, kind, labels, year });
const library = [
  bottle("Quake III Arena", "game", ["demo"], 1999),
  bottle("3DMark03", "game", ["benchmark"], 2003),
  bottle("WineHQ", "application", ["test"]),
  bottle("Doom 3", "game", ["demo"], 2004),
  bottle("Heroes 10", "game", [], 2010),
  bottle("Heroes 2", "game", [], 1996),
];
const all = { query: "", filters: [], sort: "name" };
const titles = (view) => viewLibrary(library, view).map((one) => one.title);
const only = (...filters) => titles({ ...all, filters });

test("with nothing checked every bottle shows, by name, numbers as numbers", () => {
  assert.deepEqual(titles(all), [
    "3DMark03", "Doom 3", "Heroes 2", "Heroes 10", "Quake III Arena", "WineHQ"]);
  assert.deepEqual(titles({ ...all, sort: "name-desc" }).slice(0, 2), ["WineHQ", "Quake III Arena"]);
});

test("a quick search matches any part of the title, in any case", () => {
  assert.deepEqual(titles({ ...all, query: " ARENA" }), ["Quake III Arena"]);
  assert.deepEqual(titles({ ...all, query: "xyz" }), []);
});

test("within a group, every value checked adds what answers it", () => {
  assert.deepEqual(only("demo"), ["Doom 3", "Quake III Arena"]);
  assert.deepEqual(only("demo", "benchmark"), ["3DMark03", "Doom 3", "Quake III Arena"]);
  assert.deepEqual(only("application"), ["WineHQ"]);
  // The kind is a value like the labels: a demo that is a game is a game.
  assert.deepEqual(only("game"), ["3DMark03", "Doom 3", "Heroes 2", "Heroes 10", "Quake III Arena"]);
  assert.deepEqual(only("game", "application"), titles(all));
});

test("across groups a bottle has to pass each group that has something checked", () => {
  const checked = [
    { id: "a", title: "A", kind: "game", labels: ["demo"], status: "playable" },
    { id: "b", title: "B", kind: "game", labels: [], status: null },
    { id: "c", title: "C", kind: "application", labels: [], status: "playable" },
  ];
  const shown = (...filters) => viewLibrary(checked, { ...all, filters }).map((one) => one.id);
  assert.deepEqual(shown("playable"), ["a", "c"]);
  assert.deepEqual(shown("unchecked"), ["b"]);
  assert.deepEqual(shown("game", "playable"), ["a"]);
  assert.deepEqual(shown("demo", "application", "playable"), ["a", "c"]);
  assert.deepEqual(shown("demo", "unchecked"), []);
});

test("a value the view does not know checks nothing", () => {
  assert.deepEqual(only("nonsense"), titles(all));
});

test("the search narrows what the filters let in", () => {
  assert.deepEqual(titles({ ...all, query: "doom" }), ["Doom 3"]);
  assert.deepEqual(titles({ ...all, filters: ["game"], query: "winehq" }), []);
});

test("by year, the bottle without one is last either way, filtered or not", () => {
  assert.deepEqual(titles({ ...all, sort: "year-asc" }),
    ["Heroes 2", "Quake III Arena", "3DMark03", "Doom 3", "Heroes 10", "WineHQ"]);
  assert.deepEqual(titles({ ...all, sort: "year-desc" }),
    ["Heroes 10", "Doom 3", "3DMark03", "Quake III Arena", "Heroes 2", "WineHQ"]);
  assert.deepEqual(titles({ ...all, filters: ["demo"], sort: "year-desc" }), ["Doom 3", "Quake III Arena"]);
});

test("the list asked about is not reordered", () => {
  const before = library.map((one) => one.title);
  viewLibrary(library, { ...all, sort: "year-desc" });
  assert.deepEqual(library.map((one) => one.title), before);
});

test("a store's game not installed is the store's and not checked; the rest are Other", () => {
  const card = { id: "steam:400", title: "Portal", kind: "game", labels: [], status: null,
    store: { provider: "steam", game: { id: "400" } } };
  const installed = { ...library[1], title: "Half-Life 2", steam: { appId: 220 } };
  const mixed = [library[0], installed, card];
  const from = (...filters) => viewLibrary(mixed, { ...all, filters }).map((one) => one.title);
  assert.deepEqual(from("steam"), ["Half-Life 2", "Portal"], "a card and a bottle of the store's");
  assert.deepEqual(from("other"), ["Quake III Arena"]);
  assert.deepEqual(from("steam", "other"), ["Half-Life 2", "Portal", "Quake III Arena"]);
  assert.deepEqual(from("steam", "unchecked", "game"), ["Half-Life 2", "Portal"]);
  assert.deepEqual(from("steam", "playable"), []);
});

/**
 * A store of the provider's shape, its games by id: a bottle is its game by
 * the manifest's `shop: { id }`.
 */
const shop = {
  id: "shop", name: "Shop",
  gameOf: (/** @type {any} */ one) => (one?.shop?.id ? String(one.shop.id) : null),
  getCover: (/** @type {any} */ game, /** @type {string} */ kind) => `https://art.example/${game.id}/${kind}.jpg`,
};

test("a store's games show as cards only while installable and not yet a bottle", () => {
  /** @param {string} id @param {string} name @param {boolean} [installable] */
  const game = (id, name, installable = true) => ({ id, name, bytes: 0, exact: false, installable });
  const installed = { ...bottle("Half-Life", "game", []), shop: { id: "70" } };
  const stores = [{ provider: /** @type {any} */ (shop), games: [game("400", "Portal"),
    game("500", "Mac only", false), game("70", "Half-Life")] }];
  const merged = withStoreGames([installed], stores);
  assert.deepEqual(merged.map((one) => one.id), ["Half-Life", "shop:400"]);
  assert.deepEqual(merged[1].store, { provider: "shop", game: stores[0].games[0] });
  assert.equal(merged[1].coverSmall, "https://art.example/400/capsule.jpg");
  // Signed out, or an account that does not own it: the store's bottle is hidden.
  const signedOut = [{ provider: /** @type {any} */ (shop), games: [] }];
  assert.deepEqual(withStoreGames([installed, bottle("Quake", "game", [])], signedOut)
    .map((one) => one.id), ["Quake"]);
  assert.deepEqual(withStoreGames([installed], [{ ...stores[0], games: [game("400", "Portal")] }])
    .map((one) => one.id), ["shop:400"]);
  assert.deepEqual(withStoreGames([installed], []).map((one) => one.id), ["Half-Life"],
    "a bottle of a store the launcher does not know is any bottle");
});
