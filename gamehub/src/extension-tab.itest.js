/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The Safari build -- each store run in a tab of its site (relay.js,
 * tab-session.js) -- in a real headless Chrome, against Steam itself, on a
 * cross-origin isolated page as the launcher's: the page's ops reach Steam
 * over a socket of steamcommunity.com's tab, which needs no rule, and the
 * page downloads from the content servers. Chrome runs the same code Safari
 * does; what is Safari's own (its windows, its worker's life) is not
 * exercised here. Signed in anonymously, as extension.itest.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { chrome } from './chrome.fixture.js';
import { PAGE_CLIENT } from './page.fixture.js';

const CORE = fileURLToPath(new URL('../../node_modules/@bottlify/core/src/', import.meta.url));
/** Steamworks Common Redistributables: a depot whose key Steam gives anyone. */
const APP = 228980;
const DEPOT = 228990;

const PAGE = `<!doctype html><script>
window.seen = [];
addEventListener('message', e => { if (e.data?.from === 'bottlify-gamehub') seen.push(e.data); });
${PAGE_CLIENT}
window.outcome = promise => promise.then(result => ({ result }),
    e => ({ error: String(e.message ?? e) }));
</script>`;

const pause = (/** @type {number} */ ms)=>new Promise(done=>setTimeout(done, ms));

