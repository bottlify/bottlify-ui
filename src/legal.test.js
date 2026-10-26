/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { OWN_LICENSE_URL, takedownEmailOf } from "./legal.js";

test("Bottlify's own licence has a text to read", () => {
  assert.match(OWN_LICENSE_URL, /^https:\/\//);
});

test("a contact is the deployment's address, and none for anything that is not one", () => {
  assert.equal(takedownEmailOf("legal@bottlify.app"), "legal@bottlify.app");
  assert.equal(takedownEmailOf(" legal@bottlify.app "), "legal@bottlify.app");
  for (const asked of [undefined, "", "legal", "a b@c.d", 42, null]) {
    assert.equal(takedownEmailOf(asked), "", String(asked));
  }
});
