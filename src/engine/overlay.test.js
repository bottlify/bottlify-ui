/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callName, overlayRows, readLive, tabMemoryOf } from "./overlay.js";

/**
 * A reading shaped like `app.log.live()`'s answer, with every figure a test
 * does not care about at its "nothing happened yet" value.
 *
 * @param {Object} at
 * @param {number} [at.instructions]
 * @param {number} [at.shown]
 * @param {number} [at.draws]
 * @param {number} [at.guestMs]
 * @param {number} [at.trapMs]
 * @param {{ name: string, ms: number, calls?: number }[]} [at.hooks]
 * @param {{ address: number, instructions: number }[]} [at.samples]
 * @param {{ name: string, base: number, size: number }[]} [at.regions]
 * @param {Record<string, number>} [at.shownBy]
 * @param {Record<string, number> | null} [at.lastFrame]
 * @param {{ batches: number, readSelfMs: number, sweepMs: number } | null} [at.worker]
 * @param {[string, number][]} [at.phases]  More phases, by name and self time.
 * @param {boolean} [at.noPhases]  A build without the profiler: no phase at all.
 * @param {{ id: number, name: string, instructions: number, state: string }[]} [at.threads]
 * @param {{ gpuFrames: number, gpuMs: number }} [at.gpu]
 */
function reading({
  instructions = 0, shown = 0, draws = 0, guestMs = 0, trapMs = 0, hooks = [], samples = [],
  regions = [], shownBy = {}, lastFrame = null, worker = null, phases = [], noPhases = false,
  threads = [], gpu = { gpuFrames: 0, gpuMs: 0 },
}) {
  return {
    instructions,
    phases: noPhases ? [] : [["guest", guestMs], ["trap", trapMs], ...phases]
      .map(([name, selfMs]) => ({ name, kind: "host", count: 1, selfMs })),
    threads,
    regions,
    samples,
    hooks: hooks.map((hook) => ({ calls: 0, ...hook })),
    graphics: { shown, shownBy, device: { draws, ...gpu }, lastFrame, worker },
  };
}

test("the overlay reads the keeper's live view and nothing the engine's thread answers", async () => {
  // Every member of the app but `log.live` is answered by the engine's own
  // thread or leads to it; one such answer a second was a hitch a second.
  const asked = [];
  const live = reading({ shown: 3 });
  const app = new Proxy({}, {
    get: (_, name) => {
      if (name === "log") {
        return new Proxy({}, {
          get: (__, method) => {
            asked.push(`log.${String(method)}`);
            if (method === "live") return async () => live;
            throw new Error(`the overlay asked log.${String(method)}`);
          },
        });
      }
      asked.push(String(name));
      throw new Error(`the overlay asked app.${String(name)}`);
    },
  });
  assert.equal(await readLive(app), live);
  assert.deepEqual(asked, ["log.live"]);

  // And the component reads the engine only through that: no other member of
  // `app` appears in it but in its comments.
  const source = readFileSync(new URL("../components/PerfOverlay.jsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.deepEqual(source.match(/\bapp\s*\.\s*\w+/g), null);
  assert.match(source, /readLive\(app\)/);
});

test("the first poll has nothing to take a delta against", () => {
  assert.equal(overlayRows(null, reading({}), 1000), null);
});

test("a zero or negative interval is refused rather than divided by", () => {
  const a = reading({});
  assert.equal(overlayRows(a, a, 0), null);
  assert.equal(overlayRows(a, a, -5), null);
});

test("fps, ms per frame and draws per frame come from the presenter's and the device's own counters", () => {
  const was = reading({ shown: 100, draws: 4000 });
  const now = reading({ shown: 160, draws: 6400 });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.fps, 60);
  assert.equal(rows.frameMs, 1000 / 60);
  assert.equal(rows.drawsPerFrame, 40);
});

test("the GPU's ms per frame is its time over the frames it measured, not measured without any", () => {
  const was = reading({ gpu: { gpuFrames: 10, gpuMs: 30 } });
  const now = reading({ gpu: { gpuFrames: 30, gpuMs: 110 } });
  assert.equal(overlayRows(was, now, 1000).gpuMs, 4);
  const none = reading({});
  none.graphics.device = null;
  assert.equal(overlayRows(none, none, 1000).gpuMs, null);
});

test("speed is instructions per second and the guest phase's ms per instruction, in nanoseconds", () => {
  const was = reading({ instructions: 0, guestMs: 0 });
  const now = reading({ instructions: 2_000_000, guestMs: 400 });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.instructionsPerSecond, 2_000_000);
  // 400 ms across 2,000,000 instructions is 0.0002 ms/instruction, 200 ns/instruction.
  assert.equal(rows.nsPerInstruction, 200);
});

