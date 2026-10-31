/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { useMemo, useRef, useState } from "react";
import {
  Badge, Box, Button, ButtonBase, Checkbox, Chip, Divider, FormControlLabel, InputAdornment,
  MenuItem, Popover, TextField, Typography,
} from "@mui/material";
import { FILTER_GROUPS, FILTERS, SORTS, viewLibrary, withStoreGames } from "../api/libraryView.js";
import { loadSettings, saveSettings } from "../settings.js";
import { GameCard } from "./GameCard.jsx";
import { StoreInstall } from "./Stores.jsx";
import { providerOf } from "../stores/providers.js";

const toggled = (held, value) => (held.includes(value)
  ? held.filter((one) => one !== value)
  : [...held, value]);

/**
 * What Filters opens: the order, then a group of checkboxes each. A popover
 * rather than a menu, so it stays open while several values are checked, and
 * rows tall enough for a finger.
 *
 * @param {Object} props
 * @param {HTMLElement | null} props.anchor  Open while set.
 * @param {() => void} props.onClose
 * @param {typeof FILTER_GROUPS} props.groups  The groups offered.
 * @param {string[]} props.checked
 * @param {(value: string) => void} props.onToggle
 * @param {() => void} props.onClear
 * @param {string} props.sort
 * @param {(value: string) => void} props.onSort
 */
function FiltersPanel({ anchor, onClose, groups, checked, onToggle, onClear, sort, onSort }) {
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{ paper: { sx: { mt: 1, width: 320, maxWidth: "calc(100vw - 32px)", p: 2 } } }}
    >
      <TextField
        select
        fullWidth
        size="small"
        label="Sort by"
        value={sort}
        onChange={(event) => onSort(event.target.value)}
      >
        {SORTS.map(({ value, label }) => (
          <MenuItem key={value} value={value}>{label}</MenuItem>
        ))}
      </TextField>
      {groups.map((group) => (
        <Box key={group.key} role="group" aria-label={group.title} sx={{ mt: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            {group.title}
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            {group.options.map(({ value, label }) => (
              <FormControlLabel key={value} label={label} sx={{ mr: 0 }}
                control={<Checkbox size="small" checked={checked.includes(value)}
                  onChange={() => onToggle(value)} />} />
            ))}
          </Box>
        </Box>
      ))}
      {groups.length > 0 && (<>
        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            A group with nothing checked shows everything.
          </Typography>
          <Button size="small" onClick={onClear} disabled={checked.length === 0}>Clear</Button>
        </Box>
      </>)}
    </Popover>
  );
}

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
 * @param {boolean} [props.tagged]  Kind and status are offered as filters; without
 *     them they narrow nothing, whatever was last checked.
 * @param {ReturnType<typeof import("./Stores.jsx").useStores>} [props.stores]  The game
 *     stores' accounts signed in in this browser: their games not installed are cards
 *     beside the bottles, each with its Install.
 */
export function GameGrid({
  bundles, onSelect, onSettings, onEdit, editable = false, blurred, tagged = false, stores,
}) {
  // The search is for now; the filters and the order are kept, so the library
  // opens as it was left. A forgotten search would read as games gone missing.
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(() => loadSettings().libraryFilters);
  const [sort, setSort] = useState(() => loadSettings().librarySort);
  const [open, setOpen] = useState(/** @type {HTMLElement | null} */ (null));
  const button = useRef(null);
  const known = stores?.stores;
  const everything = useMemo(() => withStoreGames(bundles, known ?? []), [bundles, known]);
  // Where it comes from is asked only while something does come from a store;
  // kind and status only where the configuration offers them. A value of a
  // group not offered is kept for when it is, and meanwhile narrows nothing.
  const fromStores = Boolean(known?.some((one) => one.account)) || bundles.some((one) => providerOf(one));
  const offered = FILTER_GROUPS.filter((group) => (group.key === "source" ? fromStores : tagged));
  const checked = filters.filter((value) => offered.some((group) =>
    group.options.some((one) => one.value === value)));
  const shown = viewLibrary(everything, { query, filters: checked, sort });
  const chooseFilters = (next) => {
    setFilters(next);
    saveSettings({ libraryFilters: next });
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
        {/* Over the catalog, at its right: the search by name, and Filters with
            what narrows it and the order it is in. On a phone the row takes the
            whole width under the title. */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto",
          flex: { xs: "1 1 100%", sm: "0 1 auto" } }}>
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
            sx={{ flex: 1, minWidth: 0, width: { sm: 320 } }}
          />
          <Badge badgeContent={checked.length} color="primary">
            <Button ref={button} variant="outlined" color="inherit" aria-haspopup="dialog"
              aria-expanded={Boolean(open)} onClick={() => setOpen(button.current)}
              startIcon={<span className="glyphicon glyphicon-filter" style={{ fontSize: 12 }} />}
              sx={{ height: 40, whiteSpace: "nowrap", borderColor: "divider" }}>
              Filters
            </Button>
          </Badge>
          <FiltersPanel anchor={open} onClose={() => setOpen(null)} groups={offered}
            checked={checked} onToggle={(value) => chooseFilters(toggled(filters, value))}
            onClear={() => chooseFilters(filters.filter((value) => !checked.includes(value)))}
            sort={sort} onSort={chooseSort} />
        </Box>
      </Box>
      {/* What is checked, each a chip that lets it go; nothing at all while
          nothing is, so the plain library has no row of it. */}
      {checked.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: -1.5, mb: 3 }}>
          {FILTERS.filter((one) => checked.includes(one.value)).map(({ value, label }) => (
            <Chip key={value} size="small" label={label}
              onDelete={() => chooseFilters(toggled(filters, value))} />
          ))}
        </Box>
      )}
      {shown.length === 0 && (
        <Typography color="text.secondary">Nothing in the library matches.</Typography>
      )}
      {/* The bottles kept in this browser apart from the server's: the same
          cards, under a heading each once there are any of the first. */}
      {[
        { key: "local", heading: "In this browser", items: shown.filter((one) => one.local) },
        { key: "server", heading: "On the server", items: shown.filter((one) => !one.local && !one.store) },
        // A store being read shows so, before its games are known as after.
        ...(known ?? []).map(({ provider, syncing }) => ({ key: provider.id, syncing,
          heading: `On ${provider.name}, not installed${syncing ? " · syncing…" : ""}`,
          items: shown.filter((one) => one.store?.provider === provider.id) })),
      ].filter((group) => group.items.length > 0 || group.syncing).map((group, _index, groups) => (
        <Box key={group.key} sx={{ mb: 4 }}>
          {groups.length > 1 || group.key !== "server" ? (
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
            {group.items.map((bundle) => (bundle.store ? (
              <GameCard key={`${group.key}:${bundle.id}`} bundle={bundle}
                footer={<StoreInstall game={bundle.store.game}
                  job={known?.find((one) => one.provider.id === bundle.store.provider)
                    ?.jobs.get(bundle.store.game.id)}
                  onInstall={() => stores?.install(bundle.store.provider, bundle.store.game)}
                  onCancel={() => stores?.cancel(bundle.store.provider, bundle.store.game)} />} />
            ) : (
              <GameCard key={`${group.key}:${bundle.id}`} bundle={bundle}
                onSelect={() => onSelect(bundle)}
                onSettings={onSettings ? () => onSettings(bundle) : undefined}
                onEdit={onEdit && (editable || bundle.local) ? () => onEdit(bundle) : undefined} />
            )))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
