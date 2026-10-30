/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";

/**
 * What Add offers: a file of the person's own -- a setup, a disc image, an
 * archive, a bottle -- or a game from a store they own it in.
 *
 * @param {Object} props
 * @param {() => void} props.onFile
 * @param {() => void} props.onSteam
 * @param {() => void} props.onClose
 */
export function AddDialog({ onFile, onSteam, onClose }) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add a game</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pb: 1 }}>
          <Button variant="outlined" size="large" onClick={onFile}
            startIcon={<span className="glyphicon glyphicon-folder-open" />}>
            From a file
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            A setup (.exe), a disc image (.iso), an archive (.zip) or a bottle (.btl).
          </Typography>
          <Button variant="contained" size="large" onClick={onSteam}
            startIcon={<span className="glyphicon glyphicon-shopping-cart" />}>
            From Steam
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            Sign in with the Steam app and install the games you own.
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
