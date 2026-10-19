/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { OWN_LICENSE_URL, TAKEDOWN_EMAIL } from "./legal.js";

test("Bottlify's own licence has a text to read", () => {
  assert.match(OWN_LICENSE_URL, /^https:\/\//);
});

test("a contact, when there is one, is an address", () => {
  assert.ok(TAKEDOWN_EMAIL === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(TAKEDOWN_EMAIL));
});
