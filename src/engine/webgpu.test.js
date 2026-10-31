/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { webgpuStatus } from "./webgpu.js";

test("no WebGPU, no adapter, and an adapter are three answers", async () => {
  assert.equal((await webgpuStatus({})).ok, false);
  assert.equal((await webgpuStatus({ gpu: { requestAdapter: async () => null } })).ok, false);
  assert.equal((await webgpuStatus({ gpu: { requestAdapter: () => Promise.reject(new Error("x")) } })).ok,
    false);
  assert.deepEqual(await webgpuStatus({ gpu: { requestAdapter: async () => ({}) } }), { ok: true });
});
