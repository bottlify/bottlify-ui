/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";

/**
 * What Add offers: a file of the person's own -- a setup, a disc image, an
 * archive, a bottle -- or signing in to a store they own games in, whose
 * games the library then shows, each with its Install.
 *
 * @param {Object} props
 * @param {string | null} props.steamAccount  The account signed in in this browser.
 * @param {() => void} props.onFile
 * @param {() => void} props.onSteam  Sign in to Steam.
 * @param {() => void} props.onClose
 */
export function AddDialog({ steamAccount, onFile, onSteam, onClose }) {
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
          <Button variant="contained" size="large" onClick={onSteam} disabled={Boolean(steamAccount)}
            startIcon={<span className="glyphicon glyphicon-shopping-cart" />}>
            From Steam
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            {steamAccount
              ? `Signed in as ${steamAccount}: your Steam games are in the library, each with Install.`
              : "Sign in with the Steam app: the games you own show in the library, each with Install."}
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
