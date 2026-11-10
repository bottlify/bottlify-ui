/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A Steam that answers from memory at the protocol's level -- logons, product
 * info, keys, codes, tickets, client files -- for the store's tests, and the
 * account token it takes.
 */

export const TOKEN = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiI3NjU2MTE5Nzk2MDI2NTcyOSJ9.secret-signature';

/** The demos the store offers (apps.js DEMOS), each Steam's to grant for free. */
const DEMO_APPS = [219, 479030, 2407990];
/** A demo whose depots and launch Steam shows only to an account holding it. */
const HIDDEN_DEMO = 479030;

/** What Steam tells anyone of an app. @param {number} app */
const appInfo = app=>(DEMO_APPS.includes(app) ? {
    common: { type: 'Demo', name: `Demo ${app}` },
    config: app === HIDDEN_DEMO ? {} : { launch: { 0: { executable: 'demo.exe' } } },
    depots: app === HIDDEN_DEMO ? {}
        : { [app + 1]: { manifests: { public: { gid: '7', size: '100' } } } },
} : {
    common: { type: app === 228980 ? 'Config' : 'Game', name: `App ${app}`, icon: 'x' },
    config: app === 70 ? { launch: { 0: { executable: 'bin/game.exe', arguments: '-w' } } } : {},
    extended: app === 70 ? { installscript: 'install.vdf' } : {},
    depots: app === 228980 ? { 228990: { manifests: { public: { gid: '2222', size: '9' } } } }
        : { 1: { manifests: { public: { gid: '5', size: '1000' }, beta: { gid: '6' } } },
            2: { manifests: { public: { gid: '9', size: '10' } } },
            228990: { depotfromapp: '228980' } },
    ufs: { quota: 1 },
});

/** What an account holding the hidden demo is told of it. */
const heldDemoInfo = ()=>({
    common: { type: 'Demo', name: `Demo ${HIDDEN_DEMO}` },
    config: { launch: { 0: { executable: 'DOOMx64.exe' } } },
    depots: { [HIDDEN_DEMO + 1]: { manifests: { public: { gid: '8', size: '300' } } } },
});

/** A Steam that answers from memory, and what was asked of it. */
export function fakeSteam(){
    const asked = /** @type {string[]} */ ([]);
    /** The apps free licences were granted to. @type {number[]} */
    const granted = [];
    const connection = ()=>({ closed: false, anonymous: false, close(){
        this.closed = true;
    } });
    return {
        asked,
        connectCm: async()=>connection(),
        logOnAnonymously: async(/** @type {any} */ link)=>{
            link.anonymous = true;
            asked.push('anonymous');
            return { steamId: 90071992547409920n };
        },
        logOn: async(/** @type {any} */ _c, /** @type {any} */ session)=>{
            asked.push(`logOn ${session.accountName} ${session.refreshToken === TOKEN}`);
            return { steamId: 76561197960265729n, licenses: [{ package_id: 1 }] };
        },
        ownedApps: async(/** @type {any} */ _c, /** @type {any[]} */ licenses)=>[70, 400, 999,
            ...(licenses ?? []).some(one=>one.package_id === 900) ? granted : []],
        /** The depots the licences give: not 2, an edition app 70 lists beside them. */
        ownedDepots: async(/** @type {any} */ _c, /** @type {any[]} */ licenses)=>[1, 70, 228990,
            ...(licenses ?? []).some(one=>one.package_id === 900) ? granted.map(app=>app + 1) : []],
        /** A free licence: a demo's granted, with the licence list after it. */
        requestFreeLicense: async(/** @type {any} */ _c, /** @type {number[]} */ apps)=>{
            asked.push(`free ${apps.join(',')}`);
            const free = apps.filter(app=>DEMO_APPS.includes(app));
            granted.push(...free);
            return free.length > 0
                ? { eresult: 1, packages: [900], apps: free,
                    licenses: [{ package_id: 1 }, { package_id: 900 }] }
                : { eresult: 2, packages: [], apps: [], licenses: null };
        },
        depotKey: async(/** @type {any} */ _c, /** @type {number} */ app, /** @type {number} */ depot)=>{
            asked.push(`key ${app} ${depot}`);
            return new Uint8Array(32).fill(depot & 0xff);
        },
        appOwnershipTicket: async(/** @type {any} */ _c, /** @type {number} */ app)=>{
            asked.push(`ticket ${app}`);
            return app === 400 ? Uint8Array.of(4, 0, 0, 0) : null;
        },
        manifestRequestCode: async(/** @type {any} */ _c, /** @type {number} */ _app,
            /** @type {number} */ _depot, /** @type {bigint} */ gid)=>gid + 1n,
        /** What Steam tells each logon of apps: an account's, a hash and no data. */
        productInfo: async(/** @type {any} */ link, /** @type {{ apps: number[] }} */ { apps })=>{
            asked.push(`info ${link.anonymous ? 'anonymous' : 'account'} ${apps.join(',')}`);
            if (!link.anonymous)
            {
                const held = apps.filter(app=>app === HIDDEN_DEMO && granted.includes(app));
                return { apps: new Map(held.map(app=>[app, heldDemoInfo()])) };
            }
            return { apps: new Map(apps.filter(app=>app !== 999).map(app=>[app, appInfo(app)])) };
        },
        contentServers: async()=>[
            { host: 'a:443', vhost: 'cache1-fra1.steamcontent.com', type: 'CDN' },
            { host: 'b', vhost: 'steampipe.akamaized.net', type: 'CDN' },
            { host: 'c', vhost: 'lancache.example.org', type: 'SteamCache' },
        ],
        fetchClientFiles: async()=>({ version: '1',
            files: { 'steamclient.dll': Uint8Array.of(77, 90) } }),
    };
}
