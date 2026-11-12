/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GOG's store in GameHub against a GOG made up here: the session's refresh
 * token traded and replaced, the library, and what an install is given.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { gogStore } from './store.js';
import { SIGN_IN_URL, codeOf } from './auth.js';

/** @param {any} body @param {number} [status] */
const json = (body, status = 200)=>new Response(JSON.stringify(body), { status });

const BUILD = { baseProductId: '100', installDirectory: 'Game', dependencies: ['DirectX'],
    products: [{ productId: '100', name: 'Game' }, { productId: '200', name: 'Owned DLC' },
        { productId: '300', name: 'Other DLC' }],
    depots: [{ productId: '100', manifest: 'a', languages: ['*'], size: 1 },
        { productId: '200', manifest: 'b', languages: ['*'], size: 1 },
        { productId: '300', manifest: 'c', languages: ['*'], size: 1 }] };

/**
 * @param {{ builds?: any, cdn?: string, refuse?: boolean }} [options]
 */
function gog({ builds, cdn = 'https://gog-cdn-fastly.gog.com', refuse = false } = {}){
    /** @type {{ accountName: string, refreshToken: string } | null} */
    let session = { accountName: 'tester', refreshToken: 'r0' };
    let issued = 0;
    /** @type {string[]} */
    const asked = [];
    const vault = {
        get: async()=>(session ? { accountName: session.accountName } : null),
        token: async()=>session,
        renew: async(/** @type {string} */ refreshToken)=>{
            session = session && { ...session, refreshToken };
        },
        signOut: async()=>{
            session = null;
        },
    };
    /** @param {string | URL | Request} input @param {RequestInit} [init] */
    const get = async(input, init)=>{
        const url = new URL(String(input));
        asked.push(url.href);
        const bearer = new Headers(init?.headers).get('Authorization');
        if (url.host === 'auth.gog.com' && url.pathname === '/token')
        {
            if (refuse || url.searchParams.get('refresh_token') !== `r${issued}`)
            {
                return json({ error: 'invalid_grant' }, 400);
            }
            issued++;
            return json({ access_token: `a${issued}`, refresh_token: `r${issued}`, expires_in: 3600,
                user_id: '9' });
        }
        const signed = bearer === `Bearer a${issued}`;
        if (url.href === 'https://embed.gog.com/user/data/games')
        {
            return signed ? json({ owned: [100, 200, 999] }) : json({}, 401);
        }
        if (url.pathname === '/products')
        {
            return json(url.searchParams.get('ids')?.split(',').map(id=>({ id: Number(id),
                title: id === '100' ? 'Game' : `Thing ${id}`,
                game_type: id === '200' ? 'dlc' : 'game',
                content_system_compatibility: { windows: id === '100' },
                images: { logo2x: `//images.gog-statics.com/${id}_logo.jpg`,
                    background: `//images.gog-statics.com/${id}_bg.jpg` } })));
        }
        if (url.pathname.startsWith('/v2/games/'))
        {
            return json({ _links: { boxArtImage: {
                href: `https://images.gog-statics.com/${url.pathname.slice(10)}_box.jpg` } } });
        }
        if (url.pathname === '/products/100/os/windows/builds')
        {
            return signed ? json(builds ?? { items: [
                { build_id: '2', branch: null, generation: 2, link: 'https://cdn.example/build' }] })
                : json({}, 401);
        }
        if (url.href === 'https://cdn.example/build')
        {
            return new Response(deflateSync(JSON.stringify(BUILD)));
        }
        const secure = /^\/products\/(\d+)\/secure_link$/.exec(url.pathname);
        if (secure)
        {
            return signed ? json({ urls: [{ url_format: '{base_url}/token={token}{path}',
                parameters: { base_url: cdn, token: 't', path: `/store/${secure[1]}` },
                priority: 1 }] }) : json({}, 401);
        }
        if (url.pathname === '/dependencies/repository')
        {
            return json({ repository_manifest: 'https://gog-cdn-fastly.gog.com/repo' });
        }
        if (url.pathname === '/open_link')
        {
            return json({ urls: [{ url_format: 'https://gog-cdn-fastly.gog.com/deps',
                parameters: {}, priority: 1 }] });
        }
        return json({}, 404);
    };
    return { store: gogStore({ vault, fetch: /** @type {typeof fetch} */ (get) }), asked,
        session: ()=>session };
}

