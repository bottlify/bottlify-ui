/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { MAGIC as BTL_MAGIC } from "@bottlify/core/bundle";

/**
 * What a chosen file is, by its first bytes: `zip`, `exe` or `btl`, or
 * null for anything else. A disc image is told apart before this
 * (`isDiscImage`), its signature lying deep in the file.
 *
 * @param {Blob} file
 * @returns {Promise<"zip" | "exe" | "btl" | null>}
 */
export async function formatOf(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return "zip";
  if (head[0] === 0x4d && head[1] === 0x5a) return "exe";
  if (String.fromCharCode(...head) === BTL_MAGIC) return "btl";
  return null;
}

/**
 * What the person is told about a file none of the kinds took. One named as a
 * disc image is one, just not of a disc Bottlify reads: the ISO 9660 file
 * system PC discs have is not on it -- a game console's disc, say -- and being
 * told .iso is taken would only contradict the name.
 *
 * @param {string} name
 * @returns {string}
 */
export function unsupportedNotice(name) {
  if (/\.iso$/i.test(name)) {
    return `${name} is not a disc Bottlify can read: it has no ISO 9660 file system, `
      + "which PC discs have. It may be a game console's disc.";
  }
  return `${name}: unsupported format. Bottlify takes an installer (.exe), `
    + "a zip, a disc image (.iso) or a bottle (.btl).";
}

/**
 * The program an archive most likely starts with: its shallowest setup.exe,
 * or its only program. Anything else is the person's to choose.
 *
 * @param {{ path: string, bytes: Uint8Array | null }[]} entries
 * @returns {string | null}
 */
export function likelyProgram(entries) {
  const programs = entries.filter((entry) => entry.bytes !== null && /\.exe$/i.test(entry.path));
  const depth = (/** @type {string} */ path) => path.split("\\").length;
  const setup = programs.filter((entry) => /(^|\\)setup\.exe$/i.test(entry.path))
    .sort((a, b) => depth(a.path) - depth(b.path))[0];
  return setup?.path ?? (programs.length === 1 ? programs[0].path : null);
}
