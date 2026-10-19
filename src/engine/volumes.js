/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Where the file editor reads and writes a bottle's volume, one interface for
 * both times it is open:
 *
 * - before a run, the volume the game will see at its start: the bundle's files
 *   under its directory, the session the game left (its settings and saves,
 *   wherever on the volume it wrote them), and the person's patch over the
 *   game's directory, in that order;
 * - while it runs, the running machine's own volume, where a change is what the
 *   game finds the next time it looks.
 *
 * Paths are whole, drive first (`C:\App\Data\x.ini`), as the game names them.
 */

import { opfsSession } from "@bottlify/core/storage";
import { mountOf, patchFor } from "./patches.js";
import { blobRanges, bundleUrl, httpRanges, readBundle } from "./btl.js";
import { bottleFile } from "./bottles.js";

/**
 * @typedef {Object} VolumeFile
 * @property {string} path   Whole, drive first.
 * @property {number} size
 * @property {"original" | "saved" | "changed" | "added" | "deleted"} state
 *     The bundle's own, written by the game in an earlier run, or the patch's.
 * @property {boolean} [bundled]  The bundle has its own copy beneath it to go back to.
 */

/**
 * @typedef {Object} VolumeFiles
 * @property {string} home   Where the editor opens: the game's directory.
 * @property {(dir: string) => Promise<{ folders: string[], files: VolumeFile[] }>} list
 * @property {(path: string) => Promise<Uint8Array>} read
 * @property {(path: string, bytes: Uint8Array) => Promise<void>} write
 * @property {(path: string) => Promise<void>} remove  A file, or a folder with what is in it.
 * @property {(path: string) => Promise<void>} createDirectory
 * @property {((path: string) => Promise<void>) | null} revert  Back to the bundle's own.
 */

/** @param {string} path */
const keyOf = (path) => path.toLowerCase();

/** @param {string} dir @param {string} name */
export const joinPath = (dir, name) => `${dir.replace(/\\+$/, "")}\\${name}`;

/** The directory above, or null at the drive. @param {string} path */
export function parentOf(path) {
  const cut = path.replace(/\\+$/, "").lastIndexOf("\\");
  return cut < 0 ? null : path.slice(0, cut);
}

/** @param {string} a @param {string} b */
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * The folders and files directly in `dir`, out of every file's whole path.
 *
 * @param {Iterable<VolumeFile>} files @param {Iterable<string>} folders  Made, and empty.
 * @param {string} dir
 */
