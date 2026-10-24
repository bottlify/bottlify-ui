/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * What the on-screen controls send the engine, worked out apart from the
 * screen so it can be tested: a stick as keys or as a pad's axes, a drag as
 * mouse motion, a tap as a click, and typing as text and keys -- each as the
 * engine's own input events (`app.input.send`, `HostInputEvent` in
 * `@bottlify/core`).
 */

/**
 * @typedef {{ kind: string, code?: string, down?: boolean, text?: string, x?: number,
 *     y?: number, dx?: number, dy?: number, button?: string, delta?: number,
 *     axis?: number, value?: number, index?: number }} InputEvent
 */

/** The keys a stick presses, by the name a bottle's settings give them. */
export const MOVE_KEYS = Object.freeze({
  wasd: Object.freeze({ up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" }),
  arrows: Object.freeze({ up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }),
});

/** How far from the centre a stick has to be pushed before it counts, as a share of its reach. */
export const DEAD_ZONE = 0.25;

/**
 * Where a stick is, as a vector of at most unit length: a thumb past the rim
 * holds the stick at the rim, as a real one stops there.
 *
 * @param {number} dx  From the stick's centre, in CSS pixels; right is positive.
 * @param {number} dy  Down is positive.
 * @param {number} reach  The rim's distance from the centre.
 * @returns {{ x: number, y: number }}
 */
export function stickVector(dx, dy, reach) {
  if (!(reach > 0)) return { x: 0, y: 0 };
  const x = dx / reach;
  const y = dy / reach;
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

/**
 * The keys a stick holds down: eight ways, a diagonal holding both of its keys
 * once the stick is within 22.5 degrees of it; none inside the dead zone.
 *
 * @param {{ x: number, y: number }} vector
 * @param {keyof typeof MOVE_KEYS} [scheme]
 * @returns {string[]}  In up, down, left, right order.
 */
export function stickKeys(vector, scheme = "wasd") {
  const keys = MOVE_KEYS[scheme] ?? MOVE_KEYS.wasd;
  if (Math.hypot(vector.x, vector.y) < DEAD_ZONE) return [];
  // tan(22.5 degrees): past it, the other axis is held as well.
  const lean = Math.tan(Math.PI / 8);
  const held = [];
  const ax = Math.abs(vector.x);
  const ay = Math.abs(vector.y);
  if (ay > 0 && ax / ay <= 1 / lean) held.push(vector.y < 0 ? keys.up : keys.down);
  if (ax > 0 && ay / ax <= 1 / lean) held.push(vector.x < 0 ? keys.left : keys.right);
  return held;
}

/**
 * The key events that take the keys held from one set to another: releases
 * first, so a stick swung from left to right never holds both.
 *
 * @param {string[]} before @param {string[]} after
 * @returns {InputEvent[]}
 */
export function keyChanges(before, after) {
  return [
    ...before.filter((code) => !after.includes(code)).map((code) => ({ kind: "key", code, down: false })),
    ...after.filter((code) => !before.includes(code)).map((code) => ({ kind: "key", code, down: true })),
  ];
}

/**
 * A stick as a pad's left stick, as the Gamepad API reports one -- axis 0
 * across, axis 1 down -- and as the engine reads a pad: the dead zone is the
 * program's to apply, so the values go as they are, to a 256th.
 *
 * @param {{ x: number, y: number }} vector
 * @param {[number, number]} last  The values last sent, updated in place.
 * @returns {InputEvent[]}  Only the axes that moved.
 */
export function stickAxes(vector, last) {
  const events = [];
  const values = [vector.x, vector.y].map((value) => Math.round(value * 256) / 256);
  for (const axis of [0, 1]) {
    if (values[axis] !== last[axis]) {
      last[axis] = values[axis];
      events.push({ kind: "padAxis", axis, value: values[axis] });
    }
  }
  return events;
}

/**
 * How many of the program's pixels one CSS pixel of the canvas is.
 *
 * @param {{ width: number, height: number }} box  The canvas as laid out.
 * @param {{ width: number, height: number }} frame  The picture the program draws.
 */
export function frameScale(box, frame) {
  return {
    x: box.width > 0 ? frame.width / box.width : 1,
    y: box.height > 0 ? frame.height / box.height : 1,
  };
}

/**
 * Mouse motion from a finger dragged over the screen: in the program's pixels,
 * times a sensitivity, with what rounding leaves carried to the next move so a
 * slow drag still turns.
 *
 * @param {number} [sensitivity]
 */
export function createLook(sensitivity = 1) {
  let restX = 0;
  let restY = 0;
  return {
    /**
     * @param {number} dx @param {number} dy  The finger's motion in CSS pixels.
     * @param {{ x: number, y: number }} scale  `frameScale` of the canvas.
     * @returns {InputEvent | null}
     */
    move(dx, dy, scale) {
      const x = dx * scale.x * sensitivity + restX;
      const y = dy * scale.y * sensitivity + restY;
      const wholeX = Math.trunc(x);
      const wholeY = Math.trunc(y);
      restX = x - wholeX;
      restY = y - wholeY;
      return wholeX === 0 && wholeY === 0 ? null : { kind: "pointerMove", dx: wholeX, dy: wholeY };
    },
    reset() {
      restX = 0;
      restY = 0;
    },
  };
}

/**
 * A tap as a click where it landed: the pointer moved there, then the button
 * pressed and released. The move names the position only: the engine works a
 * touch's motion out from where its last position was, which is what moves a
 * cursor a program draws for itself from DirectInput's motion.
 *
 * @param {number} x @param {number} y  In the canvas's CSS pixels from its corner.
 * @param {{ x: number, y: number }} scale  `frameScale` of the canvas.
 * @param {string} [button]
 * @returns {InputEvent[]}
 */
export function tapEvents(x, y, scale, button = "left") {
  return [
    { kind: "pointerMove", x: Math.round(x * scale.x), y: Math.round(y * scale.y) },
    { kind: "pointerButton", button, down: true },
    { kind: "pointerButton", button, down: false },
  ];
}

/** What a control key types, as the engine's keyboard sends it beside the key. */
const CONTROL_TEXT = Object.freeze({ Enter: "\r", Backspace: "\b", Escape: "\x1b", Tab: "\t" });

/**
 * A key tapped from the controls: down, the character it types where it types
 * one, up.
 *
 * @param {string} code  A `KeyboardEvent.code`.
 * @returns {InputEvent[]}
 */
export function keyTap(code) {
  const text = /** @type {Record<string, string>} */ (CONTROL_TEXT)[code];
  return [
    { kind: "key", code, down: true },
    ...(text ? [{ kind: "text", text }] : []),
    { kind: "key", code, down: false },
  ];
}

/**
 * What the on-screen keyboard typed, from the hidden field's `beforeinput`:
 * characters as text, a deletion as Backspace, a line break as Enter. A phone's
 * keyboard sends no key events of its own that can be trusted, so the edit the
 * field was about to make is the account of what was pressed.
 *
 * @param {{ inputType: string, data?: string | null }} event
 * @returns {InputEvent[]}
 */
export function typedEvents(event) {
  switch (event.inputType) {
    case "insertText":
    case "insertReplacementText":
    case "insertFromPaste":
    case "insertCompositionText":
      return [...(event.data ?? "")].flatMap((character) => (character === "\n"
        ? keyTap("Enter") : [{ kind: "text", text: character }]));
    case "insertLineBreak":
    case "insertParagraph":
      return keyTap("Enter");
    case "deleteContentBackward":
    case "deleteWordBackward":
    case "deleteSoftLineBackward":
      return keyTap("Backspace");
    default:
      return [];
  }
}

/** What a bottle's touch controls are, when its settings say nothing. */
export const TOUCH_DEFAULTS = Object.freeze({ controls: "keys", move: "wasd", hand: "right", size: 1 });

/**
 * The touch controls a bottle runs with: what this browser keeps for it, over
 * the defaults, every field checked.
 *
 * @param {any} stored
 * @returns {{ controls: "keys" | "pad" | "off", move: keyof typeof MOVE_KEYS,
 *     hand: "right" | "left", size: number }}
 */
export function touchLayout(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  return {
    controls: ["keys", "pad", "off"].includes(source.controls) ? source.controls : TOUCH_DEFAULTS.controls,
    move: Object.hasOwn(MOVE_KEYS, source.move) ? source.move : TOUCH_DEFAULTS.move,
    hand: source.hand === "left" ? "left" : "right",
    size: [0.8, 1, 1.25].includes(source.size) ? source.size : TOUCH_DEFAULTS.size,
  };
}

/**
 * Whether this page is in front of a touch screen with no mouse to rely on:
 * a coarse primary pointer, or touch points and no fine pointer at all.
 *
 * @param {{ matchMedia?: (query: string) => { matches: boolean },
 *     navigator?: { maxTouchPoints?: number } }} scope
 */
export function isTouchScreen(scope) {
  const coarse = scope.matchMedia?.("(pointer: coarse)").matches ?? false;
  const fine = scope.matchMedia?.("(any-pointer: fine)").matches ?? false;
  return coarse || ((scope.navigator?.maxTouchPoints ?? 0) > 0 && !fine);
}
