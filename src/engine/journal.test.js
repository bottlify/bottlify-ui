/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReport, journalFilename, journalLine, keepEnding, lastEndingReport, reportFilename, reportParts,
} from "./journal.js";

test("a record reads exactly as the Logs panel prints it", () => {
  const record = { time: 1234, levelName: "trace", category: "call.gpu", text: "glDrawElements(...)" };
  assert.equal(journalLine(record), "1.234 trac call.gpu glDrawElements(...)");
});

test("the filename names the bundle and the moment, safe for a file system", () => {
  const name = journalFilename("doom3", new Date("2026-09-19T12:34:56.789Z"));
  assert.equal(name, "doom3-journal-2026-09-19T12-34-56-789Z.txt");
  assert.doesNotMatch(name, /[:]/);
});

test("a report holds the run, every layer by name, the engine's own account and the journal", () => {
  const records = [
    { time: 1500, levelName: "trace", category: "call.cpu", text: "KERNEL32.dll!Sleep(0x0) = 0x0" },
  ];
  const layers = [
    { name: "kernel", metrics: { parallelBound: 1.09 } },
    { name: "graphics", metrics: { seam: { device: { draws: 10 } } } },
  ];
  const report = buildReport(records, { diagnostics: layers, hotCode: [{ address: 4096, base64: "AA==" }] }, {
    bundleId: "b", presents: 4, drawsPerFrame: 2.54, at: new Date("2026-10-03T19:00:00Z"),
    userAgent: "ua",
  });
  assert.deepEqual(report, {
    bundleId: "b",
    at: "2026-10-03T19:00:00.000Z",
    userAgent: "ua",
    presents: 4,
    drawsPerFrame: 2.5,
    layers: {
      kernel: { name: "kernel", metrics: { parallelBound: 1.09 } },
      graphics: { name: "graphics", metrics: { seam: { device: { draws: 10 } } } },
    },
    hotCode: [{ address: 4096, base64: "AA==" }],
    journal: ["1.500 trac call.cpu KERNEL32.dll!Sleep(0x0) = 0x0"],
  });
  assert.equal(reportFilename("b", new Date("2026-09-19T12:34:56.789Z")),
    "b-report-2026-09-19T12-34-56-789Z.json");
});

test("the JS sampler's table reaches the report as the engine published it", () => {
  const js = { name: "js", metrics: { measured: true, windowMs: 2001, samples: 3,
    functions: [{ name: "sync shadow.js:40", self: 2, total: 3 }] } };
  const report = buildReport([], { diagnostics: [js] }, { bundleId: "b", presents: 0, drawsPerFrame: 0 });
  assert.deepEqual(report.layers.js, js);
});

test("a report's parts are each answered or said missing, and a hung one does not hold the rest", async () => {
  const app = {
    log: { recent: async () => [{ time: 1000, levelName: "info", category: "call", text: "x" }] },
    presented: () => new Promise(() => {}),
    report: async () => { throw new Error("the worker is gone"); },
  };
  const parts = await reportParts(app, 10, 50);
  assert.equal(parts.records.length, 1);
  assert.equal(parts.presented, null);
  assert.equal(parts.engine, null);
  assert.deepEqual(Object.keys(parts.missing).sort(), ["engine", "presented"]);
  assert.match(parts.missing.presented, /no answer in 50 ms/);
  assert.match(parts.missing.engine, /the worker is gone/);
});

test("the report kept as a run ended is there to be saved after it", () => {
  const parts = { records: [], presented: { count: 3 }, engine: { diagnostics: [] }, missing: {} };
  keepEnding(parts);
  assert.equal(lastEndingReport()?.parts, parts);
});
