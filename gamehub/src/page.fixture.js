/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A page's side of GameHub, as a launcher writes it, for the extension's
 * integration tests and its bench: a script defining `ask(op, args)`, which
 * asks `hello` of the content script and every other op of the store's
 * session frame, embedded on first use, between the page's origin and the
 * extension's alone - or, where GameHub runs the stores in a tab of their
 * sites (`transport: 'tab'`), of the content script too. `window.frameStyle`
 * sets the frame's CSS; by default a pixel, shown but not seen.
 */

export const PAGE_CLIENT = `
let n = 0;
// wire.js's fromWire, as the launcher reads an answer that crossed a port.
const fromWire = value => {
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
    if (Array.isArray(value)) return value.map(fromWire);
    if (value && typeof value === 'object') {
        if (typeof value.$bytes === 'string') {
            return Uint8Array.from(atob(value.$bytes), c => c.charCodeAt(0));
        }
        if (typeof value.$bigint === 'string') return BigInt(value.$bigint);
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromWire(v)]));
    }
    return value;
};
const askOf = (target, origin, op, args) => new Promise((resolve, reject) => {
    const id = ++n;
    const heard = e => {
        if (e.origin !== origin || e.source !== target || e.data?.from !== 'bottlify-gamehub'
            || e.data.id !== id || e.data.event) return;
        removeEventListener('message', heard);
        'error' in e.data ? reject(new Error(e.data.error)) : resolve(fromWire(e.data.result));
    };
    addEventListener('message', heard);
    target.postMessage({ to: 'bottlify-gamehub', id, op, args }, origin);
});
const frames = {};
const frameOf = store => frames[store] ??= (async () => {
    const { origin } = await askOf(window, location.origin, 'hello');
    const frame = document.createElement('iframe');
    frame.src = origin + '/' + store + '/session.html';
    frame.style.cssText = window.frameStyle ?? 'position:fixed;left:0;bottom:0;width:1px;'
        + 'height:1px;border:0;opacity:0;pointer-events:none';
    await new Promise(ready => {
        const heard = e => {
            if (e.source !== frame.contentWindow || e.origin !== origin || !e.data?.ready) return;
            removeEventListener('message', heard);
            ready();
        };
        addEventListener('message', heard);
        document.body.append(frame);
    });
    return { target: frame.contentWindow, origin };
})();
let greeted = null;
window.ask = async (op, args) => {
    if (op === 'hello') return askOf(window, location.origin, op, args);
    greeted ??= askOf(window, location.origin, 'hello');
    if ((await greeted).transport === 'tab') return askOf(window, location.origin, op, args);
    const { target, origin } = await frameOf(args.store);
    return askOf(target, origin, op, args);
};
// GameHub's fetch as the launcher reads it (storeFetch): a body past a
// mebibyte in its parts, then the status, as a Response.
window.hubFetch = url => new Promise((resolve, reject) => {
    const id = ++n;
    const parts = [];
    const heard = e => {
        if (e.origin !== location.origin || e.data?.from !== 'bottlify-gamehub'
            || e.data.id !== id) return;
        if (e.data.event === 'part') { parts.push(fromWire(e.data.data.body)); return; }
        removeEventListener('message', heard);
        if ('error' in e.data) { reject(new Error(e.data.error)); return; }
        const { status, body, parts: said } = fromWire(e.data.result);
        if (said !== undefined && said !== parts.length) {
            reject(new Error(parts.length + ' of ' + said + ' parts'));
            return;
        }
        resolve(new Response(said === undefined ? body : new Blob(parts), { status }));
    };
    addEventListener('message', heard);
    postMessage({ to: 'bottlify-gamehub', id, op: 'fetch', args: { url } }, location.origin);
});
`;