test("no instructions retired answers a null ns/instruction rather than a division by zero", () => {
  const a = reading({ instructions: 5 });
  const b = reading({ instructions: 5 });
  assert.equal(overlayRows(a, b, 1000).nsPerInstruction, null);
});

test("the frame's budget is each activity's self-time delta in ms per presented frame", () => {
  const was = reading({ shown: 0, guestMs: 100, trapMs: 10 });
  const now = reading({ shown: 10, guestMs: 900, trapMs: 60 });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows.budget, [
    { name: "cork (game code)", ms: 80 },
    { name: "host calls (GL, audio, win32)", ms: 5 },
  ]);
  assert.deepEqual(rows.phases, []); // no per-call phases without profileCalls
});

test("a phase's own cumulative counter never goes backwards to this reducer's eyes", () => {
  // A machine rebuilt under the reader starts its phases again.
  const was = reading({ shown: 0, guestMs: 500 });
  const now = reading({ shown: 10, guestMs: 100 });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.budget.find((p) => p.name === "cork (game code)"), undefined);
});

test("with every host call profiled, the split lists calls by function in ms per frame", () => {
  const rows = overlayRows(reading({ shown: 0, phases: [["OPENGL32.dll!glDrawElements", 0]] }),
    reading({ shown: 10, phases: [["OPENGL32.dll!glDrawElements", 250]] }), 1000);
  assert.deepEqual(rows.phases, [{ name: "gl:glDrawElements", ms: 25 }]);
});

test("no bound hook answers null, the overlay's own signal for no sidecar", () => {
  assert.equal(overlayRows(reading({}), reading({}), 1000).hooks, null);
});

test("a bound hook's ms per frame and its top rows are deltas over the frames just presented", () => {
  const was = reading({
    shown: 0,
    hooks: [{ name: "a", ms: 0 }, { name: "b", ms: 0 }, { name: "c", ms: 0 }, { name: "d", ms: 0 }],
  });
  const now = reading({
    shown: 10,
    hooks: [{ name: "a", ms: 40, calls: 4 }, { name: "b", ms: 30 }, { name: "c", ms: 20 },
      { name: "d", ms: 10 }],
  });
  const rows = overlayRows(was, now, 1000);
  assert.equal(rows.hooks.msPerFrame, 10); // (40+30+20+10) / 10 frames
  assert.deepEqual(rows.hooks.top, [
    { name: "a", ms: 40, calls: 4 },
    { name: "b", ms: 30, calls: 0 },
    { name: "c", ms: 20, calls: 0 },
    { name: "d", ms: 10, calls: 0 },
  ]);
});

test("no sampler activity answers an empty guest-code list, not an error", () => {
  assert.deepEqual(overlayRows(reading({}), reading({}), 1000).guestCode, []);
});

test("guest-code rows are a delta of the sampler's cumulative buckets, named by module", () => {
  const regions = [{ name: "Game.dll", base: 4096, size: 4096 },
    { name: "Other.dll", base: 8192, size: 4096 }];
  // The sampler carries no clock: a bucket's ms is its share of the
  // interval's instructions against the guest phase's own ms.
  const was = reading({
    regions, instructions: 0, guestMs: 0,
    samples: [{ address: 4096 + 16, instructions: 1000 }],
  });
  const now = reading({
    regions, instructions: 800, guestMs: 8,
    samples: [
      { address: 4096 + 16, instructions: 1500 }, // +500
      { address: 8192 + 32, instructions: 300 }, // new bucket, +300
    ],
  });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows.guestCode, [
    { name: "Game.dll+0x10", share: 100 * 500 / 800, instructionsPerSecond: 500, ms: 5 },
    { name: "Other.dll+0x20", share: 100 * 300 / 800, instructionsPerSecond: 300, ms: 3 },
  ]);
});

test("guest-code rows fold through a bundle's own symbol table when one is given", () => {
  const regions = [{ name: "Doom3.exe", base: 0x400000, size: 0x300000 }];
  const symbols = {
    "Doom3.exe": [
      { rva: 0x10a220, name: "idDeviceContext::TextWidth" },
      { rva: 0x10bc40, name: "idDeviceContext::DrawText" },
    ],
  };
  // Inside TextWidth's own span, eight bytes past its start.
  const now = reading({ regions, samples: [{ address: 0x400000 + 0x10a228, instructions: 900 }] });
  const rows = overlayRows(reading({ regions }), now, 1000, symbols);
  assert.equal(rows.guestCode[0].name, "idDeviceContext::TextWidth+0x8");
});

