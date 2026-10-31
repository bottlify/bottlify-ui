/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Whether this browser can give the engine a WebGPU device -- everything a
 * program draws goes through one, so without it no game starts. Asked once:
 * an adapter is not something a page gains while it is open.
 *
 * @param {{ gpu?: { requestAdapter(): Promise<unknown> } }} [nav]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function webgpuStatus(nav = /** @type {any} */ (globalThis.navigator)) {
  if (!nav?.gpu) {
    return { ok: false, reason: "This browser has no WebGPU." };
  }
  const adapter = await nav.gpu.requestAdapter().catch(() => null);
  return adapter ? { ok: true }
    : { ok: false, reason: "WebGPU is here, but the browser gave no graphics adapter." };
}
