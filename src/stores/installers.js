/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * How a store's game is installed in this browser, by the store's name: the
 * page reads the store's own files -- its manifests and chunks, fetched from
 * its CDN with what GameHub's `download` answered -- and writes the bottle.
 * Speaking to the store is GameHub's, never the page's.
 */

import { installSteamGame } from "../steam/browser-install.js";
import { withClientFiles } from "../steam/client-files.js";

/**
 * @typedef {(task: { store: string, game: string, download: any,
 *     onProgress: (progress: import("./providers.js").InstallProgress) => void,
 *     signal: AbortSignal }) => Promise<string>} Installer  Resolves the bottle's id.
 */

/** @type {Record<string, Installer>} */
export const INSTALLERS = { steam: installSteamGame };

/**
 * What the page adds to a store's run data, by the store's name, where GameHub
 * leaves a public part of it to the page: Steam's client files in Safari.
 *
 * @type {Record<string, (data: Record<string, any>) => Promise<Record<string, any>>>}
 */
export const RUN_DATA = { steam: withClientFiles };
