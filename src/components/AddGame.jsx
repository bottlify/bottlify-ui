/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Breadcrumbs, Button, Dialog, DialogActions, DialogContent, LinearProgress, Link, List,
  ListItemButton, ListItemText, MenuItem, TextField, Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  archiveDisc, collectFrom, isDiscImage, isZipArchive, readZip, saveBottle, sizeOf, storageHeadroom,
} from "@bottlify/installer";
import { readFile } from "../api/readFile.js";
import { bottlesFolder, importBottle, localBottles } from "../engine/bottles.js";
import { formatOf, likelyProgram, unsupportedReason } from "../engine/formats.js";
import { DEFAULT_MACHINE } from "../settings.js";
import { useT } from "../i18n.js";
import { useSettings } from "../useSettings.js";
import { INK } from "../theme.js";
import { DialogHead, Segmented } from "./kit.jsx";
import { PlayScreen } from "./PlayScreen.jsx";

/**
 * @typedef {{ name: string, bytes: Uint8Array } | { name: string, disc: Blob | Uint8Array,
 *     entry?: string, unpacked?: { path: string, bytes: Uint8Array | null }[] }
 *     | { name: string, prefix: import("@bottlify/installer/prefix").Prefix }} Media
 *     An installer, a disc image (or an archive made a disc), or a tree that needs no install.
 */

/**
 * Adding a game of the person's own, in three steps: the file; its install,
 * which runs the installer's own wizard on the play screen; the game's name and
 * the program it starts. An installer, a disc image (told apart by its
 * contents, mounted as a drive), a zip (made a disc, or kept as it stands for a
 * game shipped unpacked) and a bottle are taken. The game is kept in this
 * browser only: nothing of it is sent anywhere.
 *
 * Which program the bottle starts is asked, always: a game of this era ships
 * several executables -- a stub, the game, an updater -- and the guess only
 * preselects the answer.
 *
 * @param {Object} props
 * @param {() => void} props.onClose
 * @param {(title: string) => void} props.onAdded  A game is in the library.
 */
