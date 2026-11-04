/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GameHub where a store's protocol cannot run in the extension's own page:
 * Safari applies no ruleset to a request an extension makes itself (WebKit bug
 * 253696), so the CM socket of an extension page goes out under the
 * extension's Origin and Steam closes it. There the store runs in a tab of
 * the store's own site, which GameHub opens and drives (tab-session.js): a
 * socket that page opens has the site's Origin and needs no rule. Everything
 * else is as in the session frame (frame.js): the same protocol, the same
 * store and the session kept in the extension's database, which this worker
 * reads for the tab.
 *
 * The service worker relays between the two over ports: a launcher page's
 * content script (`gamehub-page`) asks, the store's tab (`gamehub-tab`)
 * answers. A tab is the driven one only if it says the nonce its address was
 * opened with; any other is closed, as a link to the site carrying a made-up
 * one would be. A tab not asked anything for a while is closed. A sign-in is
 * a tab of its own, shown in a window, which ends once the session is kept.
 */

import { vaultFor } from './vault.js';
import { configOf, switchRulesets, wantedBy } from './rulesets.js';
import { toWire } from './wire.js';
import { SIGNED_OUT, TO } from './protocol.js';

export const PAGE_PORT = 'gamehub-page';
export const TAB_PORT = 'gamehub-tab';

/** Where the driven tabs are noted, to be known again by a worker the browser restarted. */
const NOTED = 'gamehub-tabs';
/** How long a tab is given to load the store's site and say its nonce. */
const LOAD_MS = 30_000;
/** How long the database is given to answer: a stall is said, not waited on. */
const VAULT_MS = 15_000;
/** How long a site's configuration is waited on before every store is taken as on. */
const CONFIG_MS = 5_000;
/**
 * How long a sign-in's tab that lost its port is given to say its nonce
 * again: a worker the browser restarted is back at once, a window closed or
 * a page left (the nonce goes with its address) never is.
 */
const LOST_MS = 3_000;

/** @param {Promise<any>} promise @param {number} ms @param {string} what */
const within = (promise, ms, what)=>{
    /** @type {any} */
    let timer;
    return Promise.race([promise, new Promise((_, reject)=>{
        timer = setTimeout(()=>reject(new Error(what)), ms);
    })]).finally(()=>clearTimeout(timer));
};

/**
 * @typedef {Object} Tab
 * @property {number} tabId
 * @property {string} nonce
 * @property {any} port  Null until the tab has said its nonce, and after it went.
 * @property {Array<(port: any) => void>} waiting  Given its port, or null once it is closed.
 * @property {any} [idle]
 */

/**
 * @param {Object} options
 * @param {any} options.chrome
 * @param {Record<string, string>} options.sites  Each store's site: `https://steamcommunity.com/`.
 * @param {RegExp} options.fetchable  The addresses a tab may have fetched for it: its
 *     store's directory and client files, which the site's CORS would refuse it.
 * @param {(store: string) => { get(): Promise<any>, set(session: any): Promise<void> }}
 *     [options.vaultOf]
 * @param {number} [options.idleMs]
 * @param {number} [options.closeSignInMs]  How long a sign-in's window shows it is done.
 * @param {number} [options.lostMs]  How long a sign-in's tab that lost its port is waited on.
 */
