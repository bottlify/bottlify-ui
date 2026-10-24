/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLook, frameScale, keyChanges, keyTap, stickAxes, stickKeys, stickVector, tapEvents,
  typedEvents,
} from "../engine/touch.js";

/** How far a finger may move, in CSS pixels, and still be a tap rather than a drag. */
const TAP_SLOP = 10;
/** How long a press may last and still be a tap. */
const TAP_MS = 350;

/**
 * The buttons over the right thumb, by control mode: what each sends while it
 * is held. A key is held as a key; the fire button holds the left mouse
 * button, which is what a game of this era shoots with; the wheel turns once
 * per press. As a pad, the face buttons by the Gamepad API's standard order.
 */
const BUTTONS = {
  keys: [
    { label: "Fire", hold: { kind: "pointerButton", button: "left" }, big: true },
    { label: "Jump", hold: { kind: "key", code: "Space" } },
    { label: "Crouch", hold: { kind: "key", code: "KeyC" } },
    { label: "Next", wheel: -120 },
  ],
  pad: [
    { label: "A", hold: { kind: "padButton", index: 0 }, big: true },
    { label: "B", hold: { kind: "padButton", index: 1 } },
    { label: "X", hold: { kind: "padButton", index: 2 } },
    { label: "Y", hold: { kind: "padButton", index: 3 } },
  ],
};

/**
 * The event a held button sends, pressed or let go.
 *
 * @param {any} hold @param {boolean} down
 */
const holdEvent = (hold, down) => ({ ...hold, down });

/**
 * The controls a touch screen plays with, over the stage: a stick under one
 * thumb and buttons under the other, every finger its own, and the rest of the
 * screen the game's -- a tap there a click where it landed; with keys, a drag
 * there turns the view as a mouse would. Everything goes to the engine as the
 * input events its own keyboard, mouse and pad capture sends.
 *
 * @param {Object} props
 * @param {(event: any) => void} props.send  The engine's `input.send`.
 * @param {{ controls: "keys" | "pad" | "off", move: string, hand: string, size: number }} props.layout
 * @param {React.RefObject<HTMLCanvasElement>} props.canvas  Where taps land.
 * @param {{ width: number, height: number } | null} props.frame  The picture the program draws.
 */
export function TouchControls({ send, layout, canvas, frame }) {
  const [shown, setShown] = useState(true);
  const unit = 56 * layout.size;
  const leftHanded = layout.hand === "left";
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  const emit = useCallback((event) => sendRef.current(event), []);

  const scale = () => {
    const box = canvas.current?.getBoundingClientRect();
    return box && frame ? frameScale(box, frame) : { x: 1, y: 1 };
  };

  return (
    <Box sx={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none",
      paddingTop: "env(safe-area-inset-top)", paddingRight: "env(safe-area-inset-right)",
      paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)",
      userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      {shown && layout.controls === "keys" && (
        <LookSurface emit={emit} scale={scale} canvas={canvas} />
      )}
      {shown && (
        <>
          <Stick emit={emit} mode={layout.controls} move={layout.move} size={unit * 2.4}
            side={leftHanded ? "right" : "left"} />
          <Box sx={{ position: "absolute", bottom: `calc(env(safe-area-inset-bottom) + ${unit * 0.4}px)`,
            [leftHanded ? "left" : "right"]: `calc(env(safe-area-inset-${leftHanded ? "left" : "right"}) + ${unit * 0.4}px)`,
            display: "grid", gridTemplateColumns: `repeat(2, ${unit * 1.3}px)`, gap: `${unit * 0.25}px`,
            pointerEvents: "none", direction: leftHanded ? "rtl" : "ltr" }}>
            {(BUTTONS[layout.controls] ?? BUTTONS.keys).map((button) => (
              <HoldButton key={button.label} button={button} emit={emit} unit={unit} />
            ))}
          </Box>
        </>
      )}
      <Box sx={{ position: "absolute", top: `calc(env(safe-area-inset-top) + ${unit * 0.2}px)`,
        right: `calc(env(safe-area-inset-right) + ${unit * 0.2}px)`, display: "flex",
        gap: `${unit * 0.15}px`, pointerEvents: "none" }}>
        {shown && <TapButton label="Esc" unit={unit} onTap={() => keyTap("Escape").forEach(emit)} />}
        {shown && <TapButton label="Enter" unit={unit} onTap={() => keyTap("Enter").forEach(emit)} />}
        {shown && <KeyboardButton unit={unit} emit={emit} canvas={canvas} />}
        <TapButton label={shown ? "Hide" : "Pad"} unit={unit} onTap={() => setShown((on) => !on)} />
      </Box>
    </Box>
  );
}

/**
 * The stick: where the thumb comes down is its centre, within its corner of
 * the screen, so a thumb never has to find it.
 *
 * @param {{ emit: (event: any) => void, mode: string, move: string, size: number, side: string }} props
 */
