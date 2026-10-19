/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The person's own patch over a bottle: files added, replaced or edited, and
 * files deleted, kept in this browser and laid over the game at every start --
 * an add-on in its directory, a realm list, a line of configuration. The
 * bottle itself is never written: a bundle on the server is everyone's, and a
 * browser could only ever replace it whole.
 *
 * Kept in the origin's private file system, where a replaced texture or a
 * folder of add-ons fits as bytes, one directory per bottle: `index.json`
 * names each patched path, by its path under the bottle, and the file that
 * holds its bytes, or says it is deleted.
 */

import { placementOf } from "@bottlify/installer";
import { loadSettings, saveSettings } from "../settings.js";

/**
 * @typedef {Object} PatchEntry
 * @property {string} path      Under the bottle's directory, backslash-separated.
 * @property {boolean} deleted  The game sees no file there.
 * @property {number} size      Bytes, or 0 when deleted.
 */

/** @param {string} path */
const keyOf = (path) => path.toLowerCase();

/** @param {string} path */
export const cleanPath = (path) => path.replace(/\//g, "\\").replace(/^\\+|\\+$/g, "")
  .replace(/\\{2,}/g, "\\");

/** The directory a bottle's patch is kept in, named safely. @param {string} bundleId */
const patchName = (bundleId) => bundleId.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * A bottle's patch taken away whole, the files the person changed in it with
 * it. None kept is nothing to take away.
 *
 * @param {string} bundleId
 * @param {() => Promise<any>} [root]  As `openPatch` takes it.
 */
export async function removePatch(bundleId, root = () => navigator.storage.getDirectory()) {
  const patches = await (await root()).getDirectoryHandle("patches").catch(() => null);
  const name = patchName(bundleId);
  if (patches && await patches.getDirectoryHandle(name).catch(() => null)) {
    await patches.removeEntry(name, { recursive: true });
  }
}

/**
 * @param {string} bundleId
 * @param {() => Promise<any>} [root]  The directory patches live under; the
 *     origin's private file system by default, a handle of the same shape in a test.
 */
export function openPatch(bundleId, root = () => navigator.storage.getDirectory()) {
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  /**
   * One change at a time: two writes that each read the index and write it
   * back would lose one of them.
   *
   * @template T
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  const serial = (work) => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  const folder = async () => {
    const patches = await (await root()).getDirectoryHandle("patches", { create: true });
    return patches.getDirectoryHandle(patchName(bundleId), { create: true });
  };

  /** @returns {Promise<{ entries: Record<string, PatchEntry & { file?: string }>, next: number }>} */
  const readIndex = async () => {
    try {
      const handle = await (await folder()).getFileHandle("index.json");
      const index = JSON.parse(await (await handle.getFile()).text());
      return { entries: index.entries ?? {}, next: index.next ?? 1 };
    } catch {
      return { entries: {}, next: 1 };
    }
  };

  /** @param {{ entries: Record<string, any>, next: number }} index */
  const writeIndex = async (index) => {
    await put(await folder(), "index.json", new TextEncoder().encode(JSON.stringify(index)));
  };

  /** @param {any} dir @param {string} name @param {Uint8Array} bytes */
  const put = async (dir, name, bytes) => {
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(bytes);
    await writable.close();
  };

  /** @param {any} dir @param {string | undefined} name */
  const drop = async (dir, name) => {
    if (name) await dir.removeEntry(name).catch(() => {});
  };

  return {
    /** @returns {Promise<PatchEntry[]>} */
    list: () => serial(async () => Object.values((await readIndex()).entries)
      .map(({ path, deleted, size }) => ({ path, deleted: Boolean(deleted), size: size ?? 0 }))),

    /**
     * The patched bytes at `path`, or null where the patch holds none.
     *
     * @param {string} path
     * @returns {Promise<Uint8Array | null>}
     */
    read: (path) => serial(async () => {
      const entry = (await readIndex()).entries[keyOf(cleanPath(path))];
      if (!entry || entry.deleted || !entry.file) return null;
      const handle = await (await folder()).getFileHandle(entry.file);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    }),

    /** @param {string} path @param {Uint8Array} bytes */
    write: (path, bytes) => serial(async () => {
      const clean = cleanPath(path);
      const index = await readIndex();
      const held = index.entries[keyOf(clean)];
      const file = held?.file ?? String(index.next++);
      await put(await folder(), file, bytes);
      index.entries[keyOf(clean)] = { path: clean, deleted: false, size: bytes.length, file };
      await writeIndex(index);
    }),

    /** The game sees no file at `path`. @param {string} path */
    remove: (path) => serial(async () => {
      const clean = cleanPath(path);
      const index = await readIndex();
      await drop(await folder(), index.entries[keyOf(clean)]?.file);
      index.entries[keyOf(clean)] = { path: clean, deleted: true, size: 0 };
      await writeIndex(index);
    }),

    /** The game sees the bottle's own file at `path` again, or none. @param {string} path */
    revert: (path) => serial(async () => {
      const index = await readIndex();
      const key = keyOf(cleanPath(path));
      await drop(await folder(), index.entries[key]?.file);
      delete index.entries[key];
      await writeIndex(index);
    }),

    /**
     * The patch as the engine takes it at a start: every path under `mount`,
     * the bytes it holds or that it is deleted.
     *
     * @param {string} mount  Where the bottle is in the guest, `C:\App`.
     * @returns {Promise<({ path: string, bytes: Uint8Array } | { path: string, delete: true })[]>}
     */
    files: (mount) => serial(async () => {
      const dir = await folder();
      const out = [];
      for (const entry of Object.values((await readIndex()).entries)) {
        const path = `${mount}\\${entry.path}`;
        if (entry.deleted) {
          out.push({ path, delete: /** @type {const} */ (true) });
        } else if (entry.file) {
          const handle = await dir.getFileHandle(entry.file);
          out.push({ path, bytes: new Uint8Array(await (await handle.getFile()).arrayBuffer()) });
        }
      }
      return out;
    }),
  };
}

/**
 * Where a bottle's files are in the guest: the directory its installation
 * chose, the way the engine mounts it, else `C:\App`.
 *
 * @param {{ root?: string, entry?: string }} bundle
 */
export function mountOf(bundle) {
  const { prefix } = placementOf({ entry: bundle.entry ?? "", root: bundle.root });
  return prefix ? `C:\\${prefix}` : "C:";
}

/**
 * The patch over a bottle, with the text edits an earlier launcher kept in its
 * settings moved into it the first time it is asked for.
 *
 * @param {string} bundleId
 */
export async function patchFor(bundleId) {
  const patch = openPatch(bundleId);
  const { bottleFiles } = loadSettings();
  if (Object.keys(bottleFiles[bundleId] ?? {}).length > 0) {
    await adoptTextEdits(patch, bottleFiles[bundleId]);
    const rest = { ...bottleFiles };
    delete rest[bundleId];
    saveSettings({ bottleFiles: rest });
  }
  return patch;
}

/**
 * What the game wrote into a file the patch holds becomes the patch's.
 *
 * The patch is laid over the session at every start and wins over what the
 * game last saved, so a file the person once edited -- a line of
 * `Config.wtf` -- would be put back as it was edited at every start, and every
 * setting the game saved since would be lost with it. The patch has to be the
 * latest known content of its files, then: when the game writes one, the patch
 * takes the bytes; when the game deletes one, the patch says it is gone. No
 * history is kept, only the file as it now is. A change to a file the patch
 * does not hold is not the patch's business.
 *
 * @param {ReturnType<typeof openPatch>} patch
 * @param {string} mount  Where the bottle is in the guest, `C:\App`.
 * @param {{ path: string, kind: string }[]} changes  The session's changes: `written` or `removed`.
 * @param {(path: string) => Promise<Uint8Array>} read  The file as the game sees it.
 */
export async function mirrorChanges(patch, mount, changes, read) {
  const prefix = `${mount}\\`.toLowerCase();
  const under = changes.filter((change) => change.path.toLowerCase().startsWith(prefix));
  if (under.length === 0) return;
  const held = new Map((await patch.list()).map((entry) => [keyOf(entry.path), entry]));
  for (const { path, kind } of under) {
    const relative = path.slice(prefix.length);
    const entry = held.get(keyOf(relative));
    if (!entry) continue;
    try {
      if (kind === "removed") {
        if (!entry.deleted) await patch.remove(relative);
      } else if (kind === "written") {
        const bytes = await read(path);
        // What the patch laid at the start comes back as a change of its own;
        // writing it again would cost a megabyte of texture for nothing.
        const same = !entry.deleted && entry.size === bytes.length
          && sameBytes(await patch.read(relative), bytes);
        if (!same) await patch.write(relative, bytes);
      }
    } catch {
      // A file gone again before it was read, or storage full: this one is
      // left as it was and the rest are still followed.
    }
  }
}

/** @param {Uint8Array | null} a @param {Uint8Array} b */
function sameBytes(a, b) {
  if (!a || a.length !== b.length) return false;
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
  return true;
}

/**
 * Writes text edits, by path under the bottle, into the patch.
 *
 * @param {ReturnType<typeof openPatch>} patch
 * @param {Record<string, string> | undefined} texts  Path under the bottle → text.
 */
export async function adoptTextEdits(patch, texts) {
  const encoder = new TextEncoder();
  for (const [path, text] of Object.entries(texts ?? {})) {
    await patch.write(path, encoder.encode(text));
  }
}
