/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Steam's session frame (`steam/session.html`), which the launcher embeds:
 * Steam's protocol over a CM socket this frame opens -- an extension page's
 * socket, which Steam's ruleset gives Steam's Origin -- and Steam's directory
 * and Valve's client files asked from here, the extension reaching their hosts
 * (frame.js).
 */

import { runFrame } from '../../frame.js';
import { steamStore } from './store.js';
import { cachedClientFetch } from './client.js';

runFrame('steam', vault=>steamStore({ vault,
    fetch: /** @type {typeof fetch} */ (cachedClientFetch(url=>fetch(url))) }));
