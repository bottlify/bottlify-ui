/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The game stores the launcher knows, each a provider of one shape: the
 * library shows every provider's games beside the bottles, Settings → Game
 * Accounts signs in to each, and a run of a store's bottle takes what its
 * provider says it needs. Nothing outside a provider's own folder knows which
 * store it is; another one is a module of this shape added to `PROVIDERS`.
 */

import { steam } from "../steam/client.js";

/**
 * @typedef {Object} StoreGame  A game of the account's, as the library shows it.
 * @property {string} id  The store's id of it.
 * @property {string} name
 * @property {number} bytes  What it takes installed, as far as the store says.
 * @property {boolean} exact  Whether `bytes` is measured rather than added up.
 * @property {boolean} installable  Whether it has a build an install here can start.
 */

/**
 * @typedef {Object} InstallProgress
 * @property {"downloading" | "packing"} state
 * @property {number} done  MiB.
 * @property {number} total  MiB, once known.
 * @property {string} message
 */

/**
 * @typedef {Object} StoreProvider
 * @property {string} id  Its name in a bottle's manifest (`{ [id]: … }`) and in the library's filters.
 * @property {string} name  As a person knows it.
 * @property {() => Promise<boolean>} available  Whether it can be used in this browser now.
 * @property {string} unavailable  What the page says while it cannot.
 * @property {{
 *   account: () => Promise<{ name: string } | null>,
 *   signIn: (options: { onChallenge: (url: string) => void, onScanned?: () => void,
 *     signal?: AbortSignal }) => Promise<{ name: string }>,
 *   signOut: () => Promise<void>,
 * }} auth  The account: a sign-in shows its challenge as a QR code.
 * @property {(options?: { fresh?: boolean }) => Promise<StoreGame[]>} getList  The account's games.
 * @property {(game: StoreGame, kind: "header" | "capsule" | "hero") => string} getCover
 * @property {(game: StoreGame, onProgress: (progress: InstallProgress) => void,
 *     signal: AbortSignal) => Promise<string>} install  Into this browser; the bottle's id.
 * @property {(bottle: Record<string, any>) => string | null} gameOf  The store's id of the
 *     game a bottle is, or null for a bottle not the store's.
 * @property {(bottle: Record<string, any>) => Promise<Record<string, any>>} runData  What a
 *     run of the store's bottle adds to createApp's options.
 */

/** @type {StoreProvider[]} */
export const PROVIDERS = [steam];

/**
 * The provider a bottle is a game of, or null.
 *
 * @param {Record<string, any> | null | undefined} bottle
 * @param {StoreProvider[]} [providers]
 */
export const providerOf = (bottle, providers = PROVIDERS) =>
  (bottle ? providers.find((provider) => provider.gameOf(bottle) !== null) ?? null : null);
