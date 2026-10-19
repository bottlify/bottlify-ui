/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Checkbox, LinearProgress, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectFrom, publish, saveBottle, sizeOf } from "@bottlify/installer";
import { bottlesFolder, localBottles } from "../engine/bottles.js";
import { PlayScreen } from "./PlayScreen.jsx";
import { KINDS, LABELS } from "../api/bundles.js";

/**
 * Adding a title by running its installer.
 *
 * The wizard runs on the same screen a game does, because it is the same thing:
 * a Win32 program with a window, driven by whoever is watching it. What is
 * different is what happens when it ends -- the prefix underneath it is the
 * answer, and this is where it is looked at and sent.
 *
 * Sent when the person says so, and only from one form: a title of this era
 * ships several executables -- a stub that starts the game, the game, an
 * updater -- and which one the bottle starts is a decision, not the installer
 * module's guess. The guess preselects the answer; it does not give it.
 *
 * @param {Object} props
 * @param {{ name: string, bytes: Uint8Array } | { name: string, disc: Blob | Uint8Array,
 *     entry?: string, unpacked?: { path: string, bytes: Uint8Array | null }[] }
 *     | { name: string, prefix: import("@bottlify/installer/prefix").Prefix }}
 *     props.media
 *     An installer, or a disc image: the same screen, the program the disc names (or
 *     `entry`) run from the disc's own drive. A prefix is a tree that needs no install
 *     -- an unpacked archive kept as it stands -- and goes straight to the form. A disc
 *     made of an archive carries the archive's `unpacked` files, which the bottle can
 *     keep beside what the program installed: a game shipped unpacked with the
 *     runtimes it needs beside it.
 * @param {{ url: string, token: string } | null} props.upload
 * @param {() => void} [props.onSaved]  Told once a bottle is saved, wherever it went.
 * @param {() => void} props.onClose
 */
