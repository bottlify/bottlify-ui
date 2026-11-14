/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { layerBundles, layersOf, noteLayerNeeded } from "./layers.js";

/** A Storage of its own, as localStorage answers. */
function storage() {
  /** @type {Map<string, string>} */
  const held = new Map();
  return {
    getItem: (/** @type {string} */ key) => held.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => void held.set(key, value),
  };
}

test("a bottle stands on what its manifest names and what a run found it needs", () => {
  const kept = storage();
  assert.deepEqual(layersOf(kept, { id: "app" }), []);
  assert.equal(noteLayerNeeded(kept, "app", "dotnet48-x86"), true, "new: start again");
  assert.equal(noteLayerNeeded(kept, "app", "dotnet48-x86"), false, "known: once");
  assert.deepEqual(layersOf(kept, { id: "app", layers: ["dotnet48-x86", "other"] }),
    ["dotnet48-x86", "other"], "each once");
  assert.deepEqual(layersOf(kept, { id: "another" }), [], "kept by bottle");
  assert.deepEqual(layersOf(kept, { id: "x", layers: "dotnet48-x86" }), [], "a list or nothing");
});

test("a layer is mounted from its manifest on the server, and only a manifest of a layer", async () => {
  /** @type {Record<string, any>} */
  const served = {
    "/bundles/dotnet48-x86/manifest.json": { kind: "layer",
      bundle: { file: "bundle.btl", indexSha256: "ab" } },
    "/bundles/game/manifest.json": { kind: "game", entry: "game.exe" },
  };
  const fetchOne = async (/** @type {string} */ url) => (served[url]
    ? { ok: true, json: async () => served[url] }
    : { ok: false, json: async () => null });
  const { layers, missing } = await layerBundles(["dotnet48-x86", "game", "gone"],
    { cacheBundle: true, overwriteBottles: false }, /** @type {any} */ (fetchOne));
  assert.deepEqual(layers, [{ url: "/bundles/dotnet48-x86/bundle.btl", id: "dotnet48-x86",
    store: "local", prefetch: true, evictOthers: false, indexSha256: "ab" }]);
  assert.deepEqual(missing, ["game", "gone"]);
});
