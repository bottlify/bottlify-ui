/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A run that ended because the guest's memory ran out, told as that: the
 * engine says each allocation it refused (a divergence, `<n> bytes refused`),
 * and a program that is refused one often stops, or faults on the null it was
 * handed, with nothing of its own to say why. The machine's memory is a
 * setting (Settings, or the bottle's own), so the end of such a run names it.
 */

/** The allocators whose refusal is the guest's memory running out. */
const ALLOCATORS = /^(HeapAlloc|HeapReAlloc|GlobalAlloc|GlobalReAlloc|LocalAlloc|LocalReAlloc|VirtualAlloc|malloc|realloc|calloc|operator new)\b/;

/**
 * Whether a divergence the engine said is an allocation it refused.
 *
 * @param {{ api?: string, detail?: string }} divergence
 */
export const refusedMemory = ({ api = "", detail = "" } = {}) =>
  ALLOCATORS.test(api) && /\bbytes refused\b/.test(detail);

/**
 * What the end of a run says of the memory it ran out of, or null for a run
 * that was refused none.
 *
 * @param {boolean} refused  Whether any allocation was refused.
 * @param {number} [memorySize]  The guest's memory, in bytes.
 * @returns {string | null}
 */
export function outOfMemoryNote(refused, memorySize) {
  if (!refused) return null;
  const size = memorySize ? ` (${Math.round(memorySize / 2 ** 20)} MB)` : "";
  return `The program ran out of the machine's memory${size}: raise Memory in Settings, `
    + "or in this game's own settings, and press play to run it again.";
}
