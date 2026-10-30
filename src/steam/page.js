/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The Steam sign-in page (/steam): a QR code for the Steam app, then the
 * logon and the library. The connection leaves from the person's own browser,
 * as Steam's location check wants. The refresh token is kept in this
 * origin's storage, so the next visit logs on without a code, and handed to
 * the server, which keeps it for the tools on this machine (`/steam/session`).
 */

import { connectCm, encodeQr, library, logOn, qrToSvg, signInWithQr } from "@bottlify/core/steam";

const KEY = "bottlify.steam.session";

/** @param {string} id */
const element = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} text */
const status = (text) => {
  element("status").textContent = text;
};

/** @returns {{ accountName: string, refreshToken: string } | null} */
function kept() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return value?.accountName && value?.refreshToken ? value : null;
  } catch {
    return null;
  }
}

/** @param {{ accountName: string, refreshToken: string } | null} session */
async function keep(session) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage refused (a private window): the server's copy still is kept.
  }
  const answer = await fetch("/steam/session", session
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(session) }
    : { method: "DELETE" });
  if (!answer.ok) throw new Error(`the server did not keep the session (${answer.status})`);
}

/** The connection managers' addresses: Steam's directory does not answer a page, the server asks it. */
async function managers() {
  const answer = await fetch("/steam/managers");
  if (!answer.ok) throw new Error(`no connection manager list (${answer.status})`);
  return /** @type {string[]} */ (await answer.json());
}

/** @type {{ closed: boolean, close: () => void } | undefined} */
let connection;
/** @type {string[]} */
let endpoints = [];
/** The open connection, or a new one: a manager drops one not logged on. */
async function connect() {
  if (connection && !connection.closed) return connection;
  for (const endpoint of endpoints) {
    try {
      connection = await connectCm({ endpoint });
      return connection;
    } catch {
      // The next one.
    }
  }
  throw new Error("no Steam connection manager answered");
}

/** @param {{ accountName: string, refreshToken: string }} signedIn */
async function showLibrary(signedIn) {
  status(`${signedIn.accountName}: logging on…`);
  const session = await logOn(await connect(), signedIn);
  status(`${signedIn.accountName}: ${session.licenses.length} licences, reading the library…`);
  const games = await library(await connect(), session.licenses);
  status(`${signedIn.accountName}: ${games.length} games. The session is kept.`);
  const list = element("games");
  list.replaceChildren(...games.map((game) => {
    const item = document.createElement("li");
    item.textContent = `${game.name} (${game.appid})`;
    return item;
  }));
  element("signout").hidden = false;
}

async function signIn() {
  for (;;) {
    try {
      const signedIn = await signInWithQr(connect, {
        deviceName: "Bottlify",
        onChallenge: (url) => {
          element("qr").innerHTML = qrToSvg(encodeQr(url), 6);
          status("Scan with the Steam app: Steam Guard → the QR scanner.");
        },
        onScanned: () => status("Scanned. Approve the sign-in in the Steam app."),
      });
      element("qr").innerHTML = "";
      await keep(signedIn);
      return signedIn;
    } catch (e) {
      status(`${/** @type {Error} */ (e).message} — a new code`);
    }
  }
}

async function run() {
  // Steam's managers let in a page from localhost or Steam's own sites and
  // answer any other origin 403 -- an address included, 127.0.0.1 too.
  if (location.hostname !== "localhost") {
    if (["127.0.0.1", "[::1]"].includes(location.hostname)) {
      location.replace(`${location.protocol}//localhost:${location.port}${location.pathname}`);
      return;
    }
    status(`Steam turns away a page from ${location.hostname}: open this page as `
      + `https://localhost:${location.port}/steam on the machine that runs the launcher.`);
    return;
  }
  status("Connecting to Steam…");
  endpoints = await managers();
  const session = kept();
  if (session) {
    try {
      // Handed to the server again: its copy may be gone while this one is not.
      await keep(session);
      await showLibrary(session);
      return;
    } catch (e) {
      status(`The kept session did not log on: ${/** @type {Error} */ (e).message}`);
      connection?.close();
    }
  }
  await showLibrary(await signIn());
}

element("signout").addEventListener("click", async () => {
  await keep(null);
  location.reload();
});

run().catch((e) => status(/** @type {Error} */ (e).message));
