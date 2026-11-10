/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Steam, as GameHub answers a page for it (hub.js), in Steam's session frame
 * (frame.js, session-page.js): every message to Steam built and read here,
 * over a CM socket the frame opens. The account's session is the extension's
 * database's (`vault`), which the sign-in page fills; it is read for a logon,
 * put into the logon and not kept here.
 *
 * One connection, logged on with the kept session or anonymously, is held
 * while the page is open, and made again when it closes. A sign-in uses
 * connections of its own: the logon it ends in is the next op's. What Steam
 * tells anyone of an app is asked over an anonymous logon: an account's is
 * answered most apps' product info as a hash and a size with no data.
 */

import * as connection from './connection.js';
import { steamManagers } from './connection.js';

export { steamManagers };
import * as session from './session.js';
import * as keys from './keys.js';
import * as client from './client.js';
import {
    DEMOS, depotOwners, describeApp, publicAppInfo, sharedDepots, steamArt, storeGame,
} from './apps.js';

/** @typedef {{ accountName: string, refreshToken: string }} Session */
/**
 * The account as the frame tells it without its token: `id` is new with each
 * sign-in, so a logon made with another session is told from the one kept.
 *
 * @typedef {{ accountName: string, id?: string, expires?: number }} Account
 */
/** @typedef {import('../../hub.js').Store} Store */

/**
 * The content servers' domains the steam ruleset lets a page read
 * (rules/steam.json, rule 2): a server elsewhere would be refused by CORS.
 */
export const CDN_DOMAINS = Object.freeze(['steamcontent.com', 'steampipe.akamaized.net']);

/** @param {string} host */
const reachable = host=>CDN_DOMAINS.some(domain=>host === domain || host.endsWith(`.${domain}`));

/** How long an account's games, and what Steam tells anyone of an app, are taken as read. */
const KEPT_MS = 10 * 60_000;

/** Apps asked of Steam in one request: an account's whole library is hundreds. */
const PRODUCT_INFO_BATCH = 500;

/** Steam's own protocol, as the store speaks it; a test answers for Steam. */
export const STEAM = Object.freeze({
    ...connection, ...session, ...keys, fetchClientFiles: client.fetchClientFiles,
});

/**
 * @typedef {Object} Held
 * @property {any} connection
 * @property {bigint} steamId
 * @property {Account | null} session  Null for an anonymous logon.
 * @property {Array<Record<string, any>>} licenses
 */

/**
 * The session as the store asks it of the extension's database.
 *
 * @typedef {Object} Vault
 * @property {() => Promise<Account | null>} get  Who is signed in, without the token.
 * @property {() => Promise<(Session & Account) | null>} token  The session, for a logon.
 * @property {() => Promise<void>} signOut
 */

/**
 * @param {Object} options
 * @param {Vault} options.vault
 * @param {(url: string) => import('./connection.js').CmSocket} [options.socket]  A CM
 *     socket; a WebSocket by default.
 * @param {typeof fetch} [options.fetch]  Steam's directory and Valve's client files.
 * @param {boolean} [options.clientFiles]  Whether run data carries Valve's client files:
 *     not where the store runs in a tab, whose answers cross the extension's ports,
 *     and the page reads the public files itself (`fetch`, launcher steam/client-files.js).
 * @param {() => Promise<string[]>} [options.managers]
 * @param {Record<string, any>} [options.steam]  Steam's protocol (`STEAM`).
 * @returns {Store}
 */
