/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The build whose stores run in a tab of their sites (relay.js,
 * tab-session.js), in one process: a page's content script asking over a
 * port, the worker relaying, the store's tab answering with the store made
 * up at the protocol's level -- ports that carry JSON alone, as a browser's
 * do -- to see what reaches the page, where the token goes, and which tab
 * is listened to.
 */

import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { startRelay } from './relay.js';
import { runTab } from './tab-session.js';
import { fromWire, toWire } from './wire.js';
import { steamStore } from './stores/steam/store.js';
import { TOKEN, fakeSteam } from './stores/steam/steam.fixture.js';

const SITE = 'https://steamcommunity.com/';
// No server there: its config.json is not read, and every store is on.
const LAUNCHER = 'http://127.0.0.1:9/';
const tick = ()=>new Promise(done=>setTimeout(done, 0));

/** One end of a port; what is posted reaches the other end as JSON, later. */
/** @param {string} name @param {any} sender */
function portPair(name, sender){
    /** @param {any} other @param {any} own */
    const end = (other, own)=>({
        name, sender: own, other, gone: false,
        heard: /** @type {Function[]} */ ([]), left: /** @type {Function[]} */ ([]),
        onMessage: { owner: /** @type {any} */ (null), addListener(/** @type {Function} */ f){
            this.owner.heard.push(f);
        } },
        onDisconnect: { owner: /** @type {any} */ (null), addListener(/** @type {Function} */ f){
            this.owner.left.push(f);
        } },
        /** @param {any} message */
        postMessage(message){
            if (this.gone)
            {
                throw new Error('the port is gone');
            }
            const json = JSON.stringify(message);
            const to = this.other;
            setTimeout(()=>!to.gone
                && to.heard.forEach((/** @type {Function} */ f)=>f(JSON.parse(json))), 0);
        },
        disconnect(){
            for (const one of [this, this.other])
            {
                if (!one.gone)
                {
                    one.gone = true;
                    const away = one === this ? this.other : this;
                    setTimeout(()=>away.left.forEach((/** @type {Function} */ f)=>f()), 0);
                }
            }
        },
    });
    const a = /** @type {any} */ (end(null, undefined));
    const b = /** @type {any} */ (end(a, sender));
    a.other = b;
    for (const one of [a, b])
    {
        one.onMessage.owner = one;
        one.onDisconnect.owner = one;
    }
    return [a, b];
}

/**
 * A browser of one extension: its worker's runtime, its tabs, and the tabs of
 * a store's site, each running the store's side when it is one the worker opened.
 */
