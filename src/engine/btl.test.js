/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeBundle } from "@bottlify/core/bundle/node";
import { blobRanges, bundleUrl, readBundle } from "./btl.js";

test("a bottle's bundle is where its manifest says, or beside the manifest", () => {
  assert.equal(bundleUrl({ id: "pop", bundle: { file: "https://bottles.example/pop/bundle.btl" } }),
    "https://bottles.example/pop/bundle.btl", "an address of its own: the page goes there itself");
  assert.equal(bundleUrl({ id: "pop", bundle: { file: "bundle.btl" } }), "/bundles/pop/bundle.btl");
  assert.equal(bundleUrl({ id: "a b" }), "/bundles/a%20b/bundle.btl", "and bundle.btl when it says nothing");
});

test("a file is read out of a bundle by the page, its blocks fetched as one range", async () => {
  const root = await mkdtemp(join(tmpdir(), "btl-in-"));
  const out = await mkdtemp(join(tmpdir(), "btl-out-"));
  try {
    // Several blocks, some compressed and some stored, and an empty file.
    const program = Buffer.concat([Buffer.alloc(9000, 0x41), randomBytes(9000)]);
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(join(root, "bin", "Game.exe"), program);
    await writeFile(join(root, "empty.txt"), Buffer.alloc(0));
    const output = join(out, "bundle.btl");
    await writeBundle({ root, output, blockSize: 4096 });

    const file = new Blob([await readFile(output)]);
    /** @type {number[][]} */
    const asked = [];
    const ranges = blobRanges(file);
    const bundle = await readBundle((offset, length) => {
      asked.push([offset, length]);
      return ranges(offset, length);
    });
    assert.deepEqual(bundle.files.map((one) => one.path).sort(), ["bin\\Game.exe", "empty.txt"]);

    asked.length = 0;
    const read = await bundle.read("BIN\\game.exe");
    assert.ok(Buffer.from(read).equals(program), "byte for byte, whatever the case of the path");
    assert.equal(asked.length, 1, "five blocks, one request");
    assert.equal((await bundle.read("empty.txt")).length, 0);
    await assert.rejects(bundle.read("missing.dll"), /not in this bottle/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});
