// Copyright © 2026 Bottlify Project
// Licensed under the Mozilla Public License, version 2.0
// See LICENSE for details

import test from "node:test";
import assert from "node:assert/strict";
import { soundStats } from "./sound-stats.js";

test("a speaker short 480 frames a second at 48 kHz is silent a hundredth of the time, and each short sample is a gap", () => {
  const samples = [];
  let starved = 0;
  for (let at = 0; at <= 3000; at += 100)
  {
    if (at % 500 === 0 && at > 0) starved += 240;
    samples.push({ at, starvedFrames: starved });
  }
  const stats = soundStats(samples, 48000);
  assert.ok(Math.abs(stats.silentShare - 0.01) < 1e-9, `${stats.silentShare}`);
  assert.equal(stats.gaps, 6);
});

test("under a second of samples says nothing of the share it cannot measure", () => {
  assert.deepEqual(soundStats([{ at: 0, starvedFrames: 0 }, { at: 500, starvedFrames: 10 }], 48000),
    { silentShare: null, gaps: 1 });
  assert.deepEqual(soundStats([], 48000), { silentShare: null, gaps: 0 });
});
