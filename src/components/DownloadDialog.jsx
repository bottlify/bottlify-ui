/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import { useT } from "../i18n.js";
import { DialogHead } from "./kit.jsx";

/**
 * Asked before a bottle that is not on this device whole starts: what it
 * still needs would come over the network while it plays, and every part a
 * game reads that is not here yet is a wait it stops for.
 *
 * @param {Object} props
 * @param {{ title: string }} props.bundle
 * @param {{ bytes: number, residentBytes: number }} props.held  How much of it is here.
 * @param {() => void} props.onDownload  Bring it in whole, then play.
 * @param {() => void} props.onPlay      Play now, the rest arriving as it is read.
 * @param {() => void} props.onClose
 */
export function DownloadDialog({ bundle, held, onDownload, onPlay, onClose }) {
  const t = useT();
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogHead title={t("download.title")} onClose={onClose} closeLabel={t("button.close")} />
      <DialogContent sx={{ px: 4 }}>
        <Typography color="text.secondary">
          {held.residentBytes > 0
            ? t("download.part", { name: bundle.title, missing: t.bytes(held.bytes - held.residentBytes) })
            : t("download.whole", { name: bundle.title, size: t.bytes(held.bytes) })}
          {" "}{t("download.why")}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 4 }}>
        <Button onClick={onPlay}>{t("download.playAnyway")}</Button>
        <Button variant="contained" onClick={onDownload} autoFocus>{t("download.download")}</Button>
      </DialogActions>
    </Dialog>
  );
}