export function steamStore({ vault, socket, fetch: get = fetch, clientFiles = true,
    managers = ()=>steamManagers(get), steam = STEAM })
{
    /** @type {Promise<Held> | null} */
    let held = null;
    /** @type {Promise<Held> | null} */
    let anonymous = null;
    /** @type {{ at: number, apps: number[] } | null} */
    let library = null;
    /** What Steam told anyone of each app, by app id. @type {Map<number, { at: number, info: any }>} */
    const apps = new Map();

    async function connect(){
        let failure = 'none is listed';
        for (const endpoint of (await managers()).slice(0, 8))
        {
            try
            {
                return await steam.connectCm({ endpoint, socket });
            }
            catch (e){
                failure = String(/** @type {Error} */ (e)?.message ?? e);
            }
        }
        throw new Error(`steam: no connection manager answered (${failure})`);
    }

    /** @param {boolean} anonymously @returns {Promise<Held>} */
    async function logOn(anonymously){
        const link = await connect();
        try
        {
            // Read now and dropped with the logon: the token is the database's.
            const kept = anonymously ? null : await vault.token();
            if (!kept)
            {
                const { steamId } = await steam.logOnAnonymously(link);
                return { connection: link, steamId, session: null, licenses: [] };
            }
            const expires = session.tokenExpiry(kept.refreshToken);
            /** @type {{ steamId: bigint, licenses: Array<Record<string, any>> } | null} */
            let answer = null;
            if (expires === null || expires > Date.now())
            {
                try
                {
                    answer = await steam.logOn(link,
                        { accountName: kept.accountName, refreshToken: kept.refreshToken });
                }
                catch (e){
                    // A connection that failed keeps the session; a session Steam
                    // says is gone is forgotten, so the page asks for a sign-in
                    // rather than failing every op on it.
                    if (!session.DEAD_SESSION.has(/** @type {any} */ (e)?.eresult))
                    {
                        throw e;
                    }
                }
            }
            if (!answer)
            {
                await vault.signOut();
                link.close();
                return logOn(true);
            }
            return { connection: link, steamId: answer.steamId, licenses: answer.licenses,
                session: { accountName: kept.accountName, id: kept.id,
                    ...expires ? { expires } : {} } };
        }
        catch (e){
            link.close();
            throw e;
        }
    }

    /**
     * The logged-on connection, made again when it closed or the kept session
     * is no longer the one it logged on with -- another page signed in or out.
     * Each caller is chained after the last, so two ops at once share one logon.
     *
     * @returns {Promise<Held>}
     */
    function loggedOn(){
        const last = held ?? Promise.resolve(null);
        held = last.catch(()=>null).then(async now=>{
            const kept = await vault.get();
            if (now && !now.connection.closed && Boolean(now.session) === Boolean(kept)
                && now.session?.id === kept?.id)
            {
                return now;
            }
            now?.connection.close();
            library = null;
            return logOn(!kept);
        });
        return held;
    }

    /** The session changed: what was logged on with the old one goes. */
    function drop(){
        held?.then(now=>now.connection.close(), ()=>{});
        held = null;
        library = null;
    }

    /** An anonymous logon: the held one when nobody is signed in, or one of its own. */
    async function anonymousConnection(){
        const now = await loggedOn();
        if (!now.session)
        {
            return now.connection;
        }
        const last = anonymous ?? Promise.resolve(null);
        anonymous = last.catch(()=>null).then(kept=>(kept && !kept.connection.closed
            ? kept : logOn(true)));
        return (await anonymous).connection;
    }

    /**
     * The signed-in account: its Steam ID, name, every app its licences grant.
     *
     * @param {boolean} [fresh]  The licences as Steam has them now, over a new logon.
     */
    async function account(fresh = false){
        if (!await vault.get())
        {
            return null;
        }
        if (fresh)
        {
            drop();
        }
        const now = await loggedOn();
        if (!now.session)
        {
            return null;
        }
        if (!library || Date.now() - library.at > KEPT_MS)
        {
            library = { at: Date.now(), apps: await steam.ownedApps(now.connection, now.licenses) };
        }
        return { steamId: String(now.steamId), accountName: now.session.accountName,
            ...now.session.expires ? { expires: now.session.expires } : {},
            apps: library.apps, licenses: now.licenses.length };
    }

    /**
     * What Steam tells anyone of apps, by app id; an app it does not describe left out.
     *
     * @param {number[]} wanted
     * @returns {Promise<Map<number, any>>}
     */
    async function productInfo(wanted){
        const ids = [...new Set(wanted)];
        const stale = ids.filter(id=>!(Date.now() - (apps.get(id)?.at ?? 0) < KEPT_MS));
        if (stale.length > 0)
        {
            const link = await anonymousConnection();
            for (let at = 0; at < stale.length; at += PRODUCT_INFO_BATCH)
            {
                const batch = stale.slice(at, at + PRODUCT_INFO_BATCH);
                const answer = await steam.productInfo(link, { apps: batch });
                for (const id of batch)
                {
                    const info = answer.apps.get(id);
                    apps.set(id, { at: Date.now(), info: info ? publicAppInfo(info) : null });
                }
            }
        }
        return new Map(ids.flatMap(id=>(apps.get(id)?.info ? [[id, apps.get(id)?.info]] : [])));
    }

    /**
     * A licence to an app the signed-in account does not hold, asked of Steam
     * as a free one -- a demo, a free game -- before its keys or its ticket
     * are: Steam refuses both to an account without one. Nobody signed in, or
     * an app the account holds: nothing asked.
     *
     * @param {number} appId
     */
    async function holding(appId){
        const now = await account();
        if (!now || now.apps.includes(appId))
        {
            return;
        }
        const logon = await loggedOn();
        const granted = await steam.requestFreeLicense(logon.connection, [appId]);
        if (granted.licenses)
        {
            logon.licenses = granted.licenses;
        }
        library = null;
        if (!granted.apps.includes(appId) && !(await account())?.apps.includes(appId))
        {
            throw new Error(`Steam granted no licence to app ${appId}`
                + ` (EResult ${granted.eresult}): it is not free to this account`);
        }
    }

    /**
     * An app's info as the account is told it: some demos' depots and launch
     * options are shown only to an account holding them, not to anyone.
     *
     * @param {number} appId
     */
    async function accountInfo(appId){
        const { connection: link } = await loggedOn();
        const info = (await steam.productInfo(link, { apps: [appId] })).apps.get(appId);
        if (info)
        {
            apps.set(appId, { at: Date.now(), info: publicAppInfo(info) });
        }
        return apps.get(appId)?.info ?? null;
    }

    /** @param {string} game */
    const appOf = game=>{
        const id = Number(game);
        if (!Number.isInteger(id) || id <= 0 || id > 0xFFFFFFFF)
        {
            throw new Error(`steam: ${game} is not an app id`);
        }
        return id;
    };

    return {
        name: 'Steam',

        ops: {
            // Nobody signed in is an answer, not a failure, and needs no logon to give.
            account: async({ fresh })=>{
                const now = await account(fresh);
                return now ? { name: now.accountName,
                    ...now.expires ? { expires: new Date(now.expires).toISOString() } : {} } : null;
            },

            signOut: async()=>{
                await vault.signOut();
                drop();
                return {};
            },

            // The account's games: every app its licences grant, of which the
            // games; and the demos (`DEMOS`) Steam grants anyone signed in, of
            // the games the account does not own. Nobody signed in: none -- the
            // launcher shows the demos itself (its demos.js), GameHub or not.
            list: async({ fresh })=>{
                const now = await account(fresh);
                if (!now)
                {
                    return [];
                }
                const owned = now.apps;
                const ownsGameOf = (/** @type {number} */ id)=>DEMOS.some(({ demo, game })=>
                    demo === id && owned.includes(game));
                const ids = [...owned.filter(id=>!ownsGameOf(id)),
                    ...DEMOS.filter(({ demo, game })=>!owned.includes(demo)
                        && !owned.includes(game)).map(({ demo })=>demo)];
                if (ids.length === 0)
                {
                    return [];
                }
                const infos = await productInfo(ids);
                return ids.flatMap(id=>{
                    const game = storeGame(id, infos.get(id));
                    const { header, cover, hero } = steamArt(id);
                    return game ? [{ ...game, covers: { header, capsule: cover, hero } }] : [];
                }).sort((a, b)=>a.name.localeCompare(b.name));
            },

            cover: async({ game, kind })=>steamArt(appOf(game))[
                /** @type {'header' | 'cover' | 'hero'} */ (kind === 'capsule' ? 'cover' : kind)],

            // What the page's install needs: the app's depots and the
            // redistributables' depots of the apps it names, each with its key
            // and a request code asked under the app that owns it, and the
            // content servers the ruleset opens to the page.
            download: async({ game })=>{
                const appId = appOf(game);
                if (DEMOS.some(({ demo })=>demo === appId) && !await account())
                {
                    throw new Error('steam: sign in to Steam to install this demo');
                }
                await holding(appId);
                let info = (await productInfo([appId])).get(appId);
                if (!info)
                {
                    throw new Error(`Steam does not describe app ${appId}`);
                }
                if (describeApp(info).depots.length === 0 && await account())
                {
                    info = await accountInfo(appId) ?? info;
                }
                const owners = await productInfo(depotOwners(info));
                const described = describeApp(info);
                const { connection: link, licenses } = await loggedOn();
                // The depots the account's licences give, as the client takes them:
                // Steam answers AccessDenied for a key to any other the app lists.
                const owned = new Set(await steam.ownedDepots(link, licenses));
                // A demo's content may be all another app's depots (HL2's demo is
                // its game's depot 221), shared, which its licence names.
                const listed = [
                    ...described.depots.map(({ id, gid })=>
                        ({ depot: id, gid, app: appId, shared: false })),
                    ...sharedDepots(info, owners).map(({ id, gid, app })=>
                        ({ depot: id, gid: String(gid), app, shared: true })),
                ];
                const wanted = listed.filter(({ depot })=>owned.has(depot));
                if (wanted.length === 0)
                {
                    const ids = listed.map(({ depot })=>depot).join(', ') || 'none listed';
                    throw new Error(`steam: this account's licences give none of app ${appId}'s`
                        + ` depots (${ids})`);
                }
                /**
                 * A depot's key under the app that owns it, and a shared one Steam
                 * keeps from its owner (AccessDenied, EResult 15) under the app
                 * installed, whose licence names it; its request code under the same.
                 * @param {number} app @param {number} depot
                 */
                const keyed = async(app, depot)=>{
                    try
                    {
                        return { app, key: await steam.depotKey(link, app, depot) };
                    }
                    catch (e){
                        if (app === appId || !/\(EResult 15\)/.test(String(
                            /** @type {Error} */ (e)?.message)))
                        {
                            throw e;
                        }
                        return { app: appId, key: await steam.depotKey(link, appId, depot) };
                    }
                };
                const depots = await Promise.all(wanted.map(async({ depot, gid, app, shared })=>{
                    const keyedOne = await keyed(app, depot);
                    return { depot, gid, shared, key: keyedOne.key, code: String(
                        await steam.manifestRequestCode(link, keyedOne.app, depot, BigInt(gid))) };
                }));
                const servers = (await steam.contentServers(link))
                    .filter((/** @type {{ vhost: string }} */ server)=>reachable(server.vhost));
                // A demo says so: its bottle is the library's whoever is signed in.
                return { name: String(info.common?.name ?? appId), launch: described.launch,
                    ...described.installscript ? { installscript: described.installscript } : {},
                    ...DEMOS.some(({ demo })=>demo === appId) ? { demo: true } : {},
                    art: steamArt(appId), servers, depots };
            },

            // Steam running for the signed-in account: its apps, the app's
            // ownership ticket as Steam signs it (none for an app it does not
            // own), and Valve's own client DLLs, which a DRM wrapper reads to
            // check the client it loaded. Nobody signed in: nothing.
            runData: async({ game })=>{
                const appId = appOf(game);
                if (!await account())
                {
                    return {};
                }
                // A demo's licence first, for its ticket; an app Steam will not
                // grant runs as it did, with none.
                await holding(appId).catch(()=>{});
                const now = /** @type {NonNullable<Awaited<ReturnType<typeof account>>>} */ (
                    await account());
                const [ticket, files] = await Promise.all([
                    steam.appOwnershipTicket((await loggedOn()).connection, appId).catch(()=>null),
                    clientFiles ? steam.fetchClientFiles({ fetch: get }).catch(()=>null) : null,
                ]);
                // When the session ends is the page's to know, not the program's.
                const signedIn = { ...now };
                delete signedIn.expires;
                return { win32: { steam: { ...signedIn, appId,
                    ...ticket ? { ownershipTickets: { [appId]: ticket } } : {},
                    ...files ? { clientFiles: files.files } : {} } } };
            },
        },

        close(){
            drop();
            anonymous?.then(kept=>kept.connection.close(), ()=>{});
            anonymous = null;
        },
    };
}
