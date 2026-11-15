/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRedistributable, sha256Hex } from "./redist.js";

/** @param {Uint8Array} bytes */
const served = (bytes) => async () => new Response(new Blob([bytes]).stream());

test("a redistributable is taken only when it is the publisher's file, byte for byte", async () => {
  const bytes = new TextEncoder().encode("the setup");
  const one = { name: "setup.exe", source: "", size: bytes.length, sha256: await sha256Hex(bytes) };
  /** @type {number[]} */
  const seen = [];
  const got = await fetchRedistributable(one, (read) => seen.push(read),
    /** @type {any} */ (served(bytes)));
  assert.deepEqual([...got], [...bytes]);
  assert.equal(seen.at(-1), bytes.length, "told as it arrives");

  const other = new TextEncoder().encode("the setuP");
  await assert.rejects(fetchRedistributable(one, undefined, /** @type {any} */ (served(other))),
    /is not the publisher's file/);
  await assert.rejects(fetchRedistributable(one, undefined,
    /** @type {any} */ (served(bytes.subarray(0, 4)))), /is not the publisher's file/);
  await assert.rejects(fetchRedistributable(one, undefined,
    /** @type {any} */ (async () => new Response("", { status: 404 }))), /npm run redist/);
});
