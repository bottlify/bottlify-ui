/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Typography,
} from "@mui/material";

const megabytes = (bytes) => `${(bytes / (1 << 20)).toFixed(0)} MB`;

/**
 * What the page says between choosing an installer and its window opening.
 *
 * That stretch is the file being looked at and, for an installer, read whole --
 * seconds, and for a large one tens of them -- and a page that shows nothing
 * for that long reads as a click that did nothing. So the dialog is up from the
 * moment the file is chosen, says which step it is in, and counts the bytes.
 *
 * @param {Object} props
 * @param {{ name: string, size: number, read: number | null }} props.reading
 *     `read` is null while the file is only being looked at.
 * @param {() => void} props.onCancel
 */
export function ReadingDialog({ reading, onCancel }) {
  const counting = reading.read !== null;
  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onCancel}>
      <DialogTitle>Preparing the installer</DialogTitle>
      <DialogContent>
        <Typography variant="body2" noWrap title={reading.name} sx={{ mb: 0.5 }}>
          {reading.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          {reading.files
            ? `Unpacking — ${reading.read} of ${reading.size} files`
            : counting
              ? `Reading the file — ${megabytes(reading.read)} of ${megabytes(reading.size)}`
              : `Checking the file — ${megabytes(reading.size)}`}
        </Typography>
        <LinearProgress
          variant={counting && reading.size > 0 ? "determinate" : "indeterminate"}
          value={counting && reading.size > 0 ? (100 * reading.read) / reading.size : 0}
        />
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
          The installer's window opens as soon as the file has been read.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