export function AddGame({ onClose, onAdded }) {
  const t = useT();
  const [phase, setPhase] = useState(/** @type {any} */ ({ kind: "choose" }));
  const [machine, setMachine] = useState(DEFAULT_MACHINE);
  // The installer's run, once it has ended: the form over its screen, or put
  // aside and brought back from the bar.
  const [result, setResult] = useState(/** @type {any} */ (null));
  const [asking, setAsking] = useState(false);
  const reading = useRef(/** @type {AbortController | null} */ (null));
  /** The media the installer runs from, for its run's end to read. */
  const installed = useRef(/** @type {any} */ (null));

  /** @param {File} file */
  const open = async (file) => {
    const attempt = new AbortController();
    reading.current = attempt;
    setPhase({ kind: "reading", name: file.name, size: file.size, read: null });
    try {
      const disc = await isDiscImage(file).catch(() => false);
      // Four kinds are taken, each told by its own bytes rather than its name.
      const kind = disc ? "iso" : await formatOf(file);
      if (kind === null) {
        setPhase({ kind: "choose", error: t(`add.${unsupportedReason(file.name)}`, { name: file.name }) });
        return;
      }
      if (kind === "btl") {
        const { manifest } = await importBottle(file, (read, size) =>
          setPhase({ kind: "reading", name: file.name, size, read }));
        onAdded(String(manifest.title ?? file.name));
        return;
      }
      // What an install will need is unknowable; that it needs at least the size
      // of its own distribution is not, so that much is checked up front.
      const room = await storageHeadroom();
      if (room && room.available < file.size) {
        setPhase({ kind: "choose", error: t("add.noRoom", { name: file.name, size: t.bytes(file.size),
          free: t.bytes(room.available) }) });
        return;
      }
      if (disc) {
        setPhase({ kind: "ready", file, media: { name: file.name, disc: file }, what: "disc" });
        return;
      }
      // An archive is the disc it stands in for, once unpacked; which of its
      // programs to start is asked, since it has no autorun.inf to say.
      if (await isZipArchive(file).catch(() => false)) {
        const entries = await readZip(file, (done, total) =>
          setPhase({ kind: "reading", name: file.name, size: total, read: done, files: true }));
        if (!attempt.signal.aborted) setPhase({ kind: "archive", file, entries });
        return;
      }
      setPhase({ kind: "reading", name: file.name, size: file.size, read: 0 });
      const bytes = await readFile(file,
        (read) => setPhase({ kind: "reading", name: file.name, size: file.size, read }),
        { signal: attempt.signal });
      setPhase({ kind: "ready", file, media: { name: file.name, bytes }, what: "installer" });
    } catch (e) {
      if (/** @type {any} */ (e)?.name === "AbortError") setPhase({ kind: "choose" });
      else setPhase({ kind: "choose", error: t("add.unreadable", { name: file.name,
        reason: /** @type {any} */ (e)?.message ?? e }) });
    }
  };

  /** @param {Media} media */
  const install = (media) => {
    setResult(null);
    if ("prefix" in media) {
      setResult({ media, prefix: media.prefix, exitCode: 0, layers: [] });
      setAsking(true);
      return;
    }
    installed.current = { ...media, machine };
    setPhase({ kind: "installing", media: installed.current });
  };

  // Read once, here: taking the tree out of the volume copies it, and the form asks about it repeatedly.
  const onExited = useCallback((/** @type {any} */ app, /** @type {number} */ code, layersNeeded = []) => {
    const media = installed.current;
    try {
      setResult({ media, prefix: collectFrom(app, media), exitCode: code, layers: layersNeeded });
    } catch (e) {
      setResult({ media, error: String(/** @type {any} */ (e)?.message ?? e) });
    }
    setAsking(true);
  }, []);

  if (phase.kind === "installing") {
    return (
      <>
        <PlayScreen media={phase.media} title={t("add.installingTitle", { name: phase.media.name })}
          onClose={onClose} onExited={onExited} />
        {result && asking && (
          <NameStep result={result} machine={machine} onAdded={onAdded} onCancel={() => setAsking(false)}
            onKeepArchive={phase.media.unpacked ? () => setResult((held) => ({ ...held,
              prefix: { ...held.prefix, files: [...held.prefix.files, ...phase.media.unpacked
                .filter((/** @type {any} */ one) => one.bytes !== null)
                // Under C:\App, where a kept archive's tree goes.
                .map((/** @type {any} */ { path, bytes }) => ({ path: `App\\${path}`, bytes }))] } })) : null} />
        )}
        {result?.prefix && !asking && (
          <Box sx={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 40,
            display: "flex", alignItems: "center", gap: 2, px: 2.5, py: 1.5, bgcolor: INK.surface,
            border: "1px solid", borderColor: "divider", borderRadius: "14px" }}>
            <Typography color="text.secondary">{t("add.putAside")}</Typography>
            <Button variant="contained" onClick={() => setAsking(true)}>{t("add.finish")}</Button>
          </Box>
        )}
      </>
    );
  }

  const step = phase.kind === "choose" ? 1 : 2;
  return (
    <>
      <Dialog open={!(result && asking)} fullWidth maxWidth="md" onClose={onClose}>
        <AddHead step={step} onClose={onClose} />
        <DialogContent sx={{ px: 4, pt: 1, pb: 4 }}>
          {phase.kind === "choose" && <ChooseStep error={phase.error} onFile={open} />}
          {phase.kind === "reading" && (
            <Box>
              <Picked name={phase.name} detail={phase.files
                ? t("add.unpacking", { done: phase.read ?? 0, total: phase.size })
                : phase.read === null ? t("add.checking", { size: t.bytes(phase.size) })
                  : t("add.reading", { done: t.bytes(phase.read), total: t.bytes(phase.size) })} />
              <Progress value={phase.read !== null && phase.size > 0 ? phase.read / phase.size : null} />
              <Button sx={{ mt: 2 }} onClick={() => reading.current?.abort()}>{t("button.cancel")}</Button>
            </Box>
          )}
          {phase.kind === "ready" && (
            <Box>
              <Picked name={phase.file.name}
                detail={`${t(`add.kind.${phase.what}`)}, ${t.bytes(phase.file.size)}`} />
              <MachineChoice machine={machine} onMachine={setMachine} />
              <Typography color="text.secondary" sx={{ mt: 3 }}>{t("add.wizardNote")}</Typography>
            </Box>
          )}
          {phase.kind === "archive" && (
            <Box>
              <Picked name={phase.file.name} detail={`${t("add.kind.archive")}, ${t.bytes(phase.file.size)}`} />
              <ArchivePicker name={phase.file.name} entries={phase.entries}
                chosen={phase.chosen ?? likelyProgram(phase.entries)}
                onChoose={(chosen) => setPhase({ ...phase, chosen })} />
              <MachineChoice machine={machine} onMachine={setMachine} />
            </Box>
          )}
        </DialogContent>
        {phase.kind === "ready" && (
          <DialogActions sx={{ px: 4, borderTop: "1px solid", borderColor: "divider" }}>
            <Button onClick={() => setPhase({ kind: "choose" })}>{t("button.back")}</Button>
            <Button variant="contained" onClick={() => install(phase.media)}>{t("add.install")}</Button>
          </DialogActions>
        )}
        {phase.kind === "archive" && (() => {
          const chosen = phase.chosen ?? likelyProgram(phase.entries);
          return (
            <DialogActions sx={{ px: 4, borderTop: "1px solid", borderColor: "divider" }}>
              <Button onClick={() => setPhase({ kind: "choose" })}>{t("button.back")}</Button>
              <Button disabled={!chosen || /\.msi$/i.test(chosen)}
                onClick={() => install({ name: phase.file.name,
                  prefix: { root: "C:\\App", outside: [], entry: chosen,
                    files: phase.entries.filter((/** @type {any} */ one) => one.bytes !== null)
                      .map((/** @type {any} */ { path, bytes }) => ({ path, bytes })) } })}>
                {t("add.installedAlready")}
              </Button>
              <Button variant="contained" disabled={!chosen}
                onClick={() => install({ ...archiveDisc(phase.file.name, phase.entries, chosen),
                  unpacked: phase.entries })}>
                {t("add.install")}
              </Button>
            </DialogActions>
          );
        })()}
      </Dialog>
      {result && asking && (
        <NameStep result={result} machine={machine} onAdded={onAdded} onCancel={() => setResult(null)} />
      )}
    </>
  );
}

