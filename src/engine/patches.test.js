/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptTextEdits, mirrorChanges, mountOf, openPatch, removePatch } from "./patches.js";
import { decodeText, encodeText } from "./text.js";

/**
 * A directory handle of the origin private file system's shape, in memory:
 * what the patch store calls, and nothing more.
 */
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
    async getFileHandle(/** @type {string} */ name, { create = false } = {}) {
      if (!entries.has(name)) {
        if (!create) throw new Error(`no file ${name}`);
        entries.set(name, { bytes: new Uint8Array(0) });
      }
      const file = entries.get(name);
      return {
        async getFile() {
          return {
            text: async () => new TextDecoder().decode(file.bytes),
            arrayBuffer: async () => file.bytes.slice().buffer,
          };
        },
        async createWritable() {
          return {
            write: async (/** @type {Uint8Array} */ bytes) => { file.bytes = bytes.slice(); },
            close: async () => {},
          };
        },
      };
    },
    async removeEntry(/** @type {string} */ name) {
      if (!entries.delete(name)) throw new Error(`no entry ${name}`);
    },
  };
}

const bytes = (/** @type {string} */ text) => new TextEncoder().encode(text);

test("a bottle's patch is removed whole, and one never kept is nothing to remove", async () => {
  const root = memoryDirectory();
  await openPatch("pariah demo", async () => root).write("Save\\slot1.sav", bytes("saved"));
  await openPatch("painkiller-demo", async () => root).write("config.ini", bytes("x"));
  await removePatch("pariah demo", async () => root);
  assert.deepEqual([...root.entries.get("patches").entries.keys()], ["painkiller-demo"]);
  await removePatch("pariah demo", async () => root);
  await removePatch("anything", async () => memoryDirectory());
});

test("a patch adds, replaces, deletes and reverts files over a bottle, and the engine gets it", async () => {
  const root = memoryDirectory();
  const patch = openPatch("world-of-warcraft-classic", async () => root);
  await patch.write("Interface/AddOns/Atlas/Atlas.toc", bytes("## Title: Atlas"));
  await patch.write("realmlist.wtf", bytes("set realmlist a"));
  await patch.write("REALMLIST.WTF", bytes("set realmlist b"));
  await patch.remove("Data\\patch-3.MPQ");

  assert.deepEqual((await patch.list()).sort((a, b) => a.path.localeCompare(b.path)), [
    { path: "Data\\patch-3.MPQ", deleted: true, size: 0 },
    { path: "Interface\\AddOns\\Atlas\\Atlas.toc", deleted: false, size: 15 },
    { path: "REALMLIST.WTF", deleted: false, size: 15 },
  ], "one entry a path, whatever its case, under the name last written");
  assert.equal(new TextDecoder().decode(await patch.read("realmlist.wtf") ?? new Uint8Array()),
    "set realmlist b");
  assert.equal(await patch.read("Data\\patch-3.MPQ"), null, "a deleted file has no bytes");
  assert.equal(await patch.read("WoW.exe"), null, "nor does one the patch never touched");

  const files = await patch.files("C:\\App");
  assert.deepEqual(files.map((one) => [one.path, "delete" in one ? "delete" : one.bytes.length])
    .sort(), [
    ["C:\\App\\Data\\patch-3.MPQ", "delete"],
    ["C:\\App\\Interface\\AddOns\\Atlas\\Atlas.toc", 15],
    ["C:\\App\\REALMLIST.WTF", 15],
  ]);

  await patch.revert("realmlist.wtf");
  await patch.revert("data\\PATCH-3.mpq");
  assert.deepEqual((await patch.list()).map((one) => one.path), ["Interface\\AddOns\\Atlas\\Atlas.toc"]);
  const stored = [...(await (await root.getDirectoryHandle("patches")).getDirectoryHandle(
    "world-of-warcraft-classic")).entries.keys()].sort();
  assert.deepEqual(stored, ["1", "index.json"], "a reverted file's bytes are gone with it");

  const again = openPatch("world-of-warcraft-classic", async () => root);
  assert.equal((await again.list()).length, 1, "and the patch is there for the next start");
  assert.deepEqual(await openPatch("other-game", async () => root).list(), [],
    "each bottle has its own");
});

test("text edits an earlier launcher kept in its settings become the patch", async () => {
  const root = memoryDirectory();
  const patch = openPatch("fallout-demo", async () => root);
  await adoptTextEdits(patch, { "fallout.cfg": "[sound]\nmusic=1" });
  assert.equal(new TextDecoder().decode(await patch.read("FALLOUT.CFG") ?? new Uint8Array()),
    "[sound]\nmusic=1");
});

test("a bottle's files are where its installation put them, else C:\\App", () => {
  assert.equal(mountOf({ entry: "Falldemo.exe" }), "C:\\App");
  assert.equal(mountOf({ entry: "3DMark03.exe", root: "C:\\Program Files\\Futuremark\\3DMark03" }),
    "C:\\Program Files\\Futuremark\\3DMark03");
});

