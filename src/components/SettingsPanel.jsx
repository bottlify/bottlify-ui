/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box, Button, ClickAwayListener, Tab, Tabs } from "@mui/material";
import { useEffect } from "react";
import { useT } from "../i18n.js";
import { saveSettings } from "../settings.js";
import { useSettings } from "../useSettings.js";
import { INK } from "../theme.js";
import { SectionTitle, SwitchRow } from "./kit.jsx";
import { StorageSettings } from "./StorageSettings.jsx";
import { StoreAccount } from "./Stores.jsx";

/** The panel's sections, by the name `open` is given. */
export const SETTINGS_TABS = ["general", "storage", "accounts"];

/**
 * The settings, hanging from the header at its right: the header's own board,
 * its line running into the panel's edge, the page behind left as it is.
 * Closed by a click anywhere else and by Esc; a dialog opened from inside it
 * (a sign-in, a confirmation) is part of it, not somewhere else.
 *
 * @param {Object} props
 * @param {string} props.tab  One of `SETTINGS_TABS`.
 * @param {(tab: string) => void} props.onTab
 * @param {() => void} props.onClose
 * @param {ReturnType<typeof import("./Stores.jsx").useStores>} props.stores
 * @param {{ id: string, coverSmall?: string }[]} props.library
 * @param {() => void} props.onLibraryChanged
 * @param {() => void} props.onEngine  Opens the engine's own settings and journal (developer mode).
 * @param {string | null} [props.gamehubLink]
 */
export function SettingsPanel({ tab, onTab, onClose, stores, library, onLibraryChanged, onEngine,
  gamehubLink = null }) {
  const t = useT();
  const settings = useSettings();
  useEffect(() => {
    const onKey = (/** @type {KeyboardEvent} */ event) => {
      // An open dialog takes its own Esc first.
      if (event.key === "Escape" && !document.querySelector(".MuiModal-root:not(.MuiModal-hidden)")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <ClickAwayListener onClickAway={(event) => {
      const target = /** @type {Element} */ (event.target);
      // The gear toggles the panel itself; a dialog the panel opened sits outside it in the page.
      if (target.closest?.("[data-settings-toggle], .MuiModal-root, .MuiPopover-root")) return;
      onClose();
    }}>
      <Box role="dialog" aria-label={t("header.settings")} sx={{
        position: "absolute", top: "100%", right: 0, mt: "-1px", zIndex: 5,
        width: "min(560px, 100%)", maxHeight: "calc(100vh - 80px)", overflowY: "auto",
        bgcolor: INK.ground, border: "1px solid", borderColor: "divider", borderTop: 0, borderRight: 0,
        borderRadius: "0 0 0 14px", boxShadow: "0 24px 40px rgba(0,0,0,0.35)",
      }}>
        <Tabs value={tab} onChange={(_event, value) => onTab(value)}
          sx={{ px: 3, borderBottom: "1px solid", borderColor: "divider" }}>
          <Tab value="general" label={t("settings.general")} />
          <Tab value="storage" label={t("settings.storage")} />
          <Tab value="accounts" label={t("settings.accounts")} />
        </Tabs>
        <Box sx={{ px: 3, pt: 0.5, pb: 2 }}>
          {tab === "general" && (<>
            <Box component="section" sx={{ py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
              <SectionTitle>{t("settings.whenHidden")}</SectionTitle>
              <SwitchRow title={t("settings.pause")} text={t("settings.pauseText")}
                checked={settings.pauseWhenHidden}
                onChange={(on) => saveSettings({ pauseWhenHidden: on })} />
              <SwitchRow title={t("settings.mute")} checked={settings.muteWhenHidden}
                onChange={(on) => saveSettings({ muteWhenHidden: on })} />
            </Box>
            <Box component="section" sx={{ py: 2 }}>
              <SectionTitle>{t("settings.developers")}</SectionTitle>
              <SwitchRow title={t("settings.developer")} text={t("settings.developerText")}
                checked={settings.developer} onChange={(on) => saveSettings({ developer: on })} />
              {settings.developer && (
                <Button sx={{ mt: 1 }} onClick={onEngine}>{t("settings.engine")}</Button>
              )}
            </Box>
          </>)}
          {tab === "storage" && <StorageSettings library={library} onChanged={onLibraryChanged} />}
          {tab === "accounts" && stores.stores.map((store) => (
            <StoreAccount key={store.provider.id} store={store} stores={stores} link={gamehubLink} />
          ))}
        </Box>
      </Box>
    </ClickAwayListener>
  );
}
