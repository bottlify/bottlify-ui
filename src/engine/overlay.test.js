/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { callName, overlayRows, tabMemoryOf } from "./overlay.js";

/**
 * A snapshot shaped like `app.diagnostics()`'s answer: the four layers the
 * overlay reads, with every counter a caller does not care about in this test
 * left at its "nothing happened yet" value.
 *
 * @param {Object} at
 * @param {number} [at.instructions]
 * @param {number} [at.shown]
 * @param {number} [at.draws]
 * @param {number} [at.guestMs]
 * @param {number} [at.trapMs]
 * @param {{ name: string, ms: number }[]} [at.hooks]
 * @param {{ slices: number, overflow: number, top: { address: number,
 *     instructions: number, samples: number }[] }} [at.samples]
 * @param {string[]} [at.layout]
 * @param {number} [at.phasesSelfMs]  Every phase's self time; absent, the log
 *        layer is an engine's that does not publish it.
 * @param {Record<string, any> | null} [at.worker]  The graphics worker's `phases`
 *        (`graphics.worker.phases`); absent, no worker.
 * @param {string[]} [at.phases]  More `topPhases` lines.
 */
function snapshot({
  instructions = 0, shown = 0, draws = 0, guestMs = 0, trapMs = 0, hooks = [],
  samples = { slices: 0, overflow: 0, top: [] }, layout = [], shownBy = {}, recentFrames = [],
  phasesSelfMs, worker, phases = [], byThread,
}) {
  return [
    ...(byThread === undefined ? [] : [{ name: "kernel", version: "0.1.0", status: "ready", metrics: { byThread } }]),
    { name: "cpu", version: "0.1.0", status: "ready", metrics: { instructions, samples } },
    { name: "memory", version: "0.1.0", status: "ready", metrics: { layout } },
    {
      name: "graphics", version: "0.1.0", status: "ready",
      metrics: {
        presenter: { shown, shownBy }, seam: { device: { draws, recentFrames } },
        ...(worker === undefined ? {} : { worker: { phases: worker } }),
      },
    },
    {
      name: "log", version: "0.1.0", status: "ready",
      metrics: {
        topPhases: [
          `guest guest x1 self=${guestMs.toFixed(3)} worst=${guestMs.toFixed(3)}`,
          `trap host x1 self=${trapMs.toFixed(3)} worst=${trapMs.toFixed(3)}`,
          ...phases,
        ],
        ...(phasesSelfMs === undefined ? {} : { phasesSelfMs }),
      },
    },
    { name: "bridge", version: "0.1.0", status: "ready", metrics: { hooks } },
  ];
}

test("the first poll has nothing to take a delta against", () => {
  assert.equal(overlayRows(null, snapshot({}), 1000), null);
});

test("a zero or negative interval is refused rather than divided by", () => {
  const a = snapshot({});
  assert.equal(overlayRows(a, a, 0), null);
  assert.equal(overlayRows(a, a, -5), null);
});

test("fps, ms per frame and draws per frame come from the presenter's and the seam's own counters", () => {
  const was = snapshot({ shown: 100, draws: 4000 });
  const now = snapshot({ shown: 160, draws: 6400 });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.fps, 60);
  assert.equal(rows.frameMs, 1000 / 60);
  assert.equal(rows.drawsPerFrame, 40);
});

test("speed is instructions per second and the guest phase's ms per instruction, in nanoseconds", () => {
  const was = snapshot({ instructions: 0, guestMs: 0 });
  const now = snapshot({ instructions: 2_000_000, guestMs: 400 });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.instructionsPerSecond, 2_000_000);
  // 400 ms across 2,000,000 instructions is 0.0002 ms/instruction, 200 ns/instruction.
  assert.equal(rows.nsPerInstruction, 200);
});

