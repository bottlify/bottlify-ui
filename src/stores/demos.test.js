/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { steamDemoGames } from "./demos.js";
import { withStoreGames } from "../api/libraryView.js";

test("Steam's demos are cards in the library before any sign-in", () => {
  const games = steamDemoGames();
  assert.deepEqual(games.map((one) => [one.id, one.name]), [
    ["219", "Half-Life 2: Demo"], ["479030", "DOOM Demo"], ["2407990", "Atomic Heart Demo"]]);
  assert.ok(games.every((one) => one.installable && one.demo));
  assert.match(games[1].covers?.capsule ?? "", /\/379720\/library_600x900\.jpg$/,
    "the game's cover: a demo has none of its own");
  const steam = /** @type {any} */ ({ id: "steam", name: "Steam",
    getCover: (/** @type {any} */ game, /** @type {string} */ kind) => game.covers[kind] });
  assert.deepEqual(withStoreGames([], [{ provider: steam, games }]).map((one) => one.id),
    ["steam:219", "steam:479030", "steam:2407990"]);
});
