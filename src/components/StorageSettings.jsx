/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { getAvailableBundles, getUnlistedBundle } from "../api/bundles.js";
import {
  STORAGE_CHANGED, clearAllCaches, clearCache, deleteSaves, removeFromDevice, storedBottles,
} from "../engine/stored.js";
import { useT } from "../i18n.js";
import { saveSettings } from "../settings.js";
import { useSettings } from "../useSettings.js";
import { INK } from "../theme.js";
import { Art, DialogHead, SectionTitle, SwitchRow } from "./kit.jsx";

/** Tells what shows the room that this page removed something. */
const changed = () => window.dispatchEvent(new Event(STORAGE_CHANGED));

/**
 * Settings → Space in the browser: how much this site keeps, and each game's
 * share of it with Delete. In developer mode, the finer means too: a cache to
 * clear, saves to delete, every cache at once, and whether a game short of room
 * may take other games' downloads. A game a run holds -- here or in another
 * tab -- is left alone.
 *
 * @param {Object} props
 * @param {{ id: string, coverSmall?: string }[]} props.library  For each game's cover.
 * @param {() => void} [props.onChanged]  Something was removed: the library reads itself again.
 */
export function StorageSettings({ library, onChanged }) {
  const t = useT();
  const { developer, overwriteBottles } = useSettings();
  const [state, setState] = useState(/** @type {any} */ (null));
  const [failure, setFailure] = useState(/** @type {string | null} */ (null));
  const [working, setWorking] = useState(false);
  /** The action waiting on its confirmation. */
  const [asking, setAsking] = useState(/** @type {any} */ (null));

  const read = useCallback(async () => {
    try {
      const listed = await getAvailableBundles().catch(() => []);
      setState(await storedBottles({ library: listed, lookup: getUnlistedBundle }));
    } catch (error) {
      setFailure(t("storage.unreadable", { reason: /** @type {any} */ (error)?.message ?? error }));
    }
  }, [t]);
  useEffect(() => {
    read();
  }, [read]);

  /** @param {() => Promise<string | null | void>} work */
  const run = async (work) => {
    setAsking(null);
    setWorking(true);
    setFailure(null);
    try {
      await work();
    } catch (error) {
      setFailure(String(/** @type {any} */ (error)?.message ?? error));
    } finally {
      setWorking(false);
      changed();
      onChanged?.();
      await read();
    }
  };

  /** @param {any} bottle */
  const ask = {
    remove: (bottle) => setAsking({
      title: t("storage.removeTitle", { name: bottle.title }),
      text: t("storage.removeText"),
      action: t("button.delete"),
      work: () => removeFromDevice(bottle),
    }),
    cache: (bottle) => setAsking({
      title: t("storage.cacheTitle", { name: bottle.title }),
      text: t("storage.cacheText"),
      action: t("storage.clearCache"),
      work: () => clearCache(bottle),
    }),
    saves: (bottle) => setAsking({
      title: t("storage.savesTitle", { name: bottle.title }),
      text: t("storage.savesText"),
      action: t("storage.deleteSaves"),
      work: () => deleteSaves(bottle),
    }),
    all: () => setAsking({
      title: t("storage.allTitle"),
      text: t("storage.allText"),
      action: t("storage.clearAll"),
      work: async () => {
        const { skipped, failed } = await clearAllCaches(state?.bottles ?? []);
        if (skipped.length || failed.length) {
          throw new Error([skipped.length ? t("storage.skipped", { names: skipped.join(", ") }) : "",
            failed.length ? t("storage.failed", { names: failed.join(", ") }) : ""].filter(Boolean).join(" "));
        }
      },
    }),
  };

  if (!state && !failure) {
    return <Box sx={{ py: 3, display: "flex", justifyContent: "center" }}><CircularProgress size={24} /></Box>;
  }
  const bottles = state?.bottles ?? [];
  const known = state && state.usage !== null && state.quota !== null;
  const share = known && state.quota > 0 ? Math.min(1, state.usage / state.quota) : 0;
  const cover = (/** @type {any} */ bottle) => library.find((one) => one.id === bottle.id)?.coverSmall ?? "";
  return (
    <Box>
      {state && (
        <Box component="section" sx={{ py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
          <SectionTitle>
            {known ? t("storage.used", { used: t.bytes(state.usage), quota: t.bytes(state.quota) })
              : t("storage.unknown")}
          </SectionTitle>
          {known && (
            <Box sx={{ height: 8, borderRadius: 4, bgcolor: INK.surface, overflow: "hidden", my: 1.25 }}>
              <Box sx={{ height: "100%", width: `${share * 100}%`, bgcolor: "text.primary" }} />
            </Box>
          )}
          <Typography variant="body2" color="text.secondary">
            {known ? t("storage.quotaNote", { quota: t.bytes(state.quota) }) : t("storage.onlyHere")}
            {" "}
            {state.persisted === false ? t("storage.notKept") : ""}
          </Typography>
          {developer && (
            <Box sx={{ mt: 1.5 }}>
              <SwitchRow title={t("storage.overwrite")} text={t("storage.overwriteText")}
                checked={overwriteBottles} onChange={(on) => saveSettings({ overwriteBottles: on })} />
              <Button color="error" sx={{ mt: 1 }} onClick={ask.all} disabled={working
                || !bottles.some((one) => one.bytes.blocks + one.bytes.translations > 0)}>
                {t("storage.clearAll")}
              </Button>
            </Box>
          )}
        </Box>
      )}
      {failure && <Alert severity="error" variant="outlined" sx={{ my: 2 }}
        onClose={() => setFailure(null)}>{failure}</Alert>}
      <Box component="section" sx={{ py: 2 }}>
        <SectionTitle>{t("storage.games")}</SectionTitle>
        {state && bottles.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t("storage.empty")}</Typography>
        )}
        {bottles.map((bottle) => (
          <Box key={bottle.key} sx={{ display: "grid", gridTemplateColumns: "52px 1fr auto", gap: 2,
            alignItems: "center", py: 2, borderBottom: "1px solid", borderColor: "divider",
            "&:last-of-type": { borderBottom: 0 } }}>
            <Art src={cover(bottle)} title={bottle.title} ratio="2 / 3" sx={{ width: 52, borderRadius: "4px" }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{bottle.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {bottle.bytes.saves > 0
                  ? t("storage.sizeWithSaves", { size: t.bytes(bottle.total), saves: t.bytes(bottle.bytes.saves) })
                  : t.bytes(bottle.total)}
                {bottle.busy ? ` · ${t("storage.running")}` : ""}
              </Typography>
              {developer && (
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                  <Button disabled={working || bottle.busy || bottle.bytes.blocks + bottle.bytes.translations === 0}
                    onClick={() => ask.cache(bottle)}>{t("storage.clearCache")}</Button>
                  <Button color="error" disabled={working || bottle.busy || bottle.bytes.saves === 0}
                    onClick={() => ask.saves(bottle)}>{t("storage.deleteSaves")}</Button>
                </Box>
              )}
            </Box>
            <Button color="error" disabled={working || bottle.busy} onClick={() => ask.remove(bottle)}>
              {t("button.delete")}
            </Button>
          </Box>
        ))}
      </Box>
      {asking && <Confirm asking={asking} onCancel={() => setAsking(null)} onConfirm={() => run(asking.work)} />}
    </Box>
  );
}

/**
 * Asks before what cannot be taken back.
 *
 * @param {Object} props
 * @param {{ title: string, text: string, action: string }} props.asking
 * @param {() => void} props.onCancel
 * @param {() => void} props.onConfirm
 * @param {boolean} [props.busy]
 */
export function Confirm({ asking, onCancel, onConfirm, busy = false }) {
  const t = useT();
  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth="xs" fullWidth>
      <DialogHead title={asking.title} />
      <DialogContent sx={{ px: 4 }}>
        <Typography color="text.secondary">{asking.text}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 4 }}>
        <Button onClick={onCancel} disabled={busy}>{t("button.cancel")}</Button>
        <Button color="error" onClick={onConfirm} disabled={busy}>{asking.action}</Button>
      </DialogActions>
    </Dialog>
  );
}
