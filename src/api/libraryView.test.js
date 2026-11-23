/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { searchLibrary, statusOf, withStoreGames } from "./libraryView.js";

const bottle = (title, kind, labels, year) => ({ id: title, title, kind, labels, year });
const library = [
  bottle("Quake III Arena", "game", ["demo"], 1999),
  bottle("3DMark03", "game", ["benchmark"], 2003),
  bottle("WineHQ", "application", ["test"]),
  bottle("Doom 3", "game", ["demo"], 2004),
  bottle("Heroes 10", "game", [], 2010),
  bottle("Heroes 2", "game", [], 1996),
];
const titles = (query) => searchLibrary(library, query).map((one) => one.title);

test("the library is by name, numbers as numbers", () => {
  assert.deepEqual(titles(""), [
    "3DMark03", "Doom 3", "Heroes 2", "Heroes 10", "Quake III Arena", "WineHQ"]);
});

test("a search matches any part of the title, in any case", () => {
  assert.deepEqual(titles(" ARENA"), ["Quake III Arena"]);
  assert.deepEqual(titles("xyz"), []);
});

test("the list asked about is not reordered", () => {
  const before = library.map((one) => one.title);
  searchLibrary(library, "");
  assert.deepEqual(library.map((one) => one.title), before);
});

test("a bottle's status is coloured as it was found to run, and unknown until checked", () => {
  assert.equal(statusOf({ status: "playable" }), "works");
  assert.equal(statusOf({ status: "start-only" }), "issues");
  assert.equal(statusOf({ status: "non-playable" }), "fails");
  assert.equal(statusOf({ status: null }), null);
  assert.equal(statusOf({}), null);
});

/** A store of the provider's shape, its covers its own. */
const shop = {
  id: "shop", name: "Shop",
  gameOf: () => null,
  getCover: (/** @type {any} */ game, /** @type {string} */ kind) => `https://art.example/${game.id}/${kind}.jpg`,
};

test("a store's games show as cards only while installable and not yet a bottle", () => {
  /** @param {string} id @param {string} name @param {boolean} [installable] */
  const game = (id, name, installable = true) => ({ id, name, bytes: 0, exact: false, installable });
  const installed = { ...bottle("Half-Life", "game", []), store: { id: "shop", game: "70" } };
  const stores = [{ provider: /** @type {any} */ (shop), games: [game("400", "Portal"),
    game("500", "Mac only", false), game("70", "Half-Life")] }];
  const merged = withStoreGames([installed], stores);
  assert.deepEqual(merged.map((one) => one.id), ["Half-Life", "shop:400"]);
  assert.deepEqual(merged[1].store, { provider: "shop", game: stores[0].games[0] });
  assert.equal(merged[1].coverSmall, "https://art.example/400/capsule.jpg");
  assert.equal(merged[1].coverFallback, "https://art.example/400/header.jpg");
  assert.equal(merged[1].wallpaper, "https://art.example/400/hero.jpg");
  // Signed out, or an account that does not own it: the store's bottle is hidden.
  const signedOut = [{ provider: /** @type {any} */ (shop), games: [] }];
  assert.deepEqual(withStoreGames([installed, bottle("Quake", "game", [])], signedOut)
    .map((one) => one.id), ["Quake"]);
  assert.deepEqual(withStoreGames([installed], [{ ...stores[0], games: [game("400", "Portal")] }])
    .map((one) => one.id), ["shop:400"]);
  assert.deepEqual(withStoreGames([installed], []).map((one) => one.id), [],
    "no such store here -- no GameHub: its bottle could not start, and is not shown");
  // A demo is anyone's: its bottle shows signed out too.
  const demo = { ...bottle("Half-Life 2: Demo", "game", []), store: { id: "shop", game: "219",
    demo: true } };
  assert.deepEqual(withStoreGames([installed, demo], signedOut).map((one) => one.id),
    ["Half-Life 2: Demo"]);
});