test("no instructions retired answers a null ns/instruction rather than a division by zero", () => {
  const a = snapshot({ instructions: 5 });
  const b = snapshot({ instructions: 5 });
  assert.equal(overlayRows(a, b, 1000).nsPerInstruction, null);
});

test("the frame's budget is each activity's self-time delta in ms per presented frame", () => {
  const was = snapshot({ shown: 0, guestMs: 100, trapMs: 10 });
  const now = snapshot({ shown: 10, guestMs: 900, trapMs: 60 });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows.budget, [
    { name: "cork (game code)", ms: 80 },
    { name: "host calls (GL, audio, win32)", ms: 5 },
  ]);
  assert.deepEqual(rows.phases, []); // no per-call phases without profileCalls
});

test("a phase's own cumulative counter never goes backwards to this reducer's eyes", () => {
  // A phase that fell out of the top sixteen and back in would otherwise read
  // as a negative delta; the reducer floors it at zero and leaves it out.
  const was = snapshot({ shown: 0, guestMs: 500 });
  const now = snapshot({ shown: 10, guestMs: 500 });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.budget.find((p) => p.name === "cork (game code)"), undefined);
});

test("with every host call profiled, the split lists calls by function in ms per frame", () => {
  const phased = (shown, glMs) => {
    const snap = snapshot({ shown, guestMs: 0, trapMs: 0 });
    snap.find((l) => l.name === "log").metrics.topPhases.push(
      `OPENGL32.dll!glDrawElements host x1 self=${glMs.toFixed(3)} worst=0.100`,
    );
    return snap;
  };
  const rows = overlayRows(phased(0, 0), phased(10, 250), 1000);
  assert.deepEqual(rows.phases, [{ name: "gl:glDrawElements", ms: 25 }]);
});

test("no bound hook answers null, the overlay's own signal for no sidecar", () => {
  const a = snapshot({ hooks: [] });
  const b = snapshot({ hooks: [] });
  assert.equal(overlayRows(a, b, 1000).hooks, null);
});

test("a bound hook's ms per frame and its top rows are deltas over the frames just presented", () => {
  const was = snapshot({
    shown: 0,
    hooks: [{ name: "a", ms: 0 }, { name: "b", ms: 0 }, { name: "c", ms: 0 }, { name: "d", ms: 0 }],
  });
  const now = snapshot({
    shown: 10,
    hooks: [{ name: "a", ms: 40 }, { name: "b", ms: 30 }, { name: "c", ms: 20 }, { name: "d", ms: 10 }],
  });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.hooks.msPerFrame, 10); // (40+30+20+10) / 10 frames
  assert.deepEqual(rows.hooks.top, [
    { name: "a", ms: 40, calls: 0 },
    { name: "b", ms: 30, calls: 0 },
    { name: "c", ms: 20, calls: 0 },
    { name: "d", ms: 10, calls: 0 },
  ]);
});

test("no sampler activity answers an empty guest-code list, not an error", () => {
  const a = snapshot({});
  const b = snapshot({});
  assert.deepEqual(overlayRows(a, b, 1000).guestCode, []);
});

test("guest-code rows are a delta of the sampler's cumulative buckets, named by module", () => {
  const layout = ["Game.dll 4096+4096", "Other.dll 8192+4096"];
  // The sampler carries no clock: a bucket's ms is its share of the
  // interval's instructions against the guest phase's own ms.
  const was = snapshot({
    layout, instructions: 0, guestMs: 0,
    samples: {
      slices: 10, overflow: 0,
      top: [{ address: 4096 + 16, instructions: 1000, samples: 5 }],
    },
  });
  const now = snapshot({
    layout, instructions: 800, guestMs: 8,
    samples: {
      slices: 30, overflow: 0,
      top: [
        { address: 4096 + 16, instructions: 1500, samples: 8 }, // +500
        { address: 8192 + 32, instructions: 300, samples: 3 }, // new bucket, +300
      ],
    },
  });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows.guestCode, [
    { name: "Game.dll+0x10", share: 100 * 500 / 800, instructionsPerSecond: 500, ms: 5 },
    { name: "Other.dll+0x20", share: 100 * 300 / 800, instructionsPerSecond: 300, ms: 3 },
  ]);
});

