/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearAllCaches, deleteSaves, mayNotFit, removeFromDevice, sizeText, spaceOf, storedBottles,
} from "./stored.js";

/** A file of the origin's file system, in memory. @param {string} text */
const file = (text) => ({
  kind: "file",
  getFile: async () => ({ size: text.length, text: async () => text }),
});

/** A directory of the origin's file system, in memory. */
function directory() {
  /** @type {Map<string, any>} */
  const children = new Map();
  const self = {
    kind: "directory",
    children,
    /** @param {string} name @param {{ create?: boolean }} [options] */
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!children.has(name)) {
        if (!create) throw new Error(`no directory ${name}`);
        children.set(name, directory());
      }
      return children.get(name);
    },
    /** @param {string} name */
    async getFileHandle(name) {
      if (children.get(name)?.kind !== "file") throw new Error(`no file ${name}`);
      return children.get(name);
    },
    async* entries() {
      yield* children;
    },
    /** @param {string} name */
    async removeEntry(name) {
      if (!children.delete(name)) throw new Error(`no entry ${name}`);
    },
    /** @param {string} path  `a/b/c` @param {string} text */
    put(path, text) {
      const parts = path.split("/");
      let at = self;
      for (const part of parts.slice(0, -1)) {
        if (!at.children.has(part)) at.children.set(part, directory());
        at = at.children.get(part);
      }
      at.children.set(/** @type {string} */ (parts.at(-1)), file(text));
    },
  };
  return self;
}

/**
 * The engine's account of an origin: a listed bottle, one listed under an id
 * the file system had to make safe, a bottle kept here whole that the library
 * missed, an orphan the server still describes and one nobody does.
 */
const engine = async () => ({
  usage: 5000, quota: 100000, persisted: true,
  bottles: [
    { bottle: "listed", busy: true, blocks: 100, translations: 10, saves: 5 },
    { bottle: "My_Game_", busy: false, blocks: 50, translations: 0, saves: 0 },
    { bottle: "kept", busy: false, blocks: 0, translations: 7, saves: 3 },
    { bottle: "served", busy: false, blocks: 400, translations: 0, saves: 0 },
    { bottle: "nameless", busy: false, blocks: 0, translations: 0, saves: 20 },
  ],
});

function origin() {
  const root = directory();
  root.put("bottles/kept/manifest.json", JSON.stringify({ title: "Kept Here" }));
  root.put("bottles/kept/bundle.btl", "x".repeat(1000));
  root.put("patches/nameless/index.json", "{}");
  return root;
}

test("each bottle is named as a person knows it, an orphan's from wherever it is kept", async () => {
  /** @type {string[]} */
  const asked = [];
  const found = await storedBottles({
    root: origin(), origin: engine,
    library: [{ id: "listed", title: "Listed Game" }, { id: "My Game!", title: "My Game" },
      { id: "empty", title: "Nothing stored" }],
    lookup: async (key) => {
      asked.push(key);
      return key === "served" ? { title: "On The Server" } : null;
    },
  });
  const by = Object.fromEntries(found.bottles.map((one) => [one.key, one]));
  assert.deepEqual(Object.keys(by).sort(), ["My_Game_", "kept", "listed", "nameless", "served"],
    "a library bottle with nothing stored is not listed");
  assert.equal(by.listed.title, "Listed Game");
  assert.equal(by.My_Game_.title, "My Game", "matched by the name the file system gave its id");
  assert.equal(by.My_Game_.id, "My Game!", "and cleared by its own id");
  assert.equal(by.kept.title, "Kept Here", "from its own manifest in this browser");
  assert.equal(by.served.title, "On The Server", "from the server, which no longer lists it");
  assert.deepEqual({ title: by.nameless.title, named: by.nameless.named }, { title: "nameless", named: false },
    "the id where no name is anywhere, and said so");
  assert.deepEqual(asked.sort(), ["nameless", "served"], "the server is asked only for the unnamed");
  assert.equal(by.listed.listed && !by.served.listed && !by.kept.listed, true);
});