function Stick({ emit, mode, move, size, side }) {
  const [knob, setKnob] = useState(/** @type {{ x: number, y: number } | null} */ (null));
  const held = useRef({ pointer: -1, cx: 0, cy: 0, keys: /** @type {string[]} */ ([]),
    axes: /** @type {[number, number]} */ ([0, 0]) });
  const reach = size / 2;

  const apply = (vector) => {
    if (mode === "pad") {
      stickAxes(vector, held.current.axes).forEach(emit);
      return;
    }
    const keys = stickKeys(vector, /** @type {any} */ (move));
    keyChanges(held.current.keys, keys).forEach(emit);
    held.current.keys = keys;
  };

  const release = () => {
    held.current.pointer = -1;
    apply({ x: 0, y: 0 });
    setKnob(null);
  };
  // Let go of whatever is held when the controls go away, and only then.
  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });
  useEffect(() => () => {
    if (held.current.pointer !== -1) releaseRef.current();
  }, []);

  return (
    <Box
      data-control="stick"
      onPointerDown={(event) => {
        if (held.current.pointer !== -1) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        held.current.pointer = event.pointerId;
        held.current.cx = event.clientX;
        held.current.cy = event.clientY;
        setKnob({ x: 0, y: 0 });
      }}
      onPointerMove={(event) => {
        if (event.pointerId !== held.current.pointer) return;
        const vector = stickVector(event.clientX - held.current.cx, event.clientY - held.current.cy, reach);
        apply(vector);
        setKnob({ x: vector.x * reach, y: vector.y * reach });
      }}
      onPointerUp={(event) => event.pointerId === held.current.pointer && release()}
      onPointerCancel={(event) => event.pointerId === held.current.pointer && release()}
      sx={{ position: "absolute", bottom: 0, [side]: 0, width: "45%", height: "70%",
        pointerEvents: "auto", touchAction: "none" }}
    >
      <Box sx={{ position: "absolute", bottom: size * 0.25, [side]: size * 0.25, width: size, height: size,
        borderRadius: "50%", border: "2px solid rgba(255,255,255,0.35)", bgcolor: "rgba(0,0,0,0.18)" }}>
        <Box sx={{ position: "absolute", left: "50%", top: "50%", width: size * 0.42, height: size * 0.42,
          borderRadius: "50%", bgcolor: knob ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.3)",
          transform: `translate(calc(-50% + ${knob?.x ?? 0}px), calc(-50% + ${knob?.y ?? 0}px))` }} />
      </Box>
    </Box>
  );
}

/**
 * A button held as a key, a mouse button or a pad's button; or one that turns
 * the wheel a notch per press.
 *
 * @param {{ button: any, emit: (event: any) => void, unit: number }} props
 */
function HoldButton({ button, emit, unit }) {
  const pointer = useRef(-1);
  const [down, setDown] = useState(false);
  const press = (event) => {
    if (pointer.current !== -1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointer.current = event.pointerId;
    setDown(true);
    if (button.hold) emit(holdEvent(button.hold, true));
    if (button.wheel) emit({ kind: "wheel", delta: button.wheel });
  };
  const release = (event) => {
    if (event && event.pointerId !== pointer.current) return;
    pointer.current = -1;
    setDown(false);
    if (button.hold) emit(holdEvent(button.hold, false));
  };
  // Let go when the controls go away, and only then.
  const letGo = useRef(() => {});
  useEffect(() => {
    letGo.current = () => {
      if (pointer.current !== -1 && button.hold) emit(holdEvent(button.hold, false));
    };
  });
  useEffect(() => () => letGo.current(), []);
  const size = unit * (button.big ? 1.3 : 1.1);
  return (
    <Box data-control={button.label} onPointerDown={press} onPointerUp={release} onPointerCancel={release}
      sx={{ width: size, height: size, borderRadius: "50%", justifySelf: "center", alignSelf: "center",
        display: "flex", alignItems: "center", justifyContent: "center", direction: "ltr",
        fontSize: unit * 0.26, fontWeight: 700, color: "rgba(255,255,255,0.9)",
        border: "2px solid rgba(255,255,255,0.4)",
        bgcolor: down ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)",
        pointerEvents: "auto", touchAction: "none" }}>
      {button.label}
    </Box>
  );
}

/**
 * A small button that acts once per tap.
 *
 * @param {{ label: string, unit: number, onTap: () => void }} props
 */
function TapButton({ label, unit, onTap }) {
  return (
    <Box component="button" type="button" data-control={label} tabIndex={-1}
      // Kept from taking the focus off the canvas, which the program would
      // hear as its window losing it; on mousedown, since a touch's pointerdown
      // prevented takes the click with it in WebKit, and the click is the
      // gesture a phone opens its keyboard in.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onTap}
      sx={{ minWidth: unit * 0.95, height: unit * 0.62, px: 1, borderRadius: 1, cursor: "pointer",
        fontFamily: "inherit", fontSize: unit * 0.22, fontWeight: 700, color: "rgba(255,255,255,0.9)",
        border: "1px solid rgba(255,255,255,0.4)", bgcolor: "rgba(0,0,0,0.35)",
        pointerEvents: "auto", touchAction: "manipulation" }}>
      {label}
    </Box>
  );
}

