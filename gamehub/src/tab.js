/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The content script on a store's site, in the build whose stores run in a
 * tab (relay.js): on a page the worker opened -- its address carries the
 * nonce it was opened with -- it loads the store's side (tab-session.js),
 * and on any other page of the site it does nothing. The worker checks the
 * nonce, so an address made up to carry one is closed. Loaded as a classic
 * script, which takes the module by its address.
 */

(()=>{
    const asked = new URLSearchParams(location.search);
    const nonce = asked.get('bottlify-gamehub');
    if (!nonce || window !== window.top)
    {
        return;
    }
    const { chrome } = /** @type {any} */ (globalThis);
    import(chrome.runtime.getURL('gamehub/src/tab-session.js'))
        .then(({ runTab })=>runTab({ chrome, nonce, store: asked.get('store'),
            mode: asked.get('mode') }))
        .catch((/** @type {Error} */ e)=>console.error('Bottlify GameHub:', e));
})();