test('the Safari build runs Steam in a tab of its site, and the page downloads', async t=>{
    const scratch = mkdtempSync(join(process.env.LOCALAPPDATA ?? tmpdir(), 'ght-'));
    const { safari } = await build(join(scratch, 'dist'));
    const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp' };
    const server = createServer((request, response)=>{
        const path = new URL(request.url ?? '/', 'http://x').pathname;
        if (path === '/')
        {
            response.writeHead(200, { ...isolated, 'Content-Type': 'text/html' }).end(PAGE);
        }
        else if (/^\/core\/[a-z0-9/]+\.js$/.test(path))
        {
            response.writeHead(200, { ...isolated, 'Content-Type': 'text/javascript' })
                .end(readFileSync(resolve(CORE, path.slice('/core/'.length))));
        }
        else
        {
            response.writeHead(404, isolated).end();
        }
    });
    await new Promise(done=>server.listen(0, '127.0.0.1', ()=>done(undefined)));
    const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`;
    const browser = chrome(join(scratch, 'profile'));
    try
    {
        const { id: extension } = await browser.send('Extensions.loadUnpacked', { path: safari });
        const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await browser.send('Target.attachToTarget',
            { targetId, flatten: true });
        /** @param {string} expression */
        const page = async expression=>{
            const answer = await browser.send('Runtime.evaluate',
                { expression, awaitPromise: true, returnByValue: true }, sessionId);
            if (answer.exceptionDetails)
            {
                const { exception, text } = answer.exceptionDetails;
                throw new Error(exception?.description ?? text);
            }
            return answer.result.value;
        };
        await browser.send('Page.navigate', { url }, sessionId);
        for (let tries = 0; tries < 100; tries++)
        {
            await pause(100);
            if (await page('document.readyState === "complete" && typeof ask').catch(()=>null)
                === 'function')
            {
                break;
            }
        }
        /** The tabs of steamcommunity.com open now. */
        const steamTabs = async()=>(await browser.send('Target.getTargets')).targetInfos
            .filter((/** @type {any} */ info)=>info.type === 'page'
                && info.url.startsWith('https://steamcommunity.com/'));

        await t.test('GameHub says it runs the stores in a tab', async()=>{
            assert.equal(await page('crossOriginIsolated'), true);
            const hello = await page('ask("hello")');
            assert.deepEqual(hello, { version: '0.1.0', origin: `chrome-extension://${extension}`,
                transport: 'tab', stores: [{ id: 'steam', name: 'Steam', on: true }] });
        });

        await t.test('an op opens steamcommunity.com and Steam answers over its socket', async()=>{
            assert.equal(await page('ask("account", { store: "steam" })'), null);
            const [tab] = await steamTabs();
            assert.match(tab?.url ?? '', /\?bottlify-gamehub=[0-9a-f-]{36}&store=steam&mode=session$/);
            const download = await page(`ask("download", { store: "steam", game: "${APP}" })
                .then(answer => ({ servers: answer.servers.length, depots: answer.depots.map(one =>
                    ({ depot: one.depot, key: one.key instanceof Uint8Array ? one.key.length : -1,
                        code: one.code })) }))`);
            assert.ok(download.servers > 0, 'content servers');
            const depot = download.depots.find((/** @type {any} */ one)=>one.depot === DEPOT);
            assert.equal(depot?.key, 32, 'the key reaches the page as bytes');
            assert.match(depot.code, /^[0-9]+$/);
            assert.equal((await steamTabs()).length, 1, 'one tab for both ops');
        });

        await t.test('the page reads a manifest and a chunk from the content servers', async()=>{
            const read = await page(`(async () => {
                const { manifest, downloadChunk } = await import('/core/steam/depot.js');
                const answer = await ask('download', { store: 'steam', game: '${APP}' });
                const [server] = answer.servers;
                const one = answer.depots.find(d => d.depot === ${DEPOT});
                const listed = await manifest(server,
                    { depot: ${DEPOT}, gid: BigInt(one.gid), code: BigInt(one.code),
                        key: one.key });
                const chunk = listed.files.find(file => file.chunks.length).chunks[0];
                const bytes = await downloadChunk(server, ${DEPOT}, chunk, one.key);
                return { files: listed.files.length, chunk: bytes.length === chunk.size };
            })()`);
            assert.ok(read.files > 0);
            assert.equal(read.chunk, true);
        });

        await t.test('a steamcommunity.com tab carrying a made-up nonce is closed', async()=>{
            await browser.send('Target.createTarget',
                { url: 'https://steamcommunity.com/?bottlify-gamehub=made-up&store=steam&mode=session' });
            let left = true;
            for (let tries = 0; tries < 100 && left; tries++)
            {
                await pause(200);
                left = (await steamTabs()).some((/** @type {any} */ one)=>one.url.includes('made-up'));
            }
            assert.equal(left, false);
            assert.equal((await steamTabs()).length, 1, 'the driven tab stays');
        });

        await t.test('a sign-in shows Steam\'s QR over its site, out of its reach', async()=>{
            // Not awaited here: it ends when the window does.
            await page('void (window.signing = outcome(ask("signIn", { store: "steam" })))');
            /** @type {any} */
            let shown = null;
            for (let tries = 0; tries < 100 && !shown; tries++, await pause(200))
            {
                shown = (await steamTabs()).find((/** @type {any} */ one)=>
                    one.url.endsWith('&mode=signin'));
            }
            assert.ok(shown, 'a tab of the site for the sign-in');
            const { sessionId: there } = await browser.send('Target.attachToTarget',
                { targetId: shown.targetId, flatten: true });
            // DevTools sees into a closed shadow root; the site's scripts do not.
            const text = async()=>JSON.stringify((await browser.send('DOM.getDocument',
                { depth: -1, pierce: true }, there)).root);
            let said = '';
            for (let tries = 0; tries < 150 && !/Scan with the Steam app/.test(said); tries++)
            {
                await pause(200);
                said = await text();
            }
            assert.match(said, /Scan with the Steam app/, 'Steam gave the overlay a QR code');
            const reach = (await browser.send('Runtime.evaluate', { returnByValue: true,
                expression: '[...document.querySelectorAll("*")]'
                    + '.filter(e => e.shadowRoot).length' },
            there)).result.value;
            assert.equal(reach, 0, 'no shadow root the site can open');
            await browser.send('Target.closeTarget', { targetId: shown.targetId });
            const ended = await page('signing');
            assert.match(ended.error, /sign-in window was closed/);
        });
    }
    finally
    {
        browser.proc.kill();
        server.close();
        await pause(1000);
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
});
