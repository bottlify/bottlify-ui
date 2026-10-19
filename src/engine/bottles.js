/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Bottles kept in this browser: a directory of the origin's file system with
 * one directory per bottle -- `bundle.btl`, `manifest.json` and `entry`, the
 * program it starts -- laid out as the bottle server keeps them, so the
 * library lists them beside the server's and a start reads them from here.
 */

import { blobRanges, cachedBottle, describedBundle, readBundle } from "./btl.js";

/** The directory under the origin's file system the bottles are kept in. */
const FOLDER = "bottles";

/**
 * Where bottles are kept, made the first time it is asked for.
 *
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function bottlesFolder() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(FOLDER, { create: true });
}

/**
 * Every bottle kept here, by id, with its manifest. A directory without a
 * readable manifest is a save that did not finish, and is not a bottle.
 *
 * @param {{ getDirectoryHandle: (name: string, options?: any) => Promise<any> } | null} [root]
 *        The origin's file system; the browser's own when absent.
 * @returns {Promise<{ id: string, manifest: Record<string, unknown> }[]>}
 */
export async function localBottles(root = null) {
  /** @type {{ id: string, manifest: Record<string, unknown> }[]} */
  const found = [];
  let folder;
  try {
    folder = root ? await root.getDirectoryHandle(FOLDER, { create: true }) : await bottlesFolder();
  } catch {
    // No origin file system -- an insecure page, a private window that
    // refuses it: no bottles are kept here, which is not an error.
    return found;
  }
  for await (const [id, handle] of folder.entries()) {
    if (handle.kind !== "directory") continue;
    try {
      const file = await (await handle.getFileHandle("manifest.json")).getFile();
      found.push({ id, manifest: JSON.parse(await file.text()) });
    } catch {
      // Unfinished, or not a bottle: skipped.
    }
  }
  return found;
}

/**
 * Removes a bottle kept here, its directory and all in it.
 *
 * @param {string} id
 * @param {{ getDirectoryHandle: (name: string, options?: any) => Promise<any> } | null} [root]
 *        The origin's file system; the browser's own when absent.
 * @returns {Promise<void>}
 */
export async function removeBottle(id, root = null) {
  const folder = root ? await root.getDirectoryHandle(FOLDER, { create: true }) : await bottlesFolder();
  await folder.removeEntry(id, { recursive: true });
}

/**
 * Changes what describes a bottle kept here -- its title, description and the
 * rest the library shows -- in its own manifest, as the server does for its.
 *
 * @param {string} id
 * @param {Record<string, unknown>} changes
 * @param {{ getDirectoryHandle: (name: string, options?: any) => Promise<any> } | null} [root]
 *        The origin's file system; the browser's own when absent.
 * @returns {Promise<Record<string, unknown>>}  The manifest as it now is.
 */
export async function saveLocalManifest(id, changes, root = null) {
  const folder = root ? await root.getDirectoryHandle(FOLDER, { create: true }) : await bottlesFolder();
  const handle = await (await folder.getDirectoryHandle(id)).getFileHandle("manifest.json");
  const manifest = { ...JSON.parse(await (await handle.getFile()).text()), ...changes };
  const writing = await handle.createWritable();
  await writing.write(JSON.stringify(manifest, null, 4));
  await writing.close();
  return manifest;
}

/**
 * One file of a bottle kept here.
 *
 * @param {string} id
 * @param {"bundle.btl" | "entry" | "manifest.json"} name
 * @returns {Promise<File>}
 */
export async function bottleFile(id, name) {
  const folder = await (await bottlesFolder()).getDirectoryHandle(id);
  return (await folder.getFileHandle(name)).getFile();
}

/**
 * A .btl a person chose, kept here as a bottle: copied whole into its
 * directory, with the program it starts unpacked beside it. One exported from
 * a launcher carries its own description -- title, program, where it was
 * installed -- and is kept as it was; one packed without it is named after the
 * file, starts its largest executable and is mounted in a directory of its
 * own. The browser is asked first to keep the storage, which it may otherwise
 * clear when the disk runs low -- a bottle of gigabytes gone with it.
 *
 * @param {File} file
 * @param {(written: number, total: number) => void} [progress]
 * @returns {Promise<{ id: string, manifest: Record<string, unknown> }>}
 */
