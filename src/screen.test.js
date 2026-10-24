/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PHONE_LINES, landscapeRoom, phoneScreen } from "./screen.js";

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

test("a phone held sideways is told a desktop of its shape at 768 lines", () => {
  // A 6.7-inch phone sideways in Safari: the notch's 47 px on either side, the
  // bars above and the home indicator below.
  const view = { width: 926, height: 380, dpr: 3, insets: { top: 0, right: 47, bottom: 21, left: 47 } };
  assert.deepEqual(landscapeRoom(view), { width: 832, height: 359 });
  const screen = phoneScreen(view);
  assert.equal(screen.height, PHONE_LINES);
  assert.equal(screen.width, 1776, "832:359 at 768 lines, down to a multiple of 8");
  assert.equal(screen.bitsPerPixel, 32);
});

test("held upright it is told the screen it will have once turned", () => {
  const upright = { width: 428, height: 832, dpr: 3, insets: { top: 47, right: 0, bottom: 34, left: 0 } };
  assert.deepEqual(landscapeRoom(upright), { width: 751, height: 428 });
  const turned = phoneScreen(upright);
  assert.equal(turned.height, PHONE_LINES);
  assert.equal(turned.width % 8, 0);
  assert.ok(turned.width / turned.height > 1.7 && turned.width / turned.height < 1.8);
});

test("a screen with fewer pixels than 768 lines keeps its own, and never under 640 by 480", () => {
  assert.deepEqual(phoneScreen({ width: 640, height: 360, dpr: 2, insets: NONE }),
    { width: 1280, height: 720, bitsPerPixel: 32 });
  assert.deepEqual(phoneScreen({ width: 480, height: 320, dpr: 1, insets: NONE }),
    { width: 640, height: 480, bitsPerPixel: 32 });
});

test("a very wide room is held to 1920 across", () => {
  const screen = phoneScreen({ width: 2400, height: 600, dpr: 2, insets: NONE });
  assert.equal(screen.width, 1920);
  assert.equal(screen.height, 480, "the height follows the shape, and is not let under 480");
});

test("the numbers are those a display mode has", () => {
  for (const width of [568, 667, 736, 812, 844, 896, 926, 932]) {
    for (const dpr of [2, 3]) {
      const screen = phoneScreen({ width, height: 375, dpr, insets: NONE });
      assert.equal(screen.width % 8, 0, `${width}@${dpr}`);
      assert.equal(screen.height % 2, 0, `${width}@${dpr}`);
    }
  }
});