/** @param {{ step: number, onClose: (() => void) | null }} props */
function AddHead({ step, onClose }) {
  const t = useT();
  return (
    <>
      <DialogHead title={t("add.title")} subtitle={t("add.subtitle")} onClose={onClose}
        closeLabel={t("button.close")} />
      <Box sx={{ display: "flex", gap: 3, px: 4, pt: 1, pb: 2.5, flexWrap: "wrap" }}>
        {["add.step.file", "add.step.install", "add.step.name"].map((key, at) => {
          const now = at + 1 === step;
          const done = at + 1 < step;
          return (
            <Box key={key} sx={{ display: "flex", alignItems: "center", gap: 1.25,
              color: now ? "text.primary" : "text.secondary", fontWeight: now ? 600 : 450 }}>
              <Box component="i" sx={{ fontStyle: "normal", width: 26, height: 26, borderRadius: "50%",
                display: "grid", placeItems: "center", fontSize: 13, border: "1px solid",
                borderColor: now ? INK.text : INK.line, bgcolor: now ? INK.text : done ? INK.raised : "transparent",
                color: now ? INK.ground : done ? "success.main" : "inherit" }}>
                {done ? "✓" : at + 1}
              </Box>
              {t(key)}
            </Box>
          );
        })}
      </Box>
    </>
  );
}

/**
 * Step one: the file, dropped or chosen, and what kinds are taken.
 *
 * @param {{ error?: string, onFile: (file: File) => void }} props
 */
function ChooseStep({ error, onFile }) {
  const t = useT();
  const [over, setOver] = useState(false);
  const chooser = useRef(/** @type {HTMLInputElement | null} */ (null));
  /** @param {import("react").DragEvent} event */
  const hold = (event) => {
    // Without this the browser opens a dropped file itself, in place of the page.
    event.preventDefault();
    setOver(true);
  };
  return (
    <>
      {error && <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>{error}</Alert>}
      <Box onDragEnter={hold} onDragOver={hold} onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        sx={{ border: "1.5px dashed", borderColor: over ? "text.primary" : "divider", borderRadius: "14px",
          bgcolor: over ? INK.raised : "transparent", py: 7, px: 4, textAlign: "center", display: "grid",
          gap: 2, justifyItems: "center" }}>
        <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{t("add.drop")}</Typography>
        <Button onClick={() => chooser.current?.click()}>{t("add.choose")}</Button>
        {/* What can be installed or opened: a setup, a disc image, an archive, a bottle. */}
        <input ref={chooser} hidden type="file" accept=".exe,.iso,.zip,.btl" onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = "";
          if (file) onFile(file);
        }} />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mt: 3 }}>
        {["installer", "disc", "archive", "bottle"].map((kind) => (
          <Box key={kind} sx={{ bgcolor: INK.ground, borderRadius: "9px", px: 3, py: 2, display: "grid", gap: 0.75 }}>
            <Typography sx={{ fontWeight: 600 }}>{t(`add.kind.${kind}`)}</Typography>
            <Typography variant="body2" color="text.secondary">{t(`add.kindText.${kind}`)}</Typography>
          </Box>
        ))}
      </Box>
    </>
  );
}