test("without a symbol table, guest-code rows print as image+0xrva", () => {
  const regions = [{ name: "Doom3.exe", base: 0x400000, size: 0x300000 }];
  const now = reading({ regions, samples: [{ address: 0x400000 + 0x10a228, instructions: 900 }] });
  assert.equal(overlayRows(reading({ regions }), now, 1000).guestCode[0].name, "Doom3.exe+0x10a228");
});

test("what reached the canvas is named by source, and the last frame reads as one line", () => {
  const was = reading({ shownBy: { target: 100, desktop: 3 } });
  const now = reading({
    shownBy: { target: 160, desktop: 63 },
    lastFrame: {
      index: 41, draws: 12, offscreenDraws: 4, offscreenTargets: 2, clears: 3,
      clearColor: 0xff000000, viewportX: 0, viewportY: 0, viewportWidth: 1024,
      viewportHeight: 768, targetWidth: 1024, targetHeight: 768,
    },
  });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows.shownBy, [{ name: "target", count: 60 }, { name: "desktop", count: 60 }]);
  assert.equal(rows.lastFrame,
    "#41 draws 12 (4 offscreen into 2), clears 3 #ff000000, viewport 0,0 1024x768 of 1024x768");

  const bare = overlayRows(reading({}), reading({}), 1000);
  assert.deepEqual(bare.shownBy, []);
  assert.equal(bare.lastFrame, null);
});

test("a frame that cleared nothing names no colour", () => {
  const lastFrame = { index: 1, draws: 1, offscreenDraws: 0, offscreenTargets: 0, clears: 0,
    clearColor: -1, viewportX: 0, viewportY: 0, viewportWidth: 640, viewportHeight: 480,
    targetWidth: 640, targetHeight: 480 };
  assert.equal(overlayRows(reading({}), reading({ lastFrame }), 1000).lastFrame,
    "#1 draws 1, clears 0, viewport 0,0 640x480 of 640x480");
});

test("COM methods are in the split, named by interface rather than by IID", () => {
  const com = (ms) => [
    ["{7385E5DF-8FE8-41D5-86B6-D7B48547B6CF}::DrawIndexedPrimitive", ms * 3],
    ["{279AFA85-4981-11CE-A521-0020AF0BE560}::Lock", ms * 2],
    ["{12345678-ABCD-0000-0000-000000000000}::Frob", ms],
  ];
  const rows = overlayRows(reading({ shown: 0, phases: com(0) }),
    reading({ shown: 10, phases: com(100) }), 1000);
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
  const was = reading({ shown: 0, guestMs: 4000, trapMs: 1000 });
  const now = reading({ shown: 10, guestMs: 4600, trapMs: 1200 });
  // 1000 ms between the polls, 800 of them in some phase: 200 over ten frames.
  assert.equal(overlayRows(was, now, 1000).notInPhaseMs, 20);
});

test("with no frame presented, the time outside the phases is not measured rather than zero", () => {
  const was = reading({ shown: 4, guestMs: 100 });
  const now = reading({ shown: 4, guestMs: 300 });
  assert.equal(overlayRows(was, now, 1000).notInPhaseMs, null);
});

test("with no phases from the engine, the time outside the phases is not measured", () => {
  const was = reading({ shown: 0, noPhases: true });
  const now = reading({ shown: 10, noPhases: true });
  assert.equal(overlayRows(was, now, 1000).notInPhaseMs, null);
});

test("phases whose estimate overshoots the wall leave nothing outside them, not less than nothing", () => {
  const was = reading({ shown: 0, guestMs: 0 });
  const now = reading({ shown: 10, guestMs: 1030 });
  assert.equal(overlayRows(was, now, 1000).notInPhaseMs, 0);
});

/** @param {number} ms @returns {[string, number][]} */
const ringPhases = (ms) => [
  ["ring-sync", ms * 1], ["ring-unlocked", ms * 2], ["ring-take", ms * 4], ["ring-held", ms * 8],
];

test("a Direct3D call's entry work is its own budget row and split by part, apart from the call", () => {
  const was = reading({ shown: 0, trapMs: 0, phases: ringPhases(0) });
  const now = reading({ shown: 10, trapMs: 100, phases: ringPhases(10) });
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
  const rows = overlayRows(reading({ shown: 0 }), reading({ shown: 10 }), 1000);
  assert.deepEqual(rows.entryWork, []);
});

