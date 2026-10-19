/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from "@mui/material";

/** @param {number} bytes */
const megabytes = (bytes) => `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`;

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
  const missing = held.bytes - held.residentBytes;
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Not downloaded yet</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {held.residentBytes > 0
            ? `${megabytes(missing)} of ${bundle.title} is not on this device yet.`
            : `${bundle.title} is not on this device yet (${megabytes(held.bytes)}).`}
          {" "}&quot;Play anyway&quot; loads it while you play, and the game can stutter or
          pause while it waits. Download first to play without delays.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onPlay}>Play anyway</Button>
        <Button variant="contained" onClick={onDownload} autoFocus>Download</Button>
      </DialogActions>
    </Dialog>
  );
}
