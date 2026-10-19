/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "./readFile.js";

const sample = (size) => Uint8Array.from({ length: size }, (_, at) => (at * 31 + 7) & 0xff);

test("the bytes read are the file's, and the count ends at its size", async () => {
  const source = sample(300_000);
  const seen = [];
  const bytes = await readFile(new Blob([source]), (read) => seen.push(read), { every: 0 });
  assert.deepEqual(bytes, source);
  assert.equal(seen.at(-1), source.length);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), "and never goes back");
});

test("an empty file is an empty answer, and is told once", async () => {
  const seen = [];
  const bytes = await readFile(new Blob([]), (read) => seen.push(read));
  assert.equal(bytes.length, 0);
  assert.deepEqual(seen, [0]);
});

test("the count is not called more often than asked", async () => {
  const seen = [];
  await readFile(new Blob([sample(2_000_000)]), (read) => seen.push(read), { every: 60_000 });
  // The first piece, and the end: nothing in between inside a minute.
  assert.ok(seen.length <= 2, `${seen.length} calls`);
  assert.equal(seen.at(-1), 2_000_000);
});

test("a read that is given up stops and says so", async () => {
  const controller = new AbortController();
  const attempt = readFile(new Blob([sample(5_000_000)]), (read) => {
    if (read > 0) controller.abort();
  }, { signal: controller.signal, every: 0 });
  await assert.rejects(attempt, { name: "AbortError" });
});
