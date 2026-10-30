/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box, Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { useState } from "react";

/**
 * What Add offers: a file of the person's own -- a setup, a disc image, an
 * archive, a bottle -- chosen or dropped on the area, or a game account, whose
 * games then show in the library each with its Install.
 *
 * @param {Object} props
 * @param {() => void} props.onChoose  Opens the file chooser.
 * @param {(file: File) => void} props.onDrop
 * @param {() => void} props.onAccounts  Opens Settings → Game Accounts.
 * @param {() => void} props.onClose
 */
export function AddDialog({ onChoose, onDrop, onAccounts, onClose }) {
  const [over, setOver] = useState(false);
  /** @param {import("react").DragEvent} event */
  const hold = (event) => {
    // Without this the browser opens a dropped file itself, in place of the page.
    event.preventDefault();
    setOver(true);
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add a game</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pb: 1 }}>
          <Box
            role="button"
            tabIndex={0}
            onClick={onChoose}
            onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onChoose()}
            onDragEnter={hold}
            onDragOver={hold}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              const file = event.dataTransfer.files?.[0];
              if (file) onDrop(file);
            }}
            sx={{
              border: "2px dashed",
              borderColor: over ? "primary.main" : "divider",
              bgcolor: over ? "action.hover" : "transparent",
              borderRadius: 2,
              py: 4,
              px: 2,
              textAlign: "center",
              cursor: "pointer",
              transition: "border-color .15s, background-color .15s",
              "&:hover, &:focus-visible": { borderColor: "primary.main", outline: "none" },
            }}
          >
            <Box component="span" className="glyphicon glyphicon-folder-open"
              sx={{ fontSize: 28, display: "block", mb: 1 }} />
            <Typography>Drop a file here, or click to choose one</Typography>
            <Typography variant="caption" color="text.secondary">
              A setup (.exe), a disc image (.iso), an archive (.zip) or a bottle (.btl).
            </Typography>
          </Box>
          <Button variant="outlined" size="large" onClick={onAccounts}
            startIcon={<span className="glyphicon glyphicon-user" />}>
            From a game account
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            Sign in to a store you own games in: they show in the library, each with Install.
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
