/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Builds the extension, unpacked: `dist/public/` for Bottlify's sites,
 * `dist/dev/` for a local launcher as well (src/manifest.js). Its entry points
 * and every module they import are copied, each at a path of the build:
 * GameHub's own under `gamehub/` as in this repository, and the core formats
 * it imports as `@bottlify/core/...` under `core/`, where the package's
 * exports name them. An extension's page resolves no bare name, so in the copy
 * such an import is the relative path to its file: one source, no second copy
 * in git.
 *
 *   node scripts/build.mjs [out]
 *
 * `dist/safari/` is `dev` with each store run in a tab of its site, for Safari
 * (manifest.js TRANSPORTS): Safari, Settings, Developer, Add Temporary Extension.
 */

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ENTRIES, HOSTS, HOST_CHECKED, PAGES, PLATFORMS, STORE_PAGES, TRANSPORTS, TRANSPORT_WRITTEN,
    manifestFor,
} from '../src/manifest.js';

const HERE = fileURLToPath(new URL('..', import.meta.url));
// The launcher, with gamehub/ in it and the engine's core among its packages.
const ROOT = resolve(HERE, '..');
const CORE = join(ROOT, 'node_modules', '@bottlify', 'core');
const CORE_NAME = '@bottlify/core/';
/** @type {Record<string, string>} */
const CORE_EXPORTS = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')).exports;

/**
 * Where in a build a core module goes: under `core/`, at its path in the package.
 *
 * @param {string} specifier  `@bottlify/core/steam/protobuf`
 */
const coreModule = specifier=>{
    const target = CORE_EXPORTS[`./${specifier.slice(CORE_NAME.length)}`];
    if (typeof target !== 'string')
    {
        throw new Error(`@bottlify/core exports no ${specifier}`);
    }
    return posix.join('core', target);
};

/** A build's path to its source. @param {string} path */
const sourceOf = path=>(path.startsWith('core/') ? join(CORE, path.slice('core/'.length))
    : join(ROOT, path));

const IMPORT = /((?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"])([^'"]+)(['"])/g;

/**
 * A module as the build lays it: an import of core by its package's name made
 * the relative path to where that module goes.
 *
 * @param {string} path @param {string} code
 */
const laidOut = (path, code)=>code.replace(IMPORT, (whole, head, specifier, tail)=>{
    if (!specifier.startsWith(CORE_NAME))
    {
        return whole;
    }
    const to = posix.relative(posix.dirname(path), coreModule(specifier));
    return `${head}${to.startsWith('.') ? to : `./${to}`}${tail}`;
});

/**
 * Modules and every module they import, by their paths in a build.
 *
 * @param {string[]} entries  `gamehub/src/worker.js`, ...
 * @returns {Promise<string[]>}
 */
export async function closure(entries){
    /** @type {Set<string>} */
    const seen = new Set();
    const pending = [...entries];
    while (pending.length > 0)
    {
        const path = /** @type {string} */ (pending.pop());
        if (seen.has(path))
        {
            continue;
        }
        seen.add(path);
        if (path.startsWith('..'))
        {
            throw new Error(`a module reaches ${path}, outside the build`);
        }
        const code = (await readFile(sourceOf(path), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const [, , specifier] of code.matchAll(IMPORT))
        {
            if (specifier.startsWith(CORE_NAME))
            {
                pending.push(coreModule(specifier));
            }
            else if (specifier.startsWith('.'))
            {
                pending.push(posix.normalize(posix.join(posix.dirname(path), specifier)));
            }
        }
    }
    return [...seen].sort();
}

/**
 * @param {string} [out]
 * @returns {Promise<Record<string, string>>}  Each build's directory.
 */
export async function build(out = join(HERE, 'dist')){
    const { version } = JSON.parse(await readFile(join(HERE, 'package.json'), 'utf8'));
    /** @type {[string, string][]} */
    const files = (await closure([...ENTRIES])).map(path=>[sourceOf(path), path]);
    for (const platform of Object.values(PLATFORMS))
    {
        files.push([join(HERE, platform.rules), `gamehub/${platform.rules}`]);
    }
    for (const [id, page, { html }] of STORE_PAGES)
    {
        files.push([join(HERE, html), `${id}/${page}.html`]);
    }
    /** @type {Record<string, string>} */
    const built = {};
    for (const flavour of /** @type {(keyof typeof PAGES)[]} */ (Object.keys(PAGES)))
    {
        const dir = join(out, flavour);
        await rm(dir, { recursive: true, force: true });
        for (const [from, to] of files)
        {
            await mkdir(dirname(join(dir, to)), { recursive: true });
            if (to.endsWith('.js'))
            {
                await writeFile(join(dir, to), laidOut(to, await readFile(from, 'utf8')));
            }
            else
            {
                await copyFile(from, join(dir, to));
            }
        }
        const hosts = HOSTS[flavour];
        for (const path of hosts ? HOST_CHECKED : [])
        {
            const script = await readFile(join(dir, path), 'utf8');
            const blank = 'const HOSTS = /** @type {RegExp | null} */ (null);';
            if (!script.includes(blank))
            {
                throw new Error(`${path} lost the line the build writes its hosts into`);
            }
            await writeFile(join(dir, path),
                script.replace(blank, ()=>`const HOSTS = new RegExp(${JSON.stringify(hosts)});`));
        }
        for (const path of TRANSPORTS[flavour] === 'frame' ? [] : TRANSPORT_WRITTEN)
        {
            const script = await readFile(join(dir, path), 'utf8');
            const blank = 'const TRANSPORT = /** @type {\'frame\' | \'tab\'} */ (\'frame\');';
            if (!script.includes(blank))
            {
                throw new Error(`${path} lost the line the build writes its transport into`);
            }
            await writeFile(join(dir, path), script.replace(blank,
                ()=>`const TRANSPORT = ${JSON.stringify(TRANSPORTS[flavour])};`));
        }
        await writeFile(join(dir, 'manifest.json'),
            `${JSON.stringify(manifestFor(flavour, version), null, 2)}\n`);
        built[flavour] = dir;
    }
    return built;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
    for (const [flavour, dir] of Object.entries(await build(process.argv[2])))
    {
        console.log(`${flavour}: ${dir}`);
    }
}
