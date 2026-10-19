/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Chip } from "@mui/material";

/** The one look every badge under a title has. @param {"small" | "medium"} size */
const badge = (size) => ({
  height: size === "medium" ? 24 : 20,
  flexShrink: 0,
  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
  fontWeight: 700,
  fontSize: size === "medium" ? 12 : 11,
  letterSpacing: "0.04em",
  color: "primary.main",
  borderColor: "primary.main",
  bgcolor: "transparent",
  "& .MuiChip-label": { px: 0.75 },
});

/**
 * A release as a small badge under a title: `v1.26`. One component for both
 * the card and the details panel, so the two cannot drift apart.
 *
 * @param {Object} props
 * @param {string} [props.version]
 * @param {"small" | "medium"} [props.size]
 */
export function VersionBadge({ version, size = "small" }) {
  const text = String(version ?? "").trim();
  // A bundle with no version at all has nothing to set apart, and an empty
  // badge would read as a missing value rather than as no release named.
  if (!text) return null;
  return <Chip label={`v${text}`} size={size} variant="outlined" sx={badge(size)} />;
}

/**
 * What a bottle is marked as -- DEMO, BENCHMARK, TEST -- each a badge drawn
 * like the version, so a card reads its release on the left and its marks on
 * the right.
 *
 * @param {Object} props
 * @param {string[]} [props.labels]
 * @param {"small" | "medium"} [props.size]
 */
export function LabelBadges({ labels = [], size = "small" }) {
  return labels.map((label) => (
    <Chip
      key={label}
      label={label.toUpperCase()}
      size={size}
      variant="outlined"
      sx={badge(size)}
    />
  ));
}