const ask = (/** @type {any} */ store, /** @type {string} */ op, args = {})=>
    store.ops[op](args, ()=>{}, new AbortController().signal);

test('GOG\'s login page, and the code in the address it ends at', ()=>{
    assert.match(SIGN_IN_URL, /^https:\/\/auth\.gog\.com\/auth\?client_id=\d+&redirect_uri=/);
    assert.equal(codeOf('https://embed.gog.com/on_login_success?origin=client&code=xyz'), 'xyz');
    assert.equal(codeOf('https://elsewhere.example/on_login_success?code=xyz'), null);
});

test('each refresh token is used once and the next one kept; a refused one ends the session',
    async()=>{
        const one = gog();
        assert.deepEqual(await ask(one.store, 'account'), { name: 'tester' });
        await ask(one.store, 'list');
        assert.equal(one.session()?.refreshToken, 'r1', 'GOG\'s next refresh token is kept');
        assert.deepEqual(await ask(one.store, 'account', { fresh: true }), { name: 'tester' });
        assert.equal(one.session()?.refreshToken, 'r2');

        const refused = gog({ refuse: true });
        assert.equal(await ask(refused.store, 'account', { fresh: true }), null);
        assert.equal(refused.session(), null, 'a refused refresh signs the account out');
        assert.deepEqual(await ask(refused.store, 'list'), []);
    });

test('the library: the account\'s games, not its DLC, with GOG\'s art', async()=>{
    const { store } = gog();
    const games = await ask(store, 'list');
    assert.deepEqual(games.map((/** @type {any} */ one)=>[one.id, one.name, one.installable]),
        [['100', 'Game', true], ['999', 'Thing 999', false]]);
    assert.deepEqual(games[0].covers, {
        header: 'https://images.gog-statics.com/100_logo.jpg',
        capsule: 'https://images.gog-statics.com/100_box.jpg',
        hero: 'https://images.gog-statics.com/100_bg.jpg' });
    assert.equal(await ask(store, 'cover', { game: '100', kind: 'hero' }),
        'https://images.gog-statics.com/100_bg.jpg');
});

test('an install is given the build, the owned products\' depots and a link to each', async()=>{
    const { store } = gog();
    const plan = await ask(store, 'download', { game: '100' });
    assert.deepEqual(plan.build.depots.map((/** @type {any} */ one)=>one.productId), ['100', '200'],
        'a DLC the account does not own is left out');
    assert.deepEqual(Object.keys(plan.links), ['100', '200']);
    assert.equal(plan.links[200].urls[0].parameters.path, '/store/200');
    assert.deepEqual(plan.dependencies, { manifest: 'https://gog-cdn-fastly.gog.com/repo',
        link: { urls: [{ url_format: 'https://gog-cdn-fastly.gog.com/deps', parameters: {},
            priority: 1 }] } });
    await assert.rejects(ask(store, 'download', { game: '555' }), /does not own product 555/);
    await assert.rejects(ask(store, 'download', { game: '../x' }), /not a product id/);
});

test('a CDN the page cannot read, or a first-generation build, is said', async()=>{
    await assert.rejects(ask(gog({ cdn: 'https://unknown.example' }).store, 'download',
        { game: '100' }), /no CDN this browser can reach \(https:\/\/unknown\.example\)/);
    await assert.rejects(ask(gog({ builds: { items: [{ build_id: '1', branch: null,
        generation: 1, link: 'x' }] } }).store, 'download', { game: '100' }),
    /first generation/);
});
