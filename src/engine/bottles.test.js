/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { removeBottle, saveLocalManifest } from "./bottles.js";

/** A directory of the origin's file system, in memory: what the bottle store calls. */
function memoryDirectory() {
  /** @type {Map<string, any>} */
  const entries = new Map();
  return {
    entries,
    async getDirectoryHandle(/** @type {string} */ name, { create = false } = {}) {
      if (!entries.has(name)) {
        if (!create) throw new Error(`no directory ${name}`);
        entries.set(name, memoryDirectory());
      }
      return entries.get(name);
    },
    async removeEntry(/** @type {string} */ name, { recursive = false } = {}) {
      const entry = entries.get(name);
      if (entry === undefined) throw new Error(`no entry ${name}`);
      if (typeof entry !== "string" && entry.entries.size > 0 && !recursive) {
        throw new Error(`${name} is not empty`);
      }
      entries.delete(name);
    },
    async getFileHandle(/** @type {string} */ name) {
      if (typeof entries.get(name) !== "string") throw new Error(`no file ${name}`);
      return {
        getFile: async () => ({ text: async () => entries.get(name) }),
        createWritable: async () => {
          let text = "";
          return {
            write: async (/** @type {string} */ chunk) => { text += chunk; },
            close: async () => { entries.set(name, text); },
          };
        },
      };
    },
  };
}

test("a bottle kept in this browser is removed with all its files, and the others stay", async () => {
  // Deleting one from the library went to the server, which has no such
  // bottle, and the one in this browser stayed.
  const root = memoryDirectory();
  const bottles = await root.getDirectoryHandle("bottles", { create: true });
  for (const id of ["painkiller-demo", "pariah-demo"]) {
    const folder = await bottles.getDirectoryHandle(id, { create: true });
    folder.entries.set("manifest.json", JSON.stringify({ title: id }));
    folder.entries.set("bundle.btl", "...");
  }
  await removeBottle("pariah-demo", root);
  assert.deepEqual([...bottles.entries.keys()], ["painkiller-demo"]);
  await assert.rejects(removeBottle("pariah-demo", root), "a bottle that is not here is an error");
});

test("a bottle kept in this browser is renamed in its own manifest, the rest of it kept", async () => {
  const root = memoryDirectory();
  const bottles = await root.getDirectoryHandle("bottles", { create: true });
  const folder = await bottles.getDirectoryHandle("pariah-demo", { create: true });
  folder.entries.set("manifest.json", JSON.stringify({ title: "pariah", entry: "C:\\App\\pariah.exe" }));
  const saved = await saveLocalManifest("pariah-demo", { title: "Pariah", labels: ["demo"] }, root);
  const expected = { title: "Pariah", entry: "C:\\App\\pariah.exe", labels: ["demo"] };
  assert.deepEqual(saved, expected);
  assert.deepEqual(JSON.parse(folder.entries.get("manifest.json")), expected, "and written back");
  await assert.rejects(saveLocalManifest("painkiller-demo", { title: "x" }, root),
    "a bottle that is not here is an error");
});