test("the graphics worker's batch read and sweep are ms per frame of their rise between polls", () => {
  const was = reading({ shown: 0, worker: { batches: 100, readSelfMs: 50, sweepMs: 10 } });
  const now = reading({ shown: 20, worker: { batches: 400, readSelfMs: 250, sweepMs: 30 } });
  assert.deepEqual(overlayRows(was, now, 1000).worker,
    { batchesPerSecond: 300, readMs: 10, sweepMs: 1 });
});

test("the worker's time with no frame presented is not measured, not zero", () => {
  const was = reading({ shown: 3, worker: { batches: 100, readSelfMs: 50, sweepMs: 10 } });
  const now = reading({ shown: 3, worker: { batches: 200, readSelfMs: 90, sweepMs: 10 } });
  assert.deepEqual(overlayRows(was, now, 1000).worker,
    { batchesPerSecond: 100, readMs: null, sweepMs: null });
});

test("a worker that has said nothing of its time, or none at all, is null", () => {
  assert.equal(overlayRows(reading({}), reading({}), 1000).worker, null);
  assert.equal(overlayRows(reading({ worker: null }),
    reading({ worker: { batches: 1, readSelfMs: 1, sweepMs: 0 } }), 1000).worker, null,
  "a first answer has nothing to take a delta against");
});

test("guest threads are a delta of the kernel's per-thread counts, and the bound is all over the busiest", () => {
  const thread = (id, name, instructions, state) => ({ id, name, instructions, state });
  const was = reading({ threads: [thread(1, "main", 1000, "ready"),
    thread(2, "thread-2", 500, "blocked"), thread(3, "thread-3", 10, "ready")] });
  const now = reading({ threads: [thread(1, "main", 4000, "ready"),
    thread(2, "thread-2", 1500, "blocked"), thread(3, "thread-3", 10, "ready"),
    thread(4, "thread-4", 0, "ready")] });
  const rows = overlayRows(was, now, 1000);
  assert.deepEqual(rows?.threads, [
    { name: "main", share: 75, instructionsPerSecond: 3000, state: "ready" },
    { name: "thread-2", share: 25, instructionsPerSecond: 1000, state: "blocked" },
  ]);
  assert.equal(rows?.parallelBound, 4000 / 3000);
});

test("two threads of one name are told apart by their ids", () => {
  const was = reading({ threads: [{ id: 1, name: "worker", instructions: 100, state: "ready" },
    { id: 2, name: "worker", instructions: 0, state: "ready" }] });
  const now = reading({ threads: [{ id: 1, name: "worker", instructions: 100, state: "ready" },
    { id: 2, name: "worker", instructions: 50, state: "ready" }] });
  assert.equal(overlayRows(was, now, 1000)?.threads[0].instructionsPerSecond, 50);
});

test("without the kernel's counts the thread rows are empty and the bound is not measured", () => {
  const rows = overlayRows(reading({}), reading({}), 1000);
  assert.deepEqual(rows?.threads, []);
  assert.equal(rows?.parallelBound, null);
});

test("the tab's memory is its total and who holds it, a worker by its script, largest first", () => {
  const executor = { url: "https://x/engine/executor.worker.js", scope: "DedicatedWorkerGlobalScope" };
  // Chrome's total counts the guest memory again in each executor that holds it.
  const memory = tabMemoryOf({
    bytes: 16 << 20,
    breakdown: [
      { bytes: 1 << 20, attribution: [{ url: "https://x/app/", scope: "Window" }] },
      { bytes: 3 << 20, attribution: [{ url: "https://x/engine/engine.worker.js?v=1", scope: "DedicatedWorkerGlobalScope" }] },
      { bytes: 2 << 20, attribution: [] },
      { bytes: 0, attribution: [{ url: "https://x/idle.js", scope: "DedicatedWorkerGlobalScope" }] },
      { bytes: 5 << 20, attribution: [executor] },
      { bytes: 5 << 20, attribution: [executor] },
    ],
  });
  assert.deepEqual(memory, { totalMB: 6, top: [
    { name: "engine.worker.js", mb: 3 }, { name: "shared", mb: 2 }, { name: "page", mb: 1 },
  ], executors: { count: 2, mb: 10 } });
  assert.equal(tabMemoryOf(null), null);
});

test("the guest's mapped memory sums the memory layer's regions", () => {
  const regions = [{ name: "entry-vector", base: 0x7000, size: 0x4 },
    { name: "msvcrt.dll .data", base: 0x201f000, size: 0x100000 },
    { name: "heap@20910000", base: 0x20910000, size: 0x200000 }];
  const rows = overlayRows(reading({ regions }), reading({ regions }), 1000);
  assert.equal(rows?.guestMappedMB, (0x4 + 0x100000 + 0x200000) / (1 << 20));
});
