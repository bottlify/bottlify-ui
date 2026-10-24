/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { localBottles } from "../engine/bottles.js";

/*
 * Stub data access for the local library. Lists the game folders under
 * `bundles/` and loads their manifests. Each manifest carries cover hrefs
 * (absolute, served from the app's public assets):
 *   coverLarge — full-resolution cover (details panel);
 *   coverSmall — lightweight thumbnail (grid cells);
 *   wallpaper  — stage background until the first frame (falls back to coverLarge).
 * A bundle whose manifest names none of them resolves to the empty string,
 * which every caller treats as "no art": the card and the details panel show a
 * placeholder rather than an image with nothing behind it.
 */


/**
 * @typedef {Object} BundleManifest
 * @property {string} id
 * @property {string} title
 * @property {string} version
 * @property {string} [description]
 * @property {number} [year]  When the program came out.
 * @property {string} [rightsHolder]  Who owns it now; shown as "© year holder".
 * @property {string} coverLarge   Empty when the manifest carries no art.
 * @property {string} coverSmall   Empty when the manifest carries no art.
 * @property {string} wallpaper    Empty when the manifest carries no art.
 * @property {string} entry
 * @property {string} [commandLine]  Arguments the program is started with,
 *   following the quoted image path.
 * @property {number} [revision]  Raised each time the bottle is packed again.
 * @property {{ file?: string }} [bundle]  Where its bundle is: a name beside the manifest,
 *   or an address of its own -- a bucket that serves bottles, the manifest kept here -- which
 *   the page and the engine read a range at a time themselves (`engine/btl.js`).
 * @property {string[]} [discs]  Disc images beside the bundle, mounted from D: on,
 *     for a program that reads its disc while it plays.
 * @property {string} [root]  Where the installation that made the bottle put
 *   it (`C:\Program Files\…`); the bottle is mounted there again.
 * @property {string} [windows]   The Windows the bottle runs as, by default.
 * @property {string} [graphics]  The graphics API it prefers, by default.
 * @property {boolean} [multithreading]  Whether its threads run on several cores
 *     at once; absent, they do not.
 * @property {string[]} labels     What the library marks it as: `LABELS` values.
 * @property {string | null} status How far it was found to run: a `STATUSES` value,
 *                                  null while nobody has checked.
 * @property {"game" | "application"} kind
 */

/** The marks a bottle may carry beside its version, shown on its card. */
export const LABELS = [
  { value: "demo", label: "Demo" },
  { value: "benchmark", label: "Benchmark" },
  { value: "test", label: "Test" },
];

/**
 * How far a bottle was found to run -- one of them, or none while nobody has
 * checked: into its game and fine, into its game with something wrong there,
 * or not into its game at all.
 */
export const STATUSES = [
  { value: "playable", label: "Playable" },
  { value: "start-only", label: "Start-only" },
  { value: "non-playable", label: "Non-playable" },
];

/** What kind of program a bottle starts. */
export const KINDS = [
  { value: "game", label: "Game" },
  { value: "application", label: "Application" },
];

/**
 * A manifest as the library uses it: its art resolved, its labels the known
 * ones, its kind a game unless it says otherwise. A version of `demo` is the
 * older way of saying the label, and is read as it.
 *
 * @param {string} id
 * @param {any} manifest
 * @returns {BundleManifest}
 */
export function describeBundle(id, manifest) {
  const known = new Set(LABELS.map((one) => one.value));
  const labels = Array.isArray(manifest.labels)
    ? manifest.labels.filter((one) => known.has(one))
    : [];
  const legacyDemo = String(manifest.version ?? "").trim().toLowerCase() === "demo";
  if (legacyDemo && !labels.includes("demo")) labels.unshift("demo");
  // A status kept among the labels is how bottles said it before the field.
  const statuses = new Set(STATUSES.map((one) => one.value));
  const status = statuses.has(manifest.status) ? manifest.status
    : (Array.isArray(manifest.labels) ? manifest.labels : []).find((one) => statuses.has(one)) ?? null;
  return {
    ...manifest,
    id,
    version: legacyDemo ? "" : manifest.version,
    labels,
    status,
    kind: manifest.kind === "application" ? "application" : "game",
    coverLarge: coverHref(manifest.coverLarge || manifest.cover, id),
    coverSmall: coverHref(manifest.coverSmall || manifest.coverLarge || manifest.cover, id),
    wallpaper: manifest.wallpaper
      ? coverHref(manifest.wallpaper, id)
      : coverHref(manifest.coverLarge || manifest.cover, id),
    entry: manifest.entry,
  };
}

/**
 * Changes what describes a bottle in its manifest on the server -- title,
 * description, version, labels, kind, the Windows and graphics it starts with
 * -- without sending the bottle again. The server takes those fields and no
 * others.
 *
 * @param {{ url: string, token: string }} upload
 * @param {string} id
 * @param {Record<string, unknown>} changes
 * @returns {Promise<BundleManifest>}
 */
