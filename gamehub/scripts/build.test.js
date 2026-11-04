/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { build } from './build.mjs';
import { HOST_CHECKED, STORE_PAGES, TRANSPORTS, TRANSPORT_WRITTEN } from '../src/manifest.js';

/** @param {string} dir @returns {string[]} */
const filesIn = dir=>readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry=>entry.isFile()).map(entry=>join(entry.parentPath, entry.name));

test('each build is whole, and the page may load a store\'s pages alone', async()=>{
    const out = mkdtempSync(join(tmpdir(), 'gamehub-build-'));
    try
    {
        const built = await build(out);
        assert.deepEqual(Object.keys(built).sort(), ['dev', 'public', 'safari']);
        for (const [flavour, dir] of Object.entries(built))
        {
            const inTab = TRANSPORTS[/** @type {keyof typeof TRANSPORTS} */ (flavour)] === 'tab';
            const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
            for (const file of filesIn(dir).filter(name=>name.endsWith('.js')))
            {
                const text = readFileSync(file, 'utf8');
                const from = relative(dir, file).replace(/\\/g, '/');
                for (const [, path] of text.matchAll(/from '([^']+\.js)'/g))
                {
                    assert.ok(existsSync(join(dirname(file), path)), `${from} imports ${path}`);
                }
            }
            const content = readFileSync(join(dir, manifest.content_scripts[0].js[0]), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '');
            assert.doesNotMatch(content, /\bimport\b|getURL\('[^']*\.js'\)/,
                'the page\'s content script loads no module: an isolated page may refuse it');
            const [forPages] = manifest.web_accessible_resources;
            assert.deepEqual(forPages.resources,
                STORE_PAGES.map(([id, page])=>`${id}/${page}.html`),
                'the page may load a store\'s pages, as frames, and no module');
            const frameLine = 'const TRANSPORT = /** @type {\'frame\' | \'tab\'} */ (\'frame\');';
            for (const path of TRANSPORT_WRITTEN)
            {
                assert.ok(readFileSync(join(dir, path), 'utf8')
                    .includes(inTab ? 'const TRANSPORT = "tab";' : frameLine),
                `${flavour}: ${path} runs the stores ${inTab ? 'in a tab' : 'in a frame'}`);
            }
            const onSites = manifest.content_scripts.slice(1);
            assert.equal(onSites.length, inTab ? 1 : 0,
                `${flavour}: a content script on the stores' sites`);
            for (const one of onSites)
            {
                assert.ok(existsSync(join(dir, one.js[0])), one.js[0]);
            }
            for (const [id, page] of STORE_PAGES)
            {
                const html = readFileSync(join(dir, `${id}/${page}.html`), 'utf8');
                const script = /<script type="module" src="\/([^"]+)"/.exec(html)?.[1];
                assert.ok(script && existsSync(join(dir, script)),
                    `${id}/${page}.html loads ${script}`);
            }
            for (const path of HOST_CHECKED)
            {
                assert.equal(readFileSync(join(dir, path), 'utf8').includes('new RegExp('),
                    flavour !== 'public', `${path} checks its page's host in the ${flavour} build`);
            }
            assert.ok(existsSync(join(dir, manifest.background.service_worker)));
            for (const ruleset of manifest.declarative_net_request.rule_resources)
            {
                assert.ok(existsSync(join(dir, ruleset.path)), ruleset.path);
            }
        }
    }
    finally
    {
        rmSync(out, { recursive: true, force: true });
    }
});