function browser({ idleMs = 300, windowsWithoutTabs = false, answerMs = 60_000,
    stuck = false } = {}){
    const steam = fakeSteam();
    const disk = { session: /** @type {any} */ (
        { accountName: 'someone', refreshToken: TOKEN, id: 'a' }) };
    /** @type {Function[]} */
    const connected = [];
    /** @type {Function[]} */
    const removed = [];
    /** @type {Map<number, { url: string, active: boolean, window?: boolean }>} */
    const tabs = new Map();
    let nextTab = 10;
    const kept = /** @type {Record<string, any>} */ ({});
    /** Everything any tab port carried, both ways. */
    const carried = /** @type {string[]} */ ([]);
    /** What tabs.update was asked, in order. @type {any[]} */
    const updated = [];
    /** Each tab's side that ran, closed or not. @type {any[]} */
    const ran = [];

    /** @param {string} name @param {any} sender */
    const connect = (name, sender)=>{
        const [mine, theirs] = portPair(name, sender);
        for (const end of [mine, theirs])
        {
            const post = end.postMessage.bind(end);
            end.postMessage = (/** @type {any} */ message)=>{
                carried.push(JSON.stringify(message));
                post(message);
            };
        }
        setTimeout(()=>connected.forEach(f=>f(theirs)), 0);
        return mine;
    };
    const manifest = { version: '0.1.0',
        declarative_net_request: { rule_resources: [{ id: 'steam' }] } };

    /** A tab's own browser: its content script's runtime. @param {number} tabId @param {string} url */
    const inTab = (tabId, url)=>({
        runtime: { id: 'gamehub', getManifest: ()=>manifest,
            connect: (/** @type {{ name: string }} */ { name })=>connect(name,
                { id: 'gamehub', tab: { id: tabId }, url }) },
    });

    /** @param {number} tabId @param {string} url */
    const load = (tabId, url)=>{
        const asked = new URL(url).searchParams;
        // A sign-in's page is a person's to use: the tests speak for it.
        if (url.startsWith(SITE) && asked.get('bottlify-gamehub')
            && asked.get('mode') === 'session')
        {
            ran.push(runTab({ chrome: inTab(tabId, url),
                nonce: /** @type {string} */ (asked.get('bottlify-gamehub')),
                store: /** @type {string} */ (asked.get('store')),
                mode: /** @type {string} */ (asked.get('mode')),
                make: vault=>steamStore({ vault, steam }) }));
        }
    };

    const chrome = {
        runtime: { id: 'gamehub', getManifest: ()=>manifest,
            onConnect: { addListener: (/** @type {Function} */ f)=>connected.push(f) } },
        storage: { session: {
            get: async(/** @type {string} */ key)=>({ [key]: kept[key] }),
            set: async(/** @type {Record<string, any>} */ values)=>Object.assign(kept, values),
        } },
        declarativeNetRequest: {
            updateEnabledRulesets: async()=>{},
            getEnabledRulesets: async()=>['steam'],
        },
        tabs: {
            create: async(/** @type {{ url: string, active: boolean }} */ { url, active })=>{
                const id = ++nextTab;
                tabs.set(id, { url, active });
                setTimeout(()=>load(id, url), 0);
                return { id };
            },
            get: async(/** @type {number} */ id)=>{
                if (!tabs.has(id))
                {
                    throw new Error(`no tab ${id}`);
                }
                return { id, windowId: 1 };
            },
            /** @param {number} id @param {any} props */
            update: async(id, props)=>{
                updated.push([id, props]);
            },
            remove: async(/** @type {number} */ id)=>{
                if (tabs.delete(id))
                {
                    removed.forEach(f=>f(id));
                }
            },
            onRemoved: { addListener: (/** @type {Function} */ f)=>removed.push(f) },
            // A window's tab, by the window's id, which is its tab's id plus 1000 here.
            query: async(/** @type {{ windowId: number }} */ { windowId })=>
                (tabs.has(windowId - 1000) ? [{ id: windowId - 1000 }] : []),
        },
        windows: {
            create: async(/** @type {{ url: string }} */ { url })=>{
                const id = ++nextTab;
                tabs.set(id, { url, active: true, window: true });
                setTimeout(()=>load(id, url), 0);
                // Safari's answer leaves the tabs out.
                return windowsWithoutTabs ? { id: id + 1000 } : { id: id + 1000, tabs: [{ id }] };
            },
            update: async()=>{},
        },
    };
    if (stuck)
    {
        // The first tab's: stopped part way, as Safari leaves a tab in the background.
        const answered = steam.ownedApps;
        let first = true;
        steam.ownedApps = ()=>{
            const now = first;
            first = false;
            return now ? new Promise(()=>{}) : answered();
        };
    }
    const relay = startRelay({ chrome, idleMs, closeSignInMs: 0, lostMs: 50, answerMs,
        sites: { steam: SITE }, fetchable: /^https:\/\/api\.steampowered\.com\//,
        vaultOf: ()=>({ get: async()=>disk.session, set: async session=>{
            disk.session = session;
        } }) });

    /** A launcher page's content script: its port to the worker, and what it was answered. */
    const page = ()=>{
        const port = connect('gamehub-page', { id: 'gamehub', tab: { id: 1 }, url: LAUNCHER,
            origin: new URL(LAUNCHER).origin });
        const answers = /** @type {any[]} */ ([]);
        port.onMessage.addListener((/** @type {any} */ one)=>answers.push(fromWire(one)));
        let next = 0;
        /** @param {string} op @param {Record<string, any>} [args] */
        const ask = async(op, args = {})=>{
            const id = ++next;
            port.postMessage({ id, op, args });
            for (let i = 0; i < 400; i++)
            {
                const done = answers.find(one=>one.id === id
                    && ('result' in one || 'error' in one));
                if (done)
                {
                    return done;
                }
                await new Promise(resolve=>setTimeout(resolve, 5));
            }
            throw new Error(`${op} was not answered`);
        };
        return { port, answers, ask };
    };
    /** Every tab's side stopped: its pings and its store. */
    const done = ()=>{
        for (const one of ran)
        {
            one?.stop();
        }
    };
    return { chrome, relay, steam, disk, tabs, carried, connect, page, inTab, done, updated };
}