test("guest-code rows fold through a bundle's own symbol table when one is given", () => {
  const layout = ["Doom3.exe 0x400000+0x300000"];
  const symbols = {
    "Doom3.exe": [
      { rva: 0x10a220, name: "idDeviceContext::TextWidth" },
      { rva: 0x10bc40, name: "idDeviceContext::DrawText" },
    ],
  };
  const was = snapshot({ layout, samples: { slices: 0, overflow: 0, top: [] } });
  const now = snapshot({
    layout,
    samples: {
      slices: 5, overflow: 0,
      // Inside TextWidth's own span, eight bytes past its start.
      top: [{ address: 0x400000 + 0x10a228, instructions: 900, ms: 0.9, samples: 4 }],
    },
  });
  const rows = overlayRows(was, now, 1000, symbols);
  assert.equal(rows.guestCode[0].name, "idDeviceContext::TextWidth+0x8");
});

test("without a symbol table, guest-code rows print as image+0xrva", () => {
  const layout = ["Doom3.exe 0x400000+0x300000"];
  const was = snapshot({ layout, samples: { slices: 0, overflow: 0, top: [] } });
  const now = snapshot({
    layout,
    samples: {
      slices: 5, overflow: 0,
      top: [{ address: 0x400000 + 0x10a228, instructions: 900, ms: 0.9, samples: 4 }],
    },
  });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.guestCode[0].name, "Doom3.exe+0x10a228");
});

test("what reached the canvas is named by source, and the last frame reads as one line", () => {
  const was = snapshot({ shownBy: { target: 100, desktop: 3 } });
  const now = snapshot({
    shownBy: { target: 160, desktop: 63 },
    recentFrames: [{
      index: 41, draws: 12, offscreenDraws: 4, offscreenTargets: 2, clears: 3,
      clearColor: "#ff000000", viewport: "0,0 1024x768", target: "1024x768",
    }],
  });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows.shownBy, [{ name: "target", count: 60 }, { name: "desktop", count: 60 }]);
  assert.equal(rows.lastFrame,
    "#41 draws 12 (4 offscreen into 2), clears 3 #ff000000, viewport 0,0 1024x768 of 1024x768");

  const bare = overlayRows(snapshot({}), snapshot({}), 1000);
  assert.deepEqual(bare.shownBy, []);
  assert.equal(bare.lastFrame, null);
});

test("the game code's row names the engine that ran it", () => {
  const was = snapshot({ shown: 0, guestMs: 100 });
  const now = snapshot({ shown: 10, guestMs: 900 });
  now[0].metrics.engine = "emulator";
  assert.equal(overlayRows(was, now, 1000).budget[0].name, "emulator (game code)");
  now[0].metrics.engine = "cork";
  assert.equal(overlayRows(was, now, 1000).budget[0].name, "cork (game code)");
});

test("COM methods are in the split, named by interface rather than by IID", () => {
  const phased = (shown, ms) => {
    const snap = snapshot({ shown });
    snap.find((l) => l.name === "log").metrics.topPhases.push(
      `{7385E5DF-8FE8-41D5-86B6-D7B48547B6CF}::DrawIndexedPrimitive host x1 self=${(ms * 3).toFixed(3)} worst=0.100`,
      `{279AFA85-4981-11CE-A521-0020AF0BE560}::Lock host x1 self=${(ms * 2).toFixed(3)} worst=0.100`,
      `{12345678-ABCD-0000-0000-000000000000}::Frob host x1 self=${ms.toFixed(3)} worst=0.100`,
    );
    return snap;
  };
  const rows = overlayRows(phased(0, 0), phased(10, 100), 1000);
  assert.deepEqual(rows.phases, [
    { name: "IDirect3DDevice8::DrawIndexedPrimitive", ms: 30 },
    { name: "IDirectSoundBuffer::Lock", ms: 20 },
    { name: "12345678::Frob", ms: 10 },
  ]);
});

