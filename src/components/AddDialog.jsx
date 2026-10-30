/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";

/**
 * What Add offers: a file of the person's own -- a setup, a disc image, an
 * archive, a bottle -- or the way to Steam: its account is signed in to under
 * Settings → Game Accounts, and its games then show in the library, each with
 * its Install.
 *
 * @param {Object} props
 * @param {string | null} props.steamAccount  The account signed in in this browser.
 * @param {() => void} props.onFile
 * @param {() => void} props.onSteam  Opens Settings → Game Accounts.
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
          <Button variant="outlined" size="large" onClick={onSteam}
            startIcon={<span className="glyphicon glyphicon-shopping-cart" />}>
            From Steam
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            {steamAccount
              ? `Signed in as ${steamAccount}: your Steam games are in the library, each with Install. `
                + "The account is in Settings → Game Accounts."
              : "Sign in under Settings → Game Accounts: the games you own show in the library, "
                + "each with Install."}
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