function listingOf(given, folders, dir) {
  // Gone through twice, so an iterator handed in is read once.
  const files = [...given];
  const prefix = `${keyOf(dir).replace(/\\+$/, "")}\\`;
  /** @type {Map<string, string>} */
  const here = new Map();
  /** @type {VolumeFile[]} */
  const inside = [];
  for (const path of [...files.map((file) => file.path), ...folders]) {
    if (!keyOf(path).startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const cut = rest.indexOf("\\");
    if (cut >= 0) here.set(keyOf(rest.slice(0, cut)), rest.slice(0, cut));
  }
  for (const folder of folders) {
    if (keyOf(parentOf(folder) ?? "") === prefix.slice(0, -1)) {
      here.set(keyOf(folder.slice(prefix.length)), folder.slice(prefix.length));
    }
  }
  for (const file of files) {
    const path = keyOf(file.path);
    if (path.startsWith(prefix) && !path.slice(prefix.length).includes("\\")) inside.push(file);
  }
  return {
    folders: [...here.values()].sort(byName),
    files: inside.sort((a, b) => byName(a.path, b.path)),
  };
}

/**
 * A bottle's volume before a run.
 *
 * @param {import("../api/bundles.js").BundleManifest} bundle
 * @param {Object} [using]  For a test: where the bundle's list and bytes, the
 *     patch and the session come from.
 * @param {() => Promise<{ files: { path: string, size: number }[],
 *     read: (path: string) => Promise<Uint8Array> }>} [using.bundle]
 * @param {() => Promise<any>} [using.patch]
 * @param {any} [using.session]
 * @returns {VolumeFiles}
 */
export function bottleFiles(bundle, using = {}) {
  const mount = mountOf(bundle);
  // Opened once, on the first look: the file kept in this browser, or the
  // bundle wherever its manifest says it is.
  /** @type {Promise<any> | null} */
  let opened = null;
  const bottle = () => (opened ??= using.bundle?.() ?? (bundle.local
    ? bottleFile(bundle.id, "bundle.btl").then((file) => readBundle(blobRanges(file)))
    : readBundle(httpRanges(bundleUrl(bundle)))));
  /** @type {Promise<any> | null} */
  let patched = null;
  const patch = () => (patched ??= (using.patch ?? (() => patchFor(bundle.id)))());
  const session = using.session ?? opfsSession(bundle.id);
  /** @type {Promise<{ path: string, size: number }[]> | null} */
  let original = null;
  /** Folders made here and still empty: kept until a file goes in. */
  const made = new Set();

  /** The path under the game's directory, or null outside it. @param {string} path */
  const underMount = (path) => {
    const base = `${keyOf(mount)}\\`;
    return keyOf(path).startsWith(base) ? path.slice(base.length) : null;
  };

  const everything = async () => {
    original ??= bottle().then((read) => read.files);
    const [bundled, saved, patches] = await Promise.all([
      original, session.list(), (await patch()).list()]);
    /** @type {Map<string, VolumeFile>} */
    const merged = new Map();
    for (const one of bundled) {
      const path = joinPath(mount, one.path);
      merged.set(keyOf(path), { path, size: one.size, state: "original" });
    }
    for (const one of saved) {
      const had = merged.get(keyOf(one.path));
      merged.set(keyOf(one.path), { path: had?.path ?? one.path, size: one.size, state: "saved",
        ...had ? { bundled: true } : {} });
    }
    for (const one of patches) {
      const path = joinPath(mount, one.path);
      const had = merged.get(keyOf(path));
      merged.set(keyOf(path), {
        path: had?.path ?? path,
        size: one.deleted ? had?.size ?? 0 : one.size,
        state: one.deleted ? "deleted" : had ? "changed" : "added",
      });
    }
    return merged;
  };

  return {
    home: mount,
    async list(dir) {
      const files = await everything();
      for (const folder of [...made]) {
        const inside = `${keyOf(folder)}\\`;
        if ([...files.keys()].some((key) => key.startsWith(inside))) made.delete(folder);
      }
      return listingOf(files.values(), made, dir);
    },
    async read(path) {
      const relative = underMount(path);
      if (relative !== null) {
        const own = await (await patch()).read(relative);
        if (own) return own;
      }
      const saved = await session.read(path);
      if (saved) return saved;
      if (relative === null) throw new Error(`${path} is not on the volume`);
      return (await bottle()).read(relative);
    },
    async write(path, bytes) {
      const relative = underMount(path);
      if (relative !== null) await (await patch()).write(relative, bytes);
      else await session.write(path, bytes);
    },
    async remove(path) {
      const files = await everything();
      const bundled = new Set((await original ?? []).map((one) => keyOf(joinPath(mount, one.path))));
      const inside = `${keyOf(path)}\\`;
      for (const file of [...files.values()]) {
        const key = keyOf(file.path);
        if (file.state === "deleted" || (key !== keyOf(path) && !key.startsWith(inside))) continue;
        const relative = underMount(file.path);
        // What the game saved leaves the session; what the patch added leaves the
        // patch; the bundle's own is hidden by the patch, which is all that can.
        if (file.state === "saved") await session.remove(file.path);
        if (relative === null) continue;
        if (file.state === "added") await (await patch()).revert(relative);
        else if (bundled.has(key)) await (await patch()).remove(relative);
      }
      for (const folder of [...made]) {
        if (keyOf(folder) === keyOf(path) || keyOf(folder).startsWith(inside)) made.delete(folder);
      }
    },
    async createDirectory(path) {
      made.add(path);
    },
    async revert(path) {
      // Back to the bundle's own: a copy the game saved over it goes as well,
      // or the game reads its settings from an earlier run and not the bottle's.
      await session.remove(path);
      const relative = underMount(path);
      if (relative !== null) await (await patch()).revert(relative);
    },
  };
}

/**
 * A running machine's volume.
 *
 * @param {any} app  The running controller, local or across the worker's link.
 * @param {string} home
 * @returns {VolumeFiles}
 */
export function liveFiles(app, home) {
  return {
    home,
    async list(dir) {
      // "C:" alone is the current directory on C, which is the game's, not the root.
      const entries = await app.files.list(/^[a-z]:$/i.test(dir) ? `${dir}\\` : dir);
      return {
        folders: entries.filter((/** @type {any} */ one) => one.directory)
          .map((/** @type {any} */ one) => one.name).sort(byName),
        files: entries.filter((/** @type {any} */ one) => !one.directory)
          .map((/** @type {any} */ one) => ({ path: one.path, size: one.size, state: "original" }))
          .sort((/** @type {VolumeFile} */ a, /** @type {VolumeFile} */ b) => byName(a.path, b.path)),
      };
    },
    read: async (path) => app.files.read(path),
    write: async (path, bytes) => app.files.write(path, bytes),
    remove: async (path) => {
      await app.files.remove(path);
    },
    createDirectory: async (path) => {
      await app.files.createDirectory(path);
    },
    revert: null,
  };
}
