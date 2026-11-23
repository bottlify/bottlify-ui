/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Box, ClickAwayListener, IconButton, InputBase, Link, Paper, Popper, Slider, Tooltip,
} from "@mui/material";
import { useRef, useState } from "react";
import logo from "../assets/logo.svg";
import { useT } from "../i18n.js";
import { saveSettings } from "../settings.js";
import { useSettings } from "../useSettings.js";
import { INK, LOGO_FONT } from "../theme.js";
import { Icon, Segmented } from "./kit.jsx";

/**
 * The bar over every page but a running game: the name leading home, the
 * search where there is a library to search, the language, and the one way to
 * the settings. The settings hang from it (`children`), so the bar is what they
 * are placed against.
 *
 * Navigation is a plain href, so a link is still a link: middle-click, copy
 * address and the back button all behave.
 *
 * @param {Object} props
 * @param {string | null} [props.query]  The library's search; null where there is none.
 * @param {(query: string) => void} [props.onQuery]
 * @param {boolean} props.settingsOpen
 * @param {() => void} props.onSettings
 * @param {import("react").ReactNode} [props.children]  What hangs from the bar.
 */
export function AppHeader({ query = null, onQuery, settingsOpen, onSettings, children }) {
  const t = useT();
  return (
    <Box
      component="header"
      sx={{
        position: "sticky", top: 0, zIndex: 10,
        display: "flex", alignItems: "center", gap: { xs: 1.5, md: 3 },
        px: { xs: 2, md: 4.5 }, py: 2,
        borderBottom: "1px solid", borderColor: "divider", bgcolor: INK.ground,
      }}
    >
      <Link href="/" underline="none" aria-label={t("header.home")}
        sx={{ display: "inline-flex", alignItems: "center", gap: 1.25, color: "text.primary", flex: "none" }}>
        <img src={logo} alt="" width={30} height={30} />
        <Box component="span" sx={{ font: `700 21px/1 ${LOGO_FONT}`, letterSpacing: "-0.02em",
          display: { xs: "none", sm: "inline" } }}>
          Bottlify
        </Box>
      </Link>

      {query !== null && (
        <InputBase
          value={query}
          onChange={(event) => onQuery?.(event.target.value)}
          placeholder={t("header.search")}
          inputProps={{ "aria-label": t("header.search"), type: "search" }}
          sx={{ flex: 1, maxWidth: 420, minWidth: 0, height: 44, px: 1.75, borderRadius: "9px",
            border: "1px solid", borderColor: "divider", bgcolor: INK.surface, fontSize: 15 }}
        />
      )}

      <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: { xs: 1, md: 1.5 } }}>
        <LanguageSwitch />
        <IconButton aria-label={t("header.settings")} aria-expanded={settingsOpen} onClick={onSettings}
          data-settings-toggle
          sx={{ border: "1px solid", borderColor: settingsOpen ? "text.primary" : "divider",
            bgcolor: settingsOpen ? INK.raised : "transparent" }}>
          <Icon name="gear" size={20} />
        </IconButton>
      </Box>
      {children}
    </Box>
  );
}

/** RU or EN, kept for the next visit; the interface follows at once. */
function LanguageSwitch() {
  const t = useT();
  return (
    <Segmented value={t.lang} label={t("header.language")}
      options={[{ value: "ru", label: "RU" }, { value: "en", label: "EN" }]}
      onChange={(language) => saveSettings({ language })} />
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
 *
 * @param {{ sx?: import("@mui/material").SxProps }} props
 */
export function VolumeControl({ sx = {} }) {
  const t = useT();
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const silent = settings.muted || settings.volume === 0;
  const label = !open ? t("play.volume") : settings.muted ? t("play.unmute") : t("play.mute");

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchor} sx={{ display: "inline-flex" }}>
        <Tooltip title={label} disableInteractive>
          <IconButton aria-label={label} sx={sx}
            onClick={() => (open ? saveSettings({ muted: !settings.muted }) : setOpen(true))}>
            <Icon name={silent ? "mute" : "sound"} size={18} />
          </IconButton>
        </Tooltip>
        <Popper open={open} anchorEl={anchor.current} placement="bottom" disablePortal sx={{ zIndex: 10 }}>
          <Paper variant="outlined" sx={{ mt: 1, px: 2, py: 1, width: 160 }}>
            <Slider
              size="small"
              aria-label={t("play.volume")}
              min={0}
              max={1}
              step={0.01}
              value={settings.muted ? 0 : settings.volume}
              onChange={(_event, value) => saveSettings({ volume: /** @type {number} */ (value), muted: false })}
              sx={{ color: "text.primary", display: "block" }}
            />
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
