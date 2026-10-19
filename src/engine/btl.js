/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A bottle's bundle read by this page itself, a range at a time: from the
 * address its manifest names -- a bucket that serves bottles -- from beside
 * its manifest, or from the file kept in this browser. The bytes go from where
 * the bundle is straight to the page; no server reads a bottle on its behalf,
 * because bottles are large and a server in the middle pays for every byte.
 */

import {
  Codec, bundleResidency, cachedBundle, decompressZstd, openBundle, withManifest,
} from "@bottlify/core/bundle";

/**
 * Where a library bottle's bundle is: the manifest's `bundle.file`, an address
 * of its own (a bucket the manifest is not kept in) or a name beside the
 * manifest, `bundle.btl` when it says nothing.
 *
 * @param {{ id: string, bundle?: { file?: string } }} bundle
 * @returns {string}
 */
export function bundleUrl(bundle) {
  const file = bundle.bundle?.file || "bundle.btl";
  return /^https?:\/\//i.test(file) ? file : `/bundles/${encodeURIComponent(bundle.id)}/${file}`;
}

/**
 * @typedef {(offset: number, length: number,
 *     progress?: (read: number, total: number) => void) => Promise<Uint8Array>} FetchRange
 */

/**
 * How much of a library bottle's bundle this browser already keeps, by the
 * engine's own record of it: its index, read from wherever the bundle is, and
 * the bitmap of the blocks the engine has kept.
 *
 * @param {{ id: string, bundle?: { file?: string } }} bundle
 * @returns {Promise<{ blocks: number, resident: number, bytes: number, residentBytes: number }>}
 */
export async function residency(bundle) {
  const opened = await openBundle(httpRanges(bundleUrl(bundle)), decodeBlock);
  return bundleResidency({ root: await navigator.storage.getDirectory(), id: bundle.id, bundle: opened });
}

/**
 * Ranges of a bundle at an address. A 206 is the only acceptable answer: a 200
 * is the whole bundle on its way, which is what reading by ranges avoids.
 *
 * @param {string} url
 * @returns {FetchRange}
 */
export function httpRanges(url) {
  return async (offset, length, progress) => {
    const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (response.status !== 206) {
      await response.body?.cancel();
      throw new Error(`${url}: range ${offset}+${length} answered ${response.status}, not 206`);
    }
    if (!progress || !response.body) return new Uint8Array(await response.arrayBuffer());
    const bytes = new Uint8Array(length);
    const reader = response.body.getReader();
    let read = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes.set(value, read);
      read += value.length;
      progress(read, length);
    }
    return bytes.subarray(0, read);
  };
}

/**
 * Ranges of a bundle this page already holds as a file.
 *
 * @param {Blob} file
 * @returns {FetchRange}
 */
export function blobRanges(file) {
  return async (offset, length) =>
    new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

/**
 * One block of a bundle, decoded: stored as it is, raw deflate by the
 * browser's own decompressor, or zstd by the engine's.
 *
 * @param {number} codec @param {Uint8Array} stored @param {number | null} length
 * @returns {Promise<Uint8Array>}
 */
async function decodeBlock(codec, stored, length) {
  if (codec === Codec.STORED) return stored;
  if (codec === Codec.DEFLATE_RAW) {
    const stream = new Blob([stored]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (codec === Codec.ZSTD) return decompressZstd(stored, length ?? 0);
  throw new Error(`this bottle has a block packed with codec ${codec}, which this page does not know`);
}

/**
 * A bundle's list of files, and one file's bytes on request: the blocks a file
 * spans lie one after another, so they are fetched as one range.
 *
 * @param {FetchRange} fetchRange
 */
export async function readBundle(fetchRange) {
  const bundle = await openBundle(fetchRange, decodeBlock);
  return {
    blockSize: bundle.blockSize,
    files: bundle.files,
    /** What the bottle says of itself, written into it when it was exported; null if nothing. */
    manifest: bundle.manifest,
    /**
     * @param {string} path  As the bundle lists it; case does not matter.
     * @param {(read: number, total: number) => void} [progress]  Bytes fetched.
     * @returns {Promise<Uint8Array>}
     */
    async read(path, progress) {
      const file = bundle.find(path);
      if (!file) throw new Error(`${path} is not in this bottle`);
      const bytes = new Uint8Array(file.size);
      const ranges = bundle.rangesFor(file, 0, file.size);
      if (ranges.length === 0) return bytes;
      const start = ranges[0].block.offset;
      const last = ranges[ranges.length - 1].block;
      const span = await fetchRange(start, last.offset + last.packed - start, progress);
      for (const { block, from, to } of ranges) {
        const stored = span.subarray(block.offset - start, block.offset - start + block.packed);
        const at = (block.index - file.firstBlock) * bundle.blockSize;
        bytes.set((await decodeBlock(block.codec, stored, block.length)).subarray(from, to), at + from);
      }
      return bytes;
    },
  };
}

/**
 * A .btl with a description written into it: the same blocks, as the file
 * holds them, between a new header and a new index. A Blob of the three
 * parts, so a bottle of any size is copied only as it is written out.
 *
 * @param {Blob} file  The bundle as it is kept.
 * @param {Record<string, unknown>} manifest
 * @returns {Promise<Blob>}
 */
export async function describedBundle(file, manifest) {
  const { header, blocks, index } = await withManifest(blobRanges(file), decodeBlock, manifest);
  return new Blob([header, file.slice(blocks[0], blocks[1]), index]);
}

/**
 * A library bottle as this browser holds it, written out as one .btl from the
 * blocks its starts brought in -- nothing of it fetched again but its index.
 * Null while any block of it is not here.
 *
 * @param {{ id: string, bundle?: { file?: string } }} bundle
 * @param {Record<string, unknown>} manifest
 * @returns {Promise<Blob | null>}
 */
export async function cachedBottle(bundle, manifest) {
  return cachedBundle({ root: await navigator.storage.getDirectory(), id: bundle.id,
    fetchRange: httpRanges(bundleUrl(bundle)), decode: decodeBlock, manifest });
}
