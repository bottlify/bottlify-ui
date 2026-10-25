/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LAUNCHER_HEAD, keptHead, opensAsPage, servedHead, showGame } from "./bookmark.js";

test("in Apple's WebKit a bottle the server holds is opened as a page of its own", () => {
  const webkit = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  ];
  const others = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
  ];
  for (const userAgent of webkit) {
    assert.equal(opensAsPage({}, { userAgent }), true, userAgent);
    assert.equal(opensAsPage({ local: true }, { userAgent }), false, `kept here: ${userAgent}`);
  }
  for (const userAgent of others) assert.equal(opensAsPage({}, { userAgent }), false, userAgent);
});

test("a bottle the server holds is named and drawn by its own files from the start", () => {
  assert.deepEqual(servedHead({ id: "q3", title: "A game" }), { title: "A game",
    manifest: "/bundles/q3/home.webmanifest", tabIcon: "/bundles/q3/icon-64.png",
    touchIcon: "/bundles/q3/icon-180.png" });
});

test("a bottle kept in this browser carries a manifest that opens it, with the launcher's icons", () => {
  const was = globalThis.location;
  Object.defineProperty(globalThis, "location", { value: { origin: "https://host:5180" }, configurable: true });
  try {
    const head = keptHead({ id: "mine", title: "Mine" });
    assert.equal(head.title, "Mine");
    const manifest = JSON.parse(decodeURIComponent(head.manifest.slice("data:application/manifest+json,".length)));
    assert.equal(manifest.start_url, "https://host:5180/play/mine");
    assert.deepEqual(manifest.icons.map((/** @type {any} */ icon) => icon.src),
      ["https://host:5180/icons/icon-192.png", "https://host:5180/icons/icon-512.png"]);
  } finally {
    Object.defineProperty(globalThis, "location", { value: was, configurable: true });
  }
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
  const undo = showGame(/** @type {any} */ (head), { title: "A game", tabIcon: "/bundles/q3/icon-64.png",
    touchIcon: "/bundles/q3/icon-180.png", manifest: "/bundles/q3/home.webmanifest" });
  assert.equal(head.title, "A game");
  assert.equal(head.attribute('meta[name="apple-mobile-web-app-title"]', "content"), "A game");
  assert.equal(head.attribute('link[rel="icon"]', "href"), "/bundles/q3/icon-64.png");
  assert.equal(head.attribute('link[rel="icon"]', "type"), "image/png");
  assert.equal(head.attribute('link[rel="apple-touch-icon"]', "href"), "/bundles/q3/icon-180.png");
  assert.equal(head.attribute('link[rel="manifest"]', "href"), "/bundles/q3/home.webmanifest");
  undo();
  assert.equal(head.title, "Bottlify");
  assert.equal(head.attribute('link[rel="icon"]', "href"), "/favicon.svg");
  assert.equal(head.attribute('link[rel="icon"]', "type"), "image/svg+xml");
  assert.equal(head.attribute('link[rel="manifest"]', "href"), "/manifest.webmanifest");
});

test("leaving a page opened by a game's address puts the launcher's head, not the game's", () => {
  // The server wrote the game into the head; the library is the launcher's.
  const head = page();
  showGame(/** @type {any} */ (head), servedHead({ id: "q3", title: "A game" }))();
  const undo = showGame(/** @type {any} */ (head), servedHead({ id: "q3", title: "A game" }));
  undo();
  assert.equal(head.title, LAUNCHER_HEAD.title);
  assert.equal(head.attribute('meta[name="apple-mobile-web-app-title"]', "content"), "Bottlify");
  assert.equal(head.attribute('link[rel="icon"]', "href"), LAUNCHER_HEAD.tabIcon);
  assert.equal(head.attribute('link[rel="icon"]', "type"), "image/svg+xml");
  assert.equal(head.attribute('link[rel="apple-touch-icon"]', "href"), LAUNCHER_HEAD.touchIcon);
  assert.equal(head.attribute('link[rel="manifest"]', "href"), LAUNCHER_HEAD.manifest);
});

test("a game with only a title leaves the icons as they are", () => {
  const head = page();
  showGame(/** @type {any} */ (head), { title: "A game" });
  assert.equal(head.title, "A game");
  assert.equal(head.attribute('link[rel="icon"]', "href"), "/favicon.svg");
  assert.equal(head.attribute('link[rel="manifest"]', "href"), "/manifest.webmanifest");
});

test("the launcher's head put back is the one index.html has", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(html, new RegExp(`<title>${LAUNCHER_HEAD.title}</title>`));
  assert.match(html, new RegExp(`<link rel="icon" type="${LAUNCHER_HEAD.tabIconType.replace("+", "\\+")}" href="${LAUNCHER_HEAD.tabIcon}"`));
  assert.match(html, new RegExp(`<link rel="manifest" href="${LAUNCHER_HEAD.manifest}"`));
  assert.match(html, new RegExp(`<link rel="apple-touch-icon" href="${LAUNCHER_HEAD.touchIcon}"`));
  assert.match(html, new RegExp(`<meta name="apple-mobile-web-app-title" content="${LAUNCHER_HEAD.title}"`));
});
