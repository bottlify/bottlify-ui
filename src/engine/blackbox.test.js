/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCutOff, endRun, noteRun, takeCutOffRun } from "./blackbox.js";

function memoryStorage() {
  const held = new Map();
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, String(value)),
    removeItem: (key) => held.delete(key),
  };
}

const RECORD = { id: "q3", title: "A game", startedAt: 1, elapsed: 12.25, stage: "loading",
  instructions: 3_200_000_000 };

test("a run that never wrote its end is told on the next visit to that game, once", () => {
  const storage = memoryStorage();
  noteRun(storage, RECORD);
  assert.equal(takeCutOffRun(storage, "other"), null, "another game is not told");
  assert.deepEqual(takeCutOffRun(storage, "q3"), RECORD);
  assert.equal(takeCutOffRun(storage, "q3"), null, "told once");
});

test("a run that ended as runs do leaves nothing to tell", () => {
  const storage = memoryStorage();
  noteRun(storage, RECORD);
  endRun(storage);
  assert.equal(takeCutOffRun(storage, "q3"), null);
});

test("each note replaces the last", () => {
  const storage = memoryStorage();
  noteRun(storage, RECORD);
  noteRun(storage, { ...RECORD, elapsed: 20, stage: "running", frames: 300 });
  assert.equal(takeCutOffRun(storage, "q3")?.frames, 300);
});

test("a store that throws or holds nonsense is no record", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); } };
  noteRun(broken, RECORD);
  assert.equal(takeCutOffRun(broken, "q3"), null);
  const storage = memoryStorage();
  storage.setItem("bottlify.run-in-progress", "{not json");
  assert.equal(takeCutOffRun(storage, "q3"), null);
});

test("the sentence says how far the run got", () => {
  assert.match(describeCutOff(RECORD), /12\.3 s in, while at "loading", no frame drawn yet, 3\.20 billion guest instructions/);
  assert.match(describeCutOff({ ...RECORD, stage: "running", frames: 1500 }), /1,500 frames drawn/);
  assert.match(describeCutOff({ ...RECORD, query: "?translate=0", detail: "binding imports" }),
    /run as \?translate=0\. Its last line: binding imports\./);
});
