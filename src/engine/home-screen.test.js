/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as zlib from "node:zlib";

const { deflateSync, inflateSync } = zlib;
import { TOUCH_ICON_SIZE, encodePng, headForBottle, homeManifest, iconFile, iconPixels, iconPlacement } from "./home-screen.js";

test("an old icon is scaled by whole pixels with a margin; a large one fits", () => {
  assert.deepEqual(iconPlacement(48, 180), { size: 144, at: 18 });
  assert.deepEqual(iconPlacement(32, 64), { size: 32, at: 16 });
  assert.deepEqual(iconPlacement(48, 64), { size: 48, at: 8 }, "never below its own size");
  assert.deepEqual(iconPlacement(256, 180), { size: 144, at: 18 });
});

test("the manifest opens the bottle by its address, named as it", () => {
  const served = homeManifest({ id: "a b", title: "A game", icons: [{ src: "/i.png", size: 192 }] });
  assert.equal(served.name, "A game");
  assert.equal(served.short_name, "A game");
  assert.equal(served.start_url, "/play/a%20b");
  assert.equal(served.scope, "/");
  assert.equal(served.display, "fullscreen");
  assert.deepEqual(served.icons, [{ src: "/i.png", sizes: "192x192", type: "image/png" }]);
  const carried = homeManifest({ id: "a", title: "A", icons: [], origin: "https://host:5180" });
  assert.equal(carried.start_url, "https://host:5180/play/a");
  assert.equal(carried.scope, "https://host:5180/");
});

test("an icon keeps its transparency, and the touch icon alone is laid on black", () => {
  const icon = { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 255, 255, 255, 128]) };
  const box = 10;
  const pixels = iconPixels(icon, box, false);
  const at = (/** @type {number} */ x, /** @type {number} */ y) => [...pixels.subarray((y * box + x) * 4, (y * box + x) * 4 + 4)];
  assert.deepEqual(at(0, 0), [0, 0, 0, 0], "nothing around it");
  assert.deepEqual(at(1, 3), [255, 0, 0, 255]);
  assert.deepEqual(at(5, 3), [255, 255, 255, 128], "half-transparent white stays so");
  // Which is the default: the touch icon on black, the others not.
  const corner = (/** @type {Uint8Array} */ drawn) => [...drawn.subarray(0, 4)];
  assert.deepEqual(corner(iconPixels(icon, TOUCH_ICON_SIZE)), [0, 0, 0, 255]);
  assert.deepEqual(corner(iconPixels(icon, 192)), [0, 0, 0, 0]);
  assert.deepEqual(corner(iconPixels(icon, 64)), [0, 0, 0, 0]);
});

test("on black an icon is laid by its alpha, each pixel a whole square", () => {
  // Two by one: opaque red, then half-transparent white.
  const icon = { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 255, 255, 255, 128]) };
  const box = 10;
  const pixels = iconPixels(icon, box, true);
  const at = (/** @type {number} */ x, /** @type {number} */ y) => [...pixels.subarray((y * box + x) * 4, (y * box + x) * 4 + 4)];
  // Scaled by 4 into the 8 pixels the margin leaves, centred: x 1-4 red, 5-8 grey, y 3-6.
  assert.deepEqual(at(0, 0), [0, 0, 0, 255], "black around it");
  assert.deepEqual(at(1, 3), [255, 0, 0, 255]);
  assert.deepEqual(at(4, 6), [255, 0, 0, 255]);
  assert.deepEqual(at(5, 3), [128, 128, 128, 255], "half white over black is grey");
  assert.deepEqual(at(1, 2), [0, 0, 0, 255]);
});

test("a PNG is written whole: signature, header, the rows unfiltered, the end", () => {
  const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const file = encodePng(rgba, 1, 2, deflateSync);
  assert.deepEqual([...file.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(file.buffer, file.byteOffset);
  assert.equal(String.fromCharCode(...file.subarray(12, 16)), "IHDR");
  assert.deepEqual([view.getUint32(16), view.getUint32(20), file[24], file[25]], [1, 2, 8, 6]);
  // IHDR's CRC as zlib computes it over its type and data.
  const crc32 = /** @type {any} */ (zlib).crc32;
  if (crc32) assert.equal(view.getUint32(29), crc32(file.subarray(12, 29)));
  const length = view.getUint32(33);
  assert.equal(String.fromCharCode(...file.subarray(37, 41)), "IDAT");
  assert.deepEqual([...inflateSync(file.subarray(41, 41 + length))], [0, 1, 2, 3, 4, 0, 5, 6, 7, 8]);
  assert.equal(String.fromCharCode(...file.subarray(file.length - 8, file.length - 4)), "IEND");
});

test("a program's PNG image is handed over as it is", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(iconFile({ width: 256, height: 256, png }, 180, deflateSync), png);
});

const INDEX = `<head>
  <title>Bottlify</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="apple-mobile-web-app-title" content="Bottlify" />
  <link rel="apple-touch-icon" href="/icons/icon-180.png" />
</head>`;

test("a bottle's address is served with a head that already names it", () => {
  const head = headForBottle(INDEX, { id: "q3", title: "A <game> & \"more\"" });
  assert.match(head, /<title>A &#60;game&#62; &#38; &#34;more&#34;<\/title>/);
  assert.match(head, /<meta name="apple-mobile-web-app-title" content="A &#60;game&#62; &#38; &#34;more&#34;"/);
  assert.match(head, /<link rel="manifest" href="\/bundles\/q3\/home.webmanifest"/);
  assert.match(head, /<link rel="apple-touch-icon" href="\/bundles\/q3\/icon-180.png"/);
  assert.match(head, /<link rel="icon" type="image\/png" href="\/bundles\/q3\/icon-64.png"/);
});
