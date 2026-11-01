/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A headless Chrome over a DevTools pipe, for the extension's integration
 * tests. A branded Chrome ignores --load-extension: the extension is loaded
 * over the pipe (Extensions.loadUnpacked), which needs
 * --enable-unsafe-extension-debugging.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** A Chromium the tests can drive: named by CHROME_BIN, or where one installs. */
const findBrowser = ()=>{
    const found = [process.env.CHROME_BIN,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path=>path && existsSync(path));
    if (!found)
    {
        throw new Error('No Chrome found. Set CHROME_BIN to the executable path.');
    }
    return found;
};

/**
 * @param {string} profile  Kept short: Windows' MAX_PATH is 260, and a
 *     profile deep in a temp tree fails to open its databases.
 */
export function chrome(profile){
    const proc = spawn(findBrowser(), ['--headless=new', '--no-first-run',
        '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-pipe',
        '--enable-unsafe-extension-debugging', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    const out = /** @type {import('node:stream').Writable} */ (proc.stdio[3]);
    const inp = /** @type {import('node:stream').Readable} */ (proc.stdio[4]);
    let buffered = '';
    let next = 0;
    /** @type {Map<number, (message: any) => void>} */
    const waiting = new Map();
    inp.on('data', data=>{
        buffered += data;
        for (let end; (end = buffered.indexOf('\0')) >= 0;)
        {
            const message = JSON.parse(buffered.slice(0, end));
            buffered = buffered.slice(end + 1);
            waiting.get(message.id)?.(message);
        }
    });
    /** @param {string} method @param {object} [params] @param {string} [sessionId] */
    const send = (method, params = {}, sessionId)=>new Promise((done, fail)=>{
        const id = ++next;
        waiting.set(id, message=>{
            waiting.delete(id);
            if (message.error)
            {
                fail(new Error(`${method}: ${message.error.message}`));
            }
            else
            {
                done(message.result);
            }
        });
        out.write(`${JSON.stringify({ id, method, params, ...sessionId ? { sessionId } : {} })}\0`);
    });
    return { proc, send };
}
