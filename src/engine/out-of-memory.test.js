/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { outOfMemoryNote, refusedMemory } from "./out-of-memory.js";

test("an allocation refused is the memory running out; another divergence is not", () => {
  assert.equal(refusedMemory({ api: "HeapAlloc",
    detail: "4194304 bytes refused: 3716560 largest free of 5980624 free" }), true);
  assert.equal(refusedMemory({ api: "VirtualAlloc", detail: "1048576 bytes refused" }), true);
  assert.equal(refusedMemory({ api: "UpdateLayeredWindow", detail: "bytes refused" }), false);
  assert.equal(refusedMemory({ api: "HeapAlloc", detail: "a flag ignored" }), false);
  assert.equal(refusedMemory(), false);
});

test("the end of a run names the machine's memory it ran out of", () => {
  assert.equal(outOfMemoryNote(false, 512 * 2 ** 20), null);
  assert.match(String(outOfMemoryNote(true, 512 * 2 ** 20)), /ran out of the machine's memory \(512 MB\)/);
  assert.match(String(outOfMemoryNote(true)), /raise Memory in Settings/);
});
