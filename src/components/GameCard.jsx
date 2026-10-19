/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box, Card, CardContent, CardMedia, Chip, Typography } from "@mui/material";
import { LabelBadges, VersionBadge } from "./VersionBadge.jsx";

/**
 * One game in the library grid: cover (small) + title + version.
 *
 * The art is portrait, so the card can only be made to read less like a column
 * by giving it width and by keeping the text block from adding a fixed slab of
 * height underneath — which it does regardless of how wide the card gets, and
 * so weighs proportionally less the wider the card is.
 *
 * @param {Object} props
 * @param {import("../api/bundles.js").BundleManifest} props.bundle
 * @param {() => void} props.onSelect
 * @param {() => void} [props.onSettings]  The gear in the card's left corner: the
 *     bottle's settings, without opening the card.
 * @param {() => void} [props.onEdit]  The pencil in its right corner: the bottle's
 *     name, pictures and labels, as the card's details edit them.
 */
export function GameCard({ bundle, onSelect, onSettings, onEdit }) {
  /**
   * A round button in one of the card's top corners, which does its own thing
   * and does not open the card.
   *
   * @param {"left" | "right"} side @param {string} label @param {string} glyph
   * @param {() => void} action
   */
  const corner = (side, label, glyph, action) => (
    <Box component="button" type="button" aria-label={label}
      onClick={(/** @type {any} */ event) => {
        event.stopPropagation();
        action();
      }}
      sx={{
        position: "absolute", top: 8, [side]: 8, zIndex: 1, width: 30, height: 30, p: 0,
        border: 0, borderRadius: "50%", cursor: "pointer", display: "flex",
        alignItems: "center", justifyContent: "center",
        bgcolor: "rgba(16,17,19,0.8)", color: "text.primary",
        "&:hover": { color: "primary.main" },
      }}>
      <span className={`glyphicon ${glyph}`} style={{ fontSize: 14 }} />
    </Box>
  );

  return (
    <Card
      onClick={onSelect}
      sx={{
        position: "relative",
        display: "flex",
        // On a phone a row of the list: the cover on the left, the name whole beside it.
        flexDirection: { xs: "row", sm: "column" },
        cursor: "pointer",
        border: "1px solid",
        borderColor: "divider",
        transition: "transform .2s, border-color .2s",
        background: "background.paper",
        "&:hover": { transform: "translateY(-4px)", borderColor: "primary.main" },
      }}
    >
      {onSettings && corner("left", "bottle settings", "glyphicon-cog", onSettings)}
      {onEdit && corner("right", "edit bottle", "glyphicon-pencil", onEdit)}
      {bundle.coverSmall ? (
        <CardMedia
          component="img"
          image={bundle.coverSmall}
          alt={bundle.title}
          sx={{
            // The art on disk is 3:4, so this crops nothing; it is declared so a
            // cover of another shape is centred and trimmed rather than letting
            // the card's height jump around the grid.
            aspectRatio: "3 / 4",
            width: { xs: 120, sm: "100%" },
            flexShrink: 0,
            objectFit: "cover",
            objectPosition: "center",
            bgcolor: "#101113",
          }}
        />
      ) : (
        // A bundle with no artwork yet: a fixed box where the cover would be,
        // so the grid keeps its shape instead of a card collapsing around a
        // broken image.
        <Box
          sx={{
            aspectRatio: "3 / 4",
            width: { xs: 120, sm: "100%" },
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "#101113",
            color: "text.secondary",
            opacity: 0.6,
          }}
        >
          <span className="glyphicon glyphicon-picture" style={{ fontSize: 40 }} />
        </Box>
      )}
      <CardContent sx={{ flex: 1, display: "flex", flexDirection: "column",
        minWidth: 0, py: 1.25, px: { xs: 1.5, sm: 2 }, "&:last-child": { pb: 1.5 } }}>
        {/* The title on its own line, the badges on the next: the name keeps
            its width, the release reads on the left and the marks on the
            right, as the build rather than as part of its name. */}
        {/* At most two lines in the grid, four in a phone's row; the badges
            keep to the card's foot, so they line up whatever the titles' lengths. */}
        <Typography variant="subtitle1" title={bundle.title} sx={{
          minWidth: 0, lineHeight: 1.3, overflow: "hidden",
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: { xs: 4, sm: 2 },
          fontSize: { xs: "1.05rem", sm: "1rem" },
          // Clear of the edit button, which sits over the text on a phone's row.
          pr: { xs: onEdit ? 4 : 0, sm: 0 },
        }}>
          {bundle.title}
        </Typography>
        <Box sx={{ mt: "auto", pt: 1, display: "flex", alignItems: "center", gap: 0.5, minHeight: 20,
          flexWrap: { xs: "wrap", sm: "nowrap" } }}>
          <VersionBadge version={bundle.version} />
          {bundle.local && (
            <Chip label="LOCAL" size="small" color="info" variant="outlined"
              title="Kept in this browser"
              sx={{ height: 20, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }} />
          )}
          {/* Under the name on a phone's row, all to the left; to the right in the grid. */}
          <Box sx={{ ml: { xs: 0, sm: "auto" }, display: "flex", flexWrap: "wrap", gap: 0.5,
            justifyContent: { xs: "flex-start", sm: "flex-end" } }}>
            <LabelBadges labels={bundle.status ? [...bundle.labels, bundle.status] : bundle.labels} />
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
