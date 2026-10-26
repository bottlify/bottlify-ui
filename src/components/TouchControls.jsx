/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  OPACITIES, SIZES, TAP_MS, TAP_SLOP, createLook, createTouchpad, frameScale, keyChanges, keyTap,
  stickAxes, stickKeys, stickVector, tapEvents,
} from "../engine/touch.js";

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
  // Under the touchpad: the two buttons a laptop's pad has, to hold for a
  // drag or a right click without a second finger on the pad.
  mouse: [
    { label: "L", hold: { kind: "pointerButton", button: "left" } },
    { label: "R", hold: { kind: "pointerButton", button: "right" } },
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
 * @typedef {Object} TouchKeyboard
 * @property {() => boolean} show  Inside a tap's own handler only.
 * @property {() => void} hide
 * @property {() => boolean} shown
 */

/**
 * The controls a touch screen plays with, over the stage: a stick under one
 * thumb and buttons under the other, every finger its own, and the rest of the
 * screen the game's -- a tap there a click where it landed; with keys, a drag
 * there turns the view as a mouse would. Everything goes to the engine as the
 * input events its own keyboard, mouse and pad capture sends.
 *
 * With the mouse (`mouse`), the right thumb has a touchpad instead of the
 * buttons: a program that keeps its own cursor -- moved by the mouse's motion,
 * never by where a finger lands -- is driven by motion alone, and a tap on
 * the picture moves nothing.
 *
 * The controls are set over the game itself: the gear along the top opens
 * what they are and how they look, and a change is kept for the bottle.
 *
 * @param {Object} props
 * @param {(event: any) => void} props.send  The engine's `input.send`.
 * @param {ReturnType<typeof import("../engine/touch.js").touchLayout>} props.layout
 * @param {(patch: object) => void} props.onLayout  Changes and keeps the bottle's layout.
 * @param {React.RefObject<HTMLCanvasElement>} props.canvas  Where taps land.
 * @param {{ width: number, height: number } | null} props.frame  The picture the program draws.
 * @param {TouchKeyboard} props.keyboard  The engine's on-screen keyboard.
 */
export function TouchControls({ send, layout, onLayout, canvas, frame, keyboard }) {
  const [shown, setShown] = useState(true);
  const [setting, setSetting] = useState(false);
  const active = shown && layout.controls !== "off";
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
      {active && layout.controls === "keys" && (
        <LookSurface emit={emit} scale={scale} canvas={canvas} />
      )}
      {active && layout.controls === "mouse" && (
        // The picture under the mouse's controls takes no touch: one reaching
        // the canvas would be a click where the finger is, the cursor jumping
        // there from where the touchpad put it.
        <Box data-control="still" onPointerDown={(event) => event.preventDefault()}
          sx={{ position: "absolute", inset: 0, pointerEvents: "auto", touchAction: "none" }} />
      )}
      {active && (
        <Box sx={{ opacity: layout.opacity }}>
          <Stick emit={emit} mode={layout.controls} move={layout.move} size={unit * 2.4}
            side={leftHanded ? "right" : "left"} />
          <Box sx={{ position: "absolute", bottom: `calc(env(safe-area-inset-bottom) + ${unit * 0.4}px)`,
            [leftHanded ? "left" : "right"]: `calc(env(safe-area-inset-${leftHanded ? "left" : "right"}) + ${unit * 0.4}px)`,
            display: "flex", flexDirection: "column", alignItems: "center", gap: `${unit * 0.2}px`,
            pointerEvents: "none" }}>
            {layout.controls === "mouse" && <Touchpad emit={emit} scale={scale} unit={unit} />}
            <Box sx={{ display: "grid", gap: `${unit * 0.25}px`, direction: leftHanded ? "rtl" : "ltr",
              gridTemplateColumns: `repeat(2, ${unit * (layout.controls === "mouse" ? 1.6 : 1.3)}px)` }}>
              {(BUTTONS[layout.controls] ?? BUTTONS.keys).map((button) => (
                <HoldButton key={button.label} button={button} emit={emit}
                  unit={layout.controls === "mouse" ? unit * 0.75 : unit} />
              ))}
            </Box>
          </Box>
        </Box>
      )}
      <Box sx={{ position: "absolute", top: `calc(env(safe-area-inset-top) + ${unit * 0.2}px)`,
        right: `calc(env(safe-area-inset-right) + ${unit * 0.2}px)`, display: "flex",
        gap: `${unit * 0.15}px`, pointerEvents: "none" }}>
        {active && <TapButton label="Esc" unit={unit} onTap={() => keyTap("Escape").forEach(emit)} />}
        {active && <TapButton label="Enter" unit={unit} onTap={() => keyTap("Enter").forEach(emit)} />}
        {active && <KeyboardButton unit={unit} keyboard={keyboard} />}
        <TapButton label="⚙" control="Setup" unit={unit} onTap={() => setSetting((on) => !on)} />
        {layout.controls !== "off" && (
          <TapButton label={shown ? "Hide" : "Show"} unit={unit} onTap={() => setShown((on) => !on)} />
        )}
      </Box>
      {setting && <TouchSettings layout={layout} onLayout={onLayout} unit={unit}
        onClose={() => setSetting(false)} />}
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
 * @param {{ label: string, unit: number, onTap: () => void, control?: string, on?: boolean,
 *     disabled?: boolean }} props  `control`: its name where the label is a glyph; `on`: shown chosen.
 */
function TapButton({ label, unit, onTap, control = label, on = false, disabled = false }) {
  return (
    <Box component="button" type="button" data-control={control} aria-label={control} tabIndex={-1}
      aria-pressed={on} disabled={disabled}
      // Kept from taking the focus off the canvas, which the program would
      // hear as its window losing it; on mousedown, since a touch's pointerdown
      // prevented takes the click with it in WebKit, and the click is the
      // gesture a phone opens its keyboard in.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onTap}
      sx={{ minWidth: unit * 0.95, height: unit * 0.62, px: 1, borderRadius: 1, cursor: "pointer",
        fontFamily: "inherit", fontSize: unit * 0.22, fontWeight: 700, color: "rgba(255,255,255,0.9)",
        border: "1px solid rgba(255,255,255,0.4)",
        bgcolor: on ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.35)",
        ...(on ? { color: "#000" } : {}), opacity: disabled ? 0.35 : 1,
        pointerEvents: "auto", touchAction: "manipulation" }}>
      {label}
    </Box>
  );
}

/**
 * The touchpad under the right thumb, with the mouse: motion moves the
 * program's cursor from where it is, a tap clicks there, two fingers scroll
 * or right-click (`createTouchpad`).
 *
 * @param {{ emit: (event: any) => void, scale: () => { x: number, y: number }, unit: number }} props
 */
function Touchpad({ emit, scale, unit }) {
  const pad = useRef(createTouchpad());
  // A button held for a drag goes up when the pad goes away.
  useEffect(() => () => pad.current.cancel().forEach(emit), [emit]);
  return (
    <Box data-control="touchpad"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pad.current.down(event.pointerId, event.clientX, event.clientY, event.timeStamp).forEach(emit);
      }}
      onPointerMove={(event) => pad.current.move(event.pointerId, event.clientX, event.clientY,
        scale()).forEach(emit)}
      onPointerUp={(event) => pad.current.up(event.pointerId, event.timeStamp).forEach(emit)}
      onPointerCancel={() => pad.current.cancel().forEach(emit)}
      sx={{ width: unit * 4, height: unit * 2.8, borderRadius: `${unit * 0.25}px`,
        border: "2px solid rgba(255,255,255,0.35)", bgcolor: "rgba(0,0,0,0.25)",
        display: "flex", alignItems: "flex-end", justifyContent: "center", pb: `${unit * 0.1}px`,
        color: "rgba(255,255,255,0.4)", fontSize: unit * 0.2, fontWeight: 700,
        pointerEvents: "auto", touchAction: "none" }}>
      Mouse
    </Box>
  );
}

