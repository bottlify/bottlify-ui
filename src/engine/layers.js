/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The layers a bottle stands on: a runtime built once and shared by every
 * bottle that needs it (the .NET Framework), mounted under the bottle's own
 * files (`bundle.layers`). A bottle says so in its manifest (`layers`), or the
 * engine finds it out while it runs (`layer-needed`), which is written down
 * here, in this browser, so every later start has it.
 *
 * A layer is a bundle on the server with a manifest of its own kind
 * (`"kind": "layer"`), served beside the bottles and not listed among them.
 * Its blocks are kept once per browser under its own id, like a bottle's.
 */

import { bundleUrl } from "./btl.js";

const KEY = "bottlify.layers-needed";

/**
 * @param {Pick<Storage, "getItem">} storage
 * @returns {Record<string, string[]>}
 */
function read(storage) {
  try {
    const record = JSON.parse(storage.getItem(KEY) ?? "null");
    return record && typeof record === "object" ? record : {};
  } catch {
    return {};
  }
}

/**
 * The layers a bottle needs: what its manifest names, and what a run of it
 * here found it needs.
 *
 * @param {Pick<Storage, "getItem">} storage
 * @param {{ id: string, layers?: unknown }} bundle
 * @returns {string[]}
 */
export function layersOf(storage, bundle) {
  const named = Array.isArray(bundle.layers) ? bundle.layers : [];
  const found = read(storage)[bundle.id] ?? [];
  return [...new Set([...named, ...found].filter((one) => typeof one === "string" && one))];
}

/**
 * Writes down that a bottle needs a layer. True when it is new: a run that
 * did not have it is then worth starting again.
 *
 * @param {Pick<Storage, "getItem" | "setItem">} storage
 * @param {string} id  The bottle.
 * @param {string} layer
 * @returns {boolean}
 */
export function noteLayerNeeded(storage, id, layer) {
  const record = read(storage);
  const held = Array.isArray(record[id]) ? record[id] : [];
  if (held.includes(layer)) return false;
  record[id] = [...held, layer];
  try {
    storage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Nowhere to keep it: the next start asks again.
  }
  return true;
}

/**
 * Each layer as `createApp`'s `bundle.layers` takes it, from its manifest on
 * the server. One the server does not have as a layer is left out and named.
 *
 * @param {string[]} ids
 * @param {{ cacheBundle?: boolean, overwriteBottles?: boolean }} settings
 * @param {(url: string) => Promise<Response>} [fetchOne]
 * @returns {Promise<{ layers: object[], missing: string[] }>}
 */
export async function layerBundles(ids, settings, fetchOne = (url) => fetch(url)) {
  /** @type {object[]} */
  const layers = [];
  /** @type {string[]} */
  const missing = [];
  for (const id of ids) {
    const response = await fetchOne(`/bundles/${encodeURIComponent(id)}/manifest.json`)
      .catch(() => null);
    const manifest = response?.ok ? await response.json().catch(() => null) : null;
    if (manifest?.kind !== "layer") {
      missing.push(id);
      continue;
    }
    layers.push({
      url: bundleUrl({ id, bundle: manifest.bundle }),
      id,
      // Kept in this browser once, for every bottle on it.
      store: "local",
      prefetch: settings.cacheBundle,
      evictOthers: settings.overwriteBottles,
      ...(manifest.bundle?.indexSha256 ? { indexSha256: manifest.bundle.indexSha256 } : {}),
    });
  }
  return { layers, missing };
}