test("a call's name: an export by library, a method by interface, either case of IID", () => {
  assert.equal(callName("OPENGL32.dll!glBegin"), "gl:glBegin");
  assert.equal(callName("KERNEL32.dll!Sleep"), "KERNEL32:Sleep");
  assert.equal(callName("{d0223b96-bf7a-43fd-92bd-a43b0d82b9eb}::Present"), "IDirect3DDevice9::Present");
  assert.equal(callName("{54D41081-DC15-4833-A41B-748F73A38179}::GetDeviceState"),
    "IDirectInputDevice8W::GetDeviceState");
});

test("time no phase accounted for is the wall less every phase's self time, per frame", () => {
  const was = snapshot({ shown: 0, phasesSelfMs: 5000 });
  const now = snapshot({ shown: 10, phasesSelfMs: 5800 });
  // 1000 ms between the polls, 800 of them in some phase: 200 over ten frames.
  assert.equal(overlayRows(was, now, 1000).notInPhaseMs, 20);
});

test("with no frame presented, the time outside the phases is not measured rather than zero", () => {
  const was = snapshot({ shown: 4, phasesSelfMs: 100 });
  const now = snapshot({ shown: 4, phasesSelfMs: 300 });
  assert.equal(overlayRows(was, now, 1000).notInPhaseMs, null);
});

test("with no phase totals from the engine, the time outside the phases is not measured", () => {
  // The top sixteen alone would charge every phase below them to "nothing".
  const was = snapshot({ shown: 0, guestMs: 100 });
  const now = snapshot({ shown: 10, guestMs: 600 });
  assert.equal(overlayRows(was, now, 1000).notInPhaseMs, null);
});

test("phases whose estimate overshoots the wall leave nothing outside them, not less than nothing", () => {
  const was = snapshot({ shown: 0, phasesSelfMs: 0 });
  const now = snapshot({ shown: 10, phasesSelfMs: 1030 });
  assert.equal(overlayRows(was, now, 1000).notInPhaseMs, 0);
});

/** @param {number} ms */
const ringLines = (ms) => [
  `ring-sync host x32 self=${(ms * 1).toFixed(3)} worst=0.100`,
  `ring-unlocked host x32 self=${(ms * 2).toFixed(3)} worst=0.100`,
  `ring-take host x32 self=${(ms * 4).toFixed(3)} worst=0.100`,
  `ring-held host x32 self=${(ms * 8).toFixed(3)} worst=0.100`,
];

test("a Direct3D call's entry work is its own budget row and split by part, apart from the call", () => {
  const was = snapshot({ shown: 0, trapMs: 0, phases: ringLines(0) });
  const now = snapshot({ shown: 10, trapMs: 100, phases: ringLines(10) });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows.entryWork, [
    { name: "ring-sync", ms: 1 },
    { name: "ring-unlocked", ms: 2 },
    { name: "ring-take", ms: 4 },
    { name: "ring-held", ms: 8 },
  ]);
  assert.deepEqual(rows.budget.filter((row) => row.name.startsWith("host calls")
    || row.name.startsWith("Direct3D entry")), [
    { name: "host calls (GL, audio, win32)", ms: 10 },
    { name: "Direct3D entry (state to the device)", ms: 15 },
  ]);
  assert.deepEqual(rows.phases, [], "the entry's phases are not host calls by function");
});

test("no entry phase rising leaves the entry split empty", () => {
  const rows = overlayRows(snapshot({ shown: 0 }), snapshot({ shown: 10 }), 1000);
  assert.deepEqual(rows.entryWork, []);
});

