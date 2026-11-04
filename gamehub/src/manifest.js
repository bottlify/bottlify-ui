/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The extension's manifest, one source for its builds: `public` runs on
 * Bottlify's own sites alone, `dev` on any page, a local launcher's too, and
 * `safari` as `dev` with each store run in a tab of its site (`TRANSPORTS`).
 *
 * A host permission is the page's as well as the platform's: Chrome applies a
 * ruleset's header changes only to a request whose URL and whose initiator
 * the extension may both reach, so a page missing from them is silently left
 * as it was. `*://` does not cover `wss://`, which is listed for itself.
 */

/** The pages GameHub serves, by build. */
export const PAGES = Object.freeze({
    public: Object.freeze(['https://bottlify.app/*', 'https://play.bottlify.app/*']),
    // Any page: a launcher is reached as localhost, 127.0.0.1 or a machine's
    // address on its network, and a match pattern takes no wildcard inside an
    // address. The dev build is loaded by hand, never published.
    dev: Object.freeze(['<all_urls>']),
    safari: Object.freeze(['<all_urls>']),
});

/**
 * Where each build runs a store's protocol: `frame`, the store's session
 * frame, an extension page the launcher embeds, its socket given the store's
 * Origin by the store's ruleset; `tab`, a tab of the store's own site the
 * worker drives (relay.js), for a browser that applies no ruleset to an
 * extension's own request - Safari (WebKit bug 253696).
 */
export const TRANSPORTS = Object.freeze(/** @type {const} */ ({
    public: 'frame', dev: 'frame', safari: 'tab' }));

const DEV_HOSTS = [String.raw`localhost|.+\.localhost`, String.raw`127\.\d+\.\d+\.\d+`,
    String.raw`192\.168\.\d+\.\d+`, String.raw`(play\.)?bottlify\.app`]
    .map(host=>`^(${host})$`).join('|');

/**
 * The hosts a build's GameHub answers on, by name, where its match patterns
 * cannot say it: the dev build, matched on every page, answers on a local
 * launcher's alone -- localhost, 127.x, a 192.168.x.x network address -- and
 * on Bottlify's sites. Null: every page the build is matched on.
 */
export const HOSTS = Object.freeze({
    public: null,
    dev: DEV_HOSTS,
    safari: DEV_HOSTS,
});

/**
 * Each store: its ruleset (switched on and off as one), the hosts the
 * ruleset and the extension's own requests reach, and its pages, which the
 * build lays out at `<store>/<page>.html` and the launcher frames: `session`,
 * which speaks the store's protocol (frame.js), and `signin`.
 */
export const PLATFORMS = Object.freeze({
    steam: Object.freeze({
        rules: 'rules/steam.json',
        // Where its tab is opened, in a build that runs it in one.
        site: 'https://steamcommunity.com/',
        pages: Object.freeze({
            session: Object.freeze({ html: 'src/stores/steam/session.html',
                script: 'gamehub/src/stores/steam/session-page.js' }),
            signin: Object.freeze({ html: 'src/stores/steam/signin.html',
                script: 'gamehub/src/stores/steam/signin.js' }),
        }),
        // The CM socket the session frame and the sign-in page open; the
        // content servers the page downloads from; Steam's directory and
        // Valve's client distribution (the client's own DLLs, which a DRM
        // wrapper reads as the installed client's), asked by the frame.
        hosts: Object.freeze(['wss://*.steamserver.net/*', 'https://api.steampowered.com/*',
            '*://*.steamcontent.com/*', '*://*.steampipe.akamaized.net/*',
            'https://client-update.akamai.steamstatic.com/*',
            // The apps' art a library shows (stores/steam/apps.js, STEAM_ART),
            // under the hosts Steam has served it from.
            'https://shared.steamstatic.com/*', 'https://shared.akamai.steamstatic.com/*',
            'https://shared.cloudflare.steamstatic.com/*', 'https://cdn.akamai.steamstatic.com/*',
            'https://cdn.cloudflare.steamstatic.com/*']),
    }),
});

/** Each store's pages, `[store, page, { html, script }]`. */
export const STORE_PAGES = Object.freeze(Object.entries(PLATFORMS).flatMap(([id, platform])=>
    Object.entries(platform.pages).map(([page, files])=>
        /** @type {[string, string, { html: string, script: string }]} */ ([id, page, files]))));

/**
 * The builds' entry points, by their paths in the build
 * out: the service worker, the content script -- which imports nothing -- and
 * each store's pages' scripts.
 */
export const ENTRIES = Object.freeze(['gamehub/src/worker.js', 'gamehub/src/content.js',
    'gamehub/src/tab.js', 'gamehub/src/tab-session.js', 'gamehub/src/wire.js',
    ...STORE_PAGES.map(([, , files])=>files.script)]);

/** The scripts the build writes its transport into (`TRANSPORTS`). */
export const TRANSPORT_WRITTEN = Object.freeze(['gamehub/src/content.js', 'gamehub/src/worker.js']);

/**
 * The scripts that check the page they serve, by its host, where the build's
 * pages cannot say it (`HOSTS`): the content script, a session frame's
 * runner, and each sign-in page.
 */
export const HOST_CHECKED = Object.freeze(['gamehub/src/content.js', 'gamehub/src/frame.js',
    ...STORE_PAGES.filter(([, page])=>page === 'signin').map(([, , files])=>files.script)]);

/**
 * The pages that may frame a store's pages. The dev build's are its hosts
 * (`HOSTS`), which a match pattern cannot say of a network address: any page,
 * the store's page itself refusing a frame on another host.
 */
export const FRAMED_BY = PAGES;

/**
 * @param {keyof typeof PAGES} build
 * @param {string} version
 */
export function manifestFor(build, version){
    const pages = [...PAGES[build]];
    const sites = TRANSPORTS[build] === 'tab'
        ? Object.values(PLATFORMS).map(platform=>`${platform.site}*`) : [];
    return {
        manifest_version: 3,
        name: build === 'public' ? 'Bottlify GameHub' : `Bottlify GameHub (${build})`,
        version,
        description: 'Connects Bottlify to your game libraries; sign-ins stay in the extension.',
        permissions: ['declarativeNetRequest', 'storage'],
        host_permissions: [...pages, ...sites,
            ...Object.values(PLATFORMS).flatMap(platform=>platform.hosts)],
        background: { service_worker: 'gamehub/src/worker.js', type: 'module' },
        content_scripts: [
            { matches: pages, js: ['gamehub/src/content.js'], run_at: 'document_start' },
            ...sites.length
                ? [{ matches: sites, js: ['gamehub/src/tab.js'], run_at: 'document_idle' }] : []],
        // A store's pages alone, as frames: no module is the page's to load -
        // but where the stores run in a tab, the content script's on the store's
        // site loads the store's side by address, and its sign-in page's markup.
        web_accessible_resources: [{
            resources: STORE_PAGES.map(([id, page])=>`${id}/${page}.html`),
            matches: [...FRAMED_BY[build]] },
        ...sites.length ? [{ resources: ['gamehub/*', 'core/*',
            ...STORE_PAGES.map(([id, page])=>`${id}/${page}.html`)], matches: sites }] : []],
        declarative_net_request: {
            rule_resources: Object.entries(PLATFORMS).map(([id, platform])=>(
                { id, enabled: true, path: `gamehub/${platform.rules}` })),
        },
    };
}