/**
 * The phone's own keyboard: a tap focuses a field kept off the picture -- in
 * the tap's own gesture, the only moment a phone shows its keyboard -- and what
 * is typed there goes to the program as text, Enter, Backspace and Escape as
 * keys. The field always holds one character, so a Backspace on what looks
 * empty still has something to delete and is heard.
 *
 * @param {{ unit: number, emit: (event: any) => void, canvas: React.RefObject<HTMLCanvasElement> }} props
 */
function KeyboardButton({ unit, emit, canvas }) {
  const field = useRef(/** @type {HTMLInputElement | null} */ (null));
  const reset = () => {
    const input = field.current;
    if (!input) return;
    input.value = " ";
    input.setSelectionRange?.(1, 1);
  };
  // The field's own beforeinput, not React's: React's is put together from
  // older events and says nothing of what kind of edit it was.
  const emitRef = useRef(emit);
  useEffect(() => {
    emitRef.current = emit;
  }, [emit]);
  useEffect(() => {
    const input = field.current;
    if (!input) return undefined;
    /** @param {InputEvent} event */
    const typed = (event) => {
      event.preventDefault();
      typedEvents({ inputType: event.inputType, data: event.data }).forEach((one) => emitRef.current(one));
      input.value = " ";
      input.setSelectionRange?.(1, 1);
    };
    /** @param {KeyboardEvent} event */
    const pressed = (event) => {
      // A field fires no beforeinput for these, typed on a keyboard with keys.
      if (event.key === "Enter" || event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        keyTap(event.key).forEach((one) => emitRef.current(one));
      }
    };
    input.addEventListener("beforeinput", typed);
    input.addEventListener("keydown", pressed);
    return () => {
      input.removeEventListener("beforeinput", typed);
      input.removeEventListener("keydown", pressed);
    };
  }, []);
  return (
    <>
      <TapButton label="Keys" unit={unit} onTap={() => {
        const input = field.current;
        if (!input) return;
        if (document.activeElement === input) {
          input.blur();
          return;
        }
        reset();
        input.focus();
        // The canvas lost the focus to the field, and the engine told the
        // program its window did; the window is still the one being typed at.
        emit({ kind: "focus", gained: true });
      }} />
      <Box component="input" ref={field} type="text" aria-label="Type to the program"
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        enterKeyHint="send"
        onInput={reset}
        onBlur={() => canvas.current?.focus()}
        sx={{ position: "fixed", left: 0, bottom: 0, width: 1, height: 1, opacity: 0,
          // Under 16 px, a phone zooms the page in on the field when it takes the focus.
          fontSize: 16, border: 0, padding: 0, pointerEvents: "none" }} />
    </>
  );
}

/**
 * The screen under the controls, with keys: a finger dragged turns the view by
 * mouse motion, and one lifted without moving clicks where it came down. Taps
 * off the picture -- in the bars beside it -- click nothing.
 *
 * @param {{ emit: (event: any) => void, scale: () => { x: number, y: number },
 *     canvas: React.RefObject<HTMLCanvasElement> }} props
 */
function LookSurface({ emit, scale, canvas }) {
  const fingers = useRef(new Map());
  const look = useRef(createLook(1.5));
  return (
    <Box data-control="look"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY,
          startX: event.clientX, startY: event.clientY, at: event.timeStamp, dragged: false });
      }}
      onPointerMove={(event) => {
        const finger = fingers.current.get(event.pointerId);
        if (!finger) return;
        const dx = event.clientX - finger.x;
        const dy = event.clientY - finger.y;
        finger.x = event.clientX;
        finger.y = event.clientY;
        if (!finger.dragged && Math.hypot(event.clientX - finger.startX, event.clientY - finger.startY) > TAP_SLOP) {
          finger.dragged = true;
        }
        if (finger.dragged) {
          const motion = look.current.move(dx, dy, scale());
          if (motion) emit(motion);
        }
      }}
      onPointerUp={(event) => {
        const finger = fingers.current.get(event.pointerId);
        fingers.current.delete(event.pointerId);
        if (!finger || finger.dragged || event.timeStamp - finger.at > TAP_MS) return;
        const box = canvas.current?.getBoundingClientRect();
        if (!box) return;
        const x = finger.startX - box.left;
        const y = finger.startY - box.top;
        if (x < 0 || y < 0 || x > box.width || y > box.height) return;
        tapEvents(x, y, scale()).forEach(emit);
      }}
      onPointerCancel={(event) => fingers.current.delete(event.pointerId)}
      sx={{ position: "absolute", inset: 0, pointerEvents: "auto", touchAction: "none" }} />
  );
}
