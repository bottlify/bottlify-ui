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

/**
 * @typedef {Object} Credit  Someone else's work the launcher itself ships, beside the engine's.
 * @property {string} name
 * @property {string} by  Whose it is.
 * @property {string} license
 * @property {string} home  Where it comes from.
 * @property {string} [text]  The licence's text as shipped beside the files, a path under `public/`.
 */

/**
 * What the launcher ships of others' that the engine's notices do not list:
 * its typefaces and its icon font. The SIL Open Font License asks that its
 * text travel with the fonts; it is served beside them and linked here.
 *
 * @type {readonly Credit[]}
 */
export const LAUNCHER_CREDITS = Object.freeze([
  { name: "Golos Text", by: "The Golos Text Project Authors", license: "SIL Open Font License 1.1",
    home: "https://github.com/googlefonts/golos-text", text: "/fonts/golos-text-OFL.txt" },
  { name: "Sora", by: "The Sora Project Authors", license: "SIL Open Font License 1.1",
    home: "https://github.com/sora-xor/sora-font", text: "/fonts/sora-OFL.txt" },
  { name: "Glyphicons Halflings", by: "Jan Kovařík, as distributed with Bootstrap 3",
    license: "MIT, under Bootstrap's licence", home: "https://getbootstrap.com/docs/3.4/components/#glyphicons" },
]);
