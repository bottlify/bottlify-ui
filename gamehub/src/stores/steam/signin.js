/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Steam's sign-in page (`steam/signin.html`), which the launcher shows in a
 * frame (signin-ui.js): the extension's page, not the launcher's, so the
 * launcher's scripts cannot reach its document. It signs in over an
 * extension page's socket, which Steam's ruleset gives Steam's Origin, seals
 * the token into the extension's own database, and tells the launcher only
 * the account's name.
 */

import { mountSignIn } from './signin-ui.js';
import { vaultFor } from '../../vault.js';

const STORE = 'steam';

// The hosts this build answers on beyond what its manifest lets frame this
// page; the build writes the dev build's (manifest.js HOSTS), null answers anywhere.
const HOSTS = /** @type {RegExp | null} */ (null);
const parentOrigin = location.ancestorOrigins?.[0] ?? null;

if (HOSTS && parentOrigin && !HOSTS.test(new URL(parentOrigin).hostname))
{
    document.body.textContent = 'This page signs in to a store for Bottlify alone.';
}
else
{
    mountSignIn(document, { vault: vaultFor(STORE), tellDone: name=>{
        if (parentOrigin)
        {
            parent.postMessage({ from: 'bottlify-signin', store: STORE, signedIn: { name } },
                parentOrigin);
        }
    } });
}
