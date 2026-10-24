/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEAD_ZONE, createLook, frameScale, isTouchScreen, keyChanges, keyTap, stickAxes, stickKeys,
  stickVector, tapEvents, touchLayout, typedEvents,
} from "./touch.js";

/** A vector at an angle, degrees clockwise from straight up, at a length. */
const at = (degrees, length = 1) => ({
  x: Math.sin((degrees * Math.PI) / 180) * length,
  y: -Math.cos((degrees * Math.PI) / 180) * length,
});

test("a thumb past the rim holds the stick at the rim", () => {
  assert.deepEqual(stickVector(30, 40, 50), { x: 0.6, y: 0.8 });
  const far = stickVector(300, 400, 50);
  assert.ok(Math.abs(Math.hypot(far.x, far.y) - 1) < 1e-12);
  assert.ok(Math.abs(far.x - 0.6) < 1e-12);
  assert.deepEqual(stickVector(5, 5, 0), { x: 0, y: 0 }, "a stick with no reach goes nowhere");
});

test("the stick presses eight ways, a diagonal past 22.5 degrees from an axis", () => {
  assert.deepEqual(stickKeys(at(0)), ["KeyW"]);
  assert.deepEqual(stickKeys(at(20)), ["KeyW"], "still straight ahead");
  assert.deepEqual(stickKeys(at(25)), ["KeyW", "KeyD"]);
  assert.deepEqual(stickKeys(at(90)), ["KeyD"]);
  assert.deepEqual(stickKeys(at(135)), ["KeyS", "KeyD"]);
  assert.deepEqual(stickKeys(at(180)), ["KeyS"]);
  assert.deepEqual(stickKeys(at(270)), ["KeyA"]);
  assert.deepEqual(stickKeys(at(315)), ["KeyW", "KeyA"]);
  assert.deepEqual(stickKeys(at(0), "arrows"), ["ArrowUp"]);
});

test("inside the dead zone the stick presses nothing", () => {
  assert.deepEqual(stickKeys(at(45, DEAD_ZONE * 0.9)), []);
  assert.deepEqual(stickKeys(at(45, DEAD_ZONE * 1.1)), ["KeyW", "KeyD"]);
  assert.deepEqual(stickKeys({ x: 0, y: 0 }), []);
});

test("swinging the stick releases before it presses", () => {
  assert.deepEqual(keyChanges(["KeyA"], ["KeyD"]), [
    { kind: "key", code: "KeyA", down: false },
    { kind: "key", code: "KeyD", down: true },
  ]);
  assert.deepEqual(keyChanges(["KeyW"], ["KeyW", "KeyD"]), [{ kind: "key", code: "KeyD", down: true }]);
  assert.deepEqual(keyChanges(["KeyW", "KeyD"], []).map((event) => event.down), [false, false]);
  assert.deepEqual(keyChanges(["KeyW"], ["KeyW"]), []);
});

test("as a pad the stick is axes 0 and 1, sent only when they move", () => {
  const last = /** @type {[number, number]} */ ([0, 0]);
  assert.deepEqual(stickAxes({ x: 0.5, y: -1 }, last), [
    { kind: "padAxis", axis: 0, value: 0.5 },
    { kind: "padAxis", axis: 1, value: -1 },
  ]);
  assert.deepEqual(stickAxes({ x: 0.5, y: -0.5 }, last), [{ kind: "padAxis", axis: 1, value: -0.5 }]);
  assert.deepEqual(stickAxes({ x: 0.5001, y: -0.5 }, last), [], "what rounds to the same 256th is not news");
  assert.deepEqual(stickAxes({ x: 0, y: 0 }, last).map((event) => event.value), [0, 0]);
});

test("a drag turns by the program's pixels and keeps what rounding leaves", () => {
  const scale = frameScale({ width: 320, height: 240 }, { width: 640, height: 480 });
  assert.deepEqual(scale, { x: 2, y: 2 });
  const look = createLook(1);
  assert.deepEqual(look.move(3, -1.5, scale), { kind: "pointerMove", dx: 6, dy: -3 });
  const slow = createLook(1);
  const half = { x: 0.5, y: 0.5 };
  assert.equal(slow.move(1, 0, half), null, "half a pixel is not a move yet");
  assert.deepEqual(slow.move(1, 0, half), { kind: "pointerMove", dx: 1, dy: 0 }, "the second half makes one");
  assert.deepEqual(createLook(2).move(1, 1, { x: 1, y: 1 }), { kind: "pointerMove", dx: 2, dy: 2 });
});

test("a tap clicks where it landed, in the program's pixels", () => {
  assert.deepEqual(tapEvents(100.4, 50, { x: 2, y: 2 }), [
    { kind: "pointerMove", x: 201, y: 100 },
    { kind: "pointerButton", button: "left", down: true },
    { kind: "pointerButton", button: "left", down: false },
  ]);
});

test("a control key types its character between its press and release", () => {
  assert.deepEqual(keyTap("Enter"), [
    { kind: "key", code: "Enter", down: true },
    { kind: "text", text: "\r" },
    { kind: "key", code: "Enter", down: false },
  ]);
  assert.deepEqual(keyTap("Escape").map((event) => event.text ?? event.down), [true, "\x1b", false]);
  assert.deepEqual(keyTap("Space"), [
    { kind: "key", code: "Space", down: true },
    { kind: "key", code: "Space", down: false },
  ]);
});

test("the phone's keyboard types text, and Enter and Backspace as keys", () => {
  assert.deepEqual(typedEvents({ inputType: "insertText", data: "hé" }), [
    { kind: "text", text: "h" }, { kind: "text", text: "é" },
  ]);
  assert.deepEqual(typedEvents({ inputType: "insertLineBreak" }), keyTap("Enter"));
  assert.deepEqual(typedEvents({ inputType: "insertText", data: "\n" }), keyTap("Enter"));
  assert.deepEqual(typedEvents({ inputType: "deleteContentBackward" }), keyTap("Backspace"));
  assert.deepEqual(typedEvents({ inputType: "formatBold" }), [], "an edit that types nothing sends nothing");
  assert.deepEqual(typedEvents({ inputType: "insertText", data: null }), []);
});

test("a bottle's touch layout keeps only what the controls know", () => {
  assert.deepEqual(touchLayout(undefined), { controls: "keys", move: "wasd", hand: "right", size: 1 });
  assert.deepEqual(touchLayout({ controls: "pad", move: "arrows", hand: "left", size: 1.25 }),
    { controls: "pad", move: "arrows", hand: "left", size: 1.25 });
  assert.deepEqual(touchLayout({ controls: "joystick", move: "hjkl", size: 7, hand: 1 }),
    { controls: "keys", move: "wasd", hand: "right", size: 1 });
});

test("a touch screen is a coarse pointer, or touch points with no fine pointer", () => {
  const media = (coarse, fine) => (query) => ({
    matches: query === "(pointer: coarse)" ? coarse : query === "(any-pointer: fine)" ? fine : false,
  });
  assert.equal(isTouchScreen({ matchMedia: media(true, false), navigator: { maxTouchPoints: 5 } }), true);
  assert.equal(isTouchScreen({ matchMedia: media(false, true), navigator: { maxTouchPoints: 0 } }), false);
  assert.equal(isTouchScreen({ matchMedia: media(false, true), navigator: { maxTouchPoints: 10 } }), false,
    "a laptop with a touch screen and a mouse keeps the mouse");
  assert.equal(isTouchScreen({ matchMedia: media(false, false), navigator: { maxTouchPoints: 5 } }), true);
  assert.equal(isTouchScreen({}), false);
});
