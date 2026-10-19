/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A file read whole, a piece at a time, telling how far it has got.
 *
 * `file.arrayBuffer()` is one silent wait that grows with the size: for an
 * installer of several hundred megabytes the page shows nothing for as long as
 * the read takes. Read through its stream the same bytes arrive with a count
 * the page can show, and the read can be given up.
 *
 * @param {Blob} file
 * @param {(read: number) => void} [onProgress]  Called as pieces arrive, at most
 *     every `every` milliseconds, and once at the end.
 * @param {{ signal?: AbortSignal, every?: number }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function readFile(file, onProgress = () => {}, { signal, every = 100 } = {}) {
  const bytes = new Uint8Array(file.size);
  const reader = file.stream().getReader();
  let at = 0;
  let told = -Infinity;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes.set(value, at);
      at += value.length;
      const now = performance.now();
      if (now - told >= every) {
        told = now;
        onProgress(at);
      }
    }
  } catch (e) {
    // The rest is not wanted: letting go of the stream lets the browser stop reading the disk.
    await reader.cancel().catch(() => {});
    throw e;
  }
  onProgress(at);
  return bytes;
}
