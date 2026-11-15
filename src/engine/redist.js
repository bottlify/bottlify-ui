/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The redistributables a layer is built from in the browser, served from this
 * origin under `/redist/` (`server.mjs`): the publisher's own download site
 * sends no CORS headers, so a page cannot read it. Each is fetched from the
 * publisher unmodified and kept only if its SHA-256 is the one written here
 * (`scripts/fetch-redist.mjs`); none is in the repository.
 */

/**
 * @typedef {Object} Redistributable
 * @property {string} name    Its file name, which is its path under `/redist/`.
 * @property {string} source  Where the publisher serves it.
 * @property {number} size
 * @property {string} sha256
 */

/** The .NET Framework 4.8 offline installer, both machine widths. @type {Redistributable} */
export const NETFX48 = {
  name: "ndp48-x86-x64-allos-enu.exe",
  source: "https://download.visualstudio.microsoft.com/download/pr/"
    + "2d6bb6b2-226a-4baa-bdec-798822606ff1/8494001c276a4b96804cde7829c04d7f/"
    + "ndp48-x86-x64-allos-enu.exe",
  size: 121307088,
  sha256: "68c9986a8dcc0214d909aa1f31bee9fb5461bb839edca996a75b08ddffc1483f",
};

export const REDISTRIBUTABLES = [NETFX48];

/**
 * A digest as lowercase hex, through the platform's own SHA-256.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A redistributable's bytes, from this origin, refused unless they are the
 * ones its digest names.
 *
 * @param {Redistributable} redistributable
 * @param {(read: number, total: number) => void} [progress]
 * @param {typeof fetch} [fetchOne]
 * @returns {Promise<Uint8Array>}
 */
export async function fetchRedistributable(redistributable, progress, fetchOne = fetch) {
  const response = await fetchOne(`/redist/${redistributable.name}`);
  if (!response.ok || !response.body) {
    throw new Error(`/redist/${redistributable.name} answered ${response.status}: the server `
      + "keeps it only after `npm run redist`");
  }
  const bytes = new Uint8Array(redistributable.size);
  const reader = response.body.getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (read + value.length > bytes.length) throw new Error(`${redistributable.name} is longer than it should be`);
    bytes.set(value, read);
    read += value.length;
    progress?.(read, bytes.length);
  }
  const digest = await sha256Hex(bytes.subarray(0, read));
  if (read !== bytes.length || digest !== redistributable.sha256) {
    throw new Error(`${redistributable.name} is not the publisher's file (${read} bytes, SHA-256 ${digest})`);
  }
  return bytes;
}
