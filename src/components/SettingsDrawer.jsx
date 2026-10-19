/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Box, Button, Chip, Divider, Drawer, FormControlLabel, IconButton, List, ListItemButton,
  ListItemText, MenuItem, Stack, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilesDialog } from "./FilesDialog.jsx";
import { EDITABLE_TYPES } from "../api/config.js";
import { mountOf } from "../engine/patches.js";
import { bottleFiles, liveFiles } from "../engine/volumes.js";
import {
  buildReport, journalLine, lastEndingReport, reportFilename, reportParts,
} from "../engine/journal.js";
import { jsonParts } from "../engine/jsonparts.js";
import { V86_WASM_URL } from "../engine/session.js";
import {
  AREAS, GPU_JOURNAL, LEVELS, MEMORY_CHOICES, loadSettings, saveSettings, storagePersists,
} from "../settings.js";

/** Warn and error, the two the filter keeps. */
const WARN = 2;

/** How often the engine is asked while a section that reads it is on screen. */
const LOG_POLL_MS = 2000;

/**
 * Lines the log view shows: a fixed tail, not a setting. The engine's ring
 * (`logCapacity`) is what a person sizes; what fits on screen never grows with
 * it, or a big ring would make the panel format thousands of lines a poll.
 */
const LOG_TAIL = 200;

/** How long a report waits for the frame it asked to be written down to be drawn. */
const FRAME_DUMP_WAIT_MS = 1500;

/**
 * Asks the engine every `LOG_POLL_MS` while the caller is mounted, and hands
 * back what it answered. Answers are awaited, so a read that becomes a round
 * trip to a worker changes nothing here; a read that throws means the graph is
 * gone, and polling stops rather than asking a disposed engine for ever.
 *
 * @template T
 * @param {(() => T | Promise<T>) | null} read
 * @returns {[T | null, boolean]}  The latest answer, and whether reads still succeed.
 */
function usePolled(read) {
  const [answer, setAnswer] = useState(/** @type {T | null} */ (null));
  const [live, setLive] = useState(read !== null);
  useEffect(() => {
    if (!read) return undefined;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const value = await read();
        if (cancelled) return;
        setAnswer(value);
        timer = setTimeout(tick, LOG_POLL_MS);
      } catch {
        if (!cancelled) setLive(false);
      }
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [read]);
  return [answer, live];
}

const SECTIONS = [
  { key: "bottle", title: "Settings", says: "Logging, profiling, the quantum, the refresh rate" },
  { key: "logs", title: "Logs", says: "Everything the engine has said, as it says it" },
  { key: "files", title: "Files", says: "The bottle's volume, as the program sees it" },
];

/** Said once per group rather than per control, where a group is all one answer. */
const NEXT_RUN = "Takes effect the next time a title starts.";

/**
 * On the tooltip of a control disabled because a title is running: every one
 * of these is read only while `createApp` builds the process, so changing it
 * now would be a change nothing already running could ever see.
 */
const APPLIES_NEXT_START = "Applies to the next start.";

/**
 * The panel behind the gear: a list of two sections, each of which takes over
 * the panel when it is pressed.
 *
 * The app is whatever engine is running right now, or null. It is read rather
 * than held: nothing here keeps a reference across a session, so a drawer left
 * open over a stopped run says so instead of polling a disposed graph.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {any} [props.app]            The running engine, if there is one.
 * @param {boolean} [props.running]    Whether a title is running (or paused) right
 *        now: every setting `createApp` only reads while building the process is
 *        disabled while this is true, since changing it could not reach the title
 *        that is already going.
 * @param {{ label: string, value: string }[]} [props.facts]
 * @param {boolean} [props.inline]     Beside what it belongs to rather than over
 *        it. Reading the journal while a game runs means seeing both at once, so
 *        the running stage takes the panel this way and gives up the width.
 * @param {string | null} [props.start]  The section this panel belongs on. Null
 *        is the list of them, which is where a panel opened by hand starts; a
 *        stage that was told to come up showing the log names it here so the
 *        first thing on screen is the log rather than a menu.
 * @param {string} [props.bundleId]     What is running, for naming a downloaded
 *        journal file. Untitled where there is nothing to name it after.
 * @param {import("../api/bundles.js").BundleManifest | null} [props.bundle]  Its
 *        manifest, for the files: where the game's directory is, and before a run
 *        what the game will see.
 */