/** The file being added, named. @param {{ name: string, detail: string }} props */
function Picked({ name, detail }) {
  return (
    <Box sx={{ p: 2, borderRadius: "9px", bgcolor: INK.ground }}>
      <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{name}</Typography>
      <Typography variant="body2" color="text.secondary">{detail}</Typography>
    </Box>
  );
}

/** @param {{ value: number | null }} props  A share, or null where it is not known. */
function Progress({ value }) {
  return (
    <LinearProgress variant={value === null ? "indeterminate" : "determinate"} value={(value ?? 0) * 100}
      sx={{ mt: 2.5, height: 6, borderRadius: 3, bgcolor: INK.raised,
        "& .MuiLinearProgress-bar": { bgcolor: INK.text } }} />
  );
}

/**
 * The Windows the install runs on, 32-bit or 64-bit, asked before it starts:
 * the game keeps it for good, since what it installs lies where that Windows
 * keeps it.
 *
 * @param {{ machine: string, onMachine: (machine: string) => void }} props
 */
function MachineChoice({ machine, onMachine }) {
  const t = useT();
  return (
    <Box sx={{ mt: 3, display: "grid", gap: 0.75 }}>
      <Typography sx={{ fontWeight: 600 }}>{t("add.machine")}</Typography>
      <Segmented value={machine} onChange={onMachine}
        options={[{ value: "x86", label: "32-bit" }, { value: "amd64", label: "64-bit" }]} />
      <Typography variant="body2" color="text.secondary">{t("add.machineHelp")}</Typography>
    </Box>
  );
}

/**
 * An unpacked archive, browsed by folder, for the person to pick the program
 * it starts: an archive has no `autorun.inf` to name one the way a disc does.
 *
 * @param {Object} props
 * @param {string} props.name
 * @param {import("@bottlify/installer").ArchiveEntry[]} props.entries
 * @param {string | null} props.chosen
 * @param {(path: string) => void} props.onChoose
 */
