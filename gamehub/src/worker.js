/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GameHub's service worker: when a page of a site loads, its content script
 * hands the site's switches here, and each store's ruleset is switched as
 * they say (rulesets.js, A66). It keeps no session and speaks no store's
 * protocol, and nothing waits on it: Chrome keeps an extension's worker at a
 * low priority and stops it when idle. A store's sign-in page and session
 * frame, the extension's own pages, do the rest (signin-flow.js, frame.js) --
 * except in the build whose stores run in a tab of their sites (Safari's),
 * where this worker relays between the page and that tab (relay.js).
 */

import { switchRulesets } from './rulesets.js';
import { startRelay } from './relay.js';
import { PLATFORMS } from './manifest.js';

const { chrome } = /** @type {any} */ (globalThis);

// Where a store's protocol runs (content.js): in the `tab` build this worker
// relays a page's ops to a tab of the store's site. The build writes it.
const TRANSPORT = /** @type {'frame' | 'tab'} */ ('frame');
if (TRANSPORT === 'tab')
{
    startRelay({ chrome,
        sites: Object.fromEntries(Object.entries(PLATFORMS).map(([id, one])=>[id, one.site])),
        // What a store's tab is refused by its site's CORS: Steam's directory and Valve's
        // client files, which the session frame fetches itself.
        fetchable: new RegExp(String.raw`^https://(api\.steampowered\.com/ISteamDirectory/`
            + String.raw`|client-update\.akamai\.steamstatic\.com/)`),
        // What a page is refused by Safari, which applies no ruleset's response headers
        // to it: Steam's content servers and its art (rules/steam.json, rules 2 and 3).
        readable: new RegExp(String.raw`^https://([a-z0-9-]+\.)*`
            + String.raw`(steamcontent\.com|steampipe\.akamaized\.net|steamstatic\.com)/`) });
}

chrome.runtime.onMessage.addListener((/** @type {any} */ message, /** @type {any} */ sender)=>{
    if (sender.id === chrome.runtime.id && sender.tab
        && !sender.url?.startsWith(chrome.runtime.getURL('')) && message?.switch)
    {
        switchRulesets(chrome, typeof message.switch === 'object' ? message.switch : {})
            .catch(()=>{});
    }
    return false;
});