export function SettingsDrawer({
  open, onClose, app = null, running = false, facts = [], inline = false, start = null,
  bundleId = "untitled", bundle = null,
}) {
  const [section, setSection] = useState(start);
  // The one file editor: the running machine's volume while a title runs, what
  // the title will see at its start before it does.
  const files = useMemo(() => (app ? liveFiles(app, bundle ? mountOf(bundle) : "C:")
    : bundle ? bottleFiles(bundle) : null), [app, bundle]);
  // One set for the whole panel: the Logs view's area chips edit the same
  // values the Bottle section does, so a change in one shows in the other
  // without the panel being reopened.
  const [settings, setSettings] = useState(loadSettings);
  const change = useCallback((patch) => setSettings(saveSettings(patch)), []);
  const here = SECTIONS.find((entry) => entry.key === section) ?? null;

  // Closing puts the panel back where it opens from, so reopening it is not a
  // continuation of whatever was last read.
  useEffect(() => {
    if (!open) setSection(start);
  }, [open, start]);

  const body = (
    <>
      <Stack
        direction="row"
        alignItems="center"
        gap={1}
        sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}
      >
        {here && (
          <IconButton size="small" aria-label="back" onClick={() => setSection(null)}>
            <span className="glyphicon glyphicon-chevron-left" />
          </IconButton>
        )}
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {here ? here.title : "Settings"}
        </Typography>
        <IconButton size="small" aria-label="close settings" onClick={onClose}>
          <span className="glyphicon glyphicon-remove" />
        </IconButton>
      </Stack>

      {here === null && (
        <List sx={{ py: 0 }}>
          {SECTIONS.map((entry) => (
            <ListItemButton
              key={entry.key}
              onClick={() => setSection(entry.key)}
              sx={{ borderBottom: "1px solid", borderColor: "divider", py: 1.75 }}
            >
              <ListItemText primary={entry.title} secondary={entry.says} />
            </ListItemButton>
          ))}
        </List>
      )}

      {section === "bottle" && (
        <BottleSettings app={app} running={running} facts={facts} settings={settings} change={change} />
      )}
      {section === "logs" && (
        <LogView app={app} settings={settings} change={change} bundleId={bundleId} />
      )}
      {section === "files" && files && (
        <FilesDialog title={bundle?.title ?? bundleId} files={files} editableTypes={EDITABLE_TYPES}
          onClose={() => setSection(null)} />
      )}
      {section === "files" && !files && (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          No bottle is open.
        </Typography>
      )}
    </>
  );

  if (inline) {
    return open ? (
      <Box
        sx={{
          width: { xs: "100%", sm: 420, lg: 520 },
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          borderLeft: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {body}
      </Box>
    ) : null;
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", sm: 560 },
            backgroundImage: "none",
            borderLeft: "1px solid",
            borderColor: "divider",
          },
        },
      }}
    >
      {body}
    </Drawer>
  );
}

/**
 * What every run is made of, and what this one turned out to be.
 *
 * One set for every title rather than one per title: these are decisions about
 * the machine, and a person who has chosen a resolution has chosen it for
 * whatever they launch next. Nothing here is a switch over a value the engine
 * does not read -- each one is handed to `createApp`, or applied to the journal
 * the moment it changes -- and where a change cannot reach a running engine the
 * group says so rather than looking as though it did.
 *
 * @param {Object} props
 * @param {any} props.app
 * @param {boolean} props.running
 * @param {{ label: string, value: string }[]} props.facts
 * @param {import("../settings.js").RunSettings} props.settings
 * @param {(patch: Partial<import("../settings.js").RunSettings>) => void} props.change
 */