export async function saveBundleSettings(upload, id, changes) {
  const response = await fetch(
    `${upload.url.replace(/\/+$/, "")}/bottles/${encodeURIComponent(id)}/manifest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${upload.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
  if (!response.ok) {
    throw new Error(`the server answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return describeBundle(id, (await response.json()).manifest);
}

/**
 * Removes a bottle from the server, whole and for everyone. What this browser
 * keeps under its name -- saved games, the person's patch -- is not touched.
 *
 * @param {{ url: string, token: string }} upload
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeBundle(upload, id) {
  const response = await fetch(
    `${upload.url.replace(/\/+$/, "")}/bottles/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${upload.token}` },
    });
  if (!response.ok) {
    throw new Error(`the server answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

/**
 * Gives a bottle a picture -- the cover its card and its details show, or the
 * wallpaper its stage shows before the first frame -- kept beside its manifest
 * on the server.
 *
 * @param {{ url: string, token: string }} upload
 * @param {string} id
 * @param {"cover" | "wallpaper"} slot
 * @param {File} file  A PNG, JPEG, WebP or GIF picture.
 * @returns {Promise<BundleManifest>}
 */
export async function saveBundleArt(upload, id, slot, file) {
  const response = await fetch(
    `${upload.url.replace(/\/+$/, "")}/bottles/${encodeURIComponent(id)}/art/${slot}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${upload.token}`, "Content-Type": file.type },
      body: file,
    });
  if (!response.ok) {
    throw new Error(`the server answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return describeBundle(id, (await response.json()).manifest);
}

/**
 * Resolves a cover href: absolute hrefs are used as-is, `./name` is a file in
 * the bottle's own directory -- where a picture set from the launcher is kept
 * -- and other relative ones are files under `/covers/`.
 *
 * @param {string} href
 * @param {string} id  The bottle whose directory `./` names.
 * @returns {string}
 */
function coverHref(href, id) {
  if (!href) return "";
  if (href.startsWith("./")) return `/bundles/${encodeURIComponent(id)}/${href.slice(2)}`;
  if (href.startsWith("/") || href.startsWith("http")) return href;
  return `/covers/${href}`;
}

/**
 * A bundle's own `hooks.json`/`hooks.mjs`, read from beside its
 * `manifest.json` -- never from inside the bundle. Most bundles carry
 * neither file, so a 404 on the spec is not an error: there is simply no
 * sidecar to load.
 *
 * @param {string} id
 * @returns {Promise<{ spec: object, source: string } | undefined>}
 */
export async function getSidecarHooks(id) {
  const specResponse = await fetch(`/bundles/${id}/hooks.json`);
  if (!specResponse.ok) return undefined;
  const spec = await specResponse.json();
  const source = await fetch(`/bundles/${id}/hooks.mjs`).then((response) => response.text());
  return { spec, source };
}

/**
 * A bundle's own `symbols.json`, read the same way `hooks.json` is: beside
 * its `manifest.json`, never from inside the bundle. Maps an image name to
 * its function starts, sorted ascending by RVA -- the engine's `cpu` layer
 * never reads this (`docs/core/cpu.md`'s "Sampling"); folding an address
 * bucket into a function name is this launcher's own job. Most bundles
 * carry none, so a 404 is not an error.
 *
 * @param {string} id
 * @returns {Promise<Record<string, { rva: number, name: string | null }[]> | undefined>}
 */
export async function getSidecarSymbols(id) {
  const response = await fetch(`/bundles/${id}/symbols.json`);
  if (!response.ok) return undefined;
  return response.json();
}

/**
 * A bottle the server has and does not list -- reached by its address alone,
 * as a link given to someone is. Null where there is no such bottle.
 *
 * @param {string} id
 * @returns {Promise<BundleManifest | null>}
 */
export async function getUnlistedBundle(id) {
  const response = await fetch(`/bundles/${encodeURIComponent(id)}/manifest.json`).catch(() => null);
  if (!response?.ok) return null;
  return describeBundle(id, await response.json().catch(() => ({})));
}

/**
 * @returns {Promise<BundleManifest[]>}
 */
export async function getAvailableBundles() {
  // The server lists what is under bundles/; a bottle sent a minute ago is
  // in the list the next time the library is opened. Beside them, the ones
  // kept in this browser -- which win over a server's bottle of the same id,
  // being the one this person made.
  const listing = await fetch("/bundles/index.json", { cache: "no-store" }).catch(() => null);
  /** @type {string[]} */
  const ids = listing?.ok ? await listing.json() : [];
  const kept = await localBottles();
  const here = new Set(kept.map((one) => one.id));
  const results = await Promise.all(
    ids.filter((id) => !here.has(id)).map(async (id) => {
      const response = await fetch(`/bundles/${id}/manifest.json`);
      if (!response.ok) return null;
      return describeBundle(id, await response.json());
    }),
  );
  return [
    ...kept.map((one) => ({ ...describeBundle(one.id, one.manifest), local: true })),
    ...results.filter((entry) => entry !== null),
  ];
}
