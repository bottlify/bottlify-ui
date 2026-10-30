/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Everything this browser keeps of each bottle, by the name a person knows it
 * by: the engine's caches and saves (`bottleStorage`), and the launcher's own
 * folders beside them -- a bottle kept here whole and the person's edits over
 * one. A bottle the library no longer lists still shows, so what it left
 * behind can be let go.
 */

import { bottleStorage, clearBottleStorage, storageName } from "@bottlify/core/storage";
import { localBottles, removeBottle } from "./bottles.js";
import { removePatch } from "./patches.js";

/**
 * @typedef {{ blocks: number, translations: number, saves: number, local: number,
 *     edits: number }} StoredBytes
 * @typedef {Object} StoredBottle
 * @property {string} key      The name the origin's file system knows it by.
 * @property {string} id       Its id where known (the library, a bottle kept here); else `key`.
 * @property {string} title
 * @property {boolean} named   False where no name was found anywhere and `title` is `key`.
 * @property {boolean} listed  The library lists it.
 * @property {boolean} local   Kept here whole.
 * @property {boolean} busy    A run holds it, in this tab or another.
 * @property {StoredBytes} bytes
 * @property {number} total
 */

/** A file's bytes, or a directory's added up. @param {any} handle @returns {Promise<number>} */
async function bytesOf(handle) {
  if (typeof handle?.getFile === "function") {
    return (await handle.getFile().catch(() => null))?.size ?? 0;
  }
  let total = 0;
  for await (const [, child] of handle.entries()) total += await bytesOf(child);
  return total;
}

/** Each sub-directory of a folder of the origin and its bytes; none where it is absent. */
async function folders(/** @type {any} */ root, /** @type {string} */ name) {
  const folder = await root.getDirectoryHandle(name).catch(() => null);
  /** @type {Map<string, number>} */
  const out = new Map();
  if (!folder) return out;
  for await (const [entry, handle] of folder.entries()) {
    if (handle.kind === "directory") out.set(entry, await bytesOf(handle));
  }
  return out;
}

/**
 * @param {Object} options
 * @param {{ id: string, title?: string, local?: boolean }[]} options.library  What the library lists.
 * @param {any} [options.root]  The origin's file system; the browser's own when absent.
 * @param {() => Promise<Awaited<ReturnType<typeof bottleStorage>>>} [options.origin]
 *        The engine's account of the origin.
 * @param {(key: string) => Promise<{ title?: string } | null>} [options.lookup]
 *        A bottle's description where the library does not list it: the server's.
 * @returns {Promise<{ usage: number | null, quota: number | null, persisted: boolean | null,
 *     bottles: StoredBottle[] }>}
 */
export async function storedBottles({ library, root = null, origin = bottleStorage,
  lookup = async () => null }) {
  const base = root ?? await navigator.storage.getDirectory();
  const [engine, kept, keptBytes, edits] = await Promise.all([
    origin(), localBottles(base), folders(base, "bottles"), folders(base, "patches")]);

  /** @type {Map<string, StoredBottle>} */
  const all = new Map();
  /** @param {string} key */
  const entry = (key) => {
    if (!all.has(key)) {
      all.set(key, { key, id: key, title: key, named: false, listed: false, local: false,
        busy: false, bytes: { blocks: 0, translations: 0, saves: 0, local: 0, edits: 0 }, total: 0 });
    }
    return /** @type {StoredBottle} */ (all.get(key));
  };
  for (const { bottle, busy, blocks, translations, saves } of engine.bottles) {
    const one = Object.assign(entry(bottle), { busy });
    Object.assign(one.bytes, { blocks, translations, saves });
  }
  for (const [id, bytes] of keptBytes) {
    const one = Object.assign(entry(storageName(id)), { id, local: true });
    one.bytes.local = bytes;
  }
  for (const [key, bytes] of edits) entry(key).bytes.edits = bytes;

  const listedBy = new Map(library.map((one) => [storageName(one.id), one]));
  const keptBy = new Map(kept.map((one) => [storageName(one.id), one]));
  const bottles = [...all.values()];
  for (const one of bottles) {
    one.total = Object.values(one.bytes).reduce((sum, bytes) => sum + bytes, 0);
    const listed = listedBy.get(one.key);
    if (listed) {
      Object.assign(one, { id: listed.id, listed: true, local: one.local || Boolean(listed.local) });
    }
    // The library's name first, then the bottle's own here, then the server's
    // for one it no longer lists; the id only where none says anything.
    const title = listed?.title ?? keptBy.get(one.key)?.manifest?.title
      ?? (await lookup(one.key).catch(() => null))?.title;
    if (typeof title === "string" && title.trim()) Object.assign(one, { title: title.trim(), named: true });
  }
  return {
    usage: engine.usage, quota: engine.quota, persisted: engine.persisted,
    bottles: bottles.filter((one) => one.total > 0).sort((a, b) => b.total - a.total),
  };
}

