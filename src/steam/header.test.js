/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { decodeSession, encodeSession } from "./header.js";

test("a session goes through the header whole, a non-ASCII account name included", () => {
  const session = { accountName: "Игрок", refreshToken: "eyJ.a-b_c.d" };
  assert.deepEqual(decodeSession(encodeSession(session)), session);
});

test("anything that is not a session is none", () => {
  for (const value of [undefined, "", "%%%", btoa("[]"), btoa("{\"accountName\":\"a\"}"),
    btoa("{\"accountName\":\"\",\"refreshToken\":\"t\"}"), "x".repeat(9000), ["a"]]) {
    assert.equal(decodeSession(/** @type {any} */ (value)), null);
  }
});
