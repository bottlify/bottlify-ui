/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Box, Button, ClickAwayListener, IconButton, Link, Menu, MenuItem, Paper, Popper, Slider, Stack,
  Tooltip, Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { CHANGED, loadSettings, saveSettings } from "../settings.js";
import { SpaceIndicator } from "./StorageSettings.jsx";

/**
 * The bar carried by both the landing page and the library.
 *
 * Navigation is plain hrefs rather than callbacks so the header stays
 * ignorant of who renders it, and so a link is still a link: middle-click,
 * copy address and the back button all behave.
 *
 * @param {Object} props
 * @param {(() => void) | null} [props.onAdd]  Absent means the button is not there
 *        at all -- installing is configuration, not a disabled control.
 * @param {(() => void) | null} [props.onAddFromAccount]  Add's second way in: the
 *        game accounts, whose games show in the library each with its Install.
 * @param {(() => void) | null} [props.onSettings]  Absent likewise: the settings
 *        are about runs, and belong only where a run can be started.
 * @param {(() => void) | null} [props.onStorage]  Absent likewise: the room this
 *        site has left, which opens what each bottle keeps here.
 */
export function AppHeader({ onAdd, onAddFromAccount, onSettings, onStorage }) {
  const [adding, setAdding] = useState(/** @type {HTMLElement | null} */ (null));
  return (
    <Box
      component="header"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        px: { xs: 2.5, md: 6 },
        py: 1.5,
        display: "flex",
        alignItems: "center",
        gap: 2,
        borderBottom: "1px solid",
        borderColor: "divider",
        // The grid scrolls under the bar, so it needs a ground of its own.
        bgcolor: "rgba(30,32,34,0.82)",
        backdropFilter: "blur(12px)",
      }}
    >
      <Link
        href="/"
        underline="none"
        sx={{ display: "flex", alignItems: "center", gap: "4px", color: "text.primary" }}
      >
        <img src="/favicon.svg" alt="" width={34} height={34} style={{ objectFit: "contain" }} />
        <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
          Bottlify
        </Typography>
      </Link>

      <Stack direction="row" spacing={1} sx={{ ml: "auto" }} alignItems="center">
        {onStorage && <SpaceIndicator onOpen={onStorage} />}
        {onAdd && (
          <Button
            size="small"
            variant="outlined"
            onClick={(event) => (onAddFromAccount ? setAdding(event.currentTarget) : onAdd())}
            startIcon={<span className="glyphicon glyphicon-plus" />}
            sx={{ color: "text.primary" }}
          >
            Add
          </Button>
        )}
        {onAdd && onAddFromAccount && (
          <Menu anchorEl={adding} open={Boolean(adding)} onClose={() => setAdding(null)}>
            <MenuItem onClick={() => { setAdding(null); onAdd(); }}>From a file…</MenuItem>
            <MenuItem onClick={() => { setAdding(null); onAddFromAccount(); }}>
              From a game account…
            </MenuItem>
          </Menu>
        )}
        {onSettings && (
          <Tooltip title="Settings">
            <IconButton size="small" aria-label="settings" onClick={onSettings}>
              <span className="glyphicon glyphicon-cog" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Box>
  );
}

/**
 * The volume of the running title: its icon, and under it, once pressed, a
 * slider. Pressed again while the slider is open it mutes, and again it
 * unmutes; a click anywhere else folds the slider away. It drives
 * `outputGain` in `session.js` -- the one place that reads `settings.volume`
 * and `settings.muted`, live -- and only ever writes those two settings, so it
 * sits on the stage of a run and nowhere a run is not.
 *
 * Muting is its own flag rather than a volume of zero, so the slider comes
 * back to wherever it was left rather than to silence.
 */
export function VolumeControl() {
  const [settings, setSettings] = useState(loadSettings);
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const change = (patch) => setSettings(saveSettings(patch));
  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  const silent = settings.muted || settings.volume === 0;

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchor} sx={{ display: "inline-flex" }}>
        {/* Beside the button and never in the way: under it is where the
            slider opens, and a tip there takes the pointer off it. */}
        <Tooltip title={!open ? "Volume" : settings.muted ? "Unmute" : "Mute"} placement="left"
          disableInteractive>
          <IconButton
            size="small"
            aria-label={!open ? "volume" : settings.muted ? "unmute" : "mute"}
            onClick={() => (open ? change({ muted: !settings.muted }) : setOpen(true))}
            sx={{ color: "text.primary" }}
          >
            <span
              className={`glyphicon glyphicon-volume-${
                silent ? "off" : settings.volume < 0.5 ? "down" : "up"}`}
            />
          </IconButton>
        </Tooltip>
        {/* Kept inside the box the click-away watches, and above the stage
            the transport row sits over. */}
        <Popper open={open} anchorEl={anchor.current} placement="bottom" disablePortal
          sx={{ zIndex: 10 }}>
          <Paper variant="outlined" sx={{ mt: 1, px: 2, py: 1, width: 160 }}>
            <Slider
              size="small"
              aria-label="volume"
              min={0}
              max={1}
              step={0.01}
              value={settings.muted ? 0 : settings.volume}
              onChange={(_event, value) => change({ volume: value, muted: false })}
              sx={{ color: "text.primary", display: "block" }}
            />
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
