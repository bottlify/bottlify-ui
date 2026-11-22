/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The 32-bit build of a game a bottle starts as 64-bit: a game that ships both
 * (a store installs both, `Binaries\Win64\Game.exe` beside
 * `Binaries\Win32\Game.exe`) runs its 32-bit one here, which cork runs faster
 * than the 64-bit one. One rule for every bottle, by the path and the image
 * alone: the 64-bit program's path with its 64-bit name in each place swapped
 * for the 32-bit one, taken only when the bottle has that file and it is a
 * 32-bit image. A launcher that picks a build by the Windows it is on is not
 * this: what it starts is the program's own choice.
 */

/** The names a 64-bit build's folder or file goes by, and its 32-bit build's. */
const SWAPS = [["win64", "win32"], ["x64", "x86"], ["amd64", "x86"], ["bin64", "bin32"], ["64bit", "32bit"]];

const SWAP = new RegExp(`(^|[\\\\/_.\\- ])(${SWAPS.map(([wide]) => wide).join("|")})(?=$|[\\\\/_.\\- ])`, "gi");

/**
 * Whether a file is a 32- or a 64-bit PE image, by its optional header's
 * magic; null for anything else.
 *
 * @param {Uint8Array} bytes  Its first kilobytes are enough.
 * @returns {32 | 64 | null}
 */
export function imageBits(bytes) {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = view.getUint32(0x3c, true);
  if (at + 26 > bytes.length || view.getUint32(at, true) !== 0x00004550) return null;
  const magic = view.getUint16(at + 24, true);
  return magic === 0x10b ? 32 : magic === 0x20b ? 64 : null;
}

/**
 * The path a 64-bit program's 32-bit build would have, as the bottle lists it,
 * or null when the bottle has no such file.
 *
 * @param {string[]} paths  Every file of the bottle.
 * @param {string} entry  The 64-bit program.
 * @returns {string | null}
 */
export function twinOf(paths, entry) {
  const wanted = entry.replace(SWAP, (_whole, before, wide) => {
    const narrow = /** @type {string} */ (SWAPS.find(([one]) => one === wide.toLowerCase()))[1];
    // Spelt as the 64-bit name was: Win64 -> Win32, WIN64 -> WIN32.
    const spelt = wide === wide.toUpperCase() ? narrow.toUpperCase()
      : wide[0] === wide[0].toUpperCase() ? narrow[0].toUpperCase() + narrow.slice(1) : narrow;
    return before + spelt;
  });
  if (wanted === entry) return null;
  const folded = wanted.replace(/\//g, "\\").toLowerCase();
  return paths.find((path) => path.replace(/\//g, "\\").toLowerCase() === folded) ?? null;
}
