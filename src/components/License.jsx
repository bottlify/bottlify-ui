/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Fragment } from "react";
import { Box, Divider, Link, Typography } from "@mui/material";
import notices from "virtual:notices";
import { OWN_LICENSE_URL } from "../legal.js";
import { inlineOf, labelOf, parseNotices } from "../notices.js";

// Read once, when the page is built: the engine's own file, so that what is
// shown here and what the repository says is distributed are one text.
const BLOCKS = parseNotices(notices).filter((one) => one.type !== "h1");

/** @param {{ text: string }} props */
function Inline({ text }) {
  return inlineOf(text).map((piece, at) => {
    if (piece.type === "link") {
      return (
        <Link key={at} href={piece.href} target="_blank" rel="noreferrer" underline="hover"
          sx={{ wordBreak: "break-all" }}>
          {piece.text}
        </Link>
      );
    }
    if (piece.type === "code") {
      return (
        <Box key={at} component="code"
          sx={{ fontFamily: "monospace", fontSize: "0.85em", wordBreak: "break-all" }}>
          {piece.text}
        </Box>
      );
    }
    return <Fragment key={at}>{piece.text}</Fragment>;
  });
}

/** @param {{ block: import("../notices.js").Block, first: boolean }} props */
function NoticeBlock({ block, first }) {
  if (block.type === "h2" || block.type === "h3") {
    return (
      <>
        {!first && <Divider sx={{ mt: 4 }} />}
        <Typography variant="h6" component="h2" sx={{ mt: first ? 0 : 3, mb: 1, fontWeight: 700 }}>
          {block.text}
        </Typography>
      </>
    );
  }
  if (block.type === "ul") {
    return (
      <Box component="ul" sx={{ m: 0, mb: 1.5, pl: 2.5 }}>
        {block.items.map((item, at) => {
          const { label, text } = labelOf(item);
          return (
            <Typography key={at} component="li" variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
              {label && <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>{label}: </Box>}
              <Inline text={text} />
            </Typography>
          );
        })}
      </Box>
    );
  }
  if (block.type === "pre") {
    return (
      <Box component="pre" sx={{
        m: 0, mb: 1.5, p: 2, overflow: "auto", fontSize: "0.8em", bgcolor: "action.hover",
        borderRadius: 1, color: "text.secondary",
      }}>
        {block.text}
      </Box>
    );
  }
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
      <Inline text={block.text} />
    </Typography>
  );
}

/**
 * The page behind the footer's credits link: what Bottlify is built on and
 * under which licences, and whose the library's games and pictures are.
 *
 * What it is built on is the engine's THIRD-PARTY-NOTICES.md as it is, which
 * is where the licence obligations are met and the one list of what is
 * distributed with the product.
 *
 * @param {{ takedownEmail?: string }} props  The deployment's address for a
 *     rights holder (`config.json`'s `takedownEmail`); none says nothing.
 */
export function License({ takedownEmail = "" }) {
  return (
    <Box component="main" sx={{ px: { xs: 3, md: 6 }, py: 4, maxWidth: 820, width: "100%", mx: "auto" }}>
      <Link href="/" underline="hover" variant="body2"
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, mb: 2, color: "text.secondary" }}>
        <span className="glyphicon glyphicon-chevron-left" style={{ fontSize: 11 }} />
        Back
      </Link>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
        Credits &amp; licenses
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1.5, mb: 4 }}>
        Bottlify is open source under the{" "}
        <Link href={OWN_LICENSE_URL} target="_blank" rel="noreferrer" underline="hover">
          Mozilla Public License 2.0
        </Link>
        . It stands on the work of others, and here is whose.
      </Typography>

      <Typography variant="h5" component="h2" sx={{ mb: 2, fontWeight: 700 }}>
        Third-party notices
      </Typography>
      {BLOCKS.map((block, at) => (
        <NoticeBlock key={at} block={block}
          first={block.type === "h2" && !BLOCKS.slice(0, at).some((one) => one.type === "h2")} />
      ))}

      <Divider sx={{ mt: 4 }} />
      <Typography variant="h6" component="h2" sx={{ mt: 3, mb: 1, fontWeight: 700 }}>
        Games, covers and bundles
      </Typography>
      <Typography variant="body2" color="text.secondary">
        The games in the library, their covers and their descriptions belong to their original
        authors and rights holders. The library holds only demo versions that the rights holders
        themselves distributed free of charge, and each entry names the year and the holder of the
        rights. Bottlify claims no rights over them and sells nothing.
      </Typography>
      {takedownEmail && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          If you hold the rights to something here and it should not be here, write to{" "}
          <Link href={`mailto:${takedownEmail}`} underline="hover">{takedownEmail}</Link>
          {" "}and it will be taken down.
        </Typography>
      )}
    </Box>
  );
}