function ArchivePicker({ name, entries, chosen, onChoose }) {
  const t = useT();
  const [dir, setDir] = useState("");
  // What is directly under `dir`: subfolders by name, files with their size.
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
  const mono = { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 14 };
  return (
    <Box sx={{ mt: 3 }}>
      <Typography sx={{ fontWeight: 600 }}>{t("add.program")}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {chosen ?? t("add.programChoose")}
      </Typography>
      <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: "9px", overflow: "hidden" }}>
        <Breadcrumbs sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
          <Link component="button" underline="hover" color="inherit" onClick={() => setDir("")}>{name}</Link>
          {crumbs.map((part, at) => (
            <Link key={at} component="button" underline="hover" color="inherit"
              onClick={() => setDir(crumbs.slice(0, at + 1).join("\\"))}>{part}</Link>
          ))}
        </Breadcrumbs>
        <List dense sx={{ maxHeight: 260, overflowY: "auto" }}>
          {dir && (
            <ListItemButton onClick={() => setDir(crumbs.slice(0, -1).join("\\"))}>
              <ListItemText primary="..\" slotProps={{ primary: { sx: mono } }} />
            </ListItemButton>
          )}
          {dirs.map((sub) => (
            <ListItemButton key={`d:${sub}`} onClick={() => setDir(dir ? `${dir}\\${sub}` : sub)}>
              <ListItemText primary={`${sub}\\`} slotProps={{ primary: { sx: mono } }} />
            </ListItemButton>
          ))}
          {files.map((file) => (
            <ListItemButton key={`f:${file.path}`} selected={chosen === file.path}
              // A Windows Installer package is installed, through msiexec, but makes no game by itself.
              disabled={!/\.(exe|msi)$/i.test(file.path)} onClick={() => onChoose(file.path)}>
              <ListItemText primary={file.name} secondary={`${(file.size / (1 << 20)).toFixed(1)} MB`}
                slotProps={{ primary: { sx: mono } }} />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Box>
  );
}

/**
 * A file name made something that may name a folder. @param {string} text
 */
function slug(text) {
  return text.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Step three: the game's name, and the program it starts, from those the
 * install left. In developer mode, the id it is kept under too.
 *
 * @param {Object} props
 * @param {{ media: Media, prefix?: any, exitCode?: number, layers?: string[], error?: string }} props.result
 * @param {string} props.machine
 * @param {(title: string) => void} props.onAdded
 * @param {() => void} props.onCancel
 * @param {(() => void) | null} [props.onKeepArchive]  Puts the archive the program ran from into
 *     the game too, when the install left nothing to start.
 */
function NameStep({ result, machine, onAdded, onCancel, onKeepArchive = null }) {
  const t = useT();
  const { developer } = useSettings();
  const { media, prefix } = result;
  const [title, setTitle] = useState(() => media.name.replace(/\.[^.]+$/, ""));
  const [ownId, setOwnId] = useState("");
  const [entry, setEntry] = useState(/** @type {string | null} */ (prefix?.entry ?? null));
  const [saving, setSaving] = useState(/** @type {{ stage: string, bytes?: number } | null} */ (null));
  const [failure, setFailure] = useState(result.error ?? null);
  const [taken, setTaken] = useState(/** @type {string[]} */ ([]));
  useEffect(() => {
    localBottles().then((kept) => setTaken(kept.map((one) => one.id)), () => {});
  }, []);
  // What could be started: every executable the install left, largest first.
  const executables = useMemo(() => (prefix?.files ?? [])
    .filter((/** @type {any} */ file) => !file.path.startsWith(".bottlify\\") && /\.exe$/i.test(file.path))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => sizeOf(b) - sizeOf(a))
    .map((/** @type {any} */ file) => file.path), [prefix]);
  // A name in a script slug cannot spell (Cyrillic, say) still makes a folder: the file's, else a fixed one.
  const id = slug(ownId) || slug(title) || slug(media.name) || "game";
  const program = entry ?? executables[0];

  const save = async () => {
    if (!prefix || !program || saving) return;
    setFailure(null);
    setSaving({ stage: "packing", bytes: 0 });
    try {
      await saveBottle({ prefix, directory: await bottlesFolder(), id, report: setSaving, manifest: {
        title: title.trim() || media.name, entry: program, installedFrom: media.name, machine, kind: "game",
        labels: [],
        // A runtime the install asked for (a .NET Framework setup), which the
        // bottle stands on as a layer rather than carrying.
        ...result.layers?.length ? { layers: result.layers } : {},
      } });
      onAdded(title.trim() || media.name);
    } catch (e) {
      setFailure(String(/** @type {any} */ (e)?.message ?? e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open fullWidth maxWidth="md" onClose={saving ? undefined : onCancel} sx={{ zIndex: 1400 }}>
      <AddHead step={3} onClose={saving ? null : onCancel} />
      <DialogContent sx={{ px: 4, pt: 1, pb: 3 }}>
        {prefix && executables.length === 0 ? (
          <Typography color="text.secondary">
            {t("add.nothingToStart")} {onKeepArchive ? t("add.keepArchiveNote") : ""}
          </Typography>
        ) : prefix && (<>
          <Box sx={{ display: "grid", gap: 0.75, mb: 3 }}>
            <Typography component="label" htmlFor="add-title" sx={{ fontWeight: 600 }}>{t("add.name")}</Typography>
            <TextField id="add-title" size="small" value={title} disabled={Boolean(saving)}
              onChange={(event) => setTitle(event.target.value)} />
          </Box>
          <Box sx={{ display: "grid", gap: 0.75, mb: 3 }}>
            <Typography sx={{ fontWeight: 600 }}>{t("add.program")}</Typography>
            <TextField select size="small" value={program} disabled={Boolean(saving)}
              onChange={(event) => setEntry(event.target.value)}>
              {executables.map((path) => <MenuItem key={path} value={path}>{path}</MenuItem>)}
            </TextField>
            <Typography variant="body2" color="text.secondary">{t("add.programHelp")}</Typography>
          </Box>
          {developer && (
            <Box sx={{ display: "grid", gap: 0.75, mb: 3 }}>
              <Typography sx={{ fontWeight: 600 }}>Bottle id</Typography>
              <TextField size="small" value={ownId} placeholder={id} disabled={Boolean(saving)}
                onChange={(event) => setOwnId(event.target.value)} />
            </Box>
          )}
          {taken.includes(id) && <Alert severity="warning" variant="outlined">{t("add.replaces")}</Alert>}
        </>)}
        {failure && <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>{failure}</Alert>}
        {saving && (<>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t("add.saving")}{saving.bytes ? ` · ${t.bytes(saving.bytes)}` : ""}
          </Typography>
          <Progress value={null} />
        </>)}
      </DialogContent>
      <DialogActions sx={{ px: 4, borderTop: "1px solid", borderColor: "divider" }}>
        <Button onClick={onCancel} disabled={Boolean(saving)}>{t("button.cancel")}</Button>
        {prefix && executables.length === 0 && onKeepArchive && (
          <Button onClick={onKeepArchive}>{t("add.keepArchive")}</Button>
        )}
        {executables.length > 0 && (
          <Button variant="contained" disabled={Boolean(saving)} onClick={save}>{t("add.add")}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
