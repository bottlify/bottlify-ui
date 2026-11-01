/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depotOwners, sharedDepots, wantedDepot } from './apps.js';

test('an install takes the depots of other apps the app names, at their owners\' manifests',
    ()=>{
        const shared = (/** @type {any} */ config)=>({ config, depotfromapp: '228980' });
        const info = { depots: {
            228986: { ...shared({ oslist: 'windows' }), sharedinstall: '1' },
            228990: shared({ oslist: 'windows' }),
            228999: shared({ oslist: 'macos' }),
            228998: shared({ oslist: 'windows', language: 'german' }),
            228997: shared(undefined),
            361422: { config: { oslist: 'windows' }, manifests: { public: { gid: '5' } } },
            branches: { public: { buildid: '1' } },
        } };
        const gid = (/** @type {string} */ value)=>({ manifests: { public: { gid: value } } });
        const owner = { depots: { 228986: gid('8782296191957114623'),
            228990: gid('1829726630299308803'), 228999: gid('3'), 228998: gid('4') } };
        assert.deepEqual(depotOwners(info), [228980]);
        assert.deepEqual(sharedDepots(info, new Map([[228980, owner]])), [
            { id: 228986, app: 228980, gid: 8782296191957114623n },
            { id: 228990, app: 228980, gid: 1829726630299308803n },
        ], 'Windows\' and the language\'s; one the owner has no manifest for is not');
        assert.deepEqual(sharedDepots(info, new Map()), [], 'no owner\'s info, none');
        assert.equal(wantedDepot({ config: { oslist: 'windows' }, dlcappid: '9' }, 'english'),
            false);
        assert.equal(wantedDepot({}, 'english'), true);
    });
