/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Installs a Steam app the account owns into a directory, as the Steam
 * client lays it out: the depots for Windows and one language, each file
 * put together from its chunks -- and the redistributables the app declares,
 * as Steam installs them on a first start: the depots of other apps it names
 * (`depotfromapp`, Steamworks Common Redistributables' Visual C++ and
 * DirectX, which an anonymous logon downloads), put in the app's directory,
 * and its install scripts' registry values and the packages their programs
 * carry, put where the bottle mounts them. The install is core's
 * (`@bottlify/core/steam/install/directory`, over the install a page runs into a
 * bottle in the browser); this asks Steam for the depots.
 *
 *   NODE_USE_ENV_PROXY=1 node gamehub/tools/steam-install.mjs --session <file> --app <id>
 *       --out <dir>
 *       [--branch public] [--language english] [--depots 401,402] [--jobs 16]
 *   node gamehub/tools/steam-install.mjs --keys <file> --app <id> --out <dir> [--jobs 16]
 *
 * --session is a signed-in session, { accountName, refreshToken }, as
 * gamehub/tools/steam-signin.mjs --token writes it; `--session -` reads it from stdin,
 * which is how the launcher hands over a browser's session without writing
 * it to a file.
 *
 * --keys installs without the account: the depots to install, each with its
 * manifest's gid, its key and a manifest request code, as @bottlify/core/steam's
 * writeDepotAccess writes them (`--keys -`: on stdin); the content servers come
 * from an anonymous logon. A request code lasts minutes: one that has expired
 * fails the run, and the run is asked for again.
 *
 * A run stopped part way is run again: a file already whole (its size and
 * SHA-1) is kept.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installToDirectory } from '@bottlify/core/steam/install/directory';
import { connectCm } from '../src/stores/steam/connection.js';
import { logOn, logOnAnonymously, productInfo } from '../src/stores/steam/session.js';
import {
    contentServers, depotKey, manifestRequestCode, readDepotAccess,
} from '../src/stores/steam/keys.js';
import {
    depotOwners, sharedDepots, wantedDepot, windowsLaunch,
} from '../src/stores/steam/apps.js';

/** @typedef {import('@bottlify/core/steam/install').DepotOpening} DepotOpening */

/**
 * Asks Steam what to install and installs it: the tool as a command.
 *
 * @param {string[]} argv
 */
async function main(argv){
    /** @param {string} name */
    const option = name=>{
        const at = argv.indexOf(name);
        return at >= 0 ? argv[at + 1] : undefined;
    };
    const sessionPath = option('--session');
    const keysPath = option('--keys');
    const app = Number(option('--app'));
    const out = option('--out');
    const branch = option('--branch') ?? 'public';
    const language = option('--language') ?? 'english';
    const only = option('--depots')?.split(',').map(Number);
    const jobs = Number(option('--jobs') ?? 16);
    if (!sessionPath === !keysPath || !app || !out)
    {
        throw new Error('usage: node gamehub/tools/steam-install.mjs --session <file> | --keys <file>'
            + ' --app <id> --out <dir>');
    }
    /**
     * Read before Steam is asked anything: a list that is not one fails the run at
     * once -- with a message of its own, as JSON.parse's quotes the text, keys and all.
     */
    const given = keysPath ? readDepotAccess((()=>{
        try
        {
            return JSON.parse(readFileSync(keysPath === '-' ? 0 : keysPath, 'utf8'));
        }
        catch {
            throw new Error('--keys is not JSON');
        }
    })()) : null;

    const directory = await (await fetch('https://api.steampowered.com/ISteamDirectory/'
        + 'GetCMListForConnect/v1/?cellid=0&cmtype=websockets')).json();
    /** @type {import('../src/stores/steam/connection.js').CmConnection | undefined} */
    let connection;
    for (const server of directory.response.serverlist.slice(0, 8))
    {
        try
        {
            connection = await connectCm({ endpoint: server.endpoint });
            break;
        }
        catch (e){
            void e;
        }
    }
    if (!connection)
    {
        throw new Error('no Steam connection manager answered');
    }
    /**
     * The depots to download; `app` is the app that owns a shared one, whose id
     * its key and manifest code are asked under.
     *
     * @type {Array<{ id: number, gid: bigint, app?: number, key?: Uint8Array, code?: bigint }>}
     */
    const chosen = [];
    if (given)
    {
        // The content servers and what Steam tells anyone of the app are all this
        // logon is for.
        await logOnAnonymously(connection);
        chosen.push(...given.map(({ depot, gid, key, code })=>({ id: depot, gid, key, code })));
    }
    else
    {
        const session = JSON.parse(
            readFileSync(sessionPath === '-' ? 0 : String(sessionPath), 'utf8'));
        await logOn(connection, session);
        console.log(`logged on as ${session.accountName}`);
    }
    const info = /** @type {Record<string, any>} */ (
        (await productInfo(connection, { apps: [app] })).apps.get(app));
    if (!given)
    {
        for (const [id, depot] of Object.entries(info?.depots ?? {}))
        {
            const gid = depot?.manifests?.[branch]?.gid;
            if (/^\d+$/.test(id) && gid && (only ? only.includes(Number(id)) : wantedDepot(depot, language)))
            {
                chosen.push({ id: Number(id), gid: BigInt(gid) });
            }
        }
    }
    // The redistributables' depots, another app's: an anonymous logon opens them
    // as well as the account's, so a run with keys is handed none for them.
    const owners = depotOwners(info);
    const shared = owners.length === 0 ? []
        : sharedDepots(info, (await productInfo(connection, { apps: owners })).apps, language)
            .filter(depot=>!only || only.includes(depot.id));
    chosen.push(...shared);
    console.log(`${info?.common?.name ?? 'app'} (${app}), branch ${branch}:`
        + ` depots ${chosen.map(d=>(d.app ? `${d.id} (of ${d.app})` : d.id)).join(', ')}`);

    const servers = await contentServers(connection);
    if (!servers.length)
    {
        throw new Error('no content server offered');
    }
    console.log(`content servers: ${servers.slice(0, 3).map(s=>s.vhost).join(', ')}…`);

    // Every key and manifest code first: a manager drops the connection during a
    // long download, and the chunks need none.
    /** @type {DepotOpening[]} */
    const depots = [];
    for (const depot of chosen)
    {
        const owner = depot.app ?? app;
        depots.push({ depot: depot.id, gid: depot.gid, shared: Boolean(depot.app),
            key: depot.key ?? await depotKey(connection, owner, depot.id),
            code: depot.code ?? await manifestRequestCode(connection, owner, depot.id, depot.gid,
                depot.app ? 'public' : branch) });
    }
    connection.close();

    const installed = await installToDirectory({ out, depots, servers, jobs, log: console.log,
        installscript: info?.extended?.installscript
            ? String(info.extended.installscript) : undefined,
        executable: windowsLaunch(info)?.executable });
    console.log(`installed into ${out}: ${installed.files} files,`
        + ` ${(installed.bytes / 2 ** 20).toFixed(0)} MiB, ${installed.seconds.toFixed(0)} s`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
{
    // A failure is one line, the last the run prints: the launcher shows it as
    // the install's message, where a stack trace would show its last frame.
    process.on('uncaughtException', e=>{
        console.error(`failed: ${e?.message ?? e}`);
        process.exit(1);
    });
    await main(process.argv.slice(2));
    process.exit(0);
}
