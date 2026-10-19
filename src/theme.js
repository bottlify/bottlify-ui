/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { createTheme } from "@mui/material/styles";

/*
 * Graphite board + white ink, following the logo's two-colour mark
 * (#FFFFFF over #1e2022, hairlines #4a4e52).
 */
export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#ffffff" },
    background: {
      default: "#1e2022",
      paper: "#1a1b1d",
    },
    divider: "#4a4e52",
    text: {
      primary: "#f4f4f2",
      secondary: "#83868b",
    },
    action: {
      hover: "rgba(255,255,255,0.06)",
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: "\"Segoe UI\", system-ui, sans-serif",
    button: {
      textTransform: "none",
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderColor: "#4a4e52",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
  },
});
