// Copyright © 2026 Bottlify Project
// Licensed under the Mozilla Public License, version 2.0
// See LICENSE for details

import test from "node:test";
import assert from "node:assert/strict";
import { frameStats } from "./frame-stats.js";

test("a steady 50 fps with one long frame counts it as the drop and the worst", () => {
  const times = [];
  for (let at = 0; at <= 3000; at += 20) times.push(at);
  times.push(3200);
  for (let at = 3220; at <= 4200; at += 20) times.push(at);
  const stats = frameStats(times, 5);
  assert.equal(stats.fps, 50, "frames in the last second of the run");
  assert.ok(Math.abs(stats.frameMs - 20) < 0.01);
  assert.equal(stats.worstMs, 200);
  assert.equal(stats.drops, 1);
  assert.ok(stats.low1 < 50, "the slowest hundredth pulls the 1% low under the mean");
  assert.equal(stats.stalledMs, 5);
});

test("no frames yet says nothing it cannot measure", () => {
  assert.deepEqual(frameStats([], 0),
    { fps: 0, frameMs: null, low1: null, worstMs: null, drops: 0, stalledMs: 0 });
  assert.equal(frameStats([10], 3000).frameMs, null);
});
