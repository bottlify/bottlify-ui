/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { useMemo, useState } from "react";
import {
  Box, ButtonBase, Chip, InputAdornment, MenuItem, TextField, Typography,
} from "@mui/material";
import { SORTS, TAGS, viewLibrary } from "../api/libraryView.js";
import { loadSettings, saveSettings } from "../settings.js";
import { GameCard } from "./GameCard.jsx";

/** A tag in the filter: on, what carries it shows; off, all of it is gone. */
function Tag({ label, on, onToggle }) {
  return (
    <Chip
      label={label}
      size="small"
      clickable
      color={on ? "primary" : "default"}
      variant={on ? "filled" : "outlined"}
      aria-pressed={on}
      onClick={onToggle}
    />
  );
}

const toggled = (held, value) => (held.includes(value)
  ? held.filter((one) => one !== value)
  : [...held, value]);

/**
 * The library: its title, the way back to the front page, and the grid of
 * games. Blurs as one when a game is selected or running; what is behind
 * stays visible but muted.
 *
 * The way back is a plain href, like the header's own navigation, so it
 * is still a link: middle-click and the back button behave.
 *
 * @param {Object} props
 * @param {import("../api/bundles.js").BundleManifest[]} props.bundles
 * @param {(bundle: import("../api/bundles.js").BundleManifest) => void} props.onSelect
 * @param {(bundle: import("../api/bundles.js").BundleManifest) => void} [props.onSettings]
 *     A card's gear: that bottle's settings.
 * @param {(bundle: import("../api/bundles.js").BundleManifest) => void} [props.onEdit]
 *     A card's pencil: that bottle's name, pictures and labels.
 * @param {boolean} [props.editable]  The server's bottles are this launcher's to
 *     describe; a bottle kept in this browser always is.
 * @param {boolean} props.blurred
 * @param {boolean} [props.tagged]  The tags are offered as filters; without them the
 *     library is shown whole, whatever tags were last chosen.
 */
export function GameGrid({ bundles, onSelect, onSettings, onEdit, editable = false, blurred, tagged = false }) {
  // The search is for now; the tags and the order are kept, so the library
  // opens as it was left. A forgotten search would read as games gone missing.
  const [query, setQuery] = useState("");
  const [chosen, setTags] = useState(() => loadSettings().libraryTags);
  const tags = tagged ? chosen : TAGS.map(({ value }) => value);
  const [sort, setSort] = useState(() => loadSettings().librarySort);
  const shown = useMemo(
    () => viewLibrary(bundles, { query, tags, sort }),
    [bundles, query, tags, sort]);
  const chooseTags = (value) => {
    const next = toggled(tags, value);
    setTags(next);
    saveSettings({ libraryTags: next });
  };
  const chooseSort = (value) => {
    setSort(value);
    saveSettings({ librarySort: value });
  };
  return (
    <Box
      component="main"
      sx={{
        p: 4,
        filter: blurred ? "blur(14px) saturate(0.7)" : "none",
        opacity: blurred ? 0.55 : 1,
        transition: "filter .45s ease, opacity .45s ease",
        pointerEvents: blurred ? "none" : "auto",
      }}
    >
      {/* Arrow and title are one target: the heading names where you are and
          the arrow says what pressing it does, and splitting them would leave
          the larger of the two dead under the pointer. */}
      <Box sx={{
        mb: 3, display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 2,
      }}>
        <ButtonBase
          href="/"
          aria-label="Back to home"
          focusRipple
          sx={{
            ml: -1.5,
            px: 1.5,
            py: 0.5,
            gap: 1,
            borderRadius: 1,
            color: "text.primary",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <span className="glyphicon glyphicon-chevron-left" style={{ fontSize: 14 }} />
          <Typography variant="h5" component="span" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
            Library
          </Typography>
        </ButtonBase>
        {/* Over the catalog, at its right: the search by name, the tags that
            narrow it and the order it is in. */}
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.5, ml: "auto" }}>
          {tagged && (
            <Box role="group" aria-label="Filter by tag"
              sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
              {TAGS.map(({ value, label }) => (
                <Tag key={value} label={label} on={tags.includes(value)}
                  onToggle={() => chooseTags(value)} />
              ))}
            </Box>
          )}
          <TextField
            size="small"
            placeholder="Search by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputProps={{ "aria-label": "Search by name" }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <span className="glyphicon glyphicon-search" style={{ fontSize: 12 }} />
                </InputAdornment>
              ),
            }}
            sx={{ width: 220 }}
          />
          <TextField
            select
            size="small"
            value={sort}
            onChange={(event) => chooseSort(event.target.value)}
            inputProps={{ "aria-label": "Sort" }}
            sx={{ minWidth: 150 }}
          >
            {SORTS.map(({ value, label }) => (
              <MenuItem key={value} value={value}>{label}</MenuItem>
            ))}
          </TextField>
        </Box>
      </Box>
      {shown.length === 0 && (
        <Typography color="text.secondary">Nothing in the library matches.</Typography>
      )}
      {/* The bottles kept in this browser apart from the server's: the same
          cards, under a heading each once there are any of the first. */}
      {[
        { key: "local", heading: "In this browser", items: shown.filter((one) => one.local) },
        { key: "server", heading: "On the server", items: shown.filter((one) => !one.local) },
      ].filter((group) => group.items.length > 0).map((group, _index, groups) => (
        <Box key={group.key} sx={{ mb: 4 }}>
          {groups.length > 1 || group.key === "local" ? (
            <Typography variant="h6" color="text.secondary" sx={{ mb: 1.5 }}>
              {group.heading}
            </Typography>
          ) : null}
          <Box
            sx={{
              display: "grid",
              // One row a game on a phone, a grid of covers elsewhere.
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(auto-fill, minmax(220px, 1fr))",
              },
              gap: 2.5,
            }}
          >
            {group.items.map((bundle) => (
              <GameCard key={`${group.key}:${bundle.id}`} bundle={bundle}
                onSelect={() => onSelect(bundle)}
                onSettings={onSettings ? () => onSettings(bundle) : undefined}
                onEdit={onEdit && (editable || bundle.local) ? () => onEdit(bundle) : undefined} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
