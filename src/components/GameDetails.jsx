/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { LabelBadges, VersionBadge } from "./VersionBadge.jsx";
import { FilesDialog } from "./FilesDialog.jsx";
import { bottleFiles } from "../engine/volumes.js";
import { residency } from "../engine/btl.js";
import { mayNotFit, siteSpace, sizeText } from "../engine/stored.js";
import { EDITABLE_TYPES } from "../api/config.js";
import {
  DEFAULT_SHADERS, DRIVER_RULES_CHOICES, GRAPHICS_CHOICES, MEMORY_CHOICES, SHADER_CHOICES,
  WINDOWS_CHOICES, loadSettings,
  saveSettings,
} from "../settings.js";
import {
  KINDS, LABELS, STATUSES, describeBundle, removeBundle, saveBundleArt, saveBundleSettings,
} from "../api/bundles.js";
import { exportBottle, removeBottle, saveLocalManifest } from "../engine/bottles.js";
import { removePatch } from "../engine/patches.js";
import { touchLayout } from "../engine/touch.js";
import { clearTranslations, opfsSession } from "@bottlify/core/storage";

/**
 * One of a bottle's pictures: what it shows now, or the file chosen to take its
 * place, which goes to the server only when the dialog is saved.
 *
 * @param {Object} props
 * @param {string} props.label
 * @param {string} props.current  What the bottle shows now, or empty.
 * @param {File | null} props.file
 * @param {(file: File) => void} props.onPick
 * @param {boolean} props.disabled
 * @param {string} props.ratio  The shape the picture is shown in.
 */
function ArtPicker({ label, current, file, onPick, disabled, ratio }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) {
      setPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const shown = preview || current;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{
        height: 120, aspectRatio: ratio, borderRadius: 1, border: "1px solid", borderColor: "divider",
        bgcolor: "#101113", backgroundImage: shown ? `url("${shown}")` : "none",
        backgroundSize: "cover", backgroundPosition: "center",
      }} />
      <Button size="small" variant="outlined" color="inherit" component="label" disabled={disabled}>
        {shown ? "Replace…" : "Choose…"}
        <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) onPick(chosen);
            event.target.value = "";
          }} />
      </Button>
    </Box>
  );
}

/**
 * A bottle's settings, in a dialog of their own. For a server's bottle where
 * this launcher may write bottles -- installing is on and a bottle server is
 * configured -- they are the bottle's: its title, description, version, kind
 * and labels, its cover and wallpaper, and the Windows and graphics it starts
 * with, saved with it for everyone who opens it.
 * Anywhere else the Windows and graphics are the person's own choice, kept in
 * this browser over what the manifest says; a bottle kept in this browser is
 * still described -- renamed, labelled -- in its own manifest.
 *
 * @param {Object} props
 * @param {import("../api/bundles.js").BundleManifest} props.bundle
 * @param {boolean} props.editable
 * @param {{ url: string, token: string } | null} props.upload
 * @param {(saved: import("../api/bundles.js").BundleManifest) => void} props.onSaved
 * @param {(id: string) => void} [props.onDeleted]  The bottle was removed, from this browser
 *     or from the server.
 * @param {() => void} props.onClose
 */