function BottleSettings({ app, running, facts, settings, change }) {
  // The emulator is offered only where this server holds a v86 build to run.
  const [emulator, setEmulator] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(V86_WASM_URL, { method: "HEAD" })
      .then((response) => live && setEmulator(response.ok))
      .catch(() => {});
    return () => { live = false; };
  }, []);
  // The journal's own figures, read where they are written rather than asked
  // for: a panel polling the engine would be the running program paying for
  // this panel. The media layer has no such table, so it is asked once -- a
  // decoder is either loaded or not, and nothing about that changes mid-run.
  const [journal] = usePolled(useCallback(() => app?.log?.stats?.() ?? null, [app]));
  const [media, setMedia] = useState(/** @type {any} */ (null));
  useEffect(() => {
    if (!app) return;
    app.diagnostics("media").then((layers) => setMedia(layers[0] ?? null), () => {});
  }, [app]);
  // Asked once per mount rather than assumed: a person can block site data
  // between one visit and the next, and a panel that quietly keeps nothing
  // reads from the outside as a panel whose settings were never applied.
  const [persists] = useState(storagePersists);

  const setLevel = (name) => {
    change({ logLevel: name });
    // The journal takes a level whenever it is given one, so this is the half
    // of the panel that does not have to wait for a run to start.
    app?.log.setDefaultLevel(name);
  };

  return (
    <Box sx={{ p: 2, overflowY: "auto" }}>
      {!persists && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          This browser is keeping nothing: what you change here holds for this visit and goes
          with the page.
        </Typography>
      )}

      <Group title="Display" note={NEXT_RUN}>
        <NumberField
          label="Maximum frames per second"
          value={settings.maxFps}
          commit={(maxFps) => change({ maxFps })}
          says={"A frame shown faster than a display can show it is a read of the surface and "
            + "an upload nobody sees. Zero delivers every frame the guest presents."}
          disabled={running}
        />
      </Group>

      <Group title="Machine" note={NEXT_RUN}>
        <Tooltip title={running ? APPLIES_NEXT_START : ""} disableHoverListener={!running}>
          <TextField
            select
            fullWidth
            size="small"
            label="Execution engine"
            value={settings.engine}
            disabled={running}
            onChange={(event) => change({ engine: event.target.value })}
            helperText={"Cork translates the program’s code to WebAssembly. The emulator runs "
              + "only where a v86 build has been put on this server."}
          >
            <MenuItem value="cork">Cork</MenuItem>
            <MenuItem value="emulator" disabled={!emulator}>
              {emulator ? "Emulator (v86)" : "Emulator (v86) — not installed"}
            </MenuItem>
          </TextField>
        </Tooltip>
        <Tooltip title={running ? APPLIES_NEXT_START : ""} disableHoverListener={!running}>
          <TextField
            select
            fullWidth
            size="small"
            label="Memory"
            value={settings.memory}
            disabled={running}
            onChange={(event) => change({ memory: Number(event.target.value) })}
            helperText={"What every bottle's machine has unless its own settings say otherwise. "
              + "Some games will not start with less; only what a game uses costs anything."}
            sx={{ mt: 2 }}
          >
            {MEMORY_CHOICES.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
          </TextField>
        </Tooltip>
        <NumberField
          label="Scheduler quantum"
          value={settings.quantum}
          commit={(quantum) => change({ quantum })}
          says={"Guest instructions a thread runs before the next one gets a turn. Lowering it "
            + "buys resolution in anything sampled and costs throughput."}
          disabled={running}
        />
        <Toggle
          label="Copy the rest of the game to this machine in the background"
          says={"What a run reads is kept on this computer either way, so the next launch reads "
            + "it here rather than from the network. On, the rest of the game is fetched too "
            + "while nothing is being read, and a first visit to any part of it is instant."}
          checked={settings.cacheBundle}
          onChange={(cacheBundle) => change({ cacheBundle })}
          disabled={running}
        />
      </Group>

      <Group title="Sound and video" note={NEXT_RUN}>
        <Toggle
          label="Sound"
          says={"Off, no audio thread is started and the engine is told nothing drains its ring "
            + "-- which is what decides whether a program's play cursor follows the sound."}
          checked={settings.sound}
          onChange={(sound) => change({ sound })}
          disabled={running}
        />
        <Toggle
          label="Video decoder"
          says={"Off, the decoder is not fetched at all and anything that would have played a "
            + "film skips it."}
          checked={settings.video}
          onChange={(video) => change({ video })}
          disabled={running}
        />
        <Toggle
          label="Mute in background"
          says={"On, the output is silenced while this page is in the background and comes back "
            + "when it returns. It only gates the speaker -- the game keeps running and never "
            + "learns the tab was hidden. Takes effect at once."}
          checked={settings.muteWhenHidden}
          onChange={(muteWhenHidden) => change({ muteWhenHidden })}
        />
      </Group>

      <Group title="Diagnostics">
        <TextField
          select
          fullWidth
          size="small"
          label="Log level"
          value={settings.logLevel}
          onChange={(event) => setLevel(event.target.value)}
          helperText={"The level of every category that has not been set on its own. Applies at "
            + "once, and to every run after this one. Debug and trace fill the ring faster, so "
            + "it holds less of the past."}
        >
          {LEVELS.map((name) => (
            <MenuItem key={name} value={name}>{name}</MenuItem>
          ))}
        </TextField>
        <NumberField
          label="Journal records held"
          value={settings.logCapacity}
          commit={(logCapacity) => change({ logCapacity })}
          says={`The engine's own ring. ${NEXT_RUN} A run whose interesting part is its first `
            + "second needs it no bigger; one that has to hold a whole startup needs it much "
            + "bigger."}
          disabled={running}
        />
        <Toggle
          label="Open the log beside a running title"
          says="The panel starts open on the stage, so a launch is watched rather than waited on."
          checked={settings.logOpen}
          onChange={(logOpen) => change({ logOpen })}
        />
        <Toggle
          label="Resolve traced pointer arguments to their text"
          says={`A trace then names a library rather than an address. ${NEXT_RUN} It costs a `
            + "read of guest memory for every traced argument."}
          checked={settings.traceStrings}
          onChange={(traceStrings) => change({ traceStrings })}
          disabled={running}
        />
        <Toggle
          label="Performance overlay (F3 · Ctrl/⌘+Shift+P)"
          says={"fps, guest code speed and what the frame is made of, over the corner of the "
            + "canvas. Off, nothing here reads the engine at all; on, once a second."}
          checked={settings.overlayOn}
          onChange={(overlayOn) => change({ overlayOn })}
        />
        <Toggle
          label="Profile host calls"
          says={"The overlay then splits host calls by function (draws, uploads, audio, "
            + `win32). ${NEXT_RUN} Two clock reads per call.`}
          checked={settings.profileCalls}
          onChange={(profileCalls) => change({ profileCalls })}
          disabled={running}
        />
      </Group>

      <Divider sx={{ my: 2.5 }} />

      <Facts
        rows={[
          ...facts,
          ...(journal
            ? [
              { label: "Journal", value: `${journal.written} written, ${journal.capacity} held` },
              { label: "Lapped", value: `${journal.lost} before this page read them` },
              { label: "Rejected", value: `${journal.rejected} below their category's level` },
              {
                label: "Read",
                value: app.log.reading() === "shared"
                  ? "by the log keeper, from the memory the engine writes into"
                  : "by the log keeper, fed by the engine — this page is not cross-origin isolated",
              },
            ]
            : []),
          // The layer's own answer rather than the launcher's: a build with a
          // binary nothing has asked to use reads the same as one without,
          // unless this is where the question is put.
          ...(media
            ? [{
              label: "Video",
              value: media.metrics?.configured
                ? "a decoder is loaded"
                : (media.issues?.[0] ?? "no decoder: nothing can be played"),
            }]
            : []),
          {
            label: "Sound",
            value: globalThis.crossOriginIsolated
              ? "available — this page is cross-origin isolated"
              : "off — this page is not cross-origin isolated",
          },
          {
            label: "WebGPU",
            value: navigator.gpu ? "present" : "absent — nothing can be drawn",
          },
        ]}
      />
    </Box>
  );
}

