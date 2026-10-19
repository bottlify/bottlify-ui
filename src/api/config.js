/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/*
 * What this deployment is allowed to do, read at run time rather than built in.
 *
 * `config.json` sits beside the app and is absent by default, so a build with
 * no configuration offers nothing but the library. Installing is a developer
 * feature and is gated on `allowInstall`: without it nothing about adding a
 * title appears anywhere in the interface.
 *
 * {
 *   "allowInstall": true,
 *   "networking": true,
 *   "libraryTags": true,
 *   "preloadBottles": true,
 *   "cork": { "ordered": false },
 *   "graphics": { "compressedTextures": true },
 *   "cpu": { "placement": "auto" },
 *   "server": { "url": "/", "token": "..." },
 *   "editableTypes": ["txt", "cfg", "ini"]
 *
 * `server` is the bottle server, which keeps bottles for everyone who opens
 * the library. `false`, left out, or without a `url`, there is none: a bottle
 * is saved in this browser, a bottle's settings are the person's own whoever
 * made it, and only the bottles kept here are renamed or deleted. A relative
 * `url` is the origin the page came from, whose server passes bottles on to
 * the bottle server -- a fixed 127.0.0.1 there means the machine the browser
 * runs on, which from any other machine is not the launcher's.
 *
 * `networking` says the launcher's own server is behind the page, with the
 * network relay's client at `/networking/` and its socket at `/relay`; left
 * out, a run has no network -- a site of static files serves neither.
 *
 * `libraryTags` shows the library's tags -- kind, labels, how far each title
 * runs -- for filtering it; left out, the library is shown whole and the tags
 * are not offered.
 *
 * `preloadBottles` asks, before a bottle that is not on this device whole
 * starts, whether to download it first: from a server far away every part a
 * game reads that is not here yet is a wait it stops for. Left out, a bottle
 * plays at once and loads as it is read.
 *
 * `cork` is laid over the translator's settings for every run (`cork.config`
 * of the engine's createApp): `ordered: false` keeps a program's plain stores
 * as plain wasm stores on any host, where the engine would otherwise order
 * them on one that reorders plain accesses. Left out, the engine decides.
 *
 * `graphics` is laid over the graphics layer's settings for every run (`graphics`
 * of the engine's createApp): `compressedTextures: true` sends DXT textures to a
 * GPU that samples BC as they are, rather than decoded first. A knob in the
 * page's address goes over it. Left out, the engine's defaults.
 *
 * `cpu` is laid over the processor's settings for every run (`cpu` of the
 * engine's createApp): `placement` says where a process of several cores runs
 * its threads. The cores a page or a title's settings ask for go over it.
 *
 * `editableTypes` are the extensions the file explorer opens in its editor:
 * text a person may change by hand. Left out, `EDITABLE_TYPES`.
 * }
 */

/** The text files the explorer edits when the configuration names none. */
export const EDITABLE_TYPES = ["txt", "cfg", "log", "conf", "json", "wtf", "ini", "lua", "toc", "xml"];

/**
 * @typedef {Object} AppConfig
 * @property {boolean} allowInstall
 * @property {{ url: string, token: string } | null} upload  The bottle server; null when
 *     there is none.
 * @property {string[]} editableTypes  Lower case, without the dot.
 * @property {boolean} libraryTags  Whether the library offers its tags as filters.
 * @property {boolean} preloadBottles  Whether a bottle not here whole is offered a download first.
 * @property {Record<string, unknown>} cork  Laid over the translator's settings for every run.
 * @property {Record<string, unknown>} graphics  Laid over the graphics layer's settings for every run.
 * @property {Record<string, unknown>} cpu  Laid over the processor's settings for every run.
 * @property {boolean} networking  Whether the page has the network relay beside it
 *     (`/networking/` and `/relay`, which only the launcher's own server serves): a
 *     site of static files has none, and a run there must not ask for its client.
 */

/** @type {Promise<AppConfig> | null} */
let asked = null;

/**
 * @returns {Promise<AppConfig>}
 */
export function getConfig() {
  asked ??= fetch("/config.json")
    .then((response) => (response.ok ? response.json() : {}))
    // No configuration is the normal case, not an error: the file is absent in
    // any deployment that has nothing to turn on.
    .catch(() => ({}))
    .then((raw) => ({
      allowInstall: raw.allowInstall === true,
      upload: raw.server?.url
        ? { url: new URL(raw.server.url, window.location.origin).href, token: raw.server.token ?? "" }
        : null,
      editableTypes: Array.isArray(raw.editableTypes)
        ? raw.editableTypes.map((one) => String(one).toLowerCase().replace(/^\./, ""))
        : EDITABLE_TYPES,
      networking: raw.networking === true,
      libraryTags: raw.libraryTags === true,
      preloadBottles: raw.preloadBottles === true,
      cork: raw.cork && typeof raw.cork === "object" && !Array.isArray(raw.cork) ? raw.cork : {},
      graphics: raw.graphics && typeof raw.graphics === "object" && !Array.isArray(raw.graphics)
        ? raw.graphics : {},
      cpu: raw.cpu && typeof raw.cpu === "object" && !Array.isArray(raw.cpu) ? raw.cpu : {},
    }));
  return asked;
}
