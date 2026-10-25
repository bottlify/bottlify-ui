/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, LinearProgress, Snackbar, Stack, Tooltip, Typography,
} from "@mui/material";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { launch } from "../engine/session.js";
import { describeCutOff, takeCutOffRun } from "../engine/blackbox.js";
import { loadSettings, touchLayoutFor } from "../settings.js";
import { isTouchScreen } from "../engine/touch.js";
import { TouchControls } from "./TouchControls.jsx";
import { PerfOverlay } from "./PerfOverlay.jsx";
import { SettingsDrawer } from "./SettingsDrawer.jsx";
import { VolumeControl } from "./AppHeader.jsx";

/**
 * What the person is waiting on, in the launch's own order.
 *
 * The engine names these stages itself (`SessionReport.stage`); what is here is
 * the sentence each one is owed. `says` is the fallback for a stage that has
 * nothing of its own to report yet, so a stage with no number still reads as a
 * stage and not as a frozen page.
 */
const STAGE_TEXT = {
  fetch: {
    title: "Fetching the bundle",
    says: "reading the entry image and the runtime",
  },
  init: {
    title: "Booting the machine",
    says: "building the process and mapping its images",
  },
  loading: {
    title: "Loading the program",
    says: "the program is running and has not drawn yet",
  },
  installing: {
    title: "Installing",
    says: "the installer is running without a window",
  },
};

/** Where each stage sits in the sequence, for saying "step N of 3". */
const STAGE_STEP = { fetch: 1, init: 2, loading: 3, installing: 3 };

/**
 * Running screen: a dark stage with transport controls above it, the guest's
 * frames below, and -- until the first of them arrives -- what the launch is
 * doing right now.
 *
 * Either a bundle or a distribution being installed. The screen is the same
 * because the run is the same: a Win32 program with a window, driven by
 * whoever is watching it.
 *
 * @param {Object} props
 * @param {import("../api/bundles.js").BundleManifest | null} [props.bundle]
 * @param {{ name: string, bytes: Uint8Array } | { name: string, disc: Blob } | null} [props.media]
 *     An installer, or a disc image mounted as a drive of its own.
 * @param {string} [props.title]
 * @param {() => void} props.onClose
 * @param {(app: any, code: number) => void} [props.onExited]  The run is over; read what it left.
 */