/**
 * A heading, the controls under it, and one line about when they take hold.
 *
 * The note belongs to the group rather than to each control because a group is
 * one answer: everything about the display reaches the engine at the same
 * moment, and repeating that under four fields is noise.
 *
 * @param {Object} props
 * @param {string} props.title
 * @param {string} [props.note]
 * @param {any} props.children
 */
function Group({ title, note, children }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
        {title}
      </Typography>
      {note && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {note}
        </Typography>
      )}
      <Stack gap={2} sx={{ mt: note ? 0 : 1.5 }}>{children}</Stack>
    </Box>
  );
}

/**
 * A number that is only read once it has been finished.
 *
 * Uncontrolled on purpose: a stored value is clamped to something the engine
 * can be handed, and clamping on every keystroke would rewrite a half-typed
 * 1024 as the smallest legal width while the person is still typing it. The
 * keyed default is what puts a value corrected on commit back into the box.
 *
 * @param {Object} props
 * @param {string} props.label
 * @param {number} props.value
 * @param {(value: number) => void} props.commit
 * @param {string} [props.says]
 * @param {boolean} [props.disabled]  A title is running and this is read only at
 *        `createApp`, so changing it now could not reach it.
 */
function NumberField({ label, value, commit, says, disabled = false }) {
  return (
    <Tooltip title={disabled ? APPLIES_NEXT_START : ""} disableHoverListener={!disabled}>
      <TextField
        key={value}
        fullWidth
        size="small"
        type="number"
        label={label}
        defaultValue={value}
        helperText={says}
        disabled={disabled}
        onBlur={(event) => commit(Number(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.querySelector("input")?.blur();
        }}
      />
    </Tooltip>
  );
}

/**
 * @param {Object} props
 * @param {string} props.label
 * @param {string} [props.says]
 * @param {boolean} props.checked
 * @param {(on: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]  A title is running and this is read only at
 *        `createApp`, so changing it now could not reach it.
 */
function Toggle({ label, says, checked, onChange, disabled = false }) {
  return (
    <Box>
      <Tooltip title={disabled ? APPLIES_NEXT_START : ""} disableHoverListener={!disabled}>
        <FormControlLabel
          disabled={disabled}
          control={(
            <Switch
              size="small"
              checked={checked}
              onChange={(event) => onChange(event.target.checked)}
            />
          )}
          label={<Typography variant="body2">{label}</Typography>}
        />
      </Tooltip>
      {says && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 5.5 }}>
          {says}
        </Typography>
      )}
    </Box>
  );
}

