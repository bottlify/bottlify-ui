/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { useLayoutEffect, useRef } from "react";
import { Box, IconButton, Switch, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { INK, STATUS_INK } from "../theme.js";
import { useArt } from "./useArt.js";

/*
 * The few pieces every screen of the launcher is built from, so a button, a
 * status or a dialog's head looks the same wherever it is.
 */

/** Stroked line icons on a 24-unit grid, drawn in the text's colour. */
const PATHS = {
  play: <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"
    fill="currentColor" stroke="none" />,
  pause: <path d="M8 5v14M16 5v14" strokeWidth="2.6" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"
    strokeLinejoin="round" />,
  cross: <path d="M6 6l12 12M18 6L6 18" strokeWidth="2" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d={"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82"
        + "-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33"
        + "l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0"
        + "-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65"
        + " 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0"
        + " 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2"
        + " 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"} strokeLinejoin="round" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  sound: (
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" strokeLinejoin="round" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" strokeLinejoin="round" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  folder: <path d="M3.5 6.5h6l2 2h9v10h-17z" strokeLinejoin="round" />,
  log: <path d="M5 5h14M5 10h14M5 15h9M5 20h6" />,
  back: <path d="M15 5l-7 7 7 7" />,
};

/**
 * @param {Object} props
 * @param {keyof typeof PATHS} props.name
 * @param {number} [props.size]
 */
export function Icon({ name, size = 16 }) {
  return (
    <Box component="svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" aria-hidden sx={{ flex: "none", display: "block" }}>
      {PATHS[name]}
    </Box>
  );
}

/**
 * Buttons that share one width: the widest one's own, read from the buttons
 * as drawn (each first at its natural width) and again once the typeface has
 * loaded or what `deps` names changes - the language, which buttons show.
 * The buttons are those under the returned ref marked `data-action`.
 *
 * @param {unknown[]} deps
 * @returns {import("react").RefObject<HTMLElement | null>}
 */
export function useEqualButtons(deps) {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  useLayoutEffect(() => {
    const fit = () => {
      const buttons = /** @type {HTMLElement[]} */ ([...ref.current?.querySelectorAll("[data-action]") ?? []]);
      for (const button of buttons) button.style.width = "";
      const widest = Math.max(0, ...buttons.map((button) => button.getBoundingClientRect().width));
      for (const button of buttons) button.style.width = `${Math.ceil(widest)}px`;
    };
    fit();
    let live = true;
    document.fonts?.ready.then(() => live && fit());
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** The plain cross a dialog or a sheet is closed with. @param {{ onClick: () => void, label: string }} props */
export function CloseButton({ onClick, label }) {
  return (
    <IconButton aria-label={label} onClick={onClick} sx={{ color: "text.secondary", flex: "none",
      "&:hover": { color: "text.primary", bgcolor: INK.raised } }}>
      <Icon name="cross" size={18} />
    </IconButton>
  );
}

/**
 * A dialog's head: its title, a line under it, the close cross on the right.
 *
 * @param {Object} props
 * @param {import("react").ReactNode} props.title
 * @param {import("react").ReactNode} [props.subtitle]
 * @param {(() => void) | null} [props.onClose]
 * @param {string} [props.closeLabel]
 * @param {string} [props.id]  Names the dialog for assistive technology.
 */
export function DialogHead({ title, subtitle, onClose, closeLabel = "", id }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, px: 4, pt: 3, pb: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography id={id} component="h2" sx={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2,
          letterSpacing: "-0.01em", overflowWrap: "anywhere" }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 1.25 }}>{subtitle}</Typography>
        )}
      </Box>
      {onClose && <Box sx={{ mt: -0.75, mr: -1 }}><CloseButton onClick={onClose} label={closeLabel} /></Box>}
    </Box>
  );
}

/**
 * A choice of a few, side by side, as wide as its labels and never stretched.
 *
 * @template {string | number} V
 * @param {Object} props
 * @param {V} props.value
 * @param {{ value: V, label: string }[]} props.options
 * @param {(value: V) => void} props.onChange
 * @param {string} [props.label]  Names the group for assistive technology.
 * @param {boolean} [props.disabled]
 */