test("a text file comes back byte for byte, in the encoding and line ends it had", () => {
  const ansi = new Uint8Array([0x80, 0x20, 0xe9, 0x0d, 0x0a, 0x41]);
  const read = decodeText(ansi);
  assert.deepEqual([read.text, read.encoding, read.crlf], ["€ é\nA", "windows-1252", true]);
  assert.deepEqual([...encodeText(read.text, read)], [...ansi]);
  assert.deepEqual([...encodeText("Ω", read)], [0x3f], "what Windows-1252 cannot hold is a ?");

  const marked = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("ключ=1\n")]);
  const utf8 = decodeText(marked);
  assert.deepEqual([utf8.text, utf8.encoding, utf8.bom, utf8.crlf], ["ключ=1\n", "utf-8", true, false]);
  assert.deepEqual([...encodeText(utf8.text, utf8)], [...marked]);
});

/** The text a patch holds at a path, or "" where it holds none. */
const textOf = async (/** @type {ReturnType<typeof openPatch>} */ patch, /** @type {string} */ path) =>
  decodeText(await patch.read(path) ?? new Uint8Array()).text;

test("a setting the game saves into a patched file is the patch's, so the next start does not undo it", async () => {
  const root = memoryDirectory();
  const patch = openPatch("wow", async () => root);
  await patch.write("WTF\\Config.wtf", bytes("SET gxResolution \"800x600\""));
  await patch.write("realmlist.wtf", bytes("set realmlist a"));
  await patch.remove("Data\\patch-3.MPQ");

  // What the game's volume holds after it has run: Config.wtf rewritten, a cache
  // the patch was never made for written, and the patched realmlist laid at the start.
  /** @type {Record<string, Uint8Array>} */
  const volume = {
    "C:\\App\\WTF\\Config.wtf": bytes("SET gxResolution \"1920x1080\""),
    "C:\\App\\realmlist.wtf": bytes("set realmlist a"),
    "C:\\App\\Cache\\WDB.bin": bytes("not the patch's"),
  };
  const read = async (/** @type {string} */ path) => {
    // A Windows volume does not tell "WTF" from "wtf".
    const file = Object.entries(volume)
      .find(([name]) => name.toLowerCase() === path.toLowerCase())?.[1];
    if (!file) throw new Error("gone");
    return file;
  };
  await mirrorChanges(patch, "C:\\App", [
    { path: "C:\\App\\wtf\\config.wtf", kind: "written" },
    { path: "C:\\App\\realmlist.wtf", kind: "written" },
    { path: "C:\\App\\Cache\\WDB.bin", kind: "written" },
    { path: "D:\\elsewhere\\Config.wtf", kind: "written" },
  ], read);

  assert.equal(await textOf(patch, "WTF\\Config.wtf"), "SET gxResolution \"1920x1080\"",
    "the game's save is what the patch holds now");
  assert.equal(await textOf(patch, "realmlist.wtf"), "set realmlist a");
  assert.equal(await patch.read("Cache\\WDB.bin"), null, "a file the patch never held is not taken in");
  assert.deepEqual((await patch.list()).length, 3, "and the patch holds the same three paths");
});

test("a patched file the game deletes is gone from the patch too, and one it makes again is back", async () => {
  const root = memoryDirectory();
  const patch = openPatch("wow", async () => root);
  await patch.write("WTF\\Config.wtf", bytes("old"));
  await patch.remove("Data\\extra.MPQ");

  await mirrorChanges(patch, "C:\\App", [{ path: "C:\\App\\WTF\\Config.wtf", kind: "removed" }],
    async () => { throw new Error("not read for a removal"); });
  assert.deepEqual((await patch.list()).find((one) => one.path === "WTF\\Config.wtf"),
    { path: "WTF\\Config.wtf", deleted: true, size: 0 });

  // The game makes a file the person had deleted: what it wrote is the patch's.
  await mirrorChanges(patch, "C:\\App", [{ path: "C:\\App\\Data\\extra.MPQ", kind: "written" }],
    async () => bytes("fresh"));
  assert.equal(await textOf(patch, "Data\\extra.MPQ"), "fresh");
});

test("one file that cannot be followed does not stop the others", async () => {
  const root = memoryDirectory();
  const patch = openPatch("wow", async () => root);
  await patch.write("a.cfg", bytes("a0"));
  await patch.write("b.cfg", bytes("b0"));
  await mirrorChanges(patch, "C:\\App", [
    { path: "C:\\App\\a.cfg", kind: "written" },
    { path: "C:\\App\\b.cfg", kind: "written" },
  ], async (path) => {
    if (path.endsWith("a.cfg")) throw new Error("gone again");
    return bytes("b1");
  });
  assert.equal(await textOf(patch, "a.cfg"), "a0");
  assert.equal(await textOf(patch, "b.cfg"), "b1");
});

test("what the patch laid itself at the start is not written back", async () => {
  const root = memoryDirectory();
  const patch = openPatch("wow", async () => root);
  await patch.write("big.dat", bytes("same"));
  let writes = 0;
  const written = patch.write;
  const counting = { ...patch, write: (/** @type {string} */ path, /** @type {Uint8Array} */ data) => {
    writes++;
    return written(path, data);
  } };
  await mirrorChanges(counting, "C:\\App", [{ path: "C:\\App\\big.dat", kind: "written" }],
    async () => bytes("same"));
  assert.equal(writes, 0);
});
