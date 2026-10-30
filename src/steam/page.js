/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The Steam sign-in page (/steam): a QR code for the Steam app, then the
 * account's library. The sign-in goes through the bridge or the launcher's
 * server, which keeps nothing of it; the session is kept in this browser alone
 * (`client.js`), so the next visit is signed in without a code.
 */

import { encodeQr, qrToSvg } from "@bottlify/core/steam";
import { signIn, signOut, steamAccountName, steamGames } from "./client.js";

/** @param {string} id */
const element = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} text */
const status = (text) => {
  element("status").textContent = text;
};

/** @param {string} accountName */
async function showLibrary(accountName) {
  status(`${accountName}: reading the library…`);
  const games = await steamGames();
  status(`${accountName}: ${games.length} games. The session is kept in this browser.`);
  element("games").replaceChildren(...games.map((game) => {
    const item = document.createElement("li");
    item.textContent = `${game.name} (${game.appId})`;
    return item;
  }));
  element("signout").hidden = false;
}

async function signInHere() {
  for (;;) {
    try {
      const account = await signIn({
        onChallenge: (url) => {
          element("qr").innerHTML = qrToSvg(encodeQr(url), 6);
          status("Scan with the Steam app: Steam Guard → the QR scanner.");
        },
        onScanned: () => status("Scanned. Approve the sign-in in the Steam app."),
      });
      element("qr").innerHTML = "";
      return account;
    } catch (e) {
      element("qr").innerHTML = "";
      status(`${/** @type {Error} */ (e).message} — a new code…`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function run() {
  status("Connecting to Steam…");
  const kept = await steamAccountName();
  if (kept) {
    try {
      await showLibrary(kept);
      return;
    } catch (e) {
      status(`The kept session did not log on: ${/** @type {Error} */ (e).message}`);
    }
  }
  await showLibrary((await signInHere()).accountName);
}

element("signout").addEventListener("click", async () => {
  await signOut().catch(() => {});
  location.reload();
});

run().catch((e) => status(/** @type {Error} */ (e).message));
