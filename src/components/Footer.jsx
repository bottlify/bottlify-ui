/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box, Divider, Link, Stack, Typography } from "@mui/material";

const YEAR = new Date().getFullYear();

/**
 * One line under every screen: the way to the credits, on the left; whose it
 * is, on the right.
 *
 * The credit to the projects Bottlify is built on is on the page the link
 * opens, with their licences, rather than one of them named in a line of its
 * own. A plain href, like the header's links: the app turns it into a history
 * entry, and a middle click still opens a tab.
 */
export function Footer() {
  return (
    <Box component="footer" sx={{ mt: "auto" }}>
      <Divider />
      <Stack
        direction="row"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1}
        sx={{ px: { xs: 3, md: 6 }, py: 2.5 }}
      >
        <Typography variant="body2" color="text.secondary">
          <Link href="/license" underline="hover" sx={{ color: "text.primary" }}>
            Credits &amp; licenses
          </Link>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          © {YEAR} Bottlify Project
        </Typography>
      </Stack>
    </Box>
  );
}

