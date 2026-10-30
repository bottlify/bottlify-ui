/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * How a browser's Steam session rides on a request to the launcher's server:
 * one header, the session's JSON in base64. A header rather than a body
 * because the library and the account are GETs; the server reads it for that
 * request alone and writes it nowhere.
 */

/** The header's name, as Node's `req.headers` spells it. */
export const SESSION_HEADER = "x-steam-session";

/** @typedef {{ accountName: string, refreshToken: string }} SteamSession */

/** @param {SteamSession} session @returns {string} */
export function encodeSession(session) {
  const bytes = new TextEncoder().encode(JSON.stringify(
    { accountName: session.accountName, refreshToken: session.refreshToken }));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The session a header carries, or null for none, or for anything that is
 * not one -- it comes from the network.
 *
 * @param {string | string[] | undefined} value
 * @returns {SteamSession | null}
 */
export function decodeSession(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(value), (char) => char.charCodeAt(0))));
    if (typeof parsed?.accountName !== "string" || typeof parsed?.refreshToken !== "string"
      || !parsed.accountName || !parsed.refreshToken) return null;
    return { accountName: parsed.accountName, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}
