/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GOG's sign-in as its Galaxy client does it: GOG's own login page, at
 * `auth.gog.com`, ends at `embed.gog.com/on_login_success` with a code in its
 * address, which a content script of GameHub's hands over (redirect.js); the
 * code is traded for an access token, good for an hour, and a refresh token,
 * which GOG replaces with each refresh. GOG lets no other client sign in to
 * an account's library: Galaxy's client id is the one every client uses.
 */

/** Galaxy's client, as GOG's login page and token endpoint know it. */
export const CLIENT_ID = '46899977096215655';
export const CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';

/** Where GOG's login page sends the person once signed in: the code is in its address. */
export const REDIRECT = 'https://embed.gog.com/on_login_success?origin=client';

/** GOG's login page. */
export const SIGN_IN_URL = `https://auth.gog.com/auth?client_id=${CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&layout=client2`;

/**
 * @typedef {Object} Tokens
 * @property {string} access  For `Authorization: Bearer`.
 * @property {string} refresh  The next refresh's: GOG takes each once.
 * @property {number} expires  When the access token stops being taken, in ms since the epoch.
 * @property {string} userId
 */

/** Taken as expired a minute early: a request made just before would be refused. */
const EARLY_MS = 60_000;

/**
 * @param {typeof fetch} get @param {Record<string, string>} grant
 * @returns {Promise<Tokens>}
 */
async function token(get, grant){
    const query = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        ...grant });
    const answer = await get(`https://auth.gog.com/token?${query}`);
    const body = await answer.json().catch(()=>null);
    if (!answer.ok || typeof body?.access_token !== 'string')
    {
        const why = body?.error_description ?? body?.error ?? `HTTP ${answer.status}`;
        throw Object.assign(new Error(`gog: the sign-in was refused (${why})`),
            { refused: answer.status === 400 || answer.status === 401 });
    }
    return { access: body.access_token, refresh: String(body.refresh_token ?? ''),
        expires: Date.now() + Number(body.expires_in ?? 3600) * 1000 - EARLY_MS,
        userId: String(body.user_id ?? '') };
}

/**
 * The code GOG's login page ended with, traded for tokens.
 *
 * @param {string} code @param {typeof fetch} [get]
 */
export const tokensForCode = (code, get = fetch)=>token(get,
    { grant_type: 'authorization_code', code, redirect_uri: REDIRECT });

/**
 * New tokens for a refresh token. A refusal carries `refused`: the session is
 * over and the person signs in again.
 *
 * @param {string} refresh @param {typeof fetch} [get]
 */
export const refreshed = (refresh, get = fetch)=>token(get,
    { grant_type: 'refresh_token', refresh_token: refresh });

/**
 * The code in the address GOG's login page ended at, or null for any other.
 *
 * @param {string} address
 */
export function codeOf(address){
    let url;
    try
    {
        url = new URL(address);
    }
    catch {
        return null;
    }
    return url.origin === 'https://embed.gog.com' && url.pathname === '/on_login_success'
        ? url.searchParams.get('code') : null;
}

/**
 * The account's name, as GOG shows it.
 *
 * @param {string} access @param {typeof fetch} [get]
 * @returns {Promise<string>}
 */
export async function accountName(access, get = fetch){
    const answer = await get('https://embed.gog.com/userData.json',
        { headers: { Authorization: `Bearer ${access}` } });
    const body = await answer.json().catch(()=>null);
    if (!answer.ok || !body?.isLoggedIn)
    {
        throw new Error(`gog: the account could not be read (HTTP ${answer.status})`);
    }
    return String(body.username ?? body.userId ?? 'GOG account');
}
