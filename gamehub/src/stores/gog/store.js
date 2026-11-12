/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GOG, as GameHub answers a page for it (hub.js), in GOG's session frame
 * (frame.js, session-page.js). The account's session is the extension's
 * database's (`vault`): a refresh token, traded here for an access token as
 * an op needs one and replaced with the one GOG gives back.
 *
 * What a page's install needs (`download`) is what only the account may ask:
 * the build GOG installs, its depots of the products the account owns, and a
 * secure link to each product's chunks; with the dependencies' repository and
 * its link. The manifests and chunks themselves the page reads from GOG's CDN.
 * GOG's games carry no DRM: a run needs nothing of the store (`runData`).
 */

import { refreshed } from './auth.js';

/** @typedef {import('../../hub.js').Store} Store */

/**
 * The session as the store asks it of the extension's database.
 *
 * @typedef {Object} Vault
 * @property {() => Promise<{ accountName: string, id?: string } | null>} get
 * @property {() => Promise<{ accountName: string, refreshToken: string } | null>} token
 * @property {(refreshToken: string) => Promise<void>} renew  GOG's next one, kept.
 * @property {() => Promise<void>} signOut
 */

/** The hosts a page may read GOG's CDN at (rules/gog.json, rule 2): another is refused by CORS. */
export const CDN_HOSTS = Object.freeze(['gog-cdn-fastly.gog.com', 'cdn.gog.com',
    'gog-cdn.gcdn.co', 'gog-cdn-lumen.secure2.footprint.net']);

/** How long an account's games are taken as read. */
const KEPT_MS = 10 * 60_000;

/** Products asked of GOG in one request: what its products endpoint takes. */
const PRODUCTS_BATCH = 50;

/** Box art asked at once: one request a game. */
const ART_JOBS = 6;

/** @param {string} address  GOG writes its images' addresses without a scheme. */
const https = address=>(typeof address === 'string' && address
    ? (address.startsWith('//') ? `https:${address}` : address) : '');

