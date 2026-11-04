/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Valve's client files for a Steam game's run, where GameHub runs the stores
 * in a tab (Safari): the tab's run data leaves them out -- tens of megabytes
 * through the extension's ports and back -- and this page reads the public
 * package through GameHub's `fetch` once, keeping it in its own cache, with
 * the same code GameHub's session frame reads it with.
 */

import { cachedClientFetch, fetchClientFiles } from "../../gamehub/src/stores/steam/client.js";
import { gamehub, storeFetch } from "../stores/gamehub.js";

/**
 * Run data with Valve's client files where GameHub left them to this page.
 *
 * @param {Record<string, any>} data  What GameHub's `runData` answered.
 * @returns {Promise<Record<string, any>>}
 */
export async function withClientFiles(data) {
  const steam = data?.win32?.steam;
  if (!steam || steam.clientFiles || (await gamehub())?.transport !== "tab") return data;
  const read = await fetchClientFiles({ fetch: cachedClientFetch(storeFetch) }).catch((e) => {
    // The run goes on without them: a DRM wrapper that checks them says so itself.
    console.warn("Steam's client files were not read:", e);
    return null;
  });
  return read ? { ...data, win32: { ...data.win32, steam: { ...steam, clientFiles: read.files } } }
    : data;
}
