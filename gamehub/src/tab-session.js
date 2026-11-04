/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A store run in a tab of its own site, which the worker opened (relay.js):
 * the session frame's protocol and store as they are (frame.js), the requests
 * and answers over a port to the worker, a CM socket of this page's -- the
 * site's Origin, which Steam takes -- and the session read from the
 * extension's database through the worker, never this site's storage, which
 * the site's own scripts read. A sign-in tab shows the store's sign-in page
 * over the site, in a shadow root the site's scripts and styles do not reach.
 *
 * A content script's world: the site's scripts see none of it, and the worker
 * is the only one it speaks to. The port is made again when the worker was
 * stopped, and what was asked and not answered is asked again: every ask is
 * one that may be.
 */

import { startFrame } from './frame.js';
import { fromWire, toWire } from './wire.js';
import { inflateWith } from './inflate.js';
import { TAB_PORT } from './relay.js';
import { steamStore } from './stores/steam/store.js';
import { mountSignIn } from './stores/steam/signin-ui.js';

/**
 * Each store as a tab runs it.
 *
 * @type {Record<string, {
 *   make: (vault: any, fetch: typeof globalThis.fetch) => import('./hub.js').Store,
 *   signIn: typeof mountSignIn }>}
 */
const STORES = {
    steam: { make: (vault, fetch)=>steamStore({ vault, fetch }), signIn: mountSignIn },
};

/** Messages that keep the worker from being stopped while this tab waits on Steam or a person. */
const PING_MS = 20_000;
/** How long the worker is given to answer what this tab asks: a stall is said, not waited on. */
const CALL_MS = 30_000;

/**
 * @param {Object} options
 * @param {any} options.chrome
 * @param {string} options.nonce  The one the worker opened this tab with.
 * @param {string} options.store
 * @param {string} options.mode  `session` or `signin`.
 * @param {(port: any) => void} [options.onPort]  For a test: each port made.
 * @param {(typeof STORES)[string]['make']} [options.make]  For a test: the store.
 */
export function runTab({ chrome, nonce, store, mode, onPort, make }){
    const made = Object.hasOwn(STORES, store)
        ? { ...STORES[store], ...make ? { make } : {} } : null;
    if (!made || (mode !== 'session' && mode !== 'signin'))
    {
        return null;
    }
    /** @type {Map<number, { body: Record<string, any>, resolve: (v: any) => void,
     *     reject: (e: Error) => void }>} */
    const calls = new Map();
    let next = 0;
    /** @type {any} */
    let port = null;
    /** @type {(request: any) => void} */
    let heard = ()=>{};

    const connect = ()=>{
        port = chrome.runtime.connect({ name: TAB_PORT });
        onPort?.(port);
        port.onMessage.addListener((/** @type {any} */ message)=>{
            if (message?.request)
            {
                heard(message.request);
                return;
            }
            const call = calls.get(message?.call);
            if (call)
            {
                calls.delete(message.call);
                if ('error' in message)
                {
                    call.reject(new Error(message.error));
                }
                else
                {
                    call.resolve(message.result);
                }
            }
        });
        port.onDisconnect.addListener(()=>{
            port = null;
            setTimeout(()=>{
                if (!port)
                {
                    connect();
                }
            }, 100);
        });
        port.postMessage({ hello: { nonce, store, mode } });
        for (const [id, { body }] of calls)
        {
            port.postMessage({ ...body, call: id });
        }
    };
    connect();
    const pinging = setInterval(()=>port?.postMessage({ ping: true }), PING_MS);

    /** @param {Record<string, any>} body */
    const call = body=>new Promise((resolve, reject)=>{
        const id = ++next;
        const timer = setTimeout(()=>{
            calls.delete(id);
            reject(new Error('GameHub did not answer its tab'));
        }, CALL_MS);
        calls.set(id, { body, resolve: (/** @type {any} */ value)=>{
            clearTimeout(timer);
            resolve(value);
        }, reject: (/** @type {Error} */ e)=>{
            clearTimeout(timer);
            reject(e);
        } });
        port?.postMessage({ ...body, call: id });
    });

    /**
     * An address the site's CORS would refuse this page, fetched by the worker.
     *
     * @param {string | URL | Request} url
     */
    const relayedFetch = async url=>{
        const address = String(url instanceof Request ? url.url : url);
        const { status, body } = await call({ fetch: address });
        return new Response(status === 204 || status === 304 ? null : fromWire(body), { status });
    };

    // Safari refuses this world a DecompressionStream: the worker inflates for it.
    inflateWith(async(bytes, format)=>fromWire(await call({ inflate: toWire(bytes), format })));

    const kept = {
        get: ()=>call({ vault: 'get' }),
        set: (/** @type {any} */ session)=>call({ vault: 'set', session }),
    };

    if (mode === 'signin')
    {
        // Done is the worker's to tell the page, once the session is kept.
        overlay().then(root=>made.signIn(root,
            { vault: kept, fetch: relayedFetch, tellDone: ()=>{} }));
        return { stop: ()=>clearInterval(pinging) };
    }
    const frame = startFrame({ store, kept, version: chrome.runtime.getManifest().version,
        make: vault=>made.make(vault, relayedFetch),
        enabled: ()=>call({ enabled: true }),
        toPage: answer=>port?.postMessage({ answer: toWire(answer) }) });
    heard = request=>frame.request(request);
    globalThis.addEventListener?.('pagehide', ()=>frame.close());
    return { stop: ()=>{
        clearInterval(pinging);
        frame.close();
    } };

    /**
     * The store's sign-in page over the site: its markup and styles in a
     * closed shadow root, styled by constructed sheets, which the site's
     * content security policy does not govern. The site under it is held
     * still: it neither scrolls nor takes a touch while the sign-in is shown.
     *
     * @returns {Promise<ShadowRoot>}
     */
    function overlay(){
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;'
            + 'align-items:center;justify-content:center;background:rgba(0,0,0,.6);'
            + 'overflow:auto;overscroll-behavior:contain;touch-action:pan-y';
        // A sheet of its own, not the elements' styles: the site's scripts rewrite those.
        const still = new CSSStyleSheet();
        still.replaceSync('html, body { overflow: hidden !important; '
            + 'overscroll-behavior: none !important; }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, still];
        // Wheel and touch over the overlay stay in it, the page under it unmoved.
        for (const kind of ['wheel', 'touchmove'])
        {
            host.addEventListener(kind, event=>{
                if (event.target === host)
                {
                    event.preventDefault();
                }
            }, { passive: false });
        }
        const root = host.attachShadow({ mode: 'closed' });
        const sheet = document.createElement('div');
        sheet.className = 'sheet';
        root.append(sheet);
        document.documentElement.append(host);
        const ready = fetch(chrome.runtime.getURL(`${store}/signin.html`)).then(page=>page.text())
            .then(html=>{
                const page = new DOMParser().parseFromString(html, 'text/html');
                const styles = new CSSStyleSheet();
                styles.replaceSync(Array.from(page.querySelectorAll('style'))
                    .map(style=>style.textContent).join('\n'));
                root.adoptedStyleSheets = [styles];
                for (const node of Array.from(page.body.childNodes))
                {
                    if (node.nodeName !== 'SCRIPT')
                    {
                        sheet.append(document.importNode(node, true));
                    }
                }
                return root;
            });
        return ready;
    }
}
