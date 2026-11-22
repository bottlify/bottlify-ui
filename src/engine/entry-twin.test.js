/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { imageBits, twinOf } from "./entry-twin.js";

/** @param {number} magic  0x10b for PE32, 0x20b for PE32+ */
const image = (magic) => {
  const bytes = new Uint8Array(0x100);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x5a]);
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x80, 0x00004550, true);
  view.setUint16(0x80 + 24, magic, true);
  return bytes;
};

test("an image is 32- or 64-bit by its optional header; anything else is neither", () => {
  assert.equal(imageBits(image(0x10b)), 32);
  assert.equal(imageBits(image(0x20b)), 64);
  assert.equal(imageBits(new Uint8Array(0x100)), null);
  assert.equal(imageBits(Uint8Array.of(0x4d, 0x5a)), null);
});

test("a 64-bit program's 32-bit build is found where its 64-bit name is the 32-bit one", () => {
  const paths = ["Binaries\\Win32\\OLGame.exe", "Binaries\\Win64\\OLGame.exe",
    "bin\\x86\\game.exe", "bin\\x64\\game.exe", "Game-Win32-Shipping.exe"];
  assert.equal(twinOf(paths, "Binaries\\Win64\\OLGame.exe"), "Binaries\\Win32\\OLGame.exe");
  assert.equal(twinOf(paths, "bin/x64/game.exe"), "bin\\x86\\game.exe", "either slash, any case");
  assert.equal(twinOf(paths, "Game-Win64-Shipping.exe"), "Game-Win32-Shipping.exe",
    "a 64-bit name in the file's own name");
  assert.equal(twinOf(paths, "Binaries\\Win64\\Other.exe"), null, "no such file: none");
  assert.equal(twinOf(paths, "FactoryGame64.exe"), null, "64 inside a word is no build's name");
  assert.equal(twinOf(paths, "Astro.exe"), null, "nothing to swap: none");
});