export function Segmented({ value, options, onChange, label, disabled = false }) {
  return (
    <ToggleButtonGroup exclusive value={value} aria-label={label} disabled={disabled}
      onChange={(_event, chosen) => chosen !== null && onChange(chosen)}>
      {options.map((one) => (
        <ToggleButton key={String(one.value)} value={one.value}>{one.label}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/**
 * How a game runs here, in its colour: the one place the launcher is not
 * monochrome. Unknown is said in the muted ink.
 *
 * @param {Object} props
 * @param {"works" | "issues" | "fails" | null} props.status
 * @param {string} props.children  What the status is called.
 * @param {boolean} [props.dot]  A dot before it, where it stands among other facts.
 * @param {boolean} [props.strong]
 */
export function StatusText({ status, children, dot = false, strong = false }) {
  return (
    <Box component="span" sx={{
      color: status ? STATUS_INK[status] : INK.muted, display: "inline-flex", alignItems: "center",
      gap: 1, fontWeight: strong ? 600 : "inherit",
      ...(dot ? { "&::before": { content: "''", width: 9, height: 9, borderRadius: "50%",
        bgcolor: "currentColor", flex: "none" } } : {}),
    }}>
      {children}
    </Box>
  );
}

/**
 * A picture of a game, or where it has none, its initial on the board.
 *
 * @param {Object} props
 * @param {string} props.src  Empty for none; a store's picture is asked for as this page may show it.
 * @param {string} props.title
 * @param {string} [props.fallback]  Shown where `src` does not load.
 * @param {string} props.ratio  The box's shape; the picture is fitted into it.
 * @param {"cover" | "contain"} [props.fit]
 * @param {import("@mui/material").SxProps} [props.sx]
 */
export function Art({ src: asked, title, fallback: askedFallback = "", ratio, fit = "cover", sx = {} }) {
  const src = useArt(asked);
  const fallback = useArt(askedFallback);
  const box = { aspectRatio: ratio, width: "100%", display: "block", bgcolor: INK.raised, ...sx };
  // Still being asked for: the board alone, not the initial that would flash before it.
  if (asked && !src) return <Box sx={box} aria-hidden />;
  if (!src) {
    return (
      <Box sx={{ ...box, display: "grid", placeItems: "center", containerType: "size" }} aria-hidden>
        <Typography component="span" sx={{ fontSize: "42cqmin", fontWeight: 700, color: INK.muted,
          lineHeight: 1 }}>
          {title.trim().charAt(0).toUpperCase()}
        </Typography>
      </Box>
    );
  }
  return (
    <Box component="img" src={src} alt="" loading="lazy"
      // Steam's and GOG's art from their CDNs, which answer any origin: asked
      // with CORS, a cross-origin isolated page shows it without GameHub's headers.
      {...(/^https:\/\/(shared\.steamstatic\.com|images(-\d+)?\.gog-statics\.com)\//.test(src)
        ? { crossOrigin: "anonymous" } : {})}
      onError={(/** @type {any} */ event) => {
        const img = event.currentTarget;
        if (fallback && img.src !== fallback) img.src = fallback;
      }}
      sx={{ ...box, objectFit: fit, objectPosition: "center top" }} />
  );
}

/**
 * A setting that is on or off: what it is, a line on what it does, the switch.
 *
 * @param {Object} props
 * @param {string} props.title
 * @param {string} [props.text]
 * @param {boolean} props.checked
 * @param {(on: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]
 */
export function SwitchRow({ title, text, checked, onChange, disabled = false }) {
  return (
    <Box component="label" sx={{ display: "flex", gap: 3, justifyContent: "space-between",
      alignItems: "flex-start", py: 1.25, cursor: disabled ? "default" : "pointer" }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
        {text && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{text}</Typography>}
      </Box>
      <Switch checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}
        sx={{
          // The board's own switch: a pill of 46 x 28, white when on, its knob the board's.
          flex: "none", width: 46, height: 28, p: 0, mt: -0.25,
          "& .MuiSwitch-switchBase": { p: "5px", color: INK.muted,
            "&.Mui-checked": { transform: "translateX(18px)", color: INK.ground } },
          "& .MuiSwitch-thumb": { width: 18, height: 18, boxShadow: "none" },
          "& .MuiSwitch-track": { borderRadius: 14, bgcolor: INK.raised, opacity: 1,
            border: `1px solid ${INK.line}`, boxSizing: "border-box" },
          "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { bgcolor: INK.text, opacity: 1,
            borderColor: INK.text },
        }} />
    </Box>
  );
}

/** A heading over a group of settings. @param {{ children: string }} props */
export function SectionTitle({ children }) {
  return <Typography component="h3" sx={{ fontSize: 16, fontWeight: 600, mb: 0.5 }}>{children}</Typography>;
}
