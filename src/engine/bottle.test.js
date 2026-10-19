/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleStart } from "./bottle.js";

test("a bottle an installation made is mounted where the installation put it", () => {
  // Its registry names that directory: a launcher that changes into it, or
  // finds its game by it, finds the bottle there.
  const start = bundleStart({ id: "tron", entry: "TRON.exe",
    root: "C:\\Program Files\\Buena Vista Interactive\\Tron 2.0 Demo" }, { cacheBundle: true });
  assert.equal(start.imagePath,
    "C:\\Program Files\\Buena Vista Interactive\\Tron 2.0 Demo\\TRON.exe");
  assert.deepEqual(start.bundle, {
    url: "/bundles/tron/bundle.btl",
    prefix: "Program Files\\Buena Vista Interactive\\Tron 2.0 Demo",
    store: "local",
    id: "tron",
    prefetch: true,
  });
});

test("a bundle that says nothing of where it belongs is mounted in a directory of its own", () => {
  const start = bundleStart({ id: "game", entry: "game.exe" }, { cacheBundle: false });
  assert.equal(start.imagePath, "C:\\App\\game.exe");
  assert.equal(start.bundle.prefix, "App");
  assert.equal(start.bundle.prefetch, false);
});

test("a bottle kept in this browser is read from its file and cached nowhere", () => {
  const file = new Blob([new Uint8Array(8)]);
  const started = bundleStart({ id: "kept", entry: "game.exe", root: "C:\\Game" },
    { cacheBundle: true }, file);
  assert.equal(started.bundle.file, file);
  assert.equal(started.bundle.url, undefined, "no server is asked for it");
  assert.equal(started.bundle.store, null, "it is on this machine already");
  assert.equal(started.bundle.prefetch, undefined);
});
