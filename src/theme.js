/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { createTheme } from "@mui/material/styles";

/*
 * Graphite board + white ink, following the logo's two-colour mark
 * (#FFFFFF over #1e2022, hairlines #4a4e52). Colour is spent on one thing
 * only: how a game runs here.
 */
export const INK = Object.freeze({
  ground: "#1e2022",
  surface: "#1a1b1d",
  raised: "#2a2d30",
  line: "#4a4e52",
  text: "#f4f4f2",
  muted: "#83868b",
});

/** How a game runs, by `statusOf`'s names. */
export const STATUS_INK = Object.freeze({ works: "#6fbf8e", issues: "#e0b252", fails: "#e5675f" });

/** Golos Text has both scripts; Sora, which has no Cyrillic, sets only the logo's word. */
export const BODY_FONT = "\"Golos Text\", system-ui, sans-serif";
export const LOGO_FONT = "Sora, \"Golos Text\", system-ui, sans-serif";

/**
 * One button size everywhere. A button is told apart by its colour, never its
 * bulk: white for the one main action of a view, outlined for the rest, red
 * outline for what cannot be taken back.
 */
const BUTTON = {
  height: 40,
  minWidth: 0,
  padding: "0 18px",
  borderRadius: 9,
  fontSize: 15,
  fontWeight: 450,
  lineHeight: 1,
  whiteSpace: "nowrap",
  gap: 8,
};
const OUTLINED = {
  border: `1px solid ${INK.line}`,
  color: INK.text,
  backgroundColor: "transparent",
  "&:hover": { backgroundColor: INK.raised, borderColor: INK.line },
};
const DANGER_LINE = `color-mix(in srgb, ${STATUS_INK.fails} 45%, ${INK.line})`;

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#ffffff" },
    error: { main: STATUS_INK.fails },
    warning: { main: STATUS_INK.issues },
    success: { main: STATUS_INK.works },
    // A notice is told by its words, not a colour of its own.
    info: { main: INK.text },
    background: { default: INK.ground, paper: INK.surface },
    divider: INK.line,
    text: { primary: INK.text, secondary: INK.muted },
    action: { hover: "rgba(255,255,255,0.06)" },
  },
  shape: { borderRadius: 9 },
  typography: {
    fontFamily: BODY_FONT,
    h1: { fontWeight: 600, letterSpacing: "-0.01em" },
    h2: { fontWeight: 600, letterSpacing: "-0.01em" },
    h3: { fontWeight: 600, letterSpacing: "-0.01em" },
    h4: { fontWeight: 600, letterSpacing: "-0.01em" },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 450 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true, variant: "outlined", color: "inherit" },
      styleOverrides: {
        root: BUTTON,
        sizeSmall: BUTTON,
        sizeLarge: BUTTON,
        outlined: OUTLINED,
        // A text button is an outlined one: there are two kinds of button, not three.
        text: OUTLINED,
        outlinedError: { color: STATUS_INK.fails, borderColor: DANGER_LINE,
          "&:hover": { backgroundColor: INK.raised, borderColor: DANGER_LINE } },
        textError: { color: STATUS_INK.fails, borderColor: DANGER_LINE },
        contained: {
          backgroundColor: INK.text,
          color: INK.ground,
          border: `1px solid ${INK.text}`,
          "&:hover": { backgroundColor: "#ffffff" },
        },
        startIcon: { marginLeft: 0, marginRight: 0 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { width: 40, height: 40, borderRadius: 9, color: INK.text,
          "&:hover": { backgroundColor: INK.raised } },
        sizeSmall: { width: 40, height: 40 },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: { root: { alignSelf: "flex-start", width: "fit-content", flexWrap: "wrap" } },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          height: 40, padding: "0 16px", textTransform: "none", fontSize: 14, fontWeight: 450,
          color: INK.muted, borderColor: INK.line, whiteSpace: "nowrap",
          "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: INK.raised, color: INK.text },
        },
        sizeSmall: { height: 40, padding: "0 16px" },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiDialog: {
      styleOverrides: {
        paper: { backgroundColor: INK.surface, border: `1px solid ${INK.line}`, borderRadius: 14 },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" } },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: { padding: "16px 24px 20px", gap: 10, "& > :not(style) ~ :not(style)": { marginLeft: 0 } },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: ({ ownerState }) => (ownerState.invisible ? {} : { backgroundColor: "rgba(12,13,14,0.66)" }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 9, backgroundColor: INK.ground },
        notchedOutline: { borderColor: INK.line },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: "none", fontSize: 14, fontWeight: 450, minWidth: 0, minHeight: 0,
          padding: "14px 12px", color: INK.muted, "&.Mui-selected": { color: INK.text } },
      },
    },
    MuiTabs: {
      styleOverrides: { indicator: { backgroundColor: INK.text }, root: { minHeight: 0 } },
    },
    MuiCard: { styleOverrides: { root: { backgroundImage: "none" } } },
  },
});
