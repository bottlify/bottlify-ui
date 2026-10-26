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

/** How far a finger may move, in CSS pixels, and still be a tap rather than a drag. */
export const TAP_SLOP = 10;
/** How long a press may last and still be a tap. */
export const TAP_MS = 350;
/** How soon after a tap a finger coming down again takes the button with it, for a drag. */
export const DRAG_AFTER_TAP_MS = 300;
/** How far two fingers move together, in CSS pixels, for one notch of the wheel. */
export const SCROLL_STEP = 24;
/** Program pixels per touchpad pixel, over the picture's own scale: a pad is a fraction of the picture. */
export const PAD_SPEED = 2.5;

/**
 * The touchpad: fingers on it, as a laptop's pad reads them, turned into the
 * mouse a program reads -- relative motion only, so the cursor moves from
 * where it is and never jumps to where a finger came down.
 *
 * One finger moves the cursor; lifted soon and still, it is a left click
 * where the cursor is. A finger that comes down again soon after a tap and
 * moves holds the left button for a drag. Two fingers lifted soon and still
 * are a right click; two moved up or down turn the wheel, the content
 * following the fingers as a phone's does.
 *
 * Each method answers the events to send, in order.
 *
 * @param {number} [speed]  Program pixels per pad pixel, at a picture's scale of one.
 */
export function createTouchpad(speed = PAD_SPEED) {
  const look = createLook(speed);
  /** @type {Map<number, { x: number, y: number, startX: number, startY: number, at: number }>} */
  const fingers = new Map();
  let lastTap = -Infinity;
  let dragArmed = false;
  let dragging = false;
  /** The fingers this touch has had at once, and whether any moved past a tap. */
  let most = 0;
  let moved = false;
  let began = 0;
  let scrollRest = 0;

  /** @param {boolean} down @param {string} [button] */
  const press = (down, button = "left") => ({ kind: "pointerButton", button, down });

  return {
    /** @param {number} id @param {number} x @param {number} y @param {number} at */
    down(id, x, y, at) {
      if (fingers.size === 0) {
        most = 0;
        moved = false;
        began = at;
        dragArmed = at - lastTap <= DRAG_AFTER_TAP_MS;
      }
      fingers.set(id, { x, y, startX: x, startY: y, at });
      most = Math.max(most, fingers.size);
      return [];
    },

    /**
     * @param {number} id @param {number} x @param {number} y
     * @param {{ x: number, y: number }} scale  The picture's program pixels per CSS pixel.
     */
    move(id, x, y, scale) {
      const finger = fingers.get(id);
      if (!finger) return [];
      const dx = x - finger.x;
      const dy = y - finger.y;
      finger.x = x;
      finger.y = y;
      if (Math.hypot(x - finger.startX, y - finger.startY) > TAP_SLOP) moved = true;
      /** @type {any[]} */
      const events = [];
      if (fingers.size >= 2) {
        // The fingers' mean motion: each moves its share.
        scrollRest += dy / fingers.size;
        const notches = Math.trunc(scrollRest / SCROLL_STEP);
        if (notches !== 0) {
          scrollRest -= notches * SCROLL_STEP;
          // Fingers going up push the content up, which is scrolling down: a negative wheel.
          events.push({ kind: "wheel", delta: notches * 120 });
        }
        return events;
      }
      if (dragArmed && moved && !dragging) {
        dragging = true;
        events.push(press(true));
      }
      const motion = look.move(dx, dy, scale);
      if (motion) events.push(motion);
      return events;
    },

    /** @param {number} id @param {number} at */
    up(id, at) {
      if (!fingers.delete(id) || fingers.size > 0) return [];
      scrollRest = 0;
      if (dragging) {
        dragging = false;
        dragArmed = false;
        return [press(false)];
      }
      if (moved || at - began > TAP_MS) return [];
      if (most >= 2) return [press(true, "right"), press(false, "right")];
      lastTap = at;
      return [press(true), press(false)];
    },

    /** The fingers went away without lifting (the touch was cancelled). */
    cancel() {
      fingers.clear();
      scrollRest = 0;
      if (!dragging) return [];
      dragging = false;
      dragArmed = false;
      return [press(false)];
    },
  };
}

/** What a bottle's touch controls are, when its settings say nothing. */
export const TOUCH_DEFAULTS = Object.freeze({ controls: "keys", move: "wasd", hand: "right", size: 1,
  opacity: 1 });

/** The controls there are: a stick and buttons, a stick and a touchpad, a gamepad, or none. */
export const CONTROLS = Object.freeze(["keys", "mouse", "pad", "off"]);
export const SIZES = Object.freeze([0.8, 1, 1.25]);
export const OPACITIES = Object.freeze([0.4, 0.7, 1]);

/**
 * The touch controls a bottle runs with: what this browser keeps for it, over
 * the defaults, every field checked.
 *
 * @param {any} stored
 * @returns {{ controls: "keys" | "mouse" | "pad" | "off", move: keyof typeof MOVE_KEYS,
 *     hand: "right" | "left", size: number, opacity: number }}
 */
export function touchLayout(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  return {
    controls: CONTROLS.includes(source.controls) ? source.controls : TOUCH_DEFAULTS.controls,
    move: Object.hasOwn(MOVE_KEYS, source.move) ? source.move : TOUCH_DEFAULTS.move,
    hand: source.hand === "left" ? "left" : "right",
    size: SIZES.includes(source.size) ? source.size : TOUCH_DEFAULTS.size,
    opacity: OPACITIES.includes(source.opacity) ? source.opacity : TOUCH_DEFAULTS.opacity,
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