export function startRelay({ chrome, sites, fetchable, vaultOf = vaultFor, idleMs = 60_000,
    closeSignInMs = 1500, lostMs = LOST_MS })
{
    const area = chrome.storage.session ?? chrome.storage.local;
    /** By `<store>/<mode>`. @type {Map<string, Tab>} */
    const tabs = new Map();
    const restored = Promise.resolve(area.get(NOTED)).then((/** @type {any} */ kept)=>{
        for (const [key, one] of Object.entries(kept?.[NOTED] ?? {}))
        {
            const { tabId, nonce } = /** @type {any} */ (one);
            tabs.set(key, { tabId, nonce, port: null, waiting: [] });
        }
    }).catch(()=>{});
    const note = ()=>area.set({ [NOTED]: Object.fromEntries([...tabs]
        .map(([key, { tabId, nonce }])=>[key, { tabId, nonce }])) });

    /** @type {Map<string, ReturnType<typeof vaultFor>>} */
    const vaults = new Map();
    /** @param {string} store */
    const vault = store=>{
        let one = vaults.get(store);
        if (!one)
        {
            one = vaultOf(store);
            vaults.set(store, one);
        }
        return one;
    };

    /** Requests relayed and not answered, by the id the tab is asked under. */
    const asked = /** @type {Map<number, { port: any, id: number, key: string }>} */ (new Map());
    let next = 0;
    /** Sign-ins a page waits on, by store. */
    const signIns = /** @type {Map<string, Array<{ port: any, id: number }>>} */ (new Map());
    /** The site's switches the last page asking came with. @type {Promise<string[]> | null} */
    let enabled = null;

    /** @param {string} key */
    const pending = key=>[...asked.values()].some(one=>one.key === key);

    /** @param {string} key */
    async function close(key){
        const tab = tabs.get(key);
        if (!tab)
        {
            return;
        }
        tabs.delete(key);
        clearTimeout(tab.idle);
        await note();
        await chrome.tabs.remove(tab.tabId).catch(()=>{});
    }

    /** @param {string} key */
    function rest(key){
        const tab = tabs.get(key);
        if (!tab || key.endsWith('/signin'))
        {
            return;
        }
        clearTimeout(tab.idle);
        tab.idle = setTimeout(()=>!pending(key) && close(key), idleMs);
    }

    /**
     * A window of its own for a sign-in, a person looking at it; a tab where
     * there are no windows (a phone). A window made is never followed by a
     * tab: Safari answers a made window without its tabs, which are asked for.
     */
    async function shown(/** @type {string} */ url){
        /** @type {any} */
        let made;
        try
        {
            made = await chrome.windows.create({ url, type: 'popup', focused: true,
                width: 520, height: 760 });
        }
        catch
        {
            return (await chrome.tabs.create({ url, active: true })).id;
        }
        const id = made?.tabs?.[0]?.id
            ?? (await chrome.tabs.query({ windowId: made?.id }).catch(()=>[]))[0]?.id;
        if (!Number.isInteger(id))
        {
            throw new Error('the sign-in window opened with no tab in it');
        }
        return id;
    }

    /**
     * The store's tab in a mode, open and having said its nonce.
     *
     * @param {string} store @param {'session' | 'signin'} mode
     * @returns {Promise<any>}  Its port.
     */
    async function tabOf(store, mode){
        await restored;
        const key = `${store}/${mode}`;
        let tab = tabs.get(key);
        if (tab && !await chrome.tabs.get(tab.tabId).then(()=>true, ()=>false))
        {
            tabs.delete(key);
            tab = undefined;
        }
        if (!tab)
        {
            const nonce = crypto.randomUUID();
            const url = `${sites[store]}?bottlify-gamehub=${nonce}&store=${store}&mode=${mode}`;
            const tabId = mode === 'signin' ? await shown(url)
                : (await chrome.tabs.create({ url, active: false })).id;
            tab = { tabId, nonce, port: null, waiting: [] };
            tabs.set(key, tab);
            await note();
        }
        else if (mode === 'signin')
        {
            const { windowId } = await chrome.tabs.get(tab.tabId);
            await chrome.tabs.update(tab.tabId, { active: true }).catch(()=>{});
            await chrome.windows?.update(windowId, { focused: true }).catch(()=>{});
        }
        clearTimeout(tab.idle);
        if (tab.port)
        {
            return tab.port;
        }
        const waiting = /** @type {Tab} */ (tab).waiting;
        const port = await within(new Promise(ready=>waiting.push(ready)), LOAD_MS,
            `${store}'s site did not answer in its tab: the extension may need to be allowed on ${
                new URL(sites[store]).hostname}`);
        if (!port)
        {
            throw new Error(`${store}'s tab was closed before it answered`);
        }
        return port;
    }

    /** @param {any} port @param {Record<string, any>} message */
    function fromPage(port, message){
        const id = Number(message?.id);
        if (!Number.isSafeInteger(id))
        {
            return;
        }
        const store = String(message.args?.store);
        if (!Object.hasOwn(sites, store))
        {
            port.postMessage({ id, error: `no store ${store}` });
            return;
        }
        enabled = port.enabled;
        if (message.op === 'signIn')
        {
            signIns.set(store, [...signIns.get(store) ?? [], { port, id }]);
            tabOf(store, 'signin').catch(e=>{
                const waiting = signIns.get(store) ?? [];
                // One a closed window has already answered is not answered twice.
                if (waiting.some(one=>one.port === port && one.id === id))
                {
                    signIns.set(store, waiting.filter(one=>one.port !== port || one.id !== id));
                    port.postMessage({ id, error: String(e?.message ?? e) });
                }
            });
            return;
        }
        const key = `${store}/session`;
        const relayed = ++next;
        asked.set(relayed, { port, id, key });
        signedOut(store, message.op, port.enabled).then(answer=>{
            if (answer)
            {
                asked.delete(relayed);
                port.postMessage({ id, result: answer.result });
                return null;
            }
            return tabOf(store, 'session').then(tab=>tab.postMessage(
                { request: { to: TO, id: relayed, op: message.op, args: message.args } }));
        }).catch(e=>{
            if (asked.delete(relayed))
            {
                port.postMessage({ id, error: String(e?.message ?? e) });
            }
        });
    }

    /**
     * The protocol's answer to an op with nobody signed in, given here when no
     * session is kept: no tab of the store's site is opened to say there is
     * no account. A store the site has switched off is the tab's to refuse.
     *
     * @param {string} store @param {string} op @param {Promise<string[]>} on
     * @returns {Promise<{ result: unknown } | null>}
     */
    async function signedOut(store, op, on){
        if (!Object.hasOwn(SIGNED_OUT, op) || !(await on).includes(store))
        {
            return null;
        }
        const kept = await within(vault(store).get(), VAULT_MS,
            'the extension\'s database did not answer');
        return kept ? null : { result: SIGNED_OUT[/** @type {keyof typeof SIGNED_OUT} */ (op)] };
    }

    /** @param {any} port */
    function page(port){
        const { sender } = port;
        const origin = sender?.origin ?? (sender?.url ? new URL(sender.url).origin : '');
        // A site that does not answer leaves its stores on, as one with no configuration.
        port.enabled = within(configOf(origin), CONFIG_MS, 'no configuration').catch(()=>({}))
            .then(config=>switchRulesets(chrome, wantedBy(config))).catch(()=>[]);
        port.onMessage.addListener((/** @type {any} */ message)=>fromPage(port, message));
        port.onDisconnect.addListener(()=>{
            for (const [relayed, one] of asked)
            {
                if (one.port === port)
                {
                    asked.delete(relayed);
                    rest(one.key);
                }
            }
            for (const [store, waiting] of signIns)
            {
                signIns.set(store, waiting.filter(one=>one.port !== port));
            }
        });
    }

    /** @param {string} store @param {(one: { port: any, id: number }) => void} each */
    const endSignIns = (store, each)=>{
        for (const one of signIns.get(store) ?? [])
        {
            each(one);
        }
        signIns.delete(store);
    };

    /**
     * What a tab asks of the worker: the session, the site's switches, an address fetched.
     *
     * @param {string} store @param {'session' | 'signin'} mode @param {Record<string, any>} message
     */
    async function call(store, mode, message){
        if (message.vault === 'get')
        {
            return within(vault(store).get(), VAULT_MS, 'the extension\'s database did not answer');
        }
        if (message.vault === 'set')
        {
            await within(vault(store).set(message.session ?? null), VAULT_MS,
                'the extension\'s database did not answer');
            if (mode === 'signin' && message.session)
            {
                const name = String(message.session.accountName);
                endSignIns(store, ({ port, id })=>port.postMessage({ id, result: { name } }));
                setTimeout(()=>close(`${store}/signin`), closeSignInMs);
            }
            return null;
        }
        if (message.enabled)
        {
            return (await enabled) ?? chrome.declarativeNetRequest.getEnabledRulesets();
        }
        if (typeof message.fetch === 'string')
        {
            const url = new URL(message.fetch);
            if (url.protocol !== 'https:' || !fetchable.test(url.href))
            {
                throw new Error(`${url.origin} is not fetched for a store's tab`);
            }
            const answer = await fetch(url.href, { credentials: 'omit' });
            const bytes = new Uint8Array(await answer.arrayBuffer());
            return { status: answer.status, body: toWire(bytes) };
        }
        throw new Error('a tab asked for nothing the worker gives');
    }

    /** @param {any} port */
    function fromTab(port){
        /** @type {{ key: string, store: string, mode: 'session' | 'signin', tab: Tab } | null} */
        let known = null;
        port.onMessage.addListener(async(/** @type {any} */ message)=>{
            if (!known)
            {
                await restored;
                const said = message?.hello;
                const key = `${said?.store}/${said?.mode}`;
                const found = tabs.get(key);
                if (!found || found.nonce !== said?.nonce || found.tabId !== port.sender?.tab?.id)
                {
                    port.disconnect();
                    chrome.tabs.remove(port.sender?.tab?.id).catch(()=>{});
                    return;
                }
                known = { key, store: said.store, mode: said.mode, tab: found };
                found.port = port;
                for (const ready of found.waiting.splice(0))
                {
                    ready(port);
                }
                return;
            }
            if (message.answer)
            {
                const one = asked.get(message.answer.id);
                if (!one)
                {
                    return;
                }
                if (!('event' in message.answer))
                {
                    asked.delete(message.answer.id);
                    rest(one.key);
                }
                one.port.postMessage({ ...message.answer, id: one.id });
            }
            else if (Number.isSafeInteger(message.call))
            {
                const { store, mode } = known;
                const id = message.call;
                call(store, mode, message).then(result=>port.postMessage({ call: id, result }),
                    e=>port.postMessage({ call: id, error: String(e?.message ?? e) }));
            }
        });
        port.onDisconnect.addListener(()=>{
            if (!known || known.tab.port !== port)
            {
                return;
            }
            const { key, tab } = known;
            tab.port = null;
            if (key.endsWith('/signin'))
            {
                setTimeout(()=>{
                    if (tabs.get(key) === tab && !tab.port)
                    {
                        gone(key, 'the sign-in window was closed or left Steam\'s page');
                        chrome.tabs.remove(tab.tabId).catch(()=>{});
                    }
                }, lostMs);
            }
        });
    }

    /**
     * A tab GameHub drove is gone: what waited on it is told, a sign-in too.
     *
     * @param {string} key @param {string} [why]  What a waiting sign-in is told.
     */
    function gone(key, why = 'the sign-in window was closed'){
        const one = tabs.get(key);
        if (!one)
        {
            return;
        }
        tabs.delete(key);
        clearTimeout(one.idle);
        note();
        for (const ready of one.waiting.splice(0))
        {
            ready(null);
        }
        const [store, mode] = key.split('/');
        if (mode === 'signin')
        {
            endSignIns(store, ({ port, id })=>port.postMessage({ id, error: why }));
        }
        for (const [relayed, waiting] of asked)
        {
            if (waiting.key === key)
            {
                asked.delete(relayed);
                waiting.port.postMessage({ id: waiting.id,
                    error: `${store}'s tab was closed before it answered` });
            }
        }
    }

    chrome.runtime.onConnect.addListener((/** @type {any} */ port)=>{
        if (port.sender?.id !== chrome.runtime.id || !port.sender?.tab)
        {
            return;
        }
        if (port.name === PAGE_PORT)
        {
            page(port);
        }
        else if (port.name === TAB_PORT)
        {
            fromTab(port);
        }
    });

    chrome.tabs.onRemoved.addListener((/** @type {number} */ tabId)=>{
        for (const [key, one] of [...tabs])
        {
            if (one.tabId === tabId)
            {
                gone(key);
            }
        }
    });

    return { tabs, asked };
}
