/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { STEAM_DEMOS, steamDemoGames } from "./demos.js";
import { withStoreGames } from "../api/libraryView.js";
import { DEMOS } from "../../gamehub/src/stores/steam/apps.js";

test("Steam's demos and free games are cards in the library before any sign-in", () => {
  const games = steamDemoGames();
  assert.deepEqual(games.map((one) => [one.id, one.name]), [
    ["410", "Portal: First Slice"], ["219", "Half-Life 2: Demo"],
    ["22010", "World of Goo Demo"], ["3592", "Plants vs. Zombies Demo"],
    ["1721470", "Poppy Playtime"], ["588430", "Fallout Shelter"]]);
  assert.ok(games.every((one) => one.installable && one.demo));
  assert.match(games[0].covers?.capsule ?? "", /\/400\/library_600x900\.jpg$/,
    "the game's cover: a demo has none of its own");
  assert.match(games[4].covers?.capsule ?? "", /\/1721470\/library_600x900\.jpg$/,
    "a free game's own");
  const steam = /** @type {any} */ ({ id: "steam", name: "Steam",
    getCover: (/** @type {any} */ game, /** @type {string} */ kind) => game.covers[kind] });
  assert.deepEqual(withStoreGames([], [{ provider: steam, games }]).map((one) => one.id),
    ["steam:410", "steam:219", "steam:22010", "steam:3592", "steam:1721470", "steam:588430"]);
});

test("the library's demos are the ones GameHub asks Steam a free licence for", () => {
  // A card GameHub does not license installs nothing; a licence no card offers
  // is never asked for.
  assert.deepEqual(STEAM_DEMOS.map(({ id, game }) => [Number(id), Number(game)]),
    DEMOS.map(({ demo, game }) => [demo, game]));
});