export function PlayScreen({ bundle, media, title, onClose, onExited }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const controls = useRef(null);
  const [state, setState] = useState({
    stage: "fetch", detail: "", note: "", off: [], frame: null, error: null,
    messageBox: null, hooks: null, progress: null, usual: null, elapsed: undefined, screen: null,
  });
  // A touch screen plays with controls over the picture and is held sideways;
  // asked once, since a phone does not become a desktop while a game runs.
  const [touch] = useState(() => isTouchScreen(window));
  const [portrait, setPortrait] = useState(() => touch
    && window.matchMedia?.("(orientation: portrait)").matches === true);
  useEffect(() => {
    if (!touch) return undefined;
    const query = window.matchMedia?.("(orientation: portrait)");
    const turned = () => setPortrait(query?.matches === true);
    query?.addEventListener?.("change", turned);
    return () => query?.removeEventListener?.("change", turned);
  }, [touch]);
  const [attempt, setAttempt] = useState(0);
  const [showTrace, setShowTrace] = useState(false);
  // A page opened by a link has had no click yet, and the browser will not
  // start its sound without one: the run waits for a press on the canvas. One
  // reached through the library was clicked into, and starts at once. A
  // browser that cannot say is taken at its word that sound may start.
  const [pressed, setPressed] = useState(
    () => /** @type {any} */ (navigator).userActivation?.hasBeenActive ?? true);
  // The pixel box the game's picture occupies -- the canvas's own box. Before
  // the first frame there is no frame to take a size from, so it is the
  // display the launcher configured, fitted to the stage the same way; the
  // loader is pinned to this box rather than to the stage, so the person is
  // looking at the surface the game will draw on.
  const [viewport, setViewport] = useState(null);
  // Open from the first moment when that is what was asked for: the reason to
  // read the journal is to watch a launch against what it is doing, and a panel
  // opened after the fact has already missed it.
  const [logFirst] = useState(() => loadSettings().logOpen);
  const [settings, setSettings] = useState(logFirst);
  // Whether the "mouse captured" hint has been shown, and whether it is up.
  // Said once per session because it is a fact about the page, not a live
  // status: the second time it would be the person being told they were right.
  const captureHintGiven = useRef(false);
  const [captureHint, setCaptureHint] = useState(false);
  // How to leave fullscreen, said each time the stage takes the screen: with
  // Escape locked for the program, one press no longer does it.
  const [fullscreenHint, setFullscreenHint] = useState(false);

  // Notes are a running log and the latest one replaces the last. A subsystem
  // switching itself off is not that: it holds for the whole run, and kept in
  // the same slot it would be erased by the next line of engine chatter before
  // the game had even started.
  const report = useCallback((patch) => setState((held) => ({
    ...held,
    ...patch,
    off: patch.off && !held.off.includes(patch.off) ? [...held.off, patch.off] : held.off,
  })), []);

  // The last start of this game, when the browser took the page away in the
  // middle of it: said once, over the stage, until it is closed.
  const [cutOff, setCutOff] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    if (!bundle?.id) return;
    let record = null;
    try {
      record = takeCutOffRun(localStorage, bundle.id);
    } catch {
      // No storage: nothing was written either.
    }
    if (record) setCutOff(describeCutOff(record));
  }, [bundle?.id]);

  // A run is keyed by its bottle's id, not by the object: a page opened by its
  // link is handed the bottle twice, read by id and then found in the library's
  // list, and restarting for the second object started a second engine beside
  // the first while the first was still going down.
  const bundleId = bundle?.id ?? null;
  const startRun = useEffectEvent(() => launch({ bundle, media, canvas: canvasRef.current, report }));

  useEffect(() => {
    if ((bundleId === null && !media) || !pressed) return undefined;
    let live = true;
    setState({
      stage: "fetch", detail: "", note: "", off: [], frame: null, error: null,
      messageBox: null, hooks: null, progress: null, usual: null, elapsed: undefined, screen: null,
    });
    setShowTrace(false);

    startRun()
      .then((session) => {
        controls.current = session;
        // Unmounted, or stopped, while the launch was still assembling: the
        // graph exists now and nothing else will ever take it down.
        if (!live) session.stop();
      })
      .catch((e) => {
        if (!live) return;
        report({
          stage: "failed",
          error: {
            reason: e.reason ?? "the title could not be started",
            message: e.message ?? String(e),
            trace: e.traceText ?? e.stack ?? "",
          },
        });
      });

    return () => {
      live = false;
      controls.current?.stop();
      controls.current = null;
    };
  }, [bundleId, media, attempt, report, pressed]);

  const { stage } = state;
  const running = stage === "running" || stage === "loading" || stage === "installing";
  const over = stage === "stopped" || stage === "failed" || stage === "exited";
  const drawn = state.frame !== null;
  const started = running || stage === "paused";
  // A run that ended on its own is told the way a run that broke is: same
  // screen, same buttons, only the title differs.
  const outcome = state.error ?? (stage === "exited"
    ? {
      reason: state.exitCode === 0 ? "Game exited" : `Game exited with code ${state.exitCode}`,
      message: "The program ended on its own. Press play to run it again.",
      trace: state.trace ?? "",
    }
    : null);

  // The viewport takes focus as soon as there is something in it, so the first
  // keystroke reaches the guest rather than the page.
  useEffect(() => {
    if (drawn) canvasRef.current?.focus();
  }, [drawn]);

  // The picture fills the stage, up as well as down, keeping the program's
  // aspect: a 640x480 dialog on a large display is unreadable at its own size.
  // Sized here rather than by object-fit, because the pointer is mapped over
  // the element's content box and a letterbox inside it would put the cursor
  // beside where the person is pointing.
  //
  // Laid out synchronously so the wallpaper's box is right on the first paint
  // rather than a frame later, which is the whole of the point: there must be
  // no moment where an unsized grey box is what is on screen.
  useLayoutEffect(() => {
    const box = stageRef.current;
    if (!box) return undefined;
    const fit = () => {
      const style = getComputedStyle(box);
      const room = {
        width: box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      };
      // The frame once the program has drawn one; until then the display the
      // program was told it has, which is the launcher's best account of the
      // box the first frame will arrive in.
      const source = state.frame ?? state.screen ?? loadSettings().screen;
      const scale = Math.min(room.width / source.width, room.height / source.height);
      setViewport({
        width: Math.max(1, Math.floor(source.width * scale)),
        height: Math.max(1, Math.floor(source.height * scale)),
      });
    };
    fit();
    const watching = new ResizeObserver(fit);
    watching.observe(box);
    return () => watching.disconnect();
  }, [state.frame, state.screen]);

  // The program ended on its own, which for an install is the signal that the
  // prefix is finished. Announced once and only for a run that got that far:
  // a stop the person asked for has nothing to hand over.
  useEffect(() => {
    if (stage === "exited" && controls.current) onExited?.(controls.current.app, state.exitCode);
    // Announced once, when the stage turns: the exit code is settled by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, onExited]);

  // In fullscreen, Escape belongs to the program: a game of this era cancels
  // with it, and a browser that spends the first one on leaving fullscreen
  // takes the key out from under the program it is showing. Both calls are
  // Chromium-only, the lock is allowed only into fullscreen and can be
  // refused -- so neither the methods nor their answers are insisted on here.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        navigator.keyboard?.lock?.(["Escape"])?.catch(() => {});
        setFullscreenHint(true);
      } else {
        navigator.keyboard?.unlock?.();
        setFullscreenHint(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // The capture is worth saying out loud the first time it happens windowed:
  // a mouse that vanishes where it was clicked is how a page looks broken.
  // Fullscreen needs no telling -- handing the screen to the game was what
  // the person asked for.
  useEffect(() => {
    const onPointerLockChange = () => {
      if (
        document.pointerLockElement === canvasRef.current
        && !document.fullscreenElement
        && !captureHintGiven.current
      ) {
        captureHintGiven.current = true;
        setCaptureHint(true);
      }
    };
    document.addEventListener("pointerlockchange", onPointerLockChange);
    return () => document.removeEventListener("pointerlockchange", onPointerLockChange);
  }, []);

  // Right Alt held is the system cursor, always -- a key the games of the era
  // all but never bind, where Control crouches or fires: the capture lets go on the first
  // keydown and the canvas shows the page's own pointer until the key is up,
  // whatever the program does with its cursor -- the way out of a lock a
  // title eats Escape in, and the way to reach the page (a screenshot, the
  // panel) without leaving the game. Nothing is prevented: the program sees
  // every key it is owed. The next click on the canvas captures again as it
  // always did.
  useEffect(() => {
    // By code, or as the right-hand Alt where a layout names the key otherwise.
    const isRightAlt = (e) => e.code === "AltRight"
      || ((e.key === "Alt" || e.key === "AltGraph") && e.location === 2);
    let shown = false;
    /** @type {string} */
    let wasCursor = "";
    const onKeyDown = (e) => {
      if (!isRightAlt(e) || shown) return;
      shown = true;
      if (document.pointerLockElement === canvasRef.current) {
        document.exitPointerLock();
      }
      const canvas = canvasRef.current;
      if (canvas) {
        wasCursor = canvas.style.cursor;
        canvas.style.cursor = "default";
      }
    };
    const onKeyUp = (e) => {
      if (!isRightAlt(e) || !shown) return;
      shown = false;
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = wasCursor;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onKeyUp);
    };
  }, []);

  /** What the touch controls send, to the engine running now. @param {any} event */
  const sendInput = useCallback((event) => controls.current?.app?.input.send(event), []);
  /** The engine's on-screen keyboard, for the touch controls' Keys. */
  const keyboard = useMemo(() => ({
    show: () => controls.current?.app?.input.showKeyboard?.() ?? false,
    hide: () => controls.current?.app?.input.hideKeyboard?.(),
    shown: () => controls.current?.app?.input.keyboardShown?.() ?? false,
  }), []);

  const handlePlay = () => {
    if (stage === "paused") {
      controls.current?.resume();
      return;
    }
    // A run that ended is disposed of before another starts: a program that
    // exited on its own has not been taken down, only stopped running.
    controls.current?.stop();
    controls.current = null;
    setAttempt((count) => count + 1);
  };
  // The stage fills the screen and the picture is scaled to it; the game
  // keeps its resolution.
  const handleFullscreen = () => {
    stageRef.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 30,
        bgcolor: "rgba(6,7,8,0.92)",
        display: "flex",
        flexDirection: "column",
        animation: "bottlify-fade-in .5s ease",
        "@keyframes bottlify-fade-in": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          // Held sideways a phone has few lines to give the bar.
          px: touch ? 1.5 : { xs: 2.5, md: 6 },
          py: touch ? 0.25 : 1.5,
          pl: touch ? "max(12px, env(safe-area-inset-left))" : undefined,
          pr: touch ? "max(12px, env(safe-area-inset-right))" : undefined,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "rgba(26,27,29,0.85)",
          backdropFilter: "blur(8px)",
          // The blur makes the bar a layer of its own, and the stage after it
          // in the page would be drawn over anything that opens below the bar
          // -- the volume's slider among them -- whatever its own z-index.
          position: "relative",
          zIndex: 1,
        }}
      >
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {bundle?.title ?? title ?? "Untitled"}
          <Box component="span" sx={{ color: "text.secondary", ml: 1 }}>
            {stage}
            {stage === "exited" ? ` with code ${state.exitCode}` : ""}
            {state.frame ? ` · ${state.frame.width}×${state.frame.height}` : ""}
          </Box>
        </Typography>

        {/* One cluster, flush right and the same width in every state, with
            the same padding the library's bar uses: a control that moves
            between one screen and the next is a control a hand misses. */}
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: "auto", flexShrink: 0 }}>
          {/* Drives the same speaker this run is actually playing through --
              see `session.js`'s `applyGain`, which reads this live. */}
          <VolumeControl />
          {/* One control, showing the state the session reports rather than one
              it remembers: a play glyph beside a running game would be a control
              saying something untrue about what the engine is doing. */}
          <Transport
            label={running ? "pause" : stage === "paused" ? "resume" : "play"}
            icon={running ? "pause" : "play"}
            disabled={!(started || over)}
            onClick={running ? () => controls.current?.pause() : handlePlay}
          />
          {/* Its arrows reach the corners of the glyph's box where the others
              sit inside it, so at the same size it reads a size larger. */}
          <Transport label="fullscreen" icon="fullscreen" glyphSize={14} onClick={handleFullscreen} />
          <Transport label="settings" icon="cog" onClick={() => setSettings((on) => !on)} />
          <Transport label="close" icon="remove" onClick={onClose} />
        </Stack>
      </Box>

      {/* The panel sits beside the stage rather than over it: the reason to
          read the journal is to watch it against what the game is doing, and a
          panel covering the picture would hide the other half of that. */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Box
          ref={stageRef}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // On a touch screen the picture takes the whole stage, inside the
            // safe area; the controls lie over it and the bars beside it.
            p: touch ? 0 : 2,
            pl: touch ? "env(safe-area-inset-left)" : undefined,
            pr: touch ? "env(safe-area-inset-right)" : undefined,
            pb: touch ? "env(safe-area-inset-bottom)" : undefined,
            bgcolor: touch ? "#000" : undefined,
            touchAction: touch ? "none" : undefined,
            // The overlay below is placed against this box.
            position: "relative",
            // Fullscreen, the stage is the screen: no gutter, and black around
            // the picture where the aspect leaves room.
            "&:fullscreen": { p: 0, bgcolor: "#000" },
          }}
        >
          {touch && started && controls.current?.app
            && touchLayoutFor(loadSettings(), bundle ?? { id: "" }).controls !== "off" && (
            <TouchControls
              send={sendInput}
              layout={touchLayoutFor(loadSettings(), bundle ?? { id: "" })}
              canvas={canvasRef}
              frame={state.frame}
              keyboard={keyboard}
            />
          )}
          {touch && portrait && (
            <Box sx={{ position: "absolute", inset: 0, zIndex: 4, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 2, p: 3, textAlign: "center",
              bgcolor: "rgba(0,0,0,0.85)" }}>
              <Box component="span" className="glyphicon glyphicon-repeat" sx={{ fontSize: 40 }} />
              <Typography variant="h6">Turn your phone sideways</Typography>
              <Typography variant="body2" color="text.secondary">
                The game is drawn for a screen held in landscape.
              </Typography>
            </Box>
          )}
          {cutOff && (
            <Alert severity="warning" onClose={() => setCutOff(null)}
              sx={{ position: "absolute", top: 8, left: 8, right: 8, zIndex: 2 }}>
              {cutOff}
            </Alert>
          )}
          {/* Inside the stage, because in fullscreen nothing outside it is
            drawn. A click is the game's, so only the clock or the cross
            closes it. */}
          <Snackbar
            open={fullscreenHint}
            autoHideDuration={5000}
            onClose={(_event, reason) => reason !== "clickaway" && setFullscreenHint(false)}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
          >
            <Alert severity="info" onClose={() => setFullscreenHint(false)}>
              Press and hold Esc to leave fullscreen.
            </Alert>
          </Snackbar>
          {/* The box the game will draw in. Before the first frame it holds the
            loader on black -- no picture, which only got in the way of reading
            it; from the first frame on it is the canvas.
            Pinned to the canvas's own box rather than the stage, so what is on
            screen is the game's surface and never a bare grey page. */}
          <Box
            sx={{
              position: "relative",
              width: viewport ? `${viewport.width}px` : "100%",
              height: viewport ? `${viewport.height}px` : "100%",
              maxWidth: "100%",
              maxHeight: "100%",
              bgcolor: "#000",
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            {/* Kept mounted from the first moment: the session is handed this
              canvas before there is anything to put in it.

              Focusable, because it is the input target as well as the
              viewport -- clicking it is the gesture the keyboard and pointer
              path hangs off. Fullscreen is the transport button's alone: a
              double-click is a gesture games use, and one that also fills the
              screen surprises. */}
            <Box
              component="canvas"
              ref={canvasRef}
              tabIndex={0}
              aria-label={`${bundle?.title ?? title ?? "game"} viewport`}
              sx={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                display: drawn ? "block" : "none",
                // No focus ring: the viewport is the picture, and a ring drawn
                // over a game's own frame tells nobody anything they cannot see
                // better in the frame itself.
                outline: "none",
                boxShadow: "none",
              }}
            />
            {/* The space the game will draw into is never an empty grey box:
              the loader spins on black from the first moment until the first
              frame, saying which stage this is and what is known about how far
              it has got. */}
            {!pressed && (
              <Box sx={{ position: "absolute", inset: 0, zIndex: 1, display: "flex",
                alignItems: "center", justifyContent: "center" }}>
                <Button variant="contained" size="large" onClick={() => setPressed(true)}
                  startIcon={<span className="glyphicon glyphicon-play" />}
                  sx={{ px: 4, py: 1.5, fontWeight: 700, bgcolor: "text.primary", color: "#1e2022" }}>
                  Press to Start
                </Button>
              </Box>
            )}
            {pressed && !drawn && !over && <Starting state={state} />}
            <PerfOverlay
              app={controls.current?.app ?? null}
              active={drawn}
              symbols={controls.current?.symbols ?? null}
            />
          </Box>
          {/* Everything after the wait is said over the whole stage, never
            beside it: the last frame stays underneath, dimmed, and the words
            and buttons sit on top of it where a person is already looking. */}
          {over && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                zIndex: 1,
                display: "flex",
                // "safe": a trace taller than the viewport scrolls from its
                // top instead of losing it above the box.
                alignItems: "safe center",
                justifyContent: "center",
                overflow: "auto",
                p: 2,
                // Dims the last frame, if there was one, so the failure
                // stays readable over whatever the game drew.
                bgcolor: drawn ? "rgba(26,27,29,0.85)" : "rgba(0,0,0,0.55)",
              }}
            >
              {outcome !== null ? (
                <Failure
                  error={outcome}
                  open={showTrace}
                  onToggle={() => setShowTrace((on) => !on)}
                  onBack={onClose}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Stopped. Press play to run it again.
                </Typography>
              )}
            </Box>
          )}
        </Box>

        {/* The engine is read at the moment the panel renders rather than
            held: a run that has been stopped leaves nothing to poll, and the
            panel says that instead of talking to a disposed graph. */}
        <SettingsDrawer
          inline
          start={logFirst ? "logs" : null}
          open={settings}
          onClose={() => setSettings(false)}
          app={controls.current?.app ?? null}
          running={started}
          bundleId={bundle?.id ?? title ?? "untitled"}
          bundle={bundle ?? null}
          facts={[
            { label: "Title", value: bundle?.title ?? title ?? "Untitled" },
            { label: "Stage", value: stage + (stage === "exited" ? ` with code ${state.exitCode}` : "") },
            {
              label: "Frame",
              value: state.frame ? `${state.frame.width}×${state.frame.height}` : "nothing presented yet",
            },
            ...(state.hooks ? [{ label: "Hooks", value: state.hooks }] : []),
            // What switched itself off holds for the whole run, so it is a
            // fact about the session rather than a line of the log -- and the
            // log is where the run's own chatter belongs, not the viewport.
            ...state.off.map((line, at) => ({ label: at === 0 ? "Not running" : "", value: line })),
            ...(state.note ? [{ label: "Last note", value: state.note }] : []),
          ]}
        />
      </Box>

      {/* Bottom-left, out of the way of the controls above the picture and of
        the game's own centred action; where an explanation belongs is under
        the thing that needs explaining. */}
      {/* The click that captured the mouse, and every click after it, is the
        game's: closing on a click away took the hint down the moment it came
        up. The clock or the cross closes it. */}
      <Snackbar
        open={captureHint}
        onClose={(_event, reason) => reason !== "clickaway" && setCaptureHint(false)}
        autoHideDuration={5000}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Alert severity="info" onClose={() => setCaptureHint(false)}>
          Mouse captured. Hold right Alt (right Option on a Mac) to free it.
        </Alert>
      </Snackbar>

      {state.messageBox && (
        <MessageBox
          notice={state.messageBox}
          onClose={() => report({ messageBox: null })}
          onAnswer={(button) => controls.current?.answerMessageBox(state.messageBox.id, button)}
        />
      )}
    </Box>
  );
}