export async function importBottle(file, progress) {
  await navigator.storage.persist?.().catch(() => false);
  const bundle = await readBundle(blobRanges(file));
  const described = bundle.manifest ?? {};
  const named = typeof described.entry === "string"
    ? bundle.files.find((one) => one.path.toLowerCase() === String(described.entry).toLowerCase())
    : null;
  const program = named ?? bundle.files
    .filter((one) => /\.exe$/i.test(one.path))
    .sort((a, b) => b.size - a.size)[0];
  if (!program) throw new Error(`${file.name} holds no program to start`);
  const entry = await bundle.read(program.path);

  const name = typeof described.title === "string" && described.title
    ? described.title : file.name.replace(/\.btl$/i, "");
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)
    || "bottle";
  const folder = await (await bottlesFolder()).getDirectoryHandle(id, { create: true });
  /** @param {string} path @param {Blob | Uint8Array} data */
  const put = async (path, data) => {
    const writing = await (await folder.getFileHandle(path, { create: true })).createWritable();
    if (data instanceof Blob) {
      const reader = data.stream().getReader();
      let written = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writing.write(value);
        written += value.length;
        progress?.(written, data.size);
      }
    } else {
      await writing.write(data);
    }
    await writing.close();
  };
  const manifest = {
    kind: "game",
    labels: [],
    ...described,
    title: name,
    entry: program.path,
    installedFrom: file.name,
    bundle: { file: "bundle.btl", blockSize: bundle.blockSize, files: bundle.files.length,
      bytes: file.size },
  };
  await put("bundle.btl", file);
  await put("entry", entry);
  await put("manifest.json", new TextEncoder().encode(JSON.stringify(manifest, null, 4)));
  return { id, manifest };
}

/**
 * A bottle written out as one .btl that carries its description, for another
 * browser or another person to import as it is: one kept here from its file,
 * one from the library from the blocks this browser holds of it -- never
 * fetched from the server only to be saved, so until it is here whole there
 * is nothing to write. Where the browser
 * can save a file as it is written, the bytes go straight to disk in pieces --
 * a bottle of gigabytes never whole in memory; elsewhere the browser downloads
 * it from where it is kept.
 *
 * @param {{ id: string, title?: string, local?: boolean, bundle?: { file?: string } }} bottle
 * @param {(written: number, total: number) => void} [progress]
 * @returns {Promise<boolean>}  false when the person cancelled the save.
 */
export async function exportBottle(bottle, progress) {
  const { id } = bottle;
  const manifest = bottle.local
    ? JSON.parse(await (await bottleFile(id, "manifest.json")).text())
    : bottle;
  // Its sizes are this copy's, measured again by whoever imports it; a library
  // entry's art is an address on its server, which the bottle does not carry.
  const described = { ...manifest };
  for (const field of ["bundle", "local", ...bottle.local ? []
    : ["coverLarge", "coverSmall", "cover", "wallpaper"]]) delete described[field];
  const blob = bottle.local
    ? await describedBundle(await bottleFile(id, "bundle.btl"), described)
    : await cachedBottle(bottle, described);
  if (!blob) throw new Error("it is downloaded once the game is here whole -- start it first");
  const name = `${String(manifest.title ?? id).replace(/[\\/:*?"<>|]+/g, " ").trim() || id}.btl`;
  const save = /** @type {any} */ (window).showSaveFilePicker;
  if (typeof save === "function") {
    let handle;
    try {
      handle = await save({ suggestedName: name,
        types: [{ description: "Bottlify bottle", accept: { "application/octet-stream": [".btl"] } }] });
    } catch (error) {
      if (/** @type {any} */ (error)?.name === "AbortError") return false;
      throw error;
    }
    const writing = await handle.createWritable();
    const reader = blob.stream().getReader();
    let written = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writing.write(value);
      written += value.length;
      progress?.(written, blob.size);
    }
    await writing.close();
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
