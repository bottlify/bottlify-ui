/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The Steam demos the library shows to everyone: Steam grants any signed-in
 * account a free licence to each (GameHub's `download` asks for it), so a card
 * for each is in the library before any sign-in, with or without GameHub; its
 * Install asks for the extension and the sign-in first. Signed in, the
 * account's list is GameHub's, which leaves out a demo of a game the account
 * owns.
 */

/** Steam's art for its apps, which its CDN serves to any origin (CORS `*`). */
const ART = "https://shared.steamstatic.com/store_item_assets/steam/apps";

/** Each demo, with the game it is of: a demo has a header of its own, the game the rest. */
export const STEAM_DEMOS = Object.freeze([
  Object.freeze({ id: "219", name: "Half-Life 2: Demo", game: "220" }),
  Object.freeze({ id: "479030", name: "DOOM Demo", game: "379720" }),
  Object.freeze({ id: "2407990", name: "Atomic Heart Demo", game: "668580" }),
]);

/**
 * The demos as a store's games, the shape the library shows a store's games in.
 *
 * @returns {import("./providers.js").StoreGame[]}
 */
export const steamDemoGames = () => STEAM_DEMOS.map(({ id, name, game }) => ({
  id, name, bytes: 0, exact: false, installable: true, demo: true,
  covers: { header: `${ART}/${id}/header.jpg`, capsule: `${ART}/${game}/library_600x900.jpg`,
    hero: `${ART}/${game}/library_hero.jpg` },
}));