/** What the controls can be, as the settings over the game name them. */
const CONTROL_CHOICES = [
  { value: "keys", label: "Keys" }, { value: "mouse", label: "Mouse" },
  { value: "pad", label: "Gamepad" }, { value: "off", label: "Off" },
];

/**
 * The controls' settings, over the game: what they are -- a stick and buttons
 * (keys), a stick and a touchpad (mouse), a gamepad, or none, taps then being
 * clicks -- and how they look: which keys the stick presses, which side it is
 * on, how large and how see-through they are. Each change is the bottle's
 * from then on.
 *
 * @param {{ layout: ReturnType<typeof import("../engine/touch.js").touchLayout>,
 *     onLayout: (patch: object) => void, unit: number, onClose: () => void }} props
 */
function TouchSettings({ layout, onLayout, unit, onClose }) {
  const stick = layout.controls !== "off";
  const row = (/** @type {string} */ name, /** @type {React.ReactNode} */ choices) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: `${unit * 0.15}px`, flexWrap: "wrap" }}>
      <Box sx={{ width: unit * 1.6, fontSize: unit * 0.22, color: "rgba(255,255,255,0.7)" }}>{name}</Box>
      {choices}
    </Box>
  );
  return (
    <Box data-control="touch-settings" sx={{ position: "absolute", left: "50%", top: "50%",
      transform: "translate(-50%, -50%)", zIndex: 4, display: "flex", flexDirection: "column",
      gap: `${unit * 0.18}px`, p: `${unit * 0.25}px`, borderRadius: `${unit * 0.2}px`,
      bgcolor: "rgba(20,21,23,0.94)", border: "1px solid rgba(255,255,255,0.2)",
      maxWidth: "calc(100% - 24px)", maxHeight: "calc(100% - 24px)", overflow: "auto",
      pointerEvents: "auto", touchAction: "manipulation" }}>
      {row("Controls", CONTROL_CHOICES.map((choice) => (
        <TapButton key={choice.value} label={choice.label} control={`controls-${choice.value}`} unit={unit}
          on={layout.controls === choice.value} onTap={() => onLayout({ controls: choice.value })} />
      )))}
      {row("Stick keys", [["wasd", "W A S D"], ["arrows", "Arrows"]].map(([value, label]) => (
        <TapButton key={value} label={label} control={`move-${value}`} unit={unit}
          disabled={layout.controls !== "keys" && layout.controls !== "mouse"}
          on={layout.move === value} onTap={() => onLayout({ move: value })} />
      )))}
      {row("Stick", [["right", "Left"], ["left", "Right"]].map(([hand, label]) => (
        <TapButton key={hand} label={label} control={`stick-${label.toLowerCase()}`} unit={unit}
          disabled={!stick} on={layout.hand === hand} onTap={() => onLayout({ hand })} />
      )))}
      {row("Size", SIZES.map((size, index) => (
        <TapButton key={size} label={["Small", "Medium", "Large"][index]} control={`size-${size}`}
          unit={unit} disabled={!stick} on={layout.size === size} onTap={() => onLayout({ size })} />
      )))}
      {row("Opacity", OPACITIES.map((opacity) => (
        <TapButton key={opacity} label={`${Math.round(opacity * 100)}%`} control={`opacity-${opacity}`}
          unit={unit} disabled={!stick} on={layout.opacity === opacity}
          onTap={() => onLayout({ opacity })} />
      )))}
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <TapButton label="Done" unit={unit} onTap={onClose} />
      </Box>
    </Box>
  );
}

/**
 * The phone's own keyboard, the engine's (`input.showKeyboard`): shown inside
 * the tap's own gesture, the only moment a phone shows it, and what is typed
 * reaches the program as the keys that type it. A second tap puts it away.
 *
 * @param {{ unit: number, keyboard: TouchKeyboard }} props
 */
function KeyboardButton({ unit, keyboard }) {
  return (
    <TapButton label="Keys" unit={unit} onTap={() => {
      if (keyboard.shown()) keyboard.hide();
      else keyboard.show();
    }} />
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