export function InstallScreen({ media, upload, onSaved, onClose }) {
  // The collected prefix, and whether the person is looking at the form.
  // Reading the tree out of the volume is a one-run affair, so Cancel closes
  // the dialog and keeps the answer: starting the decision again would mean
  // installing the game again.
  const [prefix, setPrefix] = useState(() => media.prefix ?? null);
  const [asking, setAsking] = useState(() => Boolean(media.prefix));
  const [title, setTitle] = useState(() => nameOf(media.name));
  const [id, setId] = useState(() => slug(media.name));
  const [kind, setKind] = useState("game");
  const [labels, setLabels] = useState([]);
  const [sending, setSending] = useState(null);
  const [failure, setFailure] = useState(null);
  const [done, setDone] = useState(null);
  const [exitCode, setExitCode] = useState(0);
  // Where the bottle goes: this browser's own file system unless the person
  // sends it to the server, which is a choice only when one is configured.
  const [where, setWhere] = useState("browser");

  const onExited = useCallback(async (app, code) => {
    // Read once, here: taking the tree out of the volume copies it, and the
    // screen below asks about it repeatedly.
    let collected;
    setExitCode(code);
    try {
      collected = collectFrom(app, media);
    } catch (e) {
      setFailure(e.message);
      return;
    }
    // The way the old automatic path named the bottle: a clean exit has an id
    // that two installs of one file cannot collide on, so that is what the
    // field opens with. Anything else -- a non-zero exit, nowhere to send --
    // starts from the file's slug, as the manual form always has.
    if (code === 0 && upload) setId(await hashedId(media.name));
    setFailure(null);
    setDone(null);
    setPrefix(collected);
    setAsking(true);
  }, [media, upload]);

  const installed = useMemo(
    () => prefix?.files.filter((file) => !file.path.startsWith(".bottlify\\")) ?? [],
    [prefix],
  );
  // What could be started: every executable the installer left, largest
  // first. None means the installer did not install a program, and there is
  // nothing to bottle -- an installer that failed leaves only its own runtime.
  const executables = useMemo(
    () => installed
      .filter((file) => /\.exe$/i.test(file.path))
      .sort((a, b) => sizeOf(b) - sizeOf(a))
      .map((file) => file.path),
    [installed],
  );

  const save = async () => {
    // Nothing to start, nothing to bottle: what a prefix without an executable
    // would carry is an installer's runtime, not a game.
    if ((where === "server" && !upload) || !id || !executables.length || sending || done) return;
    setFailure(null);
    setSending({ stage: "packing", bytes: 0 });
    const manifest = {
      title,
      entry: prefix.entry ?? executables[0],
      installedFrom: media.name,
      kind,
      labels: LABELS.map((one) => one.value).filter((value) => labels.includes(value)),
    };
    try {
      const { packed } = where === "server"
        ? await publish({ prefix, endpoint: upload, id, manifest, report: setSending })
        : await saveBottle({
          prefix, directory: await bottlesFolder(), id, manifest, report: setSending,
        });
      setDone(packed);
      onSaved?.();
    } catch (e) {
      setFailure(e.message);
    } finally {
      setSending(null);
    }
  };

  const cancel = () => {
    // A save cannot be cancelled while it is going: the server is half a
    // bottle and there is no taking it back, so the only thing to do is let
    // it finish and say what it did.
    if (sending) return;
    // With nothing installed there is no run to go back to.
    if (done || media.prefix) {
      onClose();
      return;
    }
    setAsking(false);
  };

  return (
    <>
      {!media.prefix && (
        <PlayScreen
          media={media}
          title={`Installing — ${media.name}`}
          onClose={onClose}
          onExited={onExited}
        />
      )}

      {prefix && asking && (
        <SaveBottleDialog
          prefix={prefix}
          exitCode={exitCode}
          upload={upload}
          where={where}
          onWhere={setWhere}
          installed={installed.length}
          executables={executables}
          title={title}
          id={id}
          kind={kind}
          labels={labels}
          sending={sending}
          failure={failure}
          done={done}
          onTitle={setTitle}
          onId={(text) => setId(slug(text))}
          onKind={setKind}
          onLabels={setLabels}
          onEntry={(path) => setPrefix((held) => ({ ...held, entry: path }))}
          onKeepArchive={"unpacked" in media && media.unpacked ? () => {
            const kept = media.unpacked;
            // Under C:\App, where a kept archive's tree goes (`archivePrefix`).
            setPrefix((held) => ({ ...held,
              files: [...held.files, ...kept.filter((one) => one.bytes !== null)
                .map(({ path, bytes }) => ({ path: `App\\${path}`, bytes }))] }));
          } : null}
          onSave={save}
          onCancel={cancel}
          onClose={onClose}
        />
      )}

      {/* The way back to the form once it has been cancelled: the run is
          over, PlayScreen offers only to run it again, and the prefix is
          still held in memory and still unsent. */}
      {prefix && !asking && executables.length > 0 && (
        <Box
          sx={{
            position: "fixed",
            bottom: 3,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2,
            py: 1,
            bgcolor: "rgba(26,27,29,0.92)",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            The install is here, and nothing has been sent.
          </Typography>
          <Button size="small" variant="outlined" color="inherit" onClick={() => setAsking(true)}>
            Save bottle
          </Button>
        </Box>
      )}
    </>
  );
}

/**
 * The one form the decision is made in: what the bottle is called, and what
 * it starts.
 *
 * Built the way the MessageBox on the play screen is -- a Dialog the person
 * answers, Enter to act on it, Escape to get out of it -- and with the three
 * fields the manual form used to hold, because both ways of reaching the end
 * of an install now end here.
 *
 * @param {Object} props
 * @param {import("@bottlify/installer/prefix").Prefix} props.prefix
 * @param {number} props.exitCode
 * @param {{ url: string, token: string } | null} props.upload
 * @param {"browser" | "server"} props.where   Where the bottle is kept.
 * @param {(where: "browser" | "server") => void} props.onWhere
 * @param {number} props.installed       Files the bottle will carry.
 * @param {string[]} props.executables   What could start it, largest first.
 * @param {string} props.title
 * @param {string} props.id
 * @param {string} props.kind          `game` or `application`.
 * @param {string[]} props.labels      What the library marks it as.
 * @param {{ stage: string, detail?: string, bytes?: number } | null} props.sending
 * @param {string | null} props.failure
 * @param {{ bytes: number } | null} props.done
 * @param {(text: string) => void} props.onTitle
 * @param {(text: string) => void} props.onId
 * @param {(kind: string) => void} props.onKind
 * @param {(labels: string[]) => void} props.onLabels
 * @param {(path: string) => void} props.onEntry
 * @param {() => void} props.onSave
 * @param {() => void} props.onCancel
 * @param {() => void} props.onClose
 * @param {(() => void) | null} [props.onKeepArchive]  Puts the archive the program
 *        ran from into the bottle too, when it came from one.
 */
function SaveBottleDialog({
  prefix, exitCode, upload, where, onWhere, installed, executables,
  title, id, kind, labels, sending, failure, done,
  onTitle, onId, onKind, onLabels, onEntry, onSave, onCancel, onClose, onKeepArchive = null,
}) {
  const entryRef = useRef(null);
  // Whether the library holds a bottle by this name already, which saving
  // replaces: the same program installed again is named the same.
  const [taken, setTaken] = useState(false);
  useEffect(() => {
    let live = true;
    (where === "server"
      ? fetch("/bundles/index.json").then((answer) => (answer.ok ? answer.json() : []))
      : localBottles().then((kept) => kept.map((one) => one.id)))
      .then((ids) => live && setTaken(Array.isArray(ids) && ids.includes(id)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, where]);
  // The entry point is the whole reason this dialog exists, so it is what the
  // dialog opens looking at; the other two fields came out of the installer's
  // file name and are usually left as they are.
  useEffect(() => {
    entryRef.current?.focus();
  }, []);

  const empty = executables.length === 0;

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={sending ? undefined : done ? onClose : onCancel}
    >
      <DialogTitle>
        {empty
          ? "The installer left no program to run"
          : done
            ? "Bottle saved"
            : sending
              ? "Saving the bottle"
              : "The installer finished"}
      </DialogTitle>
      {/* Enter answers the dialog itself. Caught in the capture phase because
          the select opens on Enter and a decision cannot be saved by a key
          that spends its first press unfolding the choices; on a button,
          Enter is already that button's own doing and must stay so. */}
      <DialogContent
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && !e.target.closest?.("button")) {
            e.preventDefault();
            e.stopPropagation();
            onSave();
          }
        }}
      >
        {empty ? (
          <Typography variant="body2" color="text.secondary">
            It exited with code {exitCode} and wrote {installed} file
            {installed === 1 ? "" : "s"} under <Box component="code">{prefix.root}</Box>,
            none of them an executable — its own runtime, not a game.
            {onKeepArchive
              ? " If the archive holds the game already unpacked, keep its files"
                + " with what was installed."
              : " There is nothing to bottle."}
          </Typography>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {installed} file{installed === 1 ? "" : "s"} under{" "}
              <Box component="code">{prefix.root}</Box>, plus the registry.
              {prefix.outside.length > 0
                ? ` ${prefix.outside.length} file${prefix.outside.length === 1 ? "" : "s"} `
                  + "outside that directory are not part of the bottle."
                : ""}
            </Typography>

            <TextField
              label="Title"
              size="small"
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              disabled={Boolean(sending || done)}
            />
            <TextField
              label="Bottle id"
              size="small"
              value={id}
              helperText={where === "server"
                ? "Names the directory the server writes it to."
                : "Names the bottle in this browser's library."}
              onChange={(e) => onId(e.target.value)}
              disabled={Boolean(sending || done)}
            />
            {taken && !done && (
              <Alert severity="warning" variant="outlined">
                A bottle with this id is in the library already, and saving replaces it. The saved
                games and the patch this browser keeps for it stay with it.
              </Alert>
            )}
            <Stack direction="row" spacing={2} alignItems="flex-start">
              <TextField
                select
                label="Type"
                size="small"
                value={kind}
                onChange={(e) => onKind(e.target.value)}
                disabled={Boolean(sending || done)}
                sx={{ minWidth: 160 }}
              >
                {KINDS.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
              </TextField>
              <TextField
                select
                label="Labels"
                size="small"
                value={labels}
                onChange={(e) => onLabels(/** @type {string[]} */ (e.target.value))}
                disabled={Boolean(sending || done)}
                SelectProps={{
                  multiple: true,
                  renderValue: (chosen) => LABELS.filter((one) => chosen.includes(one.value))
                    .map((one) => one.label).join(", ") || "None",
                  displayEmpty: true,
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ flex: 1 }}
              >
                {LABELS.map((one) => (
                  <MenuItem key={one.value} value={one.value}>
                    <Checkbox size="small" checked={labels.includes(one.value)} sx={{ py: 0, pl: 0 }} />
                    {one.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField
              select
              label="Entry point"
              size="small"
              inputRef={entryRef}
              value={prefix.entry ?? executables[0]}
              helperText="The program the bottle starts, from the ones the install left; the preselection is a guess."
              onChange={(e) => onEntry(e.target.value)}
              disabled={Boolean(sending || done)}
            >
              {executables.map((path) => (
                <MenuItem key={path} value={path}>{path}</MenuItem>
              ))}
            </TextField>

            {/* With no bottle server there is one place to keep it, and no question. */}
            {upload && (
              <TextField
                select
                label="Keep it in"
                size="small"
                value={where}
                onChange={(e) => onWhere(/** @type {"browser" | "server"} */ (e.target.value))}
                disabled={Boolean(sending || done)}
              >
                <MenuItem value="browser">This browser</MenuItem>
                <MenuItem value="server">The server</MenuItem>
              </TextField>
            )}
            {failure && (
              <Alert severity="error" variant="outlined">{failure}</Alert>
            )}
            {sending && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {sending.stage}
                  {sending.detail ? ` — ${sending.detail}` : ""}
                  {sending.bytes
                    ? ` — ${megabytes(sending.bytes)} ${where === "server" ? "sent" : "written"}`
                    : ""}
                </Typography>
                <LinearProgress sx={{ mt: 1 }} />
              </Box>
            )}
            {done && (
              <Alert severity="success" variant="outlined">
                {title} — {megabytes(done.bytes)} as <Box component="code">{id}</Box>
                {where === "server" ? ", on the server." : ", in this browser."}
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {done ? (
          <Button variant="outlined" color="inherit" onClick={onClose}>
            Back to library
          </Button>
        ) : (
          <>
            <Button color="inherit" disabled={Boolean(sending)} onClick={onCancel}>
              Cancel
            </Button>
            {empty && onKeepArchive && (
              <Button variant="outlined" color="inherit" onClick={onKeepArchive}>
                Keep the archive's files
              </Button>
            )}
            {!empty && (
              <Button
                variant="outlined"
                color="inherit"
                disabled={(where === "server" && !upload) || !id || Boolean(sending)}
                onClick={onSave}
              >
                Save bottle
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** @param {number} bytes */
function megabytes(bytes) {
  return `${(bytes / (1 << 20)).toFixed(1)} MB`;
}

/**
 * The bottle's id: a hash of the installer's file name and the moment, so two
 * installs of one file never collide and nobody is asked to think up a name --
 * only to confirm the one offered.
 *
 * @param {string} name
 */
async function hashedId(name) {
  const bytes = new TextEncoder().encode(`${name}\n${Date.now()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** @param {string} name */
function nameOf(name) {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * A file name turned into something that may name a directory. The server
 * refuses anything else, and it refuses it for the same reason.
 *
 * @param {string} text
 */
function slug(text) {
  return nameOf(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