/**
 * @param {Object} props
 * @param {{ label: string, value: string }[]} props.rows
 */
function Facts({ rows }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 1 }}>
      {rows.map((row) => (
        <Box key={row.label} sx={{ display: "contents" }}>
          <Typography variant="caption" color="text.secondary">{row.label}</Typography>
          <Typography variant="caption" sx={{ wordBreak: "break-word" }}>{row.value}</Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * The journal's tail, as it stands.
 *
 * A snapshot every couple of seconds rather than a stream: the panel asks for
 * the last `LOG_TAIL` lines and draws them, and holds nothing of its own between
 * asks. What was lapped between two reads was never going to fit on screen
 * anyway.
 *
 * @param {Object} props
 * @param {any} props.app
 * @param {import("../settings.js").RunSettings} props.settings
 * @param {(patch: Partial<import("../settings.js").RunSettings>) => void} props.change
 * @param {string} props.bundleId
 */
function LogView({ app, settings, change, bundleId }) {
  const [warnOnly, setWarnOnly] = useState(false);
  const scroller = useRef(null);
  const pinned = useRef(true);
  // The same array is handed back while the tail has not moved, so a quiet
  // engine costs the panel nothing: React sees an unchanged value and skips.
  const last = useRef({ sequence: -1, records: /** @type {any[]} */ ([]) });
  const [records, live] = usePolled(useCallback(async () => {
    if (!app) return last.current.records;
    const tail = await app.log.recent(LOG_TAIL);
    const sequence = tail.length > 0 ? tail[tail.length - 1].sequence : -1;
    if (sequence !== last.current.sequence) last.current = { sequence, records: tail };
    return last.current.records;
  }, [app]));

  // Follows the tail only while the reader is already at it: scrolling back to
  // read something is the one moment a live view must not move.
  useEffect(() => {
    const box = scroller.current;
    if (box && pinned.current) box.scrollTop = box.scrollHeight;
  }, [records, warnOnly]);

  const shown = (records ?? []).filter((record) => !warnOnly || record.level <= WARN);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <Areas app={app} settings={settings} change={change} />
      <JournalDownload app={app} bundleId={bundleId} />

      <Stack
        direction="row"
        alignItems="center"
        gap={1}
        sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}
      >
        <FormControlLabel
          control={<Switch size="small" checked={warnOnly} onChange={(e) => setWarnOnly(e.target.checked)} />}
          label={<Typography variant="caption">Warnings and errors only</Typography>}
          sx={{ mr: "auto" }}
        />
        <Typography variant="caption" color="text.secondary">
          {shown.length} line{shown.length === 1 ? "" : "s"}
        </Typography>
      </Stack>

      <Box
        ref={scroller}
        onScroll={(event) => {
          const box = event.currentTarget;
          pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          px: 2,
          py: 1,
          fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          fontSize: 11.5,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          // Plain elements, one per line: the tail is redrawn on every read, and
          // a component per line was what made a busy call area freeze the game.
          "& div": { color: "text.primary" },
          "& .warn": { color: INK.warn },
          "& .error": { color: INK.error },
        }}
      >
        {!app && (
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "inherit" }}>
            Nothing is running, so there is no journal to read. Start a title and open this again.
          </Typography>
        )}
        {app && shown.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "inherit" }}>
            {warnOnly ? "Nothing at warning or above." : "The journal is empty so far."}
          </Typography>
        )}
        {shown.map((record) => (
          <div key={record.sequence} className={record.levelName in INK ? record.levelName : undefined}>
            {journalLine(record)}
          </div>
        ))}
        {!live && app && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            The run ended; this is what it left behind.
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/**
 * Saves everything the run can say about itself as one file: the journal ring
 * (every record it still holds, whatever areas are on), every layer's
 * diagnostics -- graphics, kernel, bridge, cpu and the rest -- and a header of
 * the run. One button, so a report never lacks the part that explains it.
 *
 * `presents`/`drawsPerFrame` are read at the click rather than kept live: both
 * are cumulative counters (`docs/core/host.md`'s `presented()`,
 * `graphics.seam.device.draws`), so the header states the run's average draws
 * per frame so far, not the one frame the room happened to be on.
 *
 * @param {Object} props
 * @param {any} props.app
 * @param {string} props.bundleId
 */
function JournalDownload({ app, bundleId }) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      // The frame on the screen at the click, written down draw by draw: a
      // picture that is wrong is reported with what drew it, and nobody has to
      // ask for that from a console. Its frame has to be drawn first; a paused
      // or worker-less run writes nothing and the report goes without it.
      if (app?.debug?.dumpFrames) {
        try {
          await app.debug.dumpFrames(1);
          await new Promise((resolve) => setTimeout(resolve, FRAME_DUMP_WAIT_MS));
        } catch {
          // No graphics worker: nothing to write the frame down.
        }
      }
      // Each part on its own and within a few seconds: a worker that died
      // answers nothing, and a part the live run cannot give is taken from
      // the report kept as the run ended.
      const live = app ? await reportParts(app, GPU_JOURNAL.capacity)
        : { records: null, presented: null, engine: null, missing: { run: "no run is open" } };
      const kept = lastEndingReport()?.parts ?? null;
      const records = live.records ?? kept?.records ?? [];
      const presented = live.presented ?? kept?.presented ?? { count: 0 };
      const engine = live.engine ?? kept?.engine ?? { diagnostics: [] };
      const graphics = engine.diagnostics.find((/** @type {any} */ layer) =>
        layer?.name === "graphics");
      const draws = graphics?.metrics?.seam?.device?.draws ?? 0;
      const presents = presented.count;
      const report = {
        ...buildReport(records, engine, {
          bundleId,
          presents,
          drawsPerFrame: presents > 0 ? draws / presents : draws,
          userAgent: navigator.userAgent,
        }),
        ...Object.keys(live.missing).length > 0
          ? { unanswered: live.missing, fromEnding: kept !== null } : {},
      };
      saveFile(jsonParts(report), reportFilename(bundleId), "application/json");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
      <Tooltip title={app || lastEndingReport() ? "" : "Start a title first"}>
        <span>
          <Button size="small" variant="outlined" disabled={(!app && !lastEndingReport()) || busy}
            onClick={download}>
            Download report
          </Button>
        </span>
      </Tooltip>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {"One file: every layer's diagnostics (graphics, kernel and the rest), the phase "
          + "profile, the threads, the guest's hottest code, and every record the journal ring "
          + `still holds (up to ${GPU_JOURNAL.capacity.toLocaleString()} with a call area `
          + "recording). Taken during the scene in question: the kernel's thread times cover the "
          + "last ten seconds."}
      </Typography>
    </Box>
  );
}

