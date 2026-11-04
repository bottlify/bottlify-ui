/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * What a page and GameHub say to each other, over `window.postMessage`: `hello`
 * to the content script, on the page's own origin; every other op to the
 * store's session frame (`<origin>/<store>/session.html`, frame.js), which the
 * page embeds, between the page's origin and the extension's alone. The frame
 * reads the request here.
 *
 * The page asks `{ to: 'bottlify-gamehub', id, op, args }`; GameHub answers
 * `{ from: 'bottlify-gamehub', id, result }` or `{ ..., id, error }`; a frame
 * says `{ from: 'bottlify-gamehub', ready: true }` once it listens.
 * `id` is the page's, any number it has not used for a request still open.
 * GameHub is present when the page's root element carries
 * `data-bottlify-gamehub` (its version): set before any of the page's scripts
 * runs, so a page that does not find it need not wait for an answer.
 *
 * No op names a store's protocol: the store is an argument (`steam`).
 * - `hello` -> `{ version, origin, stores: [{ id, name, on }] }`: the stores GameHub has,
 *   and which the site has on (its `config.json`'s `gamehub`); `origin` the
 *   extension's, where a store's sign-in page is: `<origin>/<store>/signin.html`,
 *   which the page shows in a frame, and which posts the page
 *   `{ from: 'bottlify-signin', store, signedIn: { name } }` once signed in.
 * - `account { store, fresh? }` -> `{ name, expires? }`, or null for nobody signed in;
 *   `expires` when the session ends (ISO 8601, as its token says), and a
 *   session Steam refuses as gone is forgotten and answered null;
 *   `fresh` logs on again and reads the account's licences anew.
 * - `signOut { store }` -> `{}`.
 * - `list { store, fresh? }` -> `[{ id, name, bytes, exact, installable, covers }]`,
 *   the account's games; `covers` the URLs `cover` answers, by kind.
 * - `cover { store, game, kind }` -> the URL of the store's picture of a game;
 *   `kind` is `header`, `capsule` or `hero`.
 * - `download { store, game }` -> what an install needs; the store's own shape
 *   (Steam's: `{ name, launch, installscript, art, servers, depots }`).
 * - `runData { store, game }` -> what a run hands the engine's emulation of the
 *   store's client (Steam's: `{ win32: { steam } }`), `{}` signed out. Where the stores
 *   run in a tab, Steam's leaves out Valve's client files, which are public: the
 *   page reads them through `fetch`.
 *
 * - `fetch { url }` -> `{ status, body }`, where the stores run in a tab
 *   (`hello`'s `transport: 'tab'`, Safari): a store's content server or art
 *   fetched by GameHub's worker, which the browser lets read them where the
 *   page may not; answered by the worker, no tab opened for it. A body past a
 *   mebibyte comes as `part` events, `{ body }` each in order, and the answer
 *   is then `{ status, parts, size }`.
 *
 * Neither the session's token nor a password crosses to the page: a sign-in
 * is the store's sign-in page's, a logon its session frame's.
 */

export const TO = 'bottlify-gamehub';
export const FROM = 'bottlify-gamehub';

/** @typedef {'id' | 'store' | 'game' | 'kind' | 'bool?'} ArgKind */

/** Each op's arguments and what they must be. @type {Record<string, Record<string, ArgKind>>} */
export const OPS = Object.freeze({
    hello: {},
    account: { store: 'store', fresh: 'bool?' },
    signOut: { store: 'store' },
    list: { store: 'store', fresh: 'bool?' },
    cover: { store: 'store', game: 'game', kind: 'kind' },
    download: { store: 'store', game: 'game' },
    runData: { store: 'store', game: 'game' },
});

/**
 * What every store answers these ops with nobody signed in, as above: what
 * GameHub gives without asking the store, where reaching it costs (a tab of
 * its site, relay.js).
 */
export const SIGNED_OUT = Object.freeze({ account: null, list: [], signOut: {}, runData: {} });

/** @type {Record<ArgKind, (value: unknown) => boolean>} */
const VALID = {
    id: value=>Number.isSafeInteger(value),
    store: value=>typeof value === 'string' && /^[a-z][a-z0-9]{0,31}$/.test(value),
    game: value=>typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value),
    kind: value=>value === 'header' || value === 'capsule' || value === 'hero',
    'bool?': value=>value === undefined || typeof value === 'boolean',
};

/**
 * @typedef {{ id: number, op: string, args: Record<string, any> }} Request
 * @typedef {{ id: number, error: string }} Refusal
 */

/**
 * A message the page posted, read as a request: null for one not meant for
 * GameHub, a refusal for one that is but cannot be answered.
 *
 * @param {unknown} data
 * @returns {Request | Refusal | null}
 */
export function readRequest(data){
    const message = /** @type {Record<string, any> | null} */ (data);
    if (typeof message !== 'object' || message === null || message.to !== TO)
    {
        return null;
    }
    const { id, op } = message;
    if (!Number.isSafeInteger(id))
    {
        return null;
    }
    const kinds = typeof op === 'string' && Object.hasOwn(OPS, op) ? OPS[op] : null;
    if (!kinds)
    {
        return { id, error: `no op ${String(op)}` };
    }
    const given = typeof message.args === 'object' && message.args !== null ? message.args : {};
    /** @type {Record<string, any>} */
    const args = {};
    for (const [name, kind] of Object.entries(kinds))
    {
        if (!VALID[kind](given[name]))
        {
            return { id, error: `${op}: ${name} is not a valid ${kind.replace('?', '')}` };
        }
        args[name] = given[name];
    }
    return { id, op, args };
}
