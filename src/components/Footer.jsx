/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box, Link } from "@mui/material";
import { useT } from "../i18n.js";

const YEAR = new Date().getFullYear();

/**
 * One line under every page but a running game: the credits and the
 * documentation on the left; whose it is, on the right, leading to its source.
 *
 * Plain hrefs: the app turns a same-origin one into a history entry, and a
 * middle click still opens a tab. The documentation is a page the server hands
 * out beside the app (`rel="external"`), which the app has no route for.
 */
export function Footer() {
  const t = useT();
  const link = { color: "text.primary", textDecoration: "none", "&:hover": { textDecoration: "underline" } };
  return (
    <Box component="footer" sx={{
      mt: "auto", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 1.25,
      px: { xs: 2, md: 4.5 }, py: 2.25, borderTop: "1px solid", borderColor: "divider",
      color: "text.secondary", fontSize: 14,
    }}>
      <Box sx={{ display: "flex", gap: 3 }}>
        <Link href="/license" sx={link}>{t("footer.credits")}</Link>
        <Link href="/docs/" rel="external" sx={link}>{t("footer.docs")}</Link>
      </Box>
      <Box component="span">
        © {YEAR} Bottlify Project ·{" "}
        <Link href="https://github.com/bottlify/bottlify" target="_blank" rel="noopener" sx={link}>
          {t("footer.source")}
        </Link>
      </Box>
    </Box>
  );
}