/** @param {number} batches @param {number} selfMs @param {number} sweeps @param {number} sweepMs */
const workerPhases = (batches, selfMs, sweeps, sweepMs) => ({
  "batch-read": { count: batches, ms: selfMs + sweepMs, selfMs },
  "batch-sweep": { count: sweeps, ms: sweepMs },
});

test("the graphics worker's batch read and sweep are ms per frame of their rise between polls", () => {
  const was = snapshot({ shown: 0, worker: workerPhases(100, 50, 5, 10) });
  const now = snapshot({ shown: 20, worker: workerPhases(400, 250, 25, 30) });
  assert.deepEqual(overlayRows(was, now, 1000).worker,
    { batchesPerSecond: 300, readMs: 10, sweepMs: 1 });
});

test("the worker's time with no frame presented is not measured, not zero", () => {
  const was = snapshot({ shown: 3, worker: workerPhases(100, 50, 5, 10) });
  const now = snapshot({ shown: 3, worker: workerPhases(200, 90, 5, 10) });
  assert.deepEqual(overlayRows(was, now, 1000).worker,
    { batchesPerSecond: 100, readMs: null, sweepMs: null });
});

test("a worker that has said nothing of its time, or none at all, is null", () => {
  assert.equal(overlayRows(snapshot({}), snapshot({}), 1000).worker, null);
  assert.equal(overlayRows(snapshot({ worker: null }),
    snapshot({ worker: workerPhases(1, 1, 0, 0) }), 1000).worker, null,
  "a first answer has nothing to take a delta against");
});

test("guest threads are a delta of the kernel's per-thread counts, and the bound is all over the busiest", () => {
  const was = snapshot({ byThread: "main 1000 ready p8 b0 | thread-2 500 blocked p15 b0 | thread-3 10 ready p9 b0" });
  const now = snapshot({ byThread: "main 4000 ready p8 b0 g109/8 | thread-2 1500 blocked p15 b0 | thread-3 10 ready p9 b0 | thread-4 0 ready p8 b0" });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows?.threads, [
    { name: "main", share: 75, instructionsPerSecond: 3000, state: "ready" },
    { name: "thread-2", share: 25, instructionsPerSecond: 1000, state: "blocked" },
  ]);
  assert.equal(rows?.parallelBound, 4000 / 3000);
});

test("without the kernel's counts the thread rows are empty and the bound is not measured", () => {
  const rows = overlayRows(snapshot({}), snapshot({}), 1000);
  assert.deepEqual(rows?.threads, []);
  assert.equal(rows?.parallelBound, null);
});

test("the tab's memory is its total and who holds it, a worker by its script, largest first", () => {
  const memory = tabMemoryOf({
    bytes: 6 << 20,
    breakdown: [
      { bytes: 1 << 20, attribution: [{ url: "https://x/app/", scope: "Window" }] },
      { bytes: 3 << 20, attribution: [{ url: "https://x/engine/engine.worker.js?v=1", scope: "DedicatedWorkerGlobalScope" }] },
      { bytes: 2 << 20, attribution: [] },
      { bytes: 0, attribution: [{ url: "https://x/idle.js", scope: "DedicatedWorkerGlobalScope" }] },
    ],
  });
  assert.deepEqual(memory, { totalMB: 6, top: [
    { name: "engine.worker.js", mb: 3 }, { name: "shared", mb: 2 }, { name: "page", mb: 1 },
  ] });
  assert.equal(tabMemoryOf(null), null);
});

test("the guest's mapped memory sums the memory layer's regions, names with spaces and access after", () => {
  const layout = ["entry-vector 0x7000+0x4 rw", "msvcrt.dll .data 0x201f000+0x100000 rw",
    "heap@20910000 0x20910000+0x200000 rw"];
  const rows = overlayRows(snapshot({ layout }), snapshot({ layout }), 1000);
  assert.equal(rows?.guestMappedMB, (0x4 + 0x100000 + 0x200000) / (1 << 20));
});
