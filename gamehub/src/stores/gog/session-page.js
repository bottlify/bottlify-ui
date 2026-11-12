/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * GOG's session frame (`gog/session.html`), which the launcher embeds: GOG's
 * API asked from here, the extension reaching its hosts (frame.js).
 */

import { runFrame } from '../../frame.js';
import { gogStore } from './store.js';

runFrame('gog', vault=>gogStore({ vault }));