test('a page\'s ops run in an inactive tab of the store\'s site, the token kept from the page',
    async()=>{
        const one = browser();
        const { ask, answers } = one.page();
        assert.deepEqual((await ask('account', { store: 'steam' })).result, { name: 'someone' });
        const [opened] = [...one.tabs.values()];
        assert.equal(opened.active, true, 'in front: Safari stops a tab in the background');
        assert.match(opened.url, /^https:\/\/steamcommunity\.com\/\?bottlify-gamehub=[0-9a-f-]{36}&store=steam&mode=session$/);
        const download = (await ask('download', { store: 'steam', game: '70' })).result;
        assert.equal(download.depots.length, 2);
        assert.ok(download.depots.every((/** @type {any} */ d)=>d.key instanceof Uint8Array
            && d.key.length === 32), 'a key reaches the page as bytes');
        const run = (await ask('runData', { store: 'steam', game: '400' })).result.win32.steam;
        assert.deepEqual([...run.ownershipTickets[400]], [4, 0, 0, 0]);
        assert.equal(one.tabs.size, 1, 'one tab for every op');
        assert.equal(one.steam.asked.filter(asked=>asked.startsWith('logOn')).length, 1);
        assert.doesNotMatch(JSON.stringify(toWire(answers)), /secret-signature|eyJ/);
        assert.ok(one.carried.some(message=>message.includes('secret-signature')),
            'the token goes from the worker to the tab alone');
        one.done();
    });

test('a tab that does not say the nonce it was opened with is closed and not listened to',
    async()=>{
        const one = browser();
        const { ask } = one.page();
        await ask('account', { store: 'steam' });
        const id = 99;
        one.tabs.set(id, { url: `${SITE}?bottlify-gamehub=made-up&store=steam&mode=session`,
            active: true });
        const port = one.connect('gamehub-tab', { id: 'gamehub', tab: { id }, url: SITE });
        const heard = /** @type {any[]} */ ([]);
        port.onMessage.addListener((/** @type {any} */ m)=>heard.push(m));
        port.postMessage({ hello: { nonce: 'made-up', store: 'steam', mode: 'session' } });
        port.postMessage({ call: 1, vault: 'get' });
        for (let i = 0; i < 20; i++)
        {
            await tick();
        }
        assert.equal(one.tabs.has(id), false, 'closed');
        assert.deepEqual(heard, [], 'never answered, the session least of all');
        one.done();
    });

test('a sign-in is a window of the site, which ends once the session is kept', async()=>{
    const one = browser();
    one.disk.session = null;
    const { ask } = one.page();
    const signing = ask('signIn', { store: 'steam' });
    for (let i = 0; i < 20; i++)
    {
        await tick();
    }
    const [id, shown] = [...one.tabs].find(([, tab])=>tab.window) ?? [];
    assert.ok(shown, 'a window opened');
    assert.match(shown.url, /mode=signin$/);
    // What the sign-in page does when Steam has answered: the session into the vault.
    const port = one.connect('gamehub-tab', { id: 'gamehub', tab: { id }, url: shown.url });
    port.postMessage({ hello: { nonce: new URL(shown.url).searchParams.get('bottlify-gamehub'),
        store: 'steam', mode: 'signin' } });
    port.postMessage({ call: 1, vault: 'set',
        session: { accountName: 'newcomer', refreshToken: TOKEN, id: 'b' } });
    assert.deepEqual((await signing).result, { name: 'newcomer' });
    assert.equal(one.disk.session.accountName, 'newcomer');
    for (let i = 0; i < 20 && one.tabs.has(/** @type {number} */ (id)); i++)
    {
        await tick();
    }
    assert.equal(one.tabs.has(/** @type {number} */ (id)), false, 'the window closed');
    assert.deepEqual((await ask('account', { store: 'steam' })).result, { name: 'newcomer' });
    one.done();
});

test('a sign-in window closed first is said; a tab not asked for a while is closed', async()=>{
    const one = browser({ idleMs: 20 });
    one.disk.session = null;
    const { ask } = one.page();
    const signing = ask('signIn', { store: 'steam' });
    for (let i = 0; i < 20; i++)
    {
        await tick();
    }
    const [id] = [...one.tabs].find(([, tab])=>tab.window) ?? [];
    await one.chrome.tabs.remove(/** @type {number} */ (id));
    assert.match((await signing).error, /sign-in window was closed/);
    assert.equal(one.tabs.size, 0);
    one.disk.session = { accountName: 'someone', refreshToken: TOKEN, id: 'a' };
    assert.deepEqual((await ask('account', { store: 'steam' })).result, { name: 'someone' });
    assert.equal(one.tabs.size, 1);
    await new Promise(done=>setTimeout(done, 80));
    assert.equal(one.tabs.size, 0, 'the idle tab closed');
    assert.deepEqual(one.updated.at(-1), [1, { active: true }], 'the page\'s tab in front again');
    assert.deepEqual((await ask('account', { store: 'steam' })).result, { name: 'someone' },
        'and opened again');
    one.done();
});

