/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A Steam install in this browser, off the page's thread, in two roles of one
 * script (`browser-install.js` starts them):
 *
 *  - a decoder, given a port: fetches a chunk from Steam's content servers
 *    (GameHub opens them to this origin), decrypts and decompresses it and
 *    sends the bytes back -- LZMA in JavaScript is a fifth of a second a
 *    mebibyte, so there are several;
 *  - the install, given the depots' keys and codes and the decoders' ports:
 *    the engine's `installBundle` into the bottle's `bundle.btl` in this
 *    origin's file system, through a sync access handle -- which only a
 *    worker has, and which writes in place where a page's writable copies the
 *    whole file -- then the program it starts (`entry`) and, last, its
 *    `manifest.json`, which makes it a bottle the library lists.
 *
 * What a stopped install had done is kept beside it (`install.json`): the next
 * run goes on from there.
 */

import { downloadChunk } from "@bottlify/core/steam";
import { installBundle } from "@bottlify/core/steam/install";
import { bottlesFolder } from "../engine/bottles.js";

/** @typedef {import("@bottlify/core/steam/install").DepotOpening} DepotOpening */

/** @param {MessagePort} port */
function serve(port) {
  port.onmessage = async ({ data: { id, server, depot, chunk, key } }) => {
    try {
      const bytes = await downloadChunk(server, depot, chunk, key);
      port.postMessage({ id, buffer: bytes.buffer, offset: bytes.byteOffset, length: bytes.length },
        [bytes.buffer]);
    } catch (e) {
      port.postMessage({ id, error: String(/** @type {Error} */ (e)?.message ?? e) });
    }
  };
}

/**
 * Asks the decoders in turn.
 *
 * @param {MessagePort[]} ports
 * @returns {Parameters<typeof installBundle>[0]["decode"]}
 */
function decoders(ports) {
  let next = 0;
  let lastId = 0;
  /** @type {Map<number, { resolve: (bytes: Uint8Array) => void, reject: (e: Error) => void }>} */
  const waiting = new Map();
  for (const port of ports) {
    port.onmessage = ({ data }) => {
      const asked = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.error !== undefined) asked?.reject(new Error(data.error));
      else asked?.resolve(new Uint8Array(data.buffer, data.offset, data.length));
    };
  }
  return (server, depot, chunk, key) => new Promise((resolve, reject) => {
    const id = ++lastId;
    waiting.set(id, { resolve, reject });
    ports[next++ % ports.length].postMessage({ id, server, depot, chunk, key });
  });
}

/**
 * A small file of the bottle's directory, written whole.
 *
 * @param {FileSystemDirectoryHandle} folder @param {string} name @param {Uint8Array} bytes
 */
async function put(folder, name, bytes) {
  const handle = await (await folder.getFileHandle(name, { create: true })).createSyncAccessHandle();
  try {
    handle.truncate(0);
    handle.write(bytes, { at: 0 });
    handle.flush();
  } finally {
    handle.close();
  }
}

/** @param {Uint8Array} bytes */
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

/**
 * @param {Object} task
 * @param {string} task.id  The bottle's directory.
 * @param {DepotOpening[]} task.depots
 * @param {import("@bottlify/core/steam").ContentServer[]} task.servers
 * @param {string} [task.installscript] @param {string} task.executable
 * @param {Record<string, unknown>} task.manifest  The bottle's description but for its bundle.
 * @param {MessagePort[]} task.ports
 * @param {AbortSignal} signal
 */
async function install({ id, depots, servers, installscript, executable, manifest, ports }, signal) {
  const folder = await (await bottlesFolder()).getDirectoryHandle(id, { create: true });
  /** @type {import("@bottlify/core/steam/install").InstallProgress | null} */
  let resume = null;
  try {
    const kept = JSON.parse(await (await (await folder.getFileHandle("install.json")).getFile()).text());
    resume = { stamp: kept.stamp, done: Uint8Array.from(atob(kept.done), (c) => c.charCodeAt(0)) };
  } catch {
    // Nothing done before, or nothing readable: from the start.
  }
  let handle;
  try {
    handle = await (await folder.getFileHandle("bundle.btl", { create: true })).createSyncAccessHandle();
  } catch (e) {
    throw /** @type {Error} */ (e)?.name === "NoModificationAllowedError"
      ? new Error("it is being installed in another tab") : e;
  }
  let shown = 0;
  try {
    const { bundle, entry } = await installBundle({ handle, depots, servers, installscript,
      executable, resume, signal, decode: decoders(ports),
      onSave: (progress) => put(folder, "install.json", new TextEncoder().encode(
        JSON.stringify({ stamp: progress.stamp, done: base64(progress.done) }))),
      onProgress: (progress) => {
        // A message a quarter of a second at most, and the last of each stage.
        if (Date.now() - shown < 250 && progress.done < progress.total) return;
        shown = Date.now();
        postMessage({ progress });
      } });
    if (!entry) throw new Error(`${executable} is not among the files the depots install`);
    await put(folder, "entry", entry);
    const described = { ...manifest, bundle: { file: "bundle.btl", ...bundle } };
    await put(folder, "manifest.json", new TextEncoder().encode(JSON.stringify(described, null, 4)));
    await folder.removeEntry("install.json").catch(() => {});
    return described;
  } finally {
    handle.close();
  }
}

const stop = new AbortController();
onmessage = async ({ data }) => {
  if (data.serve) {
    serve(data.serve);
  } else if (data.cancel) {
    stop.abort(new DOMException("the install was stopped", "AbortError"));
  } else if (data.install) {
    try {
      postMessage({ done: await install({ ...data.install, ports: data.ports }, stop.signal) });
    } catch (e) {
      postMessage({ error: String(/** @type {Error} */ (e)?.message ?? e),
        stopped: stop.signal.aborted });
    }
  }
};