test("sizes are by kind and in total, the largest first", async () => {
  const found = await storedBottles({ root: origin(), origin: engine, library: [] });
  assert.deepEqual([found.usage, found.quota, found.persisted], [5000, 100000, true]);
  const kept = found.bottles.find((one) => one.key === "kept");
  assert.deepEqual(kept?.bytes, { blocks: 0, translations: 7, saves: 3, local: 1000 + 21, edits: 0 });
  assert.equal(kept?.local, true);
  assert.equal(found.bottles.find((one) => one.key === "nameless")?.bytes.edits, 2);
  assert.equal(found.bottles.find((one) => one.key === "listed")?.busy, true);
  assert.deepEqual(found.bottles.map((one) => one.total), [1031, 400, 115, 50, 22]);
});

test("clearing every cache never asks for saves and skips a running bottle", async () => {
  const found = await storedBottles({ root: origin(), origin: engine, library: [] });
  /** @type {string[]} */
  const calls = [];
  const result = await clearAllCaches(found.bottles, async (id, kinds) => {
    calls.push(`${id}:${kinds.join(",")}`);
    if (id === "kept") throw new Error("held open");
    return [];
  });
  assert.deepEqual(calls.sort(), ["My_Game_:blocks,translations", "kept:blocks,translations",
    "served:blocks,translations"], "nothing for a bottle with no cache, nothing for the running one");
  assert.deepEqual(result, { skipped: ["listed"], failed: ["Kept Here"] });
});

test("saves are their own removal, and removing from the device stops where the engine refuses", async () => {
  const root = origin();
  const found = await storedBottles({ root, origin: engine, library: [] });
  const kept = /** @type {any} */ (found.bottles.find((one) => one.key === "kept"));
  /** @type {string[]} */
  const calls = [];
  await deleteSaves(kept, async (id, kinds) => {
    calls.push(`${id}:${kinds.join(",")}`);
    return [];
  });
  assert.deepEqual(calls, ["kept:saves"]);

  const refuse = async () => {
    throw new Error("it is in use by a running title");
  };
  await assert.rejects(removeFromDevice(kept, { clear: refuse, root }), /running title/);
  assert.ok(root.children.get("bottles").children.has("kept"), "a refused bottle keeps its files");

  await removeFromDevice(kept, { clear: async () => [], root });
  assert.ok(!root.children.get("bottles").children.has("kept"));
  const nameless = /** @type {any} */ (found.bottles.find((one) => one.key === "nameless"));
  await removeFromDevice(nameless, { clear: async () => [], root });
  assert.ok(!root.children.get("patches").children.has("nameless"), "an orphan's edits go with it");
});

test("sizes read as a person reads them", () => {
  assert.equal(sizeText(512), "512 B");
  assert.equal(sizeText(1536), "1.5 KB");
  assert.equal(sizeText(300 * 1024 * 1024), "300 MB");
  assert.equal(sizeText(19.5 * 1024 ** 3), "20 GB");
  assert.equal(sizeText(2.25 * 1024 ** 3), "2.3 GB");
});

test("the room left is low under a tenth of the quota and short under three per cent", () => {
  const gb = 1024 ** 3;
  assert.deepEqual(spaceOf({ usage: 85.7 * gb, quota: 98 * gb }),
    { free: 98 * gb - 85.7 * gb, quota: 98 * gb, level: "ok" });
  assert.equal(spaceOf({ usage: 90, quota: 100 })?.level, "ok", "exactly a tenth free is not low");
  assert.equal(spaceOf({ usage: 91, quota: 100 })?.level, "low");
  assert.equal(spaceOf({ usage: 97, quota: 100 })?.level, "low", "exactly three per cent is not short");
  assert.equal(spaceOf({ usage: 98, quota: 100 })?.level, "short");
  assert.equal(spaceOf({ usage: 120, quota: 100 })?.free, 0, "past the quota is none, not less");
  assert.equal(spaceOf({ usage: 5 }), null, "a browser that gives no quota is not measured");
  assert.equal(spaceOf({ usage: 0, quota: 0 }), null);
  assert.equal(spaceOf(null), null);
});

test("a start may not fit when it has more to download than the room left", () => {
  assert.equal(mayNotFit(2000, { free: 1000 }), true);
  assert.equal(mayNotFit(1000, { free: 1000 }), false, "what fits exactly fits");
  assert.equal(mayNotFit(0, { free: 0 }), false, "a bottle here whole needs no room");
  assert.equal(mayNotFit(5000, null), false, "unknown room is no reason to warn");
});
