/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LAUNCHER_CREDITS, OWN_LICENSE_URL, takedownEmailOf } from "./legal.js";

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

test("every typeface the launcher serves is credited, its licence's text beside it", () => {
  const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
  const css = readFileSync(new URL("./fonts.css", import.meta.url), "utf8");
  const served = [...css.matchAll(/font-family: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(served.length > 0);
  for (const family of served) {
    assert.ok(LAUNCHER_CREDITS.some((one) => one.name === family), `${family} is credited`);
  }
  for (const credit of LAUNCHER_CREDITS) {
    assert.match(credit.home, /^https:\/\//);
    if (credit.text) assert.ok(existsSync(publicDir + credit.text.slice(1)), `${credit.text} is served`);
  }
  for (const file of [...css.matchAll(/url\("\/([^"]+)"\)/g)].map((match) => match[1])) {
    assert.ok(existsSync(publicDir + file), `${file} is served`);
  }
});