/** The MB_ICON* bits, for a notice that predates the icon name. */
const ICONS = { 0x10: "error", 0x20: "question", 0x30: "warning", 0x40: "information" };

/**
 * What the program itself said, with the buttons it asked for, and the guest
 * backtrace taken at the call.
 *
 * The program is parked inside MessageBox until one of these is pressed, so
 * this is the whole of the conversation: the labelled button the person clicks
 * is the id the call returns. The default button is the one focused, and
 * Escape answers Cancel where the box has one -- which is what the dialog
 * manager would have done.
 *
 * The trace is shown rather than folded away: it is the only part of this that
 * cannot be recovered once the run has moved on.
 *
 * @param {Object} props
 * @param {{ id: number, text: string, caption: string, type: number,
 *           buttons: { id: number, label: string }[], defaultButton: number,
 *           icon: string | null, trace: string | null }} props.notice
 * @param {() => void} props.onClose     Dismisses a notice nothing is waiting on.
 * @param {(button: number) => void} [props.onAnswer]
 *        Hands the engine the id of the button pressed.
 */
function MessageBox({ notice, onClose, onAnswer }) {
  const kind = notice.icon ?? ICONS[notice.type & 0xf0] ?? "message";
  const buttons = notice.buttons ?? [];
  // Escape and a click outside are Cancel where the box has one. A box whose
  // buttons are Abort/Retry/Ignore has no Cancel, and no way out but a button.
  const cancel = buttons.find((button) => button.id === 2);
  const dismiss = () => {
    if (buttons.length === 0) {
      onClose();
      return;
    }
    if (cancel && onAnswer) onAnswer(cancel.id);
  };
  const answer = (id) => (onAnswer ? onAnswer(id) : onClose());
  return (
    <Dialog open fullWidth maxWidth="md" onClose={dismiss}>
      <DialogTitle sx={{ pb: 0.5 }}>
        {notice.caption || "The program says"}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {kind} box raised by the program
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {notice.text}
        </Typography>
        {notice.trace && (
          <Box
            component="pre"
            sx={{
              mt: 2,
              p: 2,
              maxHeight: "40vh",
              overflow: "auto",
              bgcolor: "#101113",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              fontSize: 12,
              color: "text.secondary",
              whiteSpace: "pre",
            }}
          >
            {notice.trace}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {notice.trace && (
          <Button
            size="small"
            color="inherit"
            onClick={() => navigator.clipboard?.writeText(notice.trace)}
          >
            Copy trace
          </Button>
        )}
        {buttons.length > 0 ? (
          buttons.map((button) => (
            <Button
              key={button.id}
              size="small"
              color="inherit"
              autoFocus={button.id === notice.defaultButton}
              variant={button.id === notice.defaultButton ? "contained" : "outlined"}
              onClick={() => answer(button.id)}
            >
              {button.label}
            </Button>
          ))
        ) : (
          <Button size="small" variant="outlined" color="inherit" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/**
 * @param {Object} props
 * @param {string} props.label
 * @param {string} props.icon
 * @param {number} [props.glyphSize]  In pixels, for a glyph that fills its box.
 * @param {boolean} [props.disabled]
 * @param {() => void} props.onClick
 */
function Transport({ label, icon, glyphSize, disabled = false, onClick }) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton aria-label={label} size="small" disabled={disabled} onClick={onClick}>
          <span className={`glyphicon glyphicon-${icon}`}
            style={glyphSize ? { fontSize: glyphSize } : undefined} />
        </IconButton>
      </span>
    </Tooltip>
  );
}

/**
 * What the person is waiting on, over the picture the game will draw into.
 *
 * One stage at a time rather than a list: the launch has exactly one thing
 * happening in it at any moment, and the number beside it -- bytes, files,
 * instructions -- is what says whether it is moving. A stage that has no
 * number of its own still has elapsed time, and while the program is loading
 * it also has the range its first frame has taken on this machine before, if
 * it has ever been timed.
 *
 * @param {Object} props
 * @param {any} props.state
 */
function Starting({ state }) {
  const text = STAGE_TEXT[state.stage] ?? STAGE_TEXT.fetch;
  const step = STAGE_STEP[state.stage] ?? 1;
  const progress = state.progress && state.progress.total > 0 ? state.progress : null;
  const usual = state.usual;
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // Low in the box, under the spinner's own middle.
        justifyContent: "flex-end",
        gap: 2,
        p: 3,
        pb: "7%",
        overflow: "auto",
        textAlign: "center",
        bgcolor: "rgba(0,0,0,0.55)",
      }}
    >
      <CircularProgress size={44} thickness={4} />
      <Box sx={{ maxWidth: 520 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {text.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
          step {step} of 3
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {state.detail || text.says}
        </Typography>
        {progress && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, (progress.read / progress.total) * 100)}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              {progress.label} — {Math.round((progress.read / progress.total) * 100)}%
            </Typography>
          </Box>
        )}
        {state.elapsed !== undefined && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            {state.elapsed.toFixed(1)} s elapsed
          </Typography>
        )}
        {state.stage === "loading" && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.5, opacity: 0.85 }}
          >
            {usual
              ? (usual.high - usual.low < 1
                ? "The program is starting — first frame usually takes about "
                  + `${seconds(usual.high)} s on a warm store.`
                : "The program is starting — first frame usually takes "
                  + `${seconds(usual.low)}–${seconds(usual.high)} s on a warm store.`)
              : "The program is starting — its first frame has not been timed on this "
                + "machine yet, so this launch is recording it."}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/**
 * A duration in seconds as the copy above reads it: whole above ten, a tenth
 * below, where the difference between eight and ten is the one that matters.
 *
 * @param {number} value
 */
function seconds(value) {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/**
 * How the run ended, in plain words, with the engine's own trace behind a button.
 *
 * @param {Object} props
 * @param {{ reason: string, message: string, trace: string }} props.error
 * @param {boolean} props.open
 * @param {() => void} props.onToggle
 * @param {() => void} props.onBack
 */
function Failure({ error, open, onToggle, onBack }) {
  // The whole report rather than the dump alone. The reason and the message are
  // on screen, so copying only the trace looks complete and is not: what a
  // reader receives is registers and a stack with nothing saying what went
  // wrong, and a parked thread's registers describe the park loop and nothing
  // else.
  const report = [error.reason, error.message, error.trace].filter(Boolean).join("\n\n");
  return (
    <Box sx={{ width: "100%", maxWidth: 720 }}>
      <Typography variant="h6">{error.reason}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
        {error.message}
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
        <Button size="small" variant="outlined" color="inherit" onClick={onBack}>
          Back to library
        </Button>
        {error.trace && (
          <>
            <Button size="small" variant="outlined" color="inherit" onClick={onToggle}>
              {open ? "Hide trace" : "Show trace"}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={() => navigator.clipboard?.writeText(report)}
            >
              Copy report
            </Button>
          </>
        )}
      </Box>
      {error.trace && (
        <>
          {open && (
            <Box
              component="pre"
              sx={{
                mt: 2,
                p: 2,
                maxHeight: "40vh",
                overflow: "auto",
                bgcolor: "#101113",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                fontSize: 12,
                color: "text.secondary",
                whiteSpace: "pre",
              }}
            >
              {error.trace}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
