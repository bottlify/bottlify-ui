/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOf, likelyProgram, unsupportedNotice } from "./formats.js";

test("a chosen file is told by its first bytes, and anything else is unsupported", async () => {
  const of = (/** @type {number[]} */ bytes) => formatOf(new Blob([Uint8Array.from(bytes)]));
  assert.equal(await of([0x50, 0x4b, 3, 4]), "zip");
  assert.equal(await of([0x4d, 0x5a, 0x90, 0]), "exe");
  assert.equal(await of([...Buffer.from("BTL1")]), "btl");
  assert.equal(await of([0x52, 0x61, 0x72, 0x21]), null, "a RAR is not taken");
  assert.equal(await of([0x37, 0x7a, 0xbc, 0xaf]), null, "nor a 7-Zip");
  assert.equal(await of([]), null, "nor nothing");
});

test("a disc image none of the kinds took is said to be no PC disc, not an unsupported format", () => {
  assert.match(unsupportedNotice("Preview Disc.ISO"), /^Preview Disc\.ISO is not a disc .* no ISO 9660/);
  assert.match(unsupportedNotice("game.rar"), /^game\.rar: unsupported format\./);
});

test("an archive's setup.exe, or its only program, is chosen for the person", () => {
  const bytes = new Uint8Array(1);
  const of = (/** @type {string[]} */ paths) =>
    likelyProgram(paths.map((path) => ({ path, bytes: path.endsWith("\\") ? null : bytes })));
  assert.equal(of(["Disk1\\Setup.exe", "Setup.exe", "readme.txt"]), "Setup.exe", "the shallowest");
  assert.equal(of(["Game\\play.exe", "Game\\data.pak"]), "Game\\play.exe", "the only program");
  assert.equal(of(["a.exe", "b.exe"]), null, "two programs and no setup");
  assert.equal(of(["MySetup.exe", "other.exe"]), null, "a setup by its whole name only");
});
