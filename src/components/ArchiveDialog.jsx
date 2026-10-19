/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Breadcrumbs, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, List,
  ListItemButton, ListItemText, Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { likelyProgram } from "../engine/formats.js";

/** @param {number} bytes */
function sizeOf(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** @param {string} path */
// A Windows Installer package is installed, through msiexec, but makes no bottle.
const isProgram = (path) => /\.(exe|msi)$/i.test(path);

/**
 * An unpacked archive, browsed by directory, for the person to pick the
 * program it is to start with: an archive has no `autorun.inf` to name one
 * the way a disc does. Install runs that program from the archive mounted as
 * a disc; Save makes a bottle of the archive as it stands, the program its
 * entry point, for a game that ships unpacked rather than with a setup.
 *
 * @param {Object} props
 * @param {string} props.name  The archive's file name.
 * @param {import("@bottlify/installer").ArchiveEntry[]} props.entries
 * @param {(path: string) => void} props.onInstall
 * @param {(path: string) => void} props.onSave
 * @param {() => void} props.onClose
 */
export function ArchiveDialog({ name, entries, onInstall, onSave, onClose }) {
  const [dir, setDir] = useState("");
  const [chosen, setChosen] = useState(() => likelyProgram(entries));

  // What is directly under `dir`: subdirectories by name, files with their size.
  const { dirs, files } = useMemo(() => {
    const prefix = dir ? `${dir}\\` : "";
    const below = new Set();
    const here = [];
    for (const entry of entries) {
      if (!entry.path.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const rest = entry.path.slice(prefix.length);
      const cut = rest.indexOf("\\");
      if (cut >= 0) below.add(rest.slice(0, cut));
      else if (entry.bytes === null) below.add(rest);
      else here.push({ path: entry.path, name: rest, size: entry.bytes.length });
    }
    return {
      dirs: [...below].filter(Boolean).sort((a, b) => a.localeCompare(b)),
      files: here.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [entries, dir]);

  const crumbs = dir ? dir.split("\\") : [];

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>{name}</DialogTitle>
      <DialogContent dividers sx={{ p: 0, height: "60vh", display: "flex", flexDirection: "column" }}>
        <Breadcrumbs sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
          <Link component="button" underline="hover" color="inherit" onClick={() => setDir("")}>
            {name}
          </Link>
          {crumbs.map((part, index) => (
            <Link key={index} component="button" underline="hover" color="inherit"
              onClick={() => setDir(crumbs.slice(0, index + 1).join("\\"))}>
              {part}
            </Link>
          ))}
        </Breadcrumbs>
        <List dense sx={{ overflowY: "auto", flex: 1 }}>
          {dir && (
            <ListItemButton onClick={() => setDir(crumbs.slice(0, -1).join("\\"))}>
              <ListItemText primary="..\\" primaryTypographyProps={{ sx: { fontFamily: "monospace" } }} />
            </ListItemButton>
          )}
          {dirs.map((sub) => (
            <ListItemButton key={`d:${sub}`} onClick={() => setDir(dir ? `${dir}\\${sub}` : sub)}>
              <ListItemText primary={`${sub}\\`} primaryTypographyProps={{ sx: { fontFamily: "monospace" } }} />
            </ListItemButton>
          ))}
          {files.map((file) => {
            const program = isProgram(file.path);
            return (
              <ListItemButton key={`f:${file.path}`} selected={chosen === file.path}
                disabled={!program}
                onClick={() => setChosen(file.path)}
                onDoubleClick={() => program && onInstall(file.path)}>
                <ListItemText primary={file.name} secondary={sizeOf(file.size)}
                  primaryTypographyProps={{ sx: { fontFamily: "monospace" } }} />
              </ListItemButton>
            );
          })}
          {dirs.length === 0 && files.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>Empty.</Typography>
          )}
        </List>
      </DialogContent>
      <DialogActions>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, px: 1, fontFamily: chosen ? "monospace" : undefined }}>
          {chosen ?? "Choose an .exe or .msi file to start"}
        </Typography>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="outlined" color="inherit" disabled={!chosen || /\.msi$/i.test(chosen)} onClick={() => chosen && onSave(chosen)}>
          Save
        </Button>
        <Button variant="contained" disabled={!chosen} onClick={() => chosen && onInstall(chosen)}>
          Install
        </Button>
      </DialogActions>
    </Dialog>
  );
}