/**
 * The caches of a bottle let go -- its downloaded blocks and translated code --
 * which its next start makes again. Its saves stay.
 *
 * @param {StoredBottle} bottle
 * @param {typeof clearBottleStorage} [clear]
 */
export const clearCache = (bottle, clear = clearBottleStorage) =>
  clear(bottle.id, ["blocks", "translations"]);

/**
 * What the bottle's program wrote -- saved games, its settings -- removed for good.
 *
 * @param {StoredBottle} bottle
 * @param {typeof clearBottleStorage} [clear]
 */
export const deleteSaves = (bottle, clear = clearBottleStorage) => clear(bottle.id, ["saves"]);

/**
 * Everything this browser keeps of a bottle. The engine's part goes first: a
 * running bottle is refused there, before anything of it is touched.
 *
 * @param {StoredBottle} bottle
 * @param {{ clear?: typeof clearBottleStorage, root?: any }} [options]
 */
export async function removeFromDevice(bottle, { clear = clearBottleStorage, root = null } = {}) {
  await clear(bottle.id, ["blocks", "translations", "saves"]);
  await removePatch(bottle.id, root ? async () => root : undefined);
  if (bottle.local) await removeBottle(bottle.id, root);
}

/**
 * Every cache let go, saves never: a bottle a run holds is skipped and said so.
 *
 * @param {StoredBottle[]} bottles
 * @param {typeof clearBottleStorage} [clear]
 * @returns {Promise<{ skipped: string[], failed: string[] }>}  By title.
 */
export async function clearAllCaches(bottles, clear = clearBottleStorage) {
  const out = { skipped: /** @type {string[]} */ ([]), failed: /** @type {string[]} */ ([]) };
  for (const one of bottles) {
    if (one.bytes.blocks + one.bytes.translations === 0) continue;
    if (one.busy) {
      out.skipped.push(one.title);
      continue;
    }
    await clearCache(one, clear).catch(() => out.failed.push(one.title));
  }
  return out;
}

/**
 * Under these shares of the quota free, the space left is low, then short. A
 * game's download is gigabytes, so a few per cent of a quota is one game.
 */
export const LOW_SHARE = 0.1;
export const SHORT_SHARE = 0.03;

/**
 * The room this site has, as the browser counts it (`navigator.storage.estimate()`):
 * its quota for the site, not the disk's free space, and rounded by the
 * browser. Null where the browser does not say.
 *
 * @param {{ usage?: number, quota?: number } | null | undefined} estimate
 * @returns {{ free: number, quota: number, level: "ok" | "low" | "short" } | null}
 */
export function spaceOf(estimate) {
  const { usage, quota } = estimate ?? {};
  if (typeof usage !== "number" || typeof quota !== "number" || quota <= 0) return null;
  const free = Math.max(0, quota - usage);
  const share = free / quota;
  return { free, quota, level: share < SHORT_SHARE ? "short" : share < LOW_SHARE ? "low" : "ok" };
}

/** The site's room now. */
export const siteSpace = async () =>
  spaceOf(await navigator.storage?.estimate?.().catch(() => null));

/**
 * Whether what a start still has to download may not fit in the room left:
 * a warning, not a refusal, as the browser's figures are its own estimate.
 *
 * @param {number} missing  Bytes of the bottle not here yet.
 * @param {{ free: number } | null} space  Unknown room is no reason to warn.
 */
export const mayNotFit = (missing, space) => space !== null && missing > space.free;

/** Said on the window when this page removed something, so what shows the room reads it again. */
export const STORAGE_CHANGED = "bottlify:storage-changed";

/** Bytes as a person reads them. @param {number} bytes */
export function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
