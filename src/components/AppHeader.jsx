/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Box, Button, ClickAwayListener, IconButton, Link, Paper, Popper, Slider, Stack, Tooltip, Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { CHANGED, loadSettings, saveSettings } from "../settings.js";

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
 * @param {(() => void) | null} [props.onSettings]  Absent likewise: the settings
 *        are about runs, and belong only where a run can be started.
 */
export function AppHeader({ onAdd, onSettings }) {
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
        {onAdd && (
          <Button
            size="small"
            variant="outlined"
            onClick={onAdd}
            startIcon={<span className="glyphicon glyphicon-plus" />}
            sx={{ color: "text.primary" }}
          >
            Add
          </Button>
        )}
        <Tooltip title="GitHub">
          <IconButton
            href="https://github.com/bottlify/bottlify"
            target="_blank"
            rel="noreferrer"
            size="small"
            aria-label="GitHub"
            sx={{ color: "text.primary" }}
          >
            {/* The mark, drawn here: one path in the current ink is cheaper
                than an icon library and needs no asset. */}
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </IconButton>
        </Tooltip>
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
