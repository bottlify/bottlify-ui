/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bottleFiles, liveFiles, parentOf } from "./volumes.js";

/** A patch and a session in memory, as the editor reaches them. */
function rig() {
  /** @type {Map<string, { deleted: boolean, bytes: Uint8Array }>} */
  const patch = new Map();
  /** @type {Map<string, Uint8Array>} */
  const session = new Map([["C:\\Documents\\game\\Options.ini", Uint8Array.of(9)],
    ["C:\\App\\Data\\saved.cfg", Uint8Array.of(8, 8)]]);
  const bundled = [{ path: "Game.exe", size: 4 }, { path: "Data\\base.ini", size: 2 },
    { path: "Data\\saved.cfg", size: 1 }];
  const files = bottleFiles(/** @type {any} */ ({ id: "game", entry: "Game.exe" }), {
    bundle: async () => ({ files: bundled, read: async (path) => Uint8Array.of(path.length) }),
    patch: async () => ({
      list: async () => [...patch].map(([path, one]) => ({ path, deleted: one.deleted,
        size: one.bytes.length })),
      read: async (/** @type {string} */ path) => {
        const one = patch.get(path);
        return one && !one.deleted ? one.bytes : null;
      },
      write: async (/** @type {string} */ path, /** @type {Uint8Array} */ bytes) => {
        patch.set(path, { deleted: false, bytes });
      },
      remove: async (/** @type {string} */ path) => {
        patch.set(path, { deleted: true, bytes: new Uint8Array(0) });
      },
      revert: async (/** @type {string} */ path) => {
        patch.delete(path);
      },
    }),
    session: {
      list: async () => [...session].map(([path, bytes]) => ({ path, size: bytes.length })),
      read: async (/** @type {string} */ path) => session.get(path) ?? null,
      write: async (/** @type {string} */ path, /** @type {Uint8Array} */ bytes) => {
        session.set(path, bytes);
      },
      remove: async (/** @type {string} */ path) => {
        session.delete(path);
      },
    },
  });
  return { files, patch, session };
}

test("before a run the editor sees the whole volume: the bundle, what the game saved, the patch",
  async () => {
    const { files, patch, session } = rig();
    assert.equal(files.home, "C:\\App");
    assert.deepEqual((await files.list("C:")).folders, ["App", "Documents"],
      "above the game's directory, where the game saved its settings");
    const data = await files.list("C:\\App\\Data");
    assert.deepEqual(data.files.map((file) => [file.path, file.state]),
      [["C:\\App\\Data\\base.ini", "original"], ["C:\\App\\Data\\saved.cfg", "saved"]]);
    // What the game saved over the bundle's own is what it reads; the bundle's otherwise.
    assert.deepEqual([...await files.read("C:\\App\\Data\\saved.cfg")], [8, 8]);
    assert.deepEqual([...await files.read("C:\\Documents\\game\\Options.ini")], [9]);

    // Under the game's directory a change is the patch's; outside it, the session's.
    await files.write("C:\\App\\Data\\base.ini", Uint8Array.of(1));
    await files.write("C:\\Documents\\game\\new.txt", Uint8Array.of(2));
    assert.deepEqual([...patch.keys()], ["Data\\base.ini"]);
    assert.ok(session.has("C:\\Documents\\game\\new.txt"));
    assert.equal((await files.list("C:\\App\\Data")).files[0].state, "changed");

    // A copy the game saved over the bundle's own goes back to the bundle's.
    assert.equal(data.files[1].bundled, true);
    session.set("C:\\App\\Game.exe", Uint8Array.of(7));
    await files.revert?.("C:\\App\\Game.exe");
    assert.equal(session.has("C:\\App\\Game.exe"), false);
    assert.deepEqual((await files.list("C:\\App")).files.map((file) => file.state), ["original"]);

    // Removing a setting the game saved takes it out of the session, so it asks again.
    await files.remove("C:\\Documents\\game\\Options.ini");
    assert.equal(session.has("C:\\Documents\\game\\Options.ini"), false);
    // A saved file over a bundled one: out of the session, and hidden by the patch.
    await files.remove("C:\\App\\Data\\saved.cfg");
    assert.equal(session.has("C:\\App\\Data\\saved.cfg"), false);
    assert.equal(patch.get("Data\\saved.cfg")?.deleted, true);

    // A folder made here shows until something goes in it.
    await files.createDirectory("C:\\App\\Mods");
    assert.ok((await files.list("C:\\App")).folders.includes("Mods"));
    assert.equal(parentOf("C:\\App"), "C:");
    assert.equal(parentOf("C:"), null);
  });

test("while it runs the editor reads and changes the running machine's volume", async () => {
  /** @type {string[]} */
  const done = [];
  /** @type {string[]} */
  const asked = [];
  const files = liveFiles({
    files: {
      list: async (/** @type {string} */ dir) => (asked.push(dir), [
        { name: "Data", path: "C:\\App\\Data", directory: true, size: 0 },
        { name: "a.ini", path: "C:\\App\\a.ini", directory: false, size: 3 }]),
      read: async () => Uint8Array.of(5),
      write: async (/** @type {string} */ path) => done.push(`write ${path}`),
      remove: async (/** @type {string} */ path) => done.push(`remove ${path}`),
      createDirectory: async (/** @type {string} */ path) => done.push(`mkdir ${path}`),
    },
  }, "C:\\App");
  assert.deepEqual(await files.list("C:\\App"), { folders: ["Data"],
    files: [{ path: "C:\\App\\a.ini", size: 3, state: "original" }] });
  // "C:" alone would be the current directory on C -- the game's -- not the root.
  await files.list("C:");
  assert.deepEqual(asked, ["C:\\App", "C:\\"]);
  await files.write("C:\\App\\a.ini", Uint8Array.of(1));
  await files.remove("C:\\App\\a.ini");
  await files.createDirectory("C:\\App\\New");
  assert.deepEqual(done, ["write C:\\App\\a.ini", "remove C:\\App\\a.ini", "mkdir C:\\App\\New"]);
  assert.equal(files.revert, null, "nothing to revert to while it runs");
});