/**
 * @param {string} text @param {string} name @param {string} type
 */
function saveFile(text, name, type) {
  const url = URL.createObjectURL(new Blob(Array.isArray(text) ? text : [text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Which areas of host call are being recorded.
 *
 * Not a display filter: every area starts at `off` so that a run costs a map
 * lookup per call rather than a formatted line, and switching one on raises its
 * level in the journal itself. What was made before the switch was never
 * written, which is why the wording says "record" and not "show" -- and why the
 * choice is kept: switched on here it is on from the next run's first
 * instruction, which is where everything a program decides about a device is
 * decided.
 *
 * The engine is asked what areas it has and the saved list is offered anyway,
 * so the chips are there to press before a title has been started.
 *
 * @param {Object} props
 * @param {any} props.app
 * @param {import("../settings.js").RunSettings} props.settings
 * @param {(patch: Partial<import("../settings.js").RunSettings>) => void} props.change
 */
function Areas({ app, settings, change }) {
  const areas = [...new Set(AREAS.concat(app ? app.log.areas() : []))];
  const on = new Set(settings.logAreas);

  const toggle = (area) => {
    const next = new Set(on);
    if (next.has(area)) next.delete(area);
    else next.add(area);
    change({ logAreas: [...next] });
    // The running engine takes it now; the saved list is what the next one
    // starts with. Only the second of those can catch a program's startup.
    app?.log.setLevel(area, next.has(area) ? "trace" : "off");
  };

  return (
    <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
        Record host calls — kept between visits, so an area switched on here is recorded from the
        next run's first instruction. A running title picks it up at once, but what it did before
        the switch was never written.
      </Typography>
      <Stack direction="row" gap={0.75} flexWrap="wrap">
        {areas.map((area) => (
          <Chip
            key={area}
            label={area.replace(/^call\./, "")}
            size="small"
            onClick={() => toggle(area)}
            variant={on.has(area) ? "filled" : "outlined"}
            sx={{
              height: 22,
              fontSize: 11,
              borderColor: "divider",
              color: on.has(area) ? "background.paper" : "text.secondary",
              bgcolor: on.has(area) ? "text.primary" : "transparent",
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

/** Warnings and errors carry the meaning; the rest is context around them. */
const INK = { error: "#ff8f8f", warn: "#e8c37a" };
