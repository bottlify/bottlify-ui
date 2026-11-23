/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box, ButtonBase, Typography } from "@mui/material";
import { INK } from "../theme.js";
import { Art } from "./kit.jsx";

/**
 * One game in the library: its cover, its name, and a line under it -- how it
 * runs here, or what a store's game is. The whole of it opens the game.
 *
 * @param {Object} props
 * @param {{ title: string, coverSmall?: string, coverFallback?: string }} props.item
 * @param {import("react").ReactNode} props.note  The line under the name.
 * @param {() => void} props.onOpen
 */
export function GameCard({ item, note, onOpen }) {
  return (
    <ButtonBase onClick={onOpen} focusRipple sx={{
      display: "block", textAlign: "left", borderRadius: "6px", width: "100%",
      "&:hover .cover, &.Mui-focusVisible .cover": { outline: `2px solid ${INK.text}`, outlineOffset: 0 },
    }}>
      <Box className="cover" sx={{ borderRadius: "6px", overflow: "hidden", outline: `1px solid ${INK.line}`,
        outlineOffset: "-1px" }}>
        <Art src={item.coverSmall ?? ""} fallback={item.coverFallback} title={item.title} ratio="2 / 3" />
      </Box>
      {/* Two lines at most, the whole name on hover: a third would make the card taller than its row's. */}
      <Typography title={item.title} sx={{ mt: 1.25, fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {item.title}
      </Typography>
      <Typography component="div" sx={{ fontSize: 13, color: "text.secondary" }}>{note}</Typography>
    </ButtonBase>
  );
}

/**
 * The last tile of the person's games: where a game of their own is added.
 *
 * @param {{ title: string, text: string, onAdd: () => void }} props
 */
export function AddTile({ title, text, onAdd }) {
  return (
    <ButtonBase onClick={onAdd} focusRipple sx={{
      aspectRatio: "2 / 3", width: "100%", borderRadius: "6px", border: `1.5px dashed ${INK.line}`,
      display: "grid", placeContent: "center", textAlign: "center", gap: 1.25, p: 2, color: "text.secondary",
      "&:hover, &.Mui-focusVisible": { borderColor: INK.text },
    }}>
      <Typography component="strong" sx={{ color: "text.primary", fontSize: 16, fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography component="span" sx={{ fontSize: 13 }}>{text}</Typography>
    </ButtonBase>
  );
}
