/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { shownToThePerson } from "./boxes.js";

test("a program's own box is put in front of the person, whichever process raised it", () => {
  assert.equal(shownToThePerson({ id: 3, text: "36 file(s) unzipped successfully" }), true);
});

test("the engine's notice that the program finished is not: the launcher tells the end", () => {
  assert.equal(shownToThePerson({ id: 0, text: "The game has finished and its process has stopped.",
    exit: { code: 0 } }), false);
});
