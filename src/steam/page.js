/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The Steam sign-in page (/steam): a QR code for the Steam app, then the
 * account's library. The sign-in goes through the launcher's server, which
 * keeps nothing of it; the session is kept in this browser alone
 * (`client.js`), so the next visit is signed in without a code.
 */

import { encodeQr, qrToSvg } from "@bottlify/core/steam";
import { keepSession, keptSession, sessionHeaders, signIn } from "./client.js";

/** @param {string} id */
const element = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} text */
const status = (text) => {
  element("status").textContent = text;
};

/** @param {string} accountName */
async function showLibrary(accountName) {
  status(`${accountName}: reading the library…`);
  const answer = await fetch("/steam/library", { headers: await sessionHeaders() });
  if (!answer.ok) throw new Error(await answer.text());
  /** @type {{ appId: number, name: string }[]} */
  const games = await answer.json();
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
      const session = await signIn({
        onChallenge: (url) => {
          element("qr").innerHTML = qrToSvg(encodeQr(url), 6);
          status("Scan with the Steam app: Steam Guard → the QR scanner.");
        },
        onScanned: () => status("Scanned. Approve the sign-in in the Steam app."),
      });
      element("qr").innerHTML = "";
      await keepSession(session);
      return session;
    } catch (e) {
      element("qr").innerHTML = "";
      status(`${/** @type {Error} */ (e).message} — a new code…`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function run() {
  status("Connecting to Steam…");
  const kept = await keptSession();
  if (kept) {
    try {
      await showLibrary(kept.accountName);
      return;
    } catch (e) {
      status(`The kept session did not log on: ${/** @type {Error} */ (e).message}`);
    }
  }
  await showLibrary((await signInHere()).accountName);
}

element("signout").addEventListener("click", async () => {
  await fetch("/steam/session", { method: "DELETE", headers: await sessionHeaders() }).catch(() => {});
  await keepSession(null);
  location.reload();
});

run().catch((e) => status(/** @type {Error} */ (e).message));