test('a window answered without its tabs is one window, and its sign-in is told it went',
    async()=>{
        const one = browser({ windowsWithoutTabs: true });
        one.disk.session = null;
        const { ask } = one.page();
        const signing = ask('signIn', { store: 'steam' });
        for (let i = 0; i < 20; i++)
        {
            await tick();
        }
        const opened = [...one.tabs];
        assert.equal(opened.length, 1, 'no second tab beside the window');
        const [[id, shown]] = opened;
        // The sign-in page said its nonce, then lost its port: the window closed
        // without the browser saying the tab went, or the page left Steam's.
        const port = one.connect('gamehub-tab', { id: 'gamehub', tab: { id }, url: shown.url });
        port.postMessage({ hello: { nonce: new URL(shown.url).searchParams.get('bottlify-gamehub'),
            store: 'steam', mode: 'signin' } });
        for (let i = 0; i < 20; i++)
        {
            await tick();
        }
        port.disconnect();
        const ended = await signing;
        assert.match(ended.error, /sign-in window was closed or left Steam's page/);
        assert.equal(one.tabs.has(id), false, 'and closed');
        one.done();
    });

test('nobody signed in: answered without a tab of the site', async()=>{
    const one = browser();
    one.disk.session = null;
    const { ask } = one.page();
    assert.equal((await ask('account', { store: 'steam' })).result, null);
    assert.deepEqual((await ask('list', { store: 'steam', fresh: true })).result, []);
    assert.deepEqual((await ask('runData', { store: 'steam', game: '400' })).result, {});
    assert.deepEqual((await ask('signOut', { store: 'steam' })).result, {});
    assert.equal(one.tabs.size, 0, 'no tab opened to say there is no account');
    const cover = (await ask('cover', { store: 'steam', game: '440', kind: 'header' })).result;
    assert.match(cover, /\/440\/header\.jpg$/, 'an op the store answers anyone still goes to it');
    assert.equal(one.tabs.size, 1);
    one.done();
});

test('the worker decompresses for a tab, a store\'s formats alone', async()=>{
    const one = browser();
    const { ask } = one.page();
    await ask('account', { store: 'steam' });
    const [[id, opened]] = [...one.tabs];
    // The driven tab's own port, as its page would make it again.
    const port = one.connect('gamehub-tab', { id: 'gamehub', tab: { id }, url: opened.url });
    const heard = /** @type {any[]} */ ([]);
    port.onMessage.addListener((/** @type {any} */ m)=>heard.push(m));
    port.postMessage({ hello: { nonce: new URL(opened.url).searchParams.get('bottlify-gamehub'),
        store: 'steam', mode: 'session' } });
    const text = 'a CM message, '.repeat(50);
    port.postMessage({ call: 1, inflate: toWire(new Uint8Array(gzipSync(text))), format: 'gzip' });
    port.postMessage({ call: 2, inflate: toWire(Uint8Array.of(1)), format: 'brotli' });
    for (let i = 0; i < 100 && heard.length < 2; i++)
    {
        await new Promise(done=>setTimeout(done, 5));
    }
    const inflated = heard.find(m=>m.call === 1);
    assert.equal(new TextDecoder().decode(fromWire(inflated.result)), text);
    assert.match(heard.find(m=>m.call === 2).error, /not a store's data/);
    one.done();
});

test('a store GameHub does not have is refused without a tab', async()=>{
    const one = browser();
    const { ask } = one.page();
    assert.match((await ask('account', { store: 'gog' })).error, /no store gog/);
    assert.equal(one.tabs.size, 0);
});

test('bytes and big integers cross a port and come back as they were', ()=>{
    const value = { key: Uint8Array.of(0, 1, 255), id: 76561197960265729n,
        list: [Uint8Array.of(7)], text: 'x', none: null };
    const back = fromWire(JSON.parse(JSON.stringify(toWire(value))));
    assert.deepEqual(back, value);
});

test('a tab stuck on an op is answered for and closed, and the next op is a new tab\'s', async()=>{
    const one = browser({ answerMs: 1000, stuck: true });
    const { ask } = one.page();
    assert.match((await ask('list', { store: 'steam' })).error, /did not answer list in 1 s/);
    for (let i = 0; i < 20 && one.tabs.size > 0; i++)
    {
        await tick();
    }
    assert.equal(one.tabs.size, 0, 'the stuck tab closed');
    assert.deepEqual((await ask('account', { store: 'steam' })).result, { name: 'someone' },
        'a new tab answers');
    one.done();
});
