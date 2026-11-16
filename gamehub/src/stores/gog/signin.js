/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GOG's sign-in page (`gog/signin.html`), which the launcher shows in a frame:
 * the extension's page, so the launcher's scripts cannot reach its document.
 * It opens GOG's own login page in a window; the code that page ends with
 * comes back from GameHub's content script there (redirect.js), is traded for
 * GOG's tokens, and the refresh token is sealed into the extension's own
 * database. The launcher is told only the account's name.
 */

import { vaultFor } from '../../vault.js';
import { SIGN_IN_URL, accountName, tokensForCode } from './auth.js';

const STORE = 'gog';

// The hosts this build answers on beyond what its manifest lets frame this
// page; the build writes the dev build's (manifest.js HOSTS), null answers anywhere.
const HOSTS = /** @type {RegExp | null} */ (null);
const parentOrigin = location.ancestorOrigins?.[0] ?? null;
const { chrome } = /** @type {any} */ (globalThis);

const button = /** @type {HTMLButtonElement} */ (document.getElementById('open'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));

/** @param {string} text @param {boolean} [failed] */
const say = (text, failed = false)=>{
    status.textContent = text;
    status.classList.toggle('error', failed);
};

if (HOSTS && parentOrigin && !HOSTS.test(new URL(parentOrigin).hostname))
{
    document.body.textContent = 'This page signs in to a store for Bottlify alone.';
}
else
{
    /** Whether a window of GOG's was opened from here and has not answered. */
    let waiting = false;
    button.addEventListener('click', ()=>{
        const opened = window.open(SIGN_IN_URL, 'bottlify-gog-signin',
            'popup,width=520,height=760');
        // Waited for either way: the launcher is cross-origin isolated, and a
        // window opened from it onto another site is put in a group of its own
        // and answered as null, as a blocked one is - the code GOG's window ends
        // with was thrown away, the window closing on nothing.
        waiting = true;
        say(opened ? 'Sign in in GOG\'s window…'
            : 'Sign in in GOG\'s window. If none opened, allow pop-ups for this page and try'
                + ' again.');
    });
    chrome.runtime.onMessage.addListener((/** @type {any} */ message, /** @type {any} */ sender)=>{
        const code = message?.gogSignIn?.code;
        if (!waiting || typeof code !== 'string' || sender?.id !== chrome.runtime.id
            || !String(sender?.url ?? '').startsWith('https://embed.gog.com/on_login_success'))
        {
            return false;
        }
        waiting = false;
        button.disabled = true;
        say('Signing in…');
        (async()=>{
            try
            {
                const tokens = await tokensForCode(code);
                const name = await accountName(tokens.access);
                await vaultFor(STORE).set({ accountName: name, refreshToken: tokens.refresh,
                    id: crypto.randomUUID() });
                say(`Signed in as ${name}.`);
                if (parentOrigin)
                {
                    parent.postMessage({ from: 'bottlify-signin', store: STORE,
                        signedIn: { name } }, parentOrigin);
                }
            }
            catch (e){
                say(String(/** @type {Error} */ (e)?.message ?? e), true);
                button.disabled = false;
            }
        })();
        return false;
    });
}
