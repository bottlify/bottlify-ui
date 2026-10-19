/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Breadcrumbs, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Link, List, ListItemButton, ListItemText, Menu, MenuItem, Stack, TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeText, encodeText } from "../engine/text.js";
import { joinPath, parentOf } from "../engine/volumes.js";

/** What a browser draws, by extension. */
const IMAGES = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["gif", "image/gif"],
  ["bmp", "image/bmp"], ["webp", "image/webp"], ["ico", "image/x-icon"],
]);

/** Larger than this, a text file is not opened in the editor. */
const EDITABLE_BYTES = 2 << 20;

/** @param {string} path */
const extensionOf = (path) => (/\.([^.\\]+)$/.exec(path)?.[1] ?? "").toLowerCase();

/** @param {string} path */
const nameOf = (path) => path.slice(path.lastIndexOf("\\") + 1);

/** @param {number} bytes */
function sizeOf(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Where a file comes from, as its chip says it; the bundle's own has none. */
const STATES = {
  saved: { label: "saved by the game", color: "default" },
  changed: { label: "patched", color: "info" },
  added: { label: "added", color: "success" },
  deleted: { label: "deleted", color: "warning" },
};

/** @typedef {import("../engine/volumes.js").VolumeFile} VolumeFile */

/**
 * A bottle's files: the whole volume, opening on the game's directory. The same
 * editor before a run -- what the game will see at its start: the bundle, what
 * it saved in earlier runs, and the person's patch over its directory -- and
 * while it runs, where a change is what the game finds the next time it looks.
 *
 * @param {Object} props
 * @param {string} props.title
 * @param {import("../engine/volumes.js").VolumeFiles} props.files
 * @param {string[]} props.editableTypes  Extensions the editor opens.
 * @param {() => void} props.onClose
 */
export function FilesDialog({ title, files, editableTypes, onClose }) {
  const [dir, setDir] = useState(files.home);
  const [listing, setListing] = useState(
    /** @type {{ folders: string[], files: VolumeFile[] } | null} */ (null));
  // A folder is chosen only for its own menu: to open or delete it.
  const [selected, setSelected] = useState(/** @type {(VolumeFile & { folder?: boolean }) | null} */ (null));
  // Where the file was clicked: the menu opens under the pointer.
  const [menu, setMenu] = useState(/** @type {{ top: number, left: number } | null} */ (null));
  const [preview, setPreview] = useState(/** @type {string | null} */ (null));
  const [editing, setEditing] = useState(
    /** @type {{ path: string, form: import("../engine/text.js").TextForm } | null} */ (null));
  const [naming, setNaming] = useState(/** @type {string | null} */ (null));
  const [failure, setFailure] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const replaceInput = useRef(/** @type {HTMLInputElement | null} */ (null));
  const filesInput = useRef(/** @type {HTMLInputElement | null} */ (null));
  const folderInput = useRef(/** @type {HTMLInputElement | null} */ (null));

  const refresh = useCallback(async () => {
    try {
      setListing(await files.list(dir));
    } catch (e) {
      setListing({ folders: [], files: [] });
      setFailure(`${dir} could not be listed: ${String(/** @type {any} */ (e)?.message ?? e)}`);
    }
  }, [files, dir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  /** @param {string} to */
  const go = (to) => {
    setDir(to);
    setSelected(null);
    setPreview(null);
    setListing(null);
  };

  /** @param {() => Promise<void>} work */
  const act = async (work) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (e) {
      setFailure(String(/** @type {any} */ (e)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * A left click picks a file (its picture, its download); a right click opens
   * its menu too.
   *
   * @param {VolumeFile} file @param {{ clientX: number, clientY: number } | null} at
   */
  const choose = (file, at) => {
    setSelected(file);
    setMenu(at && { top: at.clientY, left: at.clientX });
    setPreview(null);
    const type = IMAGES.get(extensionOf(file.path));
    if (type && file.state !== "deleted") {
      void act(async () => {
        setPreview(URL.createObjectURL(new Blob([await files.read(file.path)], { type })));
      });
    }
  };

  const download = () => selected && act(async () => {
    const url = URL.createObjectURL(new Blob([await files.read(selected.path)]));
    const link = document.createElement("a");
    link.href = url;
    link.download = nameOf(selected.path);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const edit = () => selected && act(async () => {
    setMenu(null);
    setEditing({ path: selected.path, form: decodeText(await files.read(selected.path)) });
  });

  /** @param {string} path @param {Blob} file */
  const put = async (path, file) => files.write(path, new Uint8Array(await file.arrayBuffer()));

  /** @param {FileList | null} chosen @param {(file: File) => string} pathOf */
  const add = (chosen, pathOf) => chosen && chosen.length > 0 && act(async () => {
    for (const file of chosen) await put(pathOf(file), file);
    await refresh();
  });

  /** @param {string} name */
  const makeFolder = (name) => act(async () => {
    setNaming(null);
    const clean = name.trim();
    if (!clean || /[\\/:*?"<>|]/.test(clean)) throw new Error(`"${name}" is not a folder name`);
    await files.createDirectory(joinPath(dir, clean));
    await refresh();
  });

  /** @param {string} name @param {{ clientX: number, clientY: number }} at */
  const chooseFolder = (name, at) => {
    setSelected({ path: joinPath(dir, name), size: 0, state: "original", folder: true });
    setMenu({ top: at.clientY, left: at.clientX });
    setPreview(null);
  };

  const editable = selected !== null && !selected.folder && selected.state !== "deleted" && selected.size <= EDITABLE_BYTES
    && editableTypes.includes(extensionOf(selected.path));
  const crumbs = dir.split("\\");
  const up = parentOf(dir);

  return (
    <Dialog open fullWidth maxWidth="lg" onClose={busy ? undefined : onClose}
      PaperProps={{ sx: { height: "80vh" } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>Files — {title}</Typography>
        <IconButton aria-label="close" onClick={onClose} disabled={busy}>
          <span className="glyphicon glyphicon-remove" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: "flex", p: 0, minHeight: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
            <Breadcrumbs sx={{ flex: 1, minWidth: 0 }} maxItems={6}>
              {crumbs.map((name, at) => (
                <Link key={`${at}-${name}`} component="button" underline="hover" color="inherit"
                  onClick={() => go(crumbs.slice(0, at + 1).join("\\"))}>
                  {name}
                </Link>
              ))}
            </Breadcrumbs>
            {naming !== null ? (
              <TextField size="small" autoFocus placeholder="Folder name" value={naming}
                onChange={(event) => setNaming(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void makeFolder(naming);
                  if (event.key === "Escape") setNaming(null);
                }}
                onBlur={() => setNaming(null)} sx={{ width: 200 }} />
            ) : (
              <Button size="small" variant="outlined" color="inherit" disabled={busy}
                onClick={() => setNaming("")}>
                New folder
              </Button>
            )}
            {/* Into the directory being looked at: an add-on is a folder of
                its own under Interface\AddOns, and arrives as one. */}
            <Button size="small" variant="outlined" color="inherit" disabled={busy}
              onClick={() => filesInput.current?.click()}>
              Add files
            </Button>
            <Button size="small" variant="outlined" color="inherit" disabled={busy}
              onClick={() => folderInput.current?.click()}>
              Add folder
            </Button>
          </Stack>
          {failure && (
            <Alert severity="error" variant="outlined" sx={{ mx: 2, mb: 1 }} onClose={() => setFailure(null)}>
              {failure}
            </Alert>
          )}
          <List dense sx={{ flex: 1, overflowY: "auto", py: 0 }}>
            {listing === null && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>Reading…</Typography>
            )}
            {up !== null && (
              <ListItemButton onClick={() => go(up)}>
                <ListItemText primary=".." />
              </ListItemButton>
            )}
            {listing?.folders.map((name) => (
              <ListItemButton key={`d:${name}`} onClick={() => go(joinPath(dir, name))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  chooseFolder(name, event);
                }}>
                <span className="glyphicon glyphicon-folder-close" style={{ marginRight: 12, opacity: 0.7 }} />
                <ListItemText primary={name} />
              </ListItemButton>
            ))}
            {listing?.files.map((file) => (
              <ListItemButton key={`f:${file.path}`} selected={selected?.path === file.path}
                onClick={() => choose(file, null)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  choose(file, event);
                }}>
                <span className="glyphicon glyphicon-file" style={{ marginRight: 12, opacity: 0.5 }} />
                <ListItemText
                  primary={nameOf(file.path)}
                  primaryTypographyProps={{
                    noWrap: true,
                    sx: file.state === "deleted" ? { textDecoration: "line-through", opacity: 0.6 } : undefined,
                  }}
                />
                {file.state !== "original" && (
                  <Chip size="small" variant="outlined" sx={{ mr: 1.5 }}
                    label={STATES[file.state].label} color={/** @type {any} */ (STATES[file.state].color)} />
                )}
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, textAlign: "right" }}>
                  {sizeOf(file.size)}
                </Typography>
              </ListItemButton>
            ))}
            {listing && listing.folders.length === 0 && listing.files.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>Empty.</Typography>
            )}
          </List>
        </Box>
        {preview && (
          <Box sx={{
            width: "40%", borderLeft: "1px solid", borderColor: "divider", p: 2,
            display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "#101113",
          }}>
            <Box component="img" src={preview} alt={selected ? nameOf(selected.path) : ""}
              sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", imageRendering: "pixelated" }} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {dir.toLowerCase() !== files.home.toLowerCase() && (
          <Button variant="text" color="inherit" onClick={() => go(files.home)} disabled={busy}
            sx={{ mr: "auto" }}>
            The game&apos;s folder
          </Button>
        )}
        {selected && !selected.folder && selected.state !== "deleted" && (
          <Button variant="outlined" color="inherit" onClick={download} disabled={busy}
            startIcon={<span className="glyphicon glyphicon-download-alt" />}>
            Download
          </Button>
        )}
      </DialogActions>

      <Menu open={Boolean(menu && selected)} onClose={() => setMenu(null)}
        anchorReference="anchorPosition" anchorPosition={menu ?? undefined}>
        {selected?.folder ? (
          <MenuItem onClick={() => {
            setMenu(null);
            go(selected.path);
          }}>
            Open
          </MenuItem>
        ) : [
          <MenuItem key="edit" disabled={!editable} onClick={edit}>Edit</MenuItem>,
          <MenuItem key="replace" disabled={selected?.state === "deleted"}
            onClick={() => { setMenu(null); replaceInput.current?.click(); }}>
            Replace
          </MenuItem>,
        ]}
        {selected?.state !== "deleted" && (
          <MenuItem onClick={() => selected && act(async () => {
            setMenu(null);
            setPreview(null);
            await files.remove(selected.path);
            await refresh();
            setSelected(null);
          })}>
            Delete
          </MenuItem>
        )}
        {files.revert && selected && !selected.folder && (selected.state === "changed" || selected.state === "deleted" || selected.bundled) && (
          <MenuItem onClick={() => act(async () => {
            setMenu(null);
            await files.revert?.(selected.path);
            await refresh();
            setSelected(null);
            setPreview(null);
          })}>
            {selected.state === "deleted" ? "Restore" : "Restore the bottle's own"}
          </MenuItem>
        )}
      </Menu>

      <input ref={replaceInput} type="file" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file && selected) {
          void act(async () => {
            await put(selected.path, file);
            await refresh();
            setPreview(null);
          });
        }
      }} />
      <input ref={filesInput} type="file" multiple hidden onChange={(event) => {
        const chosen = event.target.files;
        void add(chosen, (file) => joinPath(dir, file.name));
        event.target.value = "";
      }} />
      <input ref={folderInput} type="file" hidden {...{ webkitdirectory: "" }} onChange={(event) => {
        const chosen = event.target.files;
        void add(chosen, (file) => joinPath(dir, file.webkitRelativePath.replace(/\//g, "\\")));
        event.target.value = "";
      }} />

      {editing && (
        <FileEditor
          path={editing.path}
          initial={editing.form.text}
          onSave={async (text) => {
            await files.write(editing.path, encodeText(text, editing.form));
            await refresh();
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Dialog>
  );
}

/**
 * A text file, edited. Saving writes it where the editor's files go; closing
 * drops what was typed, unsaved.
 *
 * @param {Object} props
 * @param {string} props.path
 * @param {string} props.initial
 * @param {(text: string) => Promise<void>} props.onSave
 * @param {() => void} props.onClose
 */
function FileEditor({ path, initial, onSave, onClose }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(/** @type {string | null} */ (null));
  return (
    <Dialog open fullWidth maxWidth="md" onClose={saving ? undefined : onClose}
      PaperProps={{ sx: { height: "80vh" } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Typography noWrap sx={{ flex: 1, minWidth: 0, fontFamily: "monospace" }}>{path}</Typography>
        <IconButton aria-label="close" onClick={onClose} disabled={saving}>
          <span className="glyphicon glyphicon-remove" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: "flex", flexDirection: "column" }}>
        {failure && <Alert severity="error" variant="outlined" sx={{ m: 1 }}>{failure}</Alert>}
        <Box component="textarea" value={text} spellCheck={false} disabled={saving}
          onChange={(event) => setText(event.target.value)}
          sx={{
            flex: 1, border: 0, outline: 0, resize: "none", p: 2, m: 0,
            fontFamily: "monospace", fontSize: 13, lineHeight: 1.5,
            bgcolor: "background.default", color: "text.primary",
          }} />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" disabled={saving} onClick={async () => {
          setSaving(true);
          setFailure(null);
          try {
            await onSave(text);
          } catch (e) {
            setFailure(String(/** @type {any} */ (e)?.message ?? e));
          } finally {
            setSaving(false);
          }
        }}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
