/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * What the License page says that the engine's THIRD-PARTY-NOTICES.md, which
 * the page otherwise shows as it is, does not.
 */

/** The text of the licence Bottlify itself is under. */
export const OWN_LICENSE_URL = "https://www.mozilla.org/en-US/MPL/2.0/";

/**
 * Where to write when something in the library should not be there: the
 * deployment's `takedownEmail` (`config.json`), or "" for none -- left out or
 * not an address, the page says nothing about a contact rather than naming no
 * one.
 *
 * @param {unknown} asked
 * @returns {string}
 */
export const takedownEmailOf = (asked) =>
  (typeof asked === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(asked.trim()) ? asked.trim() : "");