/** @param {Uint8Array} bytes @returns {Promise<any>} */
async function readMeta(bytes){
    const text = bytes[0] === 0x78 ? new Uint8Array(await new Response(new Blob([bytes]).stream()
        .pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()) : bytes;
    return JSON.parse(new TextDecoder().decode(text));
}

/** @param {{ urls?: { url_format?: string, parameters?: Record<string, unknown> }[] }} link */
function reachableOnly(link){
    const urls = (link?.urls ?? []).filter(endpoint=>{
        const base = String(endpoint.parameters?.base_url ?? endpoint.url_format ?? '');
        try
        {
            return CDN_HOSTS.includes(new URL(base.replace(/\{\w+\}/g, '')).hostname);
        }
        catch {
            return false;
        }
    });
    if (urls.length === 0)
    {
        const hosts = (link?.urls ?? []).map(endpoint=>String(endpoint.parameters?.base_url
            ?? endpoint.url_format)).join(', ') || 'none';
        throw new Error(`gog: GOG offered no CDN this browser can reach (${hosts})`);
    }
    return { urls };
}

/**
 * @param {Object} options
 * @param {Vault} options.vault
 * @param {typeof fetch} [options.fetch]
 * @returns {Store}
 */
export function gogStore({ vault, fetch: get = (url, init)=>fetch(url, init) }){
    /** @type {{ access: string, expires: number } | null} */
    let tokens = null;
    /** @type {Promise<string | null> | null} */
    let refreshing = null;
    /** @type {{ at: number, games: any[], owned: Set<string> } | null} */
    let library = null;

    /**
     * An access token, refreshed when the one held has expired; null with
     * nobody signed in. A refresh GOG refuses ends the session.
     *
     * @param {boolean} [fresh]
     */
    const access = (fresh = false)=>{
        if (tokens && !fresh && Date.now() < tokens.expires)
        {
            return Promise.resolve(tokens.access);
        }
        return (refreshing ??= (async()=>{
            try
            {
                const kept = await vault.token();
                if (!kept)
                {
                    return null;
                }
                const next = await refreshed(kept.refreshToken, get).catch(async e=>{
                    if (e?.refused)
                    {
                        await vault.signOut();
                        return null;
                    }
                    throw e;
                });
                if (!next)
                {
                    tokens = null;
                    return null;
                }
                if (next.refresh)
                {
                    await vault.renew(next.refresh);
                }
                tokens = { access: next.access, expires: next.expires };
                return next.access;
            }
            finally
            {
                refreshing = null;
            }
        })());
    };

    /** @param {string} url @returns {Promise<any>} */
    const signedGet = async url=>{
        const token = await access();
        if (!token)
        {
            throw new Error('gog: sign in to GOG first');
        }
        const answer = await get(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!answer.ok)
        {
            throw new Error(`gog: ${new URL(url).pathname} answered ${answer.status}`);
        }
        return answer.json();
    };

    /** @param {string} url @returns {Promise<any>} */
    const publicGet = async url=>{
        const answer = await get(url);
        if (!answer.ok)
        {
            throw new Error(`gog: ${new URL(url).pathname} answered ${answer.status}`);
        }
        return answer.json();
    };

    /** The ids of the products the account owns, games and DLC. */
    const owned = async()=>new Set(((await signedGet('https://embed.gog.com/user/data/games'))
        .owned ?? []).map(String));

    /** @param {string} game */
    const productOf = game=>{
        if (!/^\d{1,20}$/.test(game))
        {
            throw new Error(`gog: ${game} is not a product id`);
        }
        return game;
    };

    /** A game's vertical box art, which the products endpoint does not give. @param {string} id */
    const boxArt = id=>publicGet(`https://api.gog.com/v2/games/${id}`)
        .then(body=>https(body?._links?.boxArtImage?.href), ()=>'');

    /** @param {boolean} fresh */
    const games = async fresh=>{
        if (library && !fresh && Date.now() - library.at < KEPT_MS)
        {
            return library;
        }
        const ids = [...await owned()];
        /** @type {any[]} */
        const products = [];
        for (let at = 0; at < ids.length; at += PRODUCTS_BATCH)
        {
            const batch = ids.slice(at, at + PRODUCTS_BATCH).join(',');
            products.push(...await publicGet(`https://api.gog.com/products?ids=${batch}`));
        }
        const listed = products.filter(product=>product?.game_type === 'game');
        const art = new Map();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(ART_JOBS, listed.length) }, async()=>{
            while (next < listed.length)
            {
                const one = listed[next++];
                art.set(String(one.id), await boxArt(String(one.id)));
            }
        }));
        library = { at: Date.now(), owned: new Set(ids), games: listed.map(product=>{
            const id = String(product.id);
            const header = https(product.images?.logo2x ?? product.images?.logo);
            return {
                id,
                name: String(product.title ?? id),
                // The size of a build is its manifest's, read only for an install.
                bytes: 0,
                exact: false,
                installable: product.content_system_compatibility?.windows === true,
                covers: { header, capsule: art.get(id) || header,
                    hero: https(product.images?.background) },
            };
        }).sort((a, b)=>a.name.localeCompare(b.name)) };
        return library;
    };

    return {
        name: 'GOG',

        ops: {
            // Nobody signed in is an answer, not a failure. `fresh` asks GOG
            // whether the session still stands rather than taking it as read.
            account: async({ fresh })=>{
                const kept = await vault.get();
                if (!kept)
                {
                    return null;
                }
                if (fresh && !await access(true))
                {
                    return null;
                }
                return { name: kept.accountName };
            },

            signOut: async()=>{
                await vault.signOut();
                tokens = null;
                library = null;
                return {};
            },

            list: async({ fresh })=>(await vault.get() ? (await games(Boolean(fresh))).games : []),

            cover: async({ game, kind })=>{
                const listed = library?.games.find(one=>one.id === productOf(game));
                return listed?.covers[kind] ?? '';
            },

            download: async({ game })=>{
                const id = productOf(game);
                const mine = await owned();
                if (!mine.has(id))
                {
                    throw new Error(`gog: this account does not own product ${id}`);
                }
                const builds = await signedGet(
                    `https://content-system.gog.com/products/${id}/os/windows/builds?generation=2`);
                const items = builds?.items ?? [];
                const build = items.find((/** @type {any} */ one)=>one.branch === null
                    && one.generation === 2) ?? items.find((/** @type {any} */ one)=>one.branch === null);
                if (!build)
                {
                    throw new Error(`gog: product ${id} has no Windows build`);
                }
                if (build.generation !== 2)
                {
                    throw new Error(`gog: product ${id}'s Windows build is of Galaxy's first`
                        + ' generation, which this launcher does not install yet');
                }
                const manifestAnswer = await get(build.link);
                if (!manifestAnswer.ok)
                {
                    throw new Error(`gog: the build's manifest answered ${manifestAnswer.status}`);
                }
                const manifest = await readMeta(new Uint8Array(await manifestAnswer.arrayBuffer()));
                // A DLC's depots are in the build whether the account owns it or not.
                manifest.depots = (manifest.depots ?? []).filter((/** @type {any} */ depot)=>
                    depot.productId === id || mine.has(String(depot.productId)));
                const products = [...new Set(manifest.depots.map((/** @type {any} */ depot)=>
                    String(depot.productId)))];
                /** @type {Record<string, any>} */
                const links = {};
                for (const product of products)
                {
                    links[product] = reachableOnly(await signedGet(`https://content-system.gog.com/`
                        + `products/${product}/secure_link?_version=2&generation=2&path=/`));
                }
                const named = /** @type {string[]} */ (manifest.dependencies ?? []);
                const dependencies = named.length === 0 ? undefined : {
                    manifest: (await publicGet('https://content-system.gog.com/dependencies/'
                        + 'repository?generation=2')).repository_manifest,
                    link: reachableOnly(await publicGet('https://content-system.gog.com/'
                        + 'open_link?generation=2&_version=2&path=/dependencies/store/')),
                };
                const listed = library?.games.find(one=>one.id === id);
                const name = listed?.name ?? manifest.products?.find((/** @type {any} */ one)=>
                    String(one.productId) === id)?.name ?? `GOG product ${id}`;
                return { name, build: manifest, links,
                    ...dependencies ? { dependencies } : {},
                    art: listed?.covers ?? { header: '', capsule: '', hero: '' } };
            },

            // DRM-free: a run asks nothing of GOG.
            runData: async()=>({}),
        },

        close(){
            tokens = null;
            library = null;
        },
    };
}
