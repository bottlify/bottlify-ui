/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The content script on the page GOG's login ends at
 * (`embed.gog.com/on_login_success`), in the window GOG's sign-in page opened:
 * the code in its address goes to that page (signin.js), and the window,
 * which shows nothing a person needs, closes.
 */

(()=>{
    const { chrome } = /** @type {any} */ (globalThis);
    const code = new URLSearchParams(location.search).get('code');
    if (!code)
    {
        return;
    }
    Promise.resolve(chrome.runtime.sendMessage({ gogSignIn: { code } })).catch(()=>{})
        .finally(()=>window.close());
})();