export function BottleSettingsDialog({
  bundle, editable, upload, onSaved, onDeleted, onClose, mode = "machine",
}) {
  const describing = mode === "describe";
  // The manifest this dialog writes is the server's: one kept in this browser
  // is never there, whatever this launcher may write.
  const onServer = editable && !bundle.local;
  const [settings, setSettings] = useState(loadSettings);
  const own = settings.bottleConfig[bundle.id] ?? {};
  const [windows, setWindows] = useState(
    (onServer ? undefined : own.windows) ?? bundle.windows ?? "winxp");
  const [graphics, setGraphics] = useState(
    (onServer ? undefined : own.graphics) ?? bundle.graphics ?? "all");
  const [shaders, setShaders] = useState(
    (onServer ? undefined : own.shaders) ?? bundle.shaders ?? DEFAULT_SHADERS);
  // Said as true or false, or not at all -- which runs on one core.
  const [multithreading, setMultithreading] = useState(
    ((onServer ? undefined : own.multithreading) ?? bundle.multithreading) === true);
  // Zero follows the general setting; the choice is this browser's, whoever owns the bottle.
  const [memory, setMemory] = useState(own.memory ?? 0);
  // Kept in this browser as the memory is: a way to compare two answers, not the bottle's own.
  const [driverRules, setDriverRules] = useState(own.driverRules ?? "legacy");
  // The controls on a touch screen: this browser's, as the hands holding it are.
  const [touch, setTouch] = useState(() => touchLayout(own.touch));
  /** @param {Partial<ReturnType<typeof touchLayout>>} patch */
  const changeTouch = (patch) => setTouch((held) => touchLayout({ ...held, ...patch }));
  const [title, setTitle] = useState(bundle.title ?? "");
  const [description, setDescription] = useState(bundle.description ?? "");
  const [cover, setCover] = useState(null);
  const [wallpaper, setWallpaper] = useState(null);
  const [version, setVersion] = useState(bundle.version ?? "");
  const [kind, setKind] = useState(bundle.kind ?? "game");
  const [labels, setLabels] = useState(bundle.labels ?? []);
  const [status, setStatus] = useState(bundle.status ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);
  // Removing a bottle cannot be taken back, so it is asked twice.
  const [confirming, setConfirming] = useState(false);
  // Clearing the cache is asked once too: the next start is slower for it.
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const clearCache = () => {
    setClearing(false);
    clearTranslations(bundle.id).then(
      (count) => setCleared({ ok: true, text: count > 0
        ? "The cache is cleared: the next start translates the program again."
        : "There was no cache to clear." }),
      (error) => setCleared({ ok: false, text: `The cache was not cleared: ${error?.message ?? error}` }));
  };

  const remove = async () => {
    setSaving(true);
    setFailure(null);
    try {
      // A bottle kept in this browser is removed here, and everything this
      // browser keeps of it with it: what its program wrote -- the saved
      // games -- the patch over it and the cache of its translated code. The
      // server's of the same id, if there is one, is not the one asked about.
      if (bundle.local) {
        await removeBottle(bundle.id);
        await opfsSession(bundle.id).clear();
        await removePatch(bundle.id);
        await clearTranslations(bundle.id);
      } else {
        await removeBundle(upload, bundle.id);
      }
      onDeleted?.(bundle.id);
      onClose();
    } catch (e) {
      setFailure(e.message);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  /**
   * The bottle's own memory, or none to follow the general setting, and its
   * driver rules where they are not the default.
   *
   * @param {object} config
   */
  const withMemory = (config) => {
    const next = { ...config, memory, driverRules, touch };
    if (!memory) delete next.memory;
    if (driverRules !== "current") delete next.driverRules;
    return next;
  };

  const save = async () => {
    if (!onServer && !describing) {
      setSettings(saveSettings({
        bottleConfig: { ...settings.bottleConfig,
          [bundle.id]: withMemory({ ...own, windows, graphics, shaders, multithreading }) },
      }));
      onClose();
      return;
    }
    setSaving(true);
    setFailure(null);
    const described = {
      title: title.trim() || bundle.title,
      description: description.trim(),
      version: version.trim(),
      kind,
      labels: LABELS.map((one) => one.value).filter((value) => labels.includes(value)),
      status,
    };
    try {
      if (!onServer) {
        // Only a bottle kept here is described anywhere but on the server.
        const manifest = await saveLocalManifest(bundle.id, described);
        onSaved({ ...describeBundle(bundle.id, manifest), local: true });
        onClose();
        return;
      }
      // The pictures first: each answers the manifest as it then is, and the
      // settings after them answer the whole of it.
      for (const [slot, file] of [["cover", cover], ["wallpaper", wallpaper]]) {
        if (file) await saveBundleArt(upload, bundle.id, slot, file);
      }
      const saved = await saveBundleSettings(upload, bundle.id, {
        ...described,
        windows,
        graphics,
        shaders,
        multithreading,
      });
      // What the bottle now starts with is what was just saved; a choice of
      // the person's own over the old values would hide the new ones.
      const kept = { ...own };
      delete kept.windows;
      delete kept.graphics;
      delete kept.shaders;
      delete kept.multithreading;
      setSettings(saveSettings({
        bottleConfig: { ...settings.bottleConfig, [bundle.id]: withMemory(kept) },
      }));
      onSaved(saved);
      onClose();
    } catch (e) {
      setFailure(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={saving ? undefined : onClose}>
      <DialogTitle>{describing ? "Edit bottle" : "Bottle settings"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {onServer
              ? "Saved in the bottle itself: everyone who opens it starts with these."
              : describing
                ? "Saved in the bottle, in this browser."
                : "Kept for you in this browser, over what the bottle says."}
          </Typography>
          {describing && (onServer || bundle.local) && (
            <>
              <TextField label="Title" size="small" value={title}
                onChange={(event) => setTitle(event.target.value)} disabled={saving} />
              <TextField label="Description" size="small" value={description} multiline minRows={2}
                maxRows={6} inputProps={{ maxLength: 2000 }}
                onChange={(event) => setDescription(event.target.value)} disabled={saving} />
              {/* Pictures are kept beside a manifest on the server only. */}
              {onServer && (
                <Stack direction="row" spacing={3}>
                  <ArtPicker label="Cover" ratio="3 / 4" current={bundle.coverLarge} file={cover}
                    onPick={setCover} disabled={saving} />
                  <ArtPicker label="Wallpaper" ratio="16 / 9"
                    current={bundle.wallpaper === bundle.coverLarge ? "" : bundle.wallpaper}
                    file={wallpaper} onPick={setWallpaper} disabled={saving} />
                </Stack>
              )}
              <Stack direction="row" spacing={2}>
                <TextField label="Version" size="small" value={version} sx={{ flex: 1 }}
                  helperText="Left empty, no version is shown"
                  onChange={(event) => setVersion(event.target.value)} disabled={saving} />
                <TextField select label="Type" size="small" value={kind} sx={{ flex: 1 }}
                  onChange={(event) => setKind(event.target.value)} disabled={saving}>
                  {KINDS.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
                </TextField>
              </Stack>
              <Box>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                  Labels
                </Typography>
                <ToggleButtonGroup size="small" value={labels} disabled={saving}
                  onChange={(_event, value) => setLabels(value)}>
                  {LABELS.map((one) => (
                    <ToggleButton key={one.value} value={one.value} sx={{ px: 1.5 }}>{one.label}</ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                  Status
                </Typography>
                {/* One of them or none: pressing the chosen one again takes it back. */}
                <ToggleButtonGroup size="small" exclusive value={status} disabled={saving}
                  onChange={(_event, value) => setStatus(value ?? "")}>
                  {STATUSES.map((one) => (
                    <ToggleButton key={one.value} value={one.value} sx={{ px: 1.5 }}>{one.label}</ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
            </>
          )}
          {!describing && (<>
            <TextField select size="small" label="Windows" value={windows} disabled={saving}
              onChange={(event) => setWindows(event.target.value)}>
              {WINDOWS_CHOICES.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Graphics" value={graphics} disabled={saving}
              helperText="Every DirectX up to the chosen one is installed; OpenGL means OpenGL alone"
              onChange={(event) => setGraphics(event.target.value)}>
              {GRAPHICS_CHOICES.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Shader profile" value={shaders} disabled={saving}
              helperText="The video card games are told of: they pick their effects from it"
              onChange={(event) => setShaders(event.target.value)}>
              {SHADER_CHOICES.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Multithreading" value={multithreading ? "on" : "off"}
              disabled={saving}
              helperText="Its threads on several cores at once; off, one core"
              onChange={(event) => setMultithreading(event.target.value === "on")}>
              <MenuItem value="off">Off (one core)</MenuItem>
              <MenuItem value="on">On (cores chosen by the engine)</MenuItem>
            </TextField>
            <TextField select size="small" label="Memory" value={memory} disabled={saving}
              helperText="Some games will not start with less; kept in this browser"
              onChange={(event) => setMemory(Number(event.target.value))}>
              <MenuItem value={0}>
              Default ({MEMORY_CHOICES.find((one) => one.value === settings.memory)?.label})
              </MenuItem>
              {MEMORY_CHOICES.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Driver rules" value={driverRules} disabled={saving}
              helperText="Where DirectX left a behaviour to the driver; kept in this browser"
              onChange={(event) => setDriverRules(event.target.value)}>
              {DRIVER_RULES_CHOICES.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Touch controls" value={touch.controls} disabled={saving}
              helperText="On a phone or a tablet, over the picture; kept in this browser"
              onChange={(event) => changeTouch({ controls: event.target.value })}>
              <MenuItem value="keys">Keyboard and mouse (a stick for the keys, a drag to look)</MenuItem>
              <MenuItem value="mouse">Mouse (a stick for the keys, a touchpad for the cursor)</MenuItem>
              <MenuItem value="pad">Gamepad (for a game that reads one)</MenuItem>
              <MenuItem value="off">Off (taps are clicks)</MenuItem>
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField select size="small" label="Stick keys" value={touch.move} sx={{ flex: 1 }}
                disabled={saving || (touch.controls !== "keys" && touch.controls !== "mouse")}
                onChange={(event) => changeTouch({ move: event.target.value })}>
                <MenuItem value="wasd">W A S D</MenuItem>
                <MenuItem value="arrows">Arrows</MenuItem>
              </TextField>
              <TextField select size="small" label="Stick under" value={touch.hand} sx={{ flex: 1 }}
                disabled={saving || touch.controls === "off"}
                onChange={(event) => changeTouch({ hand: event.target.value })}>
                <MenuItem value="right">The left thumb</MenuItem>
                <MenuItem value="left">The right thumb</MenuItem>
              </TextField>
              <TextField select size="small" label="Size" value={touch.size} sx={{ flex: 1 }}
                disabled={saving || touch.controls === "off"}
                onChange={(event) => changeTouch({ size: Number(event.target.value) })}>
                <MenuItem value={0.8}>Small</MenuItem>
                <MenuItem value={1}>Medium</MenuItem>
                <MenuItem value={1.25}>Large</MenuItem>
              </TextField>
            </Stack>
          </>)}
          {failure && <Alert severity="error" variant="outlined">{failure}</Alert>}
          {cleared && (
            <Alert severity={cleared.ok ? "success" : "error"} variant="outlined"
              onClose={() => setCleared(null)}>
              {cleared.text}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!describing && (
          <Button color="error" onClick={() => setClearing(true)} disabled={saving}
            sx={{ mr: "auto" }}>
            Clear cache…
          </Button>
        )}
        {describing && (onServer || bundle.local) && onDeleted && (
          <Button color="error" onClick={() => setConfirming(true)} disabled={saving}
            sx={{ mr: "auto" }}>
            Delete bottle…
          </Button>
        )}
        <Button color="inherit" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="outlined" color="inherit" onClick={save} disabled={saving}>Save</Button>
      </DialogActions>
      <Dialog open={clearing} onClose={() => setClearing(false)}>
        <DialogTitle>Clear the cache of {bundle.title}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The whole cache of the game&apos;s translated code is erased. The next start translates
            the program again, and is slower for it. The saved games are not touched.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setClearing(false)}>Cancel</Button>
          <Button variant="outlined" color="error" onClick={clearCache}>Clear cache</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirming} onClose={saving ? undefined : () => setConfirming(false)}>
        <DialogTitle>Delete {bundle.title}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {bundle.local
              ? "Everything this browser keeps of it is deleted: the bottle, your saved games, "
                + "the changes made to its files and its cache. None of it can be brought back."
              : "The bottle is removed from the server, for everyone who opens this library, "
                + "and cannot be brought back. The saved games and the patch this browser keeps "
                + "for it are not removed."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirming(false)} disabled={saving}>Cancel</Button>
          <Button variant="outlined" color="error" onClick={remove} disabled={saving}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

/** A screen wider than it is tall -- a desktop, a phone on its side -- has the
 * cover beside the text; a taller one has it above, and the panel scrolls. */
const LANDSCAPE = "@media (orientation: landscape)";

/** The cover's box: a 3:4 picture, above the text or the panel's full height beside it. */
const COVER = {
  aspectRatio: "3 / 4",
  width: "min(64%, 260px)",
  alignSelf: "center",
  [LANDSCAPE]: { width: "auto", height: "100%", maxWidth: "42%", alignSelf: "flex-start" },
  flexShrink: 0,
  borderRadius: 2,
  border: "1px solid",
  borderColor: "divider",
  bgcolor: "#101113",
};

/**
 * Game info panel. Slides in from the right over the blurred grid and takes
 * ~80% of the width; the grid stays visible under the blur. Left 20% acts as
 * a dimmed scrim that closes the panel.
 *
 * @param {Object} props
 * @param {import("../api/bundles.js").BundleManifest | null} props.bundle
 * @param {() => void} props.onClose
 * @param {() => void} props.onPlay
 * @param {boolean} [props.editable]  This launcher may write the bottle's manifest.
 * @param {{ url: string, token: string } | null} [props.upload]
 * @param {(saved: import("../api/bundles.js").BundleManifest) => void} [props.onChanged]
 * @param {(id: string) => void} [props.onDeleted]
 * @param {string[]} [props.editableTypes]  Extensions the file explorer edits.
 */
export function GameDetails({
  bundle, onClose, onPlay, editable = false, upload = null, onChanged, onDeleted,
  editableTypes = EDITABLE_TYPES,
}) {
  const [editing, setEditing] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [browsing, setBrowsing] = useState(/** @type {import("../engine/volumes.js").VolumeFiles | null} */ (null));
  // How far an export has got, as a share; null when none runs. Updated a few
  // times a second at most: a bottle of gigabytes is tens of thousands of
  // pieces, and a render for each would stall the page writing it.
  const [exporting, setExporting] = useState(/** @type {number | null} */ (null));
  const [exportFailure, setExportFailure] = useState(/** @type {string | null} */ (null));
  // Whether the bottle is here whole, so a download is written from this
  // browser: one kept here always is, a library one once every block of it is.
  // null while that is being checked, and the button waits for the answer;
  // `unchecked` when the check could not answer, which leaves it off too.
  // `held` is the share of its bytes here, which the button names when it
  // cannot write.
  const [whole, setWhole] = useState(/** @type {boolean | null} */ (null));
  const [unchecked, setUnchecked] = useState(false);
  const [held, setHeld] = useState(0);
  // What a start still downloads beside the room this site has left, when the
  // one is larger than the other: said on Play, never in its way.
  const [tight, setTight] = useState(/** @type {{ missing: number, free: number } | null} */ (null));
  useEffect(() => {
    if (!bundle) return undefined;
    setUnchecked(false);
    setTight(null);
    if (bundle.local) {
      setWhole(true);
      return undefined;
    }
    let live = true;
    setWhole(null);
    residency(bundle).then(async (here) => {
      if (!live) return;
      setWhole(here.resident === here.blocks);
      setHeld(here.bytes > 0 ? here.residentBytes / here.bytes : 0);
      const missing = here.bytes - here.residentBytes;
      const space = await siteSpace().catch(() => null);
      if (live && space && mayNotFit(missing, space)) setTight({ missing, free: space.free });
    }, () => live && setUnchecked(true));
    return () => { live = false; };
  }, [bundle]);
  const exportIt = async () => {
    setExportFailure(null);
    setExporting(0);
    let shown = 0;
    try {
      await exportBottle(bundle, (written, total) => {
        const now = performance.now();
        if (now - shown < 250) return;
        shown = now;
        setExporting(total > 0 ? written / total : 0);
      });
    } catch (error) {
      setExportFailure(`The bottle was not exported: ${/** @type {any} */ (error)?.message ?? error}`);
    } finally {
      setExporting(null);
    }
  };
  if (!bundle) return null;
  const kind = KINDS.find((one) => one.value === bundle.kind)?.label ?? "Game";

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      {/* scrim over the left 20%: closing the panel, leaving the blurred grid below;
          on a phone the panel takes the whole width */}
      <Box
        onClick={onClose}
        sx={{
          display: { xs: "none", md: "block" },
          width: "20%",
          height: "100%",
          bgcolor: "rgba(10,11,13,0.35)",
          cursor: "pointer",
        }}
      />

      <Box
        sx={{
          width: { xs: "100%", md: "80%" },
          height: "100%",
          bgcolor: "background.paper",
          borderLeft: "1px solid",
          borderColor: "divider",
          boxShadow: "-24px 0 64px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
          animation: "bottlify-slide-in .5s cubic-bezier(0.16,1,0.3,1)",
          "@keyframes bottlify-slide-in": {
            from: { transform: "translateX(100%)" },
            to: { transform: "translateX(0)" },
          },
        }}
      >
        <Box sx={{ p: 2, display: "flex", justifyContent: "flex-end" }}>
          <IconButton onClick={onClose} aria-label="close">
            <span className="glyphicon glyphicon-remove" />
          </IconButton>
        </Box>

        {/* Side by side on a wide screen; on a phone the cover, the text and
            the buttons one under another, the whole panel scrolling. */}
        <Box sx={{
          display: "flex", flexDirection: "column", gap: 2.5, overflowY: "auto",
          height: "100%", minHeight: 0, px: { xs: 2, md: 4 }, pb: { xs: 3, md: 4 },
          [LANDSCAPE]: { flexDirection: "row", gap: { xs: 2.5, md: 4 }, overflowY: "visible" },
        }}>
          {/* big cover, or the same box with a placeholder when the manifest
              names none -- never an empty <img src=""> */}
          {bundle.coverLarge ? (
            <Box
              component="img"
              src={bundle.coverLarge}
              alt={bundle.title}
              sx={{
                ...COVER,
                objectFit: "cover",
              }}
            />
          ) : (
            <Box
              sx={{
                ...COVER,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "text.secondary",
                opacity: 0.6,
              }}
            >
              <span className="glyphicon glyphicon-picture" style={{ fontSize: 56 }} />
            </Box>
          )}
          {/* text block */}
          <Box sx={{ flex: "none", display: "flex", flexDirection: "column", minWidth: 0,
            [LANDSCAPE]: { flex: 1, minHeight: 0 } }}>
            <Typography variant="h4" title={bundle.title} sx={{
              fontWeight: 700, minWidth: 0, fontSize: { xs: "1.75rem", md: "2.125rem" },
              overflow: "hidden", textOverflow: "ellipsis", [LANDSCAPE]: { whiteSpace: "nowrap" },
            }}>
              {bundle.title}
            </Typography>
            <Box sx={{ mt: 0.75, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <VersionBadge version={bundle.version} size="medium" />
              <LabelBadges labels={bundle.status ? [...bundle.labels, bundle.status] : bundle.labels}
                size="medium" />
              <Typography variant="body2" color="text.secondary"
                sx={{ ml: 0.5, minWidth: 0, overflowWrap: "anywhere" }}>
                {kind} · {bundle.id}
                {/* Whether the game is on this device, so a person knows what
                    starts without the network and what can be saved. */}
                {whole !== null && ` · ${whole ? "Downloaded"
                  : held > 0 ? `${Math.floor(held * 100)}% downloaded` : "Not downloaded"}`}
              </Typography>
              {/* The bottle's name and pictures are its owner's to change. */}
              {((editable && upload) || bundle.local) && (
                <Tooltip title="Edit bottle">
                  <IconButton size="small" aria-label="edit bottle" onClick={() => setEditing(true)}
                    sx={{ ml: "auto" }}>
                    <span className="glyphicon glyphicon-pencil" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ mt: { xs: 2, md: 3 }, [LANDSCAPE]: { flex: 1, overflowY: "auto" } }}
            >
              {bundle.description || "No description in the bundle manifest."}
            </Typography>
            {(bundle.year || bundle.rightsHolder) && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                © {[bundle.year, bundle.rightsHolder].filter(Boolean).join(" ")}
              </Typography>
            )}
            {(editing || configuring) && (
              <BottleSettingsDialog
                bundle={bundle}
                mode={editing ? "describe" : "machine"}
                editable={editable && Boolean(upload)}
                upload={upload}
                onSaved={(saved) => onChanged?.(saved)}
                onDeleted={onDeleted}
                onClose={() => {
                  setEditing(false);
                  setConfiguring(false);
                }}
              />
            )}
            {browsing && (
              <FilesDialog title={bundle.title} files={browsing} editableTypes={editableTypes}
                onClose={() => setBrowsing(null)} />
            )}
            {exportFailure && (
              <Alert severity="error" variant="outlined" onClose={() => setExportFailure(null)}
                sx={{ mt: 2 }}>
                {exportFailure}
              </Alert>
            )}
            {/* Play under the text, right-aligned, and the bottle's files
                beside it: what the game will see, and the person's patch. */}
            <Box sx={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 1.5,
              pt: 2, "& > .MuiButton-root": { flex: { xs: 1, md: "none" }, px: { xs: 1, md: 3 } } }}>
              {/* A bottle goes out as one file another imports as it is: a download
                  beside the buttons, its ring filling while it writes. */}
              <Tooltip title={exporting !== null ? `Downloading: ${Math.floor(exporting * 100)}%`
                : whole === false ? `${Math.floor(held * 100)}% of the game is in this browser; `
                  + "it can be saved once all of it is"
                  : unchecked ? "Whether the whole game is in this browser could not be checked"
                    : whole === null ? "Checking that the whole game is in this browser…"
                      : "Download the bottle"}>
                <span>
                  <IconButton aria-label="download the bottle" onClick={exportIt}
                    disabled={exporting !== null || whole !== true} sx={{ width: 44, height: 44 }}>
                    {exporting === null
                      ? <span className="glyphicon glyphicon-download-alt" />
                      : <CircularProgress size={22} variant="determinate"
                        value={Math.max(exporting * 100, 2)} color="inherit" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Button variant="outlined" color="inherit" onClick={() => setBrowsing(bottleFiles(bundle))}
                startIcon={<span className="glyphicon glyphicon-folder-open" />} sx={{ py: 1.2 }}>
                Files
              </Button>
              <Button variant="outlined" color="inherit" onClick={() => setConfiguring(true)}
                startIcon={<span className="glyphicon glyphicon-cog" />} sx={{ py: 1.2 }}>
                Settings
              </Button>
              <Button
                variant="contained"
                onClick={onPlay}
                startIcon={<span className="glyphicon glyphicon-play" />}
                sx={{ py: 1.2 }}
              >
                Play
              </Button>
            </Box>
            {tight && (
              <Typography variant="caption" color="warning.main" sx={{ display: "block", textAlign: "right", mt: 1 }}>
                May not fit: {sizeText(tight.missing)} still to download, {sizeText(tight.free)} free
                for this site (the browser&apos;s estimate).
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
