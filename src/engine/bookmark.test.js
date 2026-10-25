/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { gameManifest, iconPlacement, showGame } from "./bookmark.js";

test("an old icon is scaled by whole pixels with a margin; a large one fits", () => {
  assert.deepEqual(iconPlacement(48, 180, 0.72), { size: 96, at: 42 }, "48 twice is 96: 144 would not fit");
  assert.deepEqual(iconPlacement(32, 180, 0.72), { size: 128, at: 26 });
  assert.deepEqual(iconPlacement(48, 64, 0.9), { size: 48, at: 8 }, "never below its own size");
  assert.deepEqual(iconPlacement(256, 180, 0.72), { size: 130, at: 25 });
});

test("the manifest opens the game, named as it", () => {
  const manifest = gameManifest({ title: "A game", id: "a b", origin: "https://host:5180",
    icons: [{ src: "data:image/png;base64,AA", size: 192 }] });
  assert.equal(manifest.name, "A game");
  assert.equal(manifest.short_name, "A game");
  assert.equal(manifest.start_url, "https://host:5180/play/a%20b");
  assert.equal(manifest.scope, "https://host:5180/");
  assert.equal(manifest.display, "fullscreen");
  assert.deepEqual(manifest.icons, [{ src: "data:image/png;base64,AA", sizes: "192x192", type: "image/png" }]);
});

/** A head with the launcher's own tags. */
function page() {
  const tags = new Map([
    ['meta[name="apple-mobile-web-app-title"]', { content: "Bottlify" }],
    ['link[rel="icon"]', { href: "/favicon.svg", type: "image/svg+xml" }],
    ['link[rel="apple-touch-icon"]', { href: "/icons/icon-180.png" }],
    ['link[rel="manifest"]', { href: "/manifest.webmanifest" }],
  ]);
  const elements = new Map([...tags].map(([selector, attributes]) => {
    const held = new Map(Object.entries(attributes));
    return [selector, {
      held,
      getAttribute: (/** @type {string} */ name) => held.get(name) ?? null,
      setAttribute: (/** @type {string} */ name, /** @type {string} */ value) => held.set(name, value),
      removeAttribute: (/** @type {string} */ name) => held.delete(name),
    }];
  }));
  return {
    title: "Bottlify",
    head: { querySelector: (/** @type {string} */ selector) => elements.get(selector) ?? null },
    /** @param {string} selector @param {string} name */
    attribute: (selector, name) => elements.get(selector)?.held.get(name),
  };
}

test("while a game plays the head says the game, and leaving puts the launcher's back", () => {
  const head = page();
  const undo = showGame(/** @type {any} */ (head), { title: "A game", tabIcon: "data:tab",
    touchIcon: "data:home", manifest: { name: "A game" } });
  assert.equal(head.title, "A game");
  assert.equal(head.attribute('meta[name="apple-mobile-web-app-title"]', "content"), "A game");
  assert.equal(head.attribute('link[rel="icon"]', "href"), "data:tab");
  assert.equal(head.attribute('link[rel="icon"]', "type"), "image/png");
  assert.equal(head.attribute('link[rel="apple-touch-icon"]', "href"), "data:home");
  assert.equal(head.attribute('link[rel="manifest"]', "href"),
    `data:application/manifest+json,${encodeURIComponent('{"name":"A game"}')}`);
  undo();
  assert.equal(head.title, "Bottlify");
  assert.equal(head.attribute('link[rel="icon"]', "href"), "/favicon.svg");
  assert.equal(head.attribute('link[rel="icon"]', "type"), "image/svg+xml");
  assert.equal(head.attribute('link[rel="manifest"]', "href"), "/manifest.webmanifest");
});

test("a game with no icon yet keeps the launcher's icons and still names itself", () => {
  const head = page();
  const undo = showGame(/** @type {any} */ (head), { title: "A game" });
  assert.equal(head.title, "A game");
  assert.equal(head.attribute('link[rel="icon"]', "href"), "/favicon.svg");
  assert.equal(head.attribute('link[rel="manifest"]', "href"), "/manifest.webmanifest");
  undo();
  assert.equal(head.title, "Bottlify");
});
