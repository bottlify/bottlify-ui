/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, Divider,
  IconButton, LinearProgress, Menu, MenuItem, Snackbar, Tooltip, Typography,
} from "@mui/material";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { engineNow, launch, loadEngine, openRunSpeaker, soundWanted } from "../engine/session.js";
import { describeCutOff, takeCutOffRun } from "../engine/blackbox.js";
import { lastEndingReport } from "../engine/journal.js";
import { drawIcon, keptHead, servedHead, showGame } from "../engine/bookmark.js";
import { loadSettings, saveSettings, touchLayoutFor } from "../settings.js";
import { touchLayout } from "../engine/touch.js";
import { isTouchScreen } from "../engine/touch.js";
import { TouchControls } from "./TouchControls.jsx";
import { FpsMeter } from "./FpsMeter.jsx";
import { SettingsDrawer } from "./SettingsDrawer.jsx";
import { VolumeControl } from "./AppHeader.jsx";
import { RateDialog, ReportDialog } from "./Feedback.jsx";
import { DialogHead, Icon, StatusText } from "./kit.jsx";
import { knownProviders, storeOf } from "../stores/providers.js";
import { useT } from "../i18n.js";
import { useSettings } from "../useSettings.js";
import { INK } from "../theme.js";
import logo from "../assets/logo.svg";

/**
 * What the person is waiting on, in the launch's own order.
 *
 * The engine names these stages itself (`SessionReport.stage`); a player is told
 * each in a plain word (`play.stage.*`), a developer also what the engine is
 * doing in it -- this, for a stage that has nothing of its own to report yet,
 * so it still reads as a stage and not as a frozen page.
 */
const STAGE_TEXT = {
  fetch: "reading the entry image and the runtime",
  init: "building the process and mapping its images",
  loading: "the program is running and has not drawn yet",
  installing: "the installer is running without a window",
};

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
 * @param {(app: any, code: number, layersNeeded: string[]) => void} [props.onExited]
 *     The run is over; read what it left, and the layers the engine asked for in it.
 */
/** How long into a run the header goes up, and stays down when reached for on a touch screen. */
const HEADER_HIDES_MS = 5000;
/** How long the header stays after the pointer leaves it. */
const HEADER_LEAVE_MS = 1200;

/** How long a speaker opened with no press in hand is given to start on its own. */
const STARTS_ALONE_MS = 300;

/**
 * Whether a speaker opened outside a gesture starts anyway.
 *
 * @param {any} speaker
 * @returns {Promise<boolean>}
 */
async function startsAlone(speaker) {
  for (let waited = 0; speaker.state() !== "running" && waited < STARTS_ALONE_MS; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return speaker.state() === "running";
}

export function PlayScreen({ bundle, media, title, onClose, onExited }) {
  const t = useT();
  const prefs = useSettings();
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
  // A page opened by a link has had no click yet, and the browser will not
  // start its sound without one: the run waits for a press on the canvas. One
  // reached through the library was clicked into, and starts at once -- unless
  // its browser wants the press itself for sound, as a phone's does, which the
  // run finds out and then waits for the press too. A browser that cannot say
  // is taken at its word that sound may start. `?autostart=1` starts without
  // the press, its sound as the browser allows: a script or a person driving
  // the page by its address does not stop to click.
  const [pressed, setPressed] = useState(
    () => new URLSearchParams(window.location.search).get("autostart") === "1"
      || (/** @type {any} */ (navigator).userActivation?.hasBeenActive ?? true));
  // The speaker, opened inside the press that starts a run (`openRunSpeaker`)
  // and handed to that run, which owns it from then on.
  const speakerRef = useRef(/** @type {any} */ (null));
  const openSpeakerNow = () => {
    speakerRef.current?.close();
    speakerRef.current = openRunSpeaker();
  };
  // Imported before anyone presses anything, so the press finds the engine at
  // hand; and a speaker no run took is closed with the page.
  useEffect(() => {
    loadEngine().catch(() => {});
    return () => {
      speakerRef.current?.close();
      speakerRef.current = null;
    };
  }, []);
  // The pixel box the game's picture occupies -- the canvas's own box. Before
  // the first frame there is no frame to take a size from, so it is the
  // display the launcher configured, fitted to the stage the same way; the
  // loader is pinned to this box rather than to the stage, so the person is
  // looking at the surface the game will draw on.
  const [viewport, setViewport] = useState(null);
  // Open from the first moment when that is what was asked for: the reason to
  // read the journal is to watch a launch against what it is doing, and a panel
  // opened after the fact has already missed it.
  const [logFirst] = useState(() => loadSettings().developer && loadSettings().logOpen);
  const [settings, setSettings] = useState(logFirst);
  // The bar's menu, and what it opened.
  const [menu, setMenu] = useState(/** @type {HTMLElement | null} */ (null));
  const [helping, setHelping] = useState(false);
  const [rating, setRating] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Whether the "mouse captured" hint has been shown, and whether it is up.
  // Said once per session because it is a fact about the page, not a live
  // status: the second time it would be the person being told they were right.
  const captureHintGiven = useRef(false);
  const [captureHint, setCaptureHint] = useState(false);
  // How to leave fullscreen, said each time the stage takes the screen: with
  // Escape locked for the program, one press no longer does it.
  const [fullscreenHint, setFullscreenHint] = useState(false);
  // A browser with no fullscreen for the stage -- Safari on an iPhone, which
  // has it only for a video -- is told the way it has: the home screen.
  const [homeScreenHint, setHomeScreenHint] = useState(false);

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

  // While a game is open, the tab, a bookmark and a home-screen icon are the
  // game's (`bookmark.js`): one the server holds from the first moment, one
  // kept in this browser by its title, and by its icon once a run has read it.
  const icon = state.icon ?? null;
  const gameId = bundle?.id ?? null;
  const gameTitle = bundle?.title ?? null;
  const kept = bundle?.local === true;
  useEffect(() => {
    if (!gameId || !gameTitle) return undefined;
    const game = { id: gameId, title: gameTitle };
    let undo = showGame(document, kept ? keptHead(game) : servedHead(game));
    let live = true;
    if (kept && icon) {
      Promise.all([drawIcon(icon, 64), drawIcon(icon, 180)]).then(([tab, home]) => {
        if (!live) return;
        undo();
        undo = showGame(document, { ...keptHead(game), tabIcon: tab, touchIcon: home });
      }, () => {});
    }
    return () => {
      live = false;
      undo();
    };
  }, [gameId, gameTitle, kept, icon]);

  // A run is keyed by its bottle's id, not by the object: a page opened by its
  // link is handed the bottle twice, read by id and then found in the library's
  // list, and restarting for the second object started a second engine beside
  // the first while the first was still going down.
  const bundleId = bundle?.id ?? null;
  const startRun = useEffectEvent(() => {
    const speaker = speakerRef.current;
    speakerRef.current = null;
    if (bundle) saveSettings({ lastRun: { ...loadSettings().lastRun, [bundle.id]: Date.now() } });
    return launch({ bundle, media, canvas: canvasRef.current, report, speaker });
  });

  useEffect(() => {
    if ((bundleId === null && !media) || !pressed) return undefined;
    let live = true;
    setState({
      stage: "fetch", detail: "", note: "", off: [], frame: null, error: null,
      messageBox: null, hooks: null, progress: null, usual: null, elapsed: undefined, screen: null,
    });

    // Started with no press to open the speaker in: one opened now runs only
    // where the browser lets a page that was clicked once start sound when it
    // likes. Where it does not, the run waits for Press to Start, as on a page
    // opened by its link.
    const begin = async () => {
      if (!speakerRef.current && soundWanted()) {
        await loadEngine().catch(() => null);
        const trial = openRunSpeaker();
        if (trial && !(await startsAlone(trial))) {
          await trial.close();
          if (live) setPressed(false);
          return null;
        }
        speakerRef.current = trial;
      }
      return live ? startRun() : null;
    };

    begin()
      .then((session) => {
        if (!session) return;
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

  // Behind another tab the game waits, where the person asked for that: paused
  // by the page, and resumed by it when the page is back -- a pause the person
  // made themselves stays theirs to undo.
  const pausedHidden = useRef(false);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (prefs.pauseWhenHidden && controls.current && state.stage === "running") {
          pausedHidden.current = true;
          controls.current.pause();
        }
      } else if (pausedHidden.current) {
        pausedHidden.current = false;
        controls.current?.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [prefs.pauseWhenHidden, state.stage]);

  // The engine asked for a layer this bottle did not have, now written down
  // for it: started again, this time standing on it. The new run's state
  // carries no `again`, so it is once.
  useEffect(() => {
    if (state.again) setAttempt((count) => count + 1);
  }, [state.again]);

  const { stage } = state;
  const running = stage === "running" || stage === "loading" || stage === "installing";
  const over = stage === "stopped" || stage === "failed" || stage === "exited";
  const drawn = state.frame !== null;
  const started = running || stage === "paused";
  // The header goes up out of the way five seconds into a run, so the picture
  // has the whole screen; it stays while the panel with the logs is open, and
  // comes back when the run pauses or ends, or when it is reached for -- the
  // pointer at the top edge, or on a touch screen the handle there.
  const playing = pressed && !over && stage !== "paused";
  const [headerHidden, setHeaderHidden] = useState(false);
  const [headerPeek, setHeaderPeek] = useState(false);
  const peekTimer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  useEffect(() => {
    if (!playing || settings) {
      setHeaderHidden(false);
      return undefined;
    }
    const timer = setTimeout(() => setHeaderHidden(true), HEADER_HIDES_MS);
    return () => clearTimeout(timer);
  }, [playing, settings]);
  /** @param {boolean} on */
  const peekHeader = (on) => {
    clearTimeout(peekTimer.current);
    if (on) {
      setHeaderPeek(true);
      // A finger cannot leave the bar the way a pointer does: it goes up again on its own.
      if (touch) peekTimer.current = setTimeout(() => setHeaderPeek(false), HEADER_HIDES_MS);
    } else {
      peekTimer.current = setTimeout(() => setHeaderPeek(false), HEADER_LEAVE_MS);
    }
  };
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  const headerAway = headerHidden && !headerPeek;
  // A run that ended on its own is told the way a run that broke is: same
  // screen, same buttons, only the title differs.
  const outcome = state.error ?? (stage === "exited"
    ? {
      reason: state.exitCode === 0 ? "" : `Game exited with code ${state.exitCode}`,
      message: state.memoryNote ?? "",
      trace: state.trace ?? "",
    }
    : null);
  // A run that stopped on an error, or ended with a code that says one: a crash.
  const crashed = state.error != null || (stage === "exited" && state.exitCode !== 0);
  const gameName = bundle?.title ?? title ?? "";

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
    if (stage === "exited" && controls.current) {
      onExited?.(controls.current.app, state.exitCode, controls.current.layersNeeded?.() ?? []);
    }
    // Announced once, when the stage turns: the exit code is settled by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, onExited]);

  // In fullscreen, Escape belongs to the program: a game of this era cancels
  // with it, and a browser that spends the first one on leaving fullscreen
  // takes the key out from under the program it is showing. Both calls are
  // Chromium-only, the lock is allowed only into fullscreen and can be
  // refused -- so neither the methods nor their answers are insisted on here.
  useEffect(() => {
    let stop = null;
    let live = true;
    loadEngine().then((engine) => {
      if (!live) return;
      stop = engine.watchFullscreen((element) => {
        if (element) {
          navigator.keyboard?.lock?.(["Escape"])?.catch(() => {});
          setFullscreenHint(true);
        } else {
          navigator.keyboard?.unlock?.();
          setFullscreenHint(false);
        }
      });
    }, () => {});
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  // The capture is worth saying out loud the first time it happens windowed:
  // a mouse that vanishes where it was clicked is how a page looks broken.
  // Fullscreen needs no telling -- handing the screen to the game was what
  // the person asked for.
  useEffect(() => {
    const onPointerLockChange = () => {
      if (
        document.pointerLockElement === canvasRef.current
        && !engineNow()?.fullscreenElement()
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

  // The bottle's touch controls, changed from over the game and kept for it,
  // as the Bottle settings dialog keeps them.
  const [touchControls, setTouchControls] = useState(() => touchLayoutFor(loadSettings(), bundle ?? { id: "" }));
  useEffect(() => {
    setTouchControls(touchLayoutFor(loadSettings(), { id: gameId ?? "" }));
  }, [gameId]);
  /** @param {object} patch */
  const changeTouchControls = (patch) => {
    const next = touchLayout({ ...touchControls, ...patch });
    setTouchControls(next);
    if (!gameId) return;
    const stored = loadSettings();
    saveSettings({ bottleConfig: { ...stored.bottleConfig,
      [gameId]: { ...stored.bottleConfig[gameId], touch: next } } });
  };

  // A selection WebKit starts anyway on a long press is refused while the game
  // runs, inside the stage only: the logs beside it stay selectable.
  useEffect(() => {
    if (!started) return undefined;
    /** @param {Event} event */
    const refuse = (event) => {
      if (event.target instanceof Node && stageRef.current?.contains(event.target)) event.preventDefault();
    };
    document.addEventListener("selectstart", refuse);
    return () => document.removeEventListener("selectstart", refuse);
  }, [started]);

  // The virtual cursor, for the run now going and for each one after.
  const cursorAlways = touch && touchControls.cursor === "always";
  useEffect(() => {
    if (started) controls.current?.showCursorAlways?.(cursorAlways);
  }, [cursorAlways, started]);

  /** What the touch controls send, to the engine running now. @param {any} event */
  const sendInput = useCallback((event) => controls.current?.app?.input.send(event), []);
  /** The engine's on-screen keyboard, for the touch controls' Keys. */
  const keyboard = useMemo(() => ({
    show: () => controls.current?.app?.input.showKeyboard?.() ?? false,
    hide: () => controls.current?.app?.input.hideKeyboard?.(),
    shown: () => controls.current?.app?.input.keyboardShown?.() ?? false,
  }), []);

  /** The press a page opened by its link waits for: the speaker opened inside it. */
  const pressStart = () => {
    openSpeakerNow();
    setPressed(true);
  };
  const handlePlay = () => {
    if (!pressed) {
      pressStart();
      return;
    }
    if (stage === "paused") {
      controls.current?.resume();
      return;
    }
    // A run that ended is disposed of before another starts: a program that
    // exited on its own has not been taken down, only stopped running.
    controls.current?.stop();
    controls.current = null;
    openSpeakerNow();
    setAttempt((count) => count + 1);
  };
  // The stage fills the screen and the picture is scaled to it; the game
  // keeps its resolution.
  // Asked inside the click: a browser grants fullscreen to a gesture only.
  const handleFullscreen = () => {
    const box = stageRef.current;
    const engine = engineNow();
    if (!box || !engine) return;
    engine.requestFullscreen(box).then((answer) => {
      if (answer.reason === "unsupported") setHomeScreenHint(true);
    });
  };

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 30,
        bgcolor: "#000",
        display: "flex",
        flexDirection: "column",
        animation: "bottlify-fade-in .5s ease",
        "@keyframes bottlify-fade-in": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      {headerHidden && (
        // Where the bar is reached for once it has gone up: the top edge
        // under a pointer, a handle a finger can find on a touch screen.
        <Box
          data-control="header-handle"
          aria-label={t("play.showBar")}
          onPointerEnter={(event) => event.pointerType === "mouse" && peekHeader(true)}
          onPointerDown={() => peekHeader(true)}
          sx={touch
            ? { position: "absolute", top: "env(safe-area-inset-top)", left: "50%", zIndex: 6,
              transform: "translateX(-50%)", width: 64, height: 22, borderRadius: "0 0 10px 10px",
              bgcolor: "rgba(26,27,29,0.6)", display: "flex", alignItems: "center",
              justifyContent: "center", color: "rgba(255,255,255,0.7)", fontSize: 12,
              touchAction: "manipulation" }
            : { position: "absolute", top: 0, left: 0, right: 0, height: 8, zIndex: 6 }}
        >
          {touch && <span className="glyphicon glyphicon-chevron-down" />}
        </Box>
      )}
      {/* The bar: a pill over the top of the picture, so the game has the whole
        screen. It goes up five seconds into a run and comes back when reached for. */}
      {!over && (
        <Box
          onPointerEnter={() => headerHidden && peekHeader(true)}
          onPointerLeave={(event) => headerHidden && event.pointerType === "mouse" && peekHeader(false)}
          sx={{
            position: "absolute", top: touch ? "max(8px, env(safe-area-inset-top))" : 16, left: "50%",
            zIndex: 7, transform: headerAway ? "translate(-50%, -160%)" : "translateX(-50%)",
            transition: "transform .25s ease",
            display: "flex", alignItems: "center", gap: 0.75, pl: 2.25, pr: 0.75, py: 0.75,
            maxWidth: "calc(100vw - 32px)",
            bgcolor: "rgba(26,27,29,0.92)", border: "1px solid", borderColor: "divider", borderRadius: 999,
            "& .MuiIconButton-root": { borderRadius: "50%", bgcolor: INK.raised, width: 36, height: 36,
              "&:hover": { bgcolor: INK.line } },
          }}
        >
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, mr: 1, minWidth: 0 }}>
            {gameName || t("play.untitled")}
            {prefs.developer && (
              <Box component="span" sx={{ color: "text.secondary", fontWeight: 450, ml: 1 }}>
                {stage}
                {stage === "exited" ? ` with code ${state.exitCode}` : ""}
                {state.frame ? ` · ${state.frame.width}×${state.frame.height}` : ""}
              </Box>
            )}
          </Typography>
          {/* Drives the same speaker this run is actually playing through --
              see `session.js`'s `applyGain`, which reads this live. */}
          <VolumeControl />
          <BarButton label={t("play.fullscreen")} icon="fullscreen" onClick={handleFullscreen} />
          {prefs.developer && (<>
            {/* The state the session reports rather than one it remembers. */}
            <BarButton label={running ? "Pause" : stage === "paused" ? "Resume" : "Play"}
              icon={running ? "pause" : "play"} disabled={pressed && !(started || over)}
              onClick={running ? () => controls.current?.pause() : handlePlay} />
            <BarButton label="Engine" icon="log" onClick={() => setSettings((on) => !on)} />
          </>)}
          <BarButton label={t("play.menu")} icon="more" onClick={(event) => setMenu(event.currentTarget)} />
          <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { mt: 1, width: 260, borderRadius: "14px", border: "1px solid",
              borderColor: "divider", bgcolor: INK.surface } } }}>
            <MenuItem onClick={() => { setMenu(null); setHelping(true); }}>{t("play.controls")}</MenuItem>
            {bundle && (
              <MenuItem onClick={() => { setMenu(null); setRating(true); }}>{t("play.rate")}</MenuItem>
            )}
            <Divider />
            <MenuItem onClick={() => { setMenu(null); onClose(); }}>{t("play.close")}</MenuItem>
          </Menu>
        </Box>
      )}

      {/* The panel sits beside the stage rather than over it: the reason to
          read the journal is to watch it against what the game is doing, and a
          panel covering the picture would hide the other half of that. */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Box
          ref={stageRef}
          sx={{
            flex: 1,
            minWidth: 0,
            // A game being played is not a page being read: a finger held or
            // tapped twice -- on the touchpad, on a button -- would otherwise
            // select the canvas for copying and open the phone's menu over
            // it. Only while it runs: a failure's report is there to be copied.
            ...(started ? { userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
              WebkitTapHighlightColor: "transparent" } : {}),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // On a touch screen the picture takes the whole stage, inside the
            // safe area; the controls lie over it and the bars beside it.
            p: touch ? 0 : 2,
            pl: touch ? "env(safe-area-inset-left)" : undefined,
            pr: touch ? "env(safe-area-inset-right)" : undefined,
            pb: touch ? "env(safe-area-inset-bottom)" : undefined,
            touchAction: touch ? "none" : undefined,
            // The overlay below is placed against this box.
            position: "relative",
            // Fullscreen, the stage is the screen: no gutter, and black around
            // the picture where the aspect leaves room.
            "&:fullscreen": { p: 0, bgcolor: "#000" },
            // Safari before its standard name, an iPad's among them.
            "&:-webkit-full-screen": { p: 0, bgcolor: "#000" },
          }}
        >
          {touch && started && controls.current?.app && (
            <TouchControls
              send={sendInput}
              layout={touchControls}
              onLayout={changeTouchControls}
              canvas={canvasRef}
              frame={state.frame}
              keyboard={keyboard}
            />
          )}
          {/* Asked only before the game's first frame: once it plays, the
            person holds the phone as they like. */}
          {touch && portrait && !drawn && !over && (
            <Box sx={{ position: "absolute", inset: 0, zIndex: 4, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 2, p: 3, textAlign: "center",
              bgcolor: "rgba(0,0,0,0.85)" }}>
              <Box component="span" className="glyphicon glyphicon-repeat" sx={{ fontSize: 40 }} />
              <Typography variant="h6">{t("play.turn")}</Typography>
              <Typography variant="body2" color="text.secondary">{t("play.turnText")}</Typography>
            </Box>
          )}
          {cutOff && (
            <Alert severity="warning" onClose={() => setCutOff(null)}
              sx={{ position: "absolute", top: 72, left: 8, right: 8, zIndex: 2 }}>
              {prefs.developer ? cutOff : t("play.cutOff")}
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
            <Alert severity="info" onClose={() => setFullscreenHint(false)}>{t("play.fullscreenHint")}</Alert>
          </Snackbar>
          <Snackbar
            open={homeScreenHint}
            autoHideDuration={12000}
            onClose={(_event, reason) => reason !== "clickaway" && setHomeScreenHint(false)}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
          >
            <Alert severity="info" onClose={() => setHomeScreenHint(false)}>{t("play.homeScreenHint")}</Alert>
          </Snackbar>
          {/* The box the game will draw in. Before the first frame it holds the
            loader on black; from the first frame on it is the canvas.
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
            }}
          >
            {/* Kept mounted from the first moment: the session is handed this
              canvas before there is anything to put in it.

              Focusable, because it is the input target as well as the
              viewport -- clicking it is the gesture the keyboard and pointer
              path hangs off. Fullscreen is the bar's alone: a double-click is
              a gesture games use, and one that also fills the screen surprises. */}
            <Box
              component="canvas"
              ref={canvasRef}
              tabIndex={0}
              aria-label={gameName || t("play.untitled")}
              draggable={false}
              sx={{
                WebkitUserDrag: "none",
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
            {!pressed && (
              <Box sx={{ position: "absolute", inset: 0, zIndex: 1, display: "flex",
                alignItems: "center", justifyContent: "center" }}>
                <Button variant="contained" onClick={pressStart} startIcon={<Icon name="play" />}>
                  {t("play.pressToStart")}
                </Button>
              </Box>
            )}
            {pressed && !drawn && !over && <Starting state={state} name={gameName} developer={prefs.developer} />}
            {drawn && !over && <BundleWait fetching={state.fetchingBundle === true} />}
            {prefs.developer && <FpsMeter app={controls.current?.app ?? null} active={drawn} />}
          </Box>
          {/* How the run ended, over the whole stage. A crash and an ending are
            the same page with the same ways on; only what is said differs. */}
          {over && (
            <Ended
              name={gameName}
              crashed={crashed}
              stopped={outcome === null}
              outcome={outcome}
              developer={prefs.developer}
              onAgain={handlePlay}
              onReport={bundle ? () => setReporting(true) : null}
              onBack={onClose}
            />
          )}
        </Box>

        {/* The engine is read at the moment the panel renders rather than
            held: a run that has been stopped leaves nothing to poll, and the
            panel says that instead of talking to a disposed graph. */}
        {prefs.developer && (
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
              { label: "Title", value: gameName || "Untitled" },
              { label: "Stage", value: stage + (stage === "exited" ? ` with code ${state.exitCode}` : "") },
              {
                label: "Frame",
                value: state.frame ? `${state.frame.width}×${state.frame.height}` : "nothing presented yet",
              },
              ...(state.hooks ? [{ label: "Hooks", value: state.hooks }] : []),
              // What switched itself off holds for the whole run, so it is a
              // fact about the session rather than a line of the log.
              ...state.off.map((line, at) => ({ label: at === 0 ? "Not running" : "", value: line })),
              ...(state.note ? [{ label: "Last note", value: state.note }] : []),
            ]}
          />
        )}
      </Box>

      {/* The click that captured the mouse, and every click after it, is the
        game's: closing on a click away took the hint down the moment it came
        up. The clock or the cross closes it. */}
      <Snackbar
        open={captureHint}
        onClose={(_event, reason) => reason !== "clickaway" && setCaptureHint(false)}
        autoHideDuration={5000}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Alert severity="info" onClose={() => setCaptureHint(false)}>{t("play.captured")}</Alert>
      </Snackbar>

      {/* Stays until closed: a game that downloads again what it cannot keep
        is slower for it, and the person can free space in Settings. */}
      <Snackbar open={state.storageFull === true} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Alert severity="warning" onClose={() => report({ storageFull: false })}>{t("play.storageFull")}</Alert>
      </Snackbar>

      {state.layerBuild && state.layerBuild.stage !== "done" && stage !== "failed" && (
        <LayerBuild build={state.layerBuild} />
      )}

      {state.messageBox && (
        <MessageBox
          notice={state.messageBox}
          developer={prefs.developer}
          onClose={() => report({ messageBox: null })}
          onAnswer={(button) => controls.current?.answerMessageBox(state.messageBox.id, button)}
        />
      )}

      {helping && <ControlsHelp touch={touch} onClose={() => setHelping(false)} />}
      {rating && bundle && (
        <RateDialog game={{ id: bundle.id, title: bundle.title, store: storeOf(bundle) }}
          onClose={() => setRating(false)} />
      )}
      {reporting && bundle && (
        <ReportDialog game={{ id: bundle.id, title: bundle.title, store: storeOf(bundle) }}
          store={storeOf(bundle) ? knownProviders().find((one) => one.id === storeOf(bundle))?.name
            ?? String(storeOf(bundle)).replace(/^./, (first) => first.toUpperCase())
            : bundle.local ? t("sheet.own") : t("sheet.catalog")}
          details={() => ({ userAgent: navigator.userAgent, outcome, ending: lastEndingReport() })}
          onClose={() => setReporting(false)} />
      )}
    </Box>
  );
}

/**
 * How the keyboard and the mouse reach the game, and how to get them back.
 *
 * @param {{ touch: boolean, onClose: () => void }} props
 */
function ControlsHelp({ touch, onClose }) {
  const t = useT();
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogHead title={t("play.controls")} onClose={onClose} closeLabel={t("button.close")} />
      <DialogContent sx={{ px: 4, pb: 4 }}>
        {(touch ? ["touch", "fullscreen"] : ["mouse", "release", "fullscreen", "leave"]).map((key) => (
          <Typography key={key} sx={{ mb: 1.5 }}>{t(`play.help.${key}`)}</Typography>
        ))}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A round button of the bar.
 *
 * @param {Object} props
 * @param {string} props.label
 * @param {Parameters<typeof Icon>[0]["name"]} props.icon
 * @param {boolean} [props.disabled]
 * @param {(event: import("react").MouseEvent<HTMLButtonElement>) => void} props.onClick
 */
function BarButton({ label, icon, disabled = false, onClick }) {
  return (
    <Tooltip title={label} disableInteractive>
      <span>
        <IconButton aria-label={label} disabled={disabled} onClick={onClick}>
          <Icon name={icon} size={16} />
        </IconButton>
      </span>
    </Tooltip>
  );
}

/**
 * A runtime the bottle needs, built in this browser before it starts: once,
 * for every bottle that needs it. Nothing to press; a page closed meanwhile
 * goes on from the stage it stopped at.
 *
 * @param {{ build: import("../engine/layer-build.js").BuildReport }} props
 */
function LayerBuild({ build }) {
  const t = useT();
  const measured = build.progress && build.progress.total > 0;
  return (
    <Dialog open fullWidth maxWidth="sm">
      <DialogHead title={t("play.dotnet")} subtitle={t("play.dotnetText")} />
      <DialogContent sx={{ px: 4, pb: 4 }}>
        <Typography>
          {t(`play.build.${build.stage}`)}
          {build.steps ? ` (${build.step} / ${build.steps})` : ""}
        </Typography>
        <LinearProgress
          variant={measured ? "determinate" : "indeterminate"}
          value={measured ? Math.min(100, (100 * build.progress.read) / build.progress.total) : 0}
          sx={{ my: 1.5, height: 6, borderRadius: 3, bgcolor: INK.raised,
            "& .MuiLinearProgress-bar": { bgcolor: INK.text } }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
          {build.detail}
        </Typography>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the program itself said, with the buttons it asked for; in developer
 * mode, the guest backtrace taken at the call too.
 *
 * The program is parked inside MessageBox until one of these is pressed, so
 * this is the whole of the conversation: the labelled button the person clicks
 * is the id the call returns. The default button is the one focused, and
 * Escape answers Cancel where the box has one -- which is what the dialog
 * manager would have done.
 *
 * @param {Object} props
 * @param {{ id: number, text: string, caption: string, type: number,
 *           buttons: { id: number, label: string }[], defaultButton: number,
 *           icon: string | null, trace: string | null }} props.notice
 * @param {boolean} props.developer
 * @param {() => void} props.onClose     Dismisses a notice nothing is waiting on.
 * @param {(button: number) => void} [props.onAnswer]
 *        Hands the engine the id of the button pressed.
 */
function MessageBox({ notice, developer, onClose, onAnswer }) {
  const t = useT();
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
  const answer = (/** @type {number} */ id) => (onAnswer ? onAnswer(id) : onClose());
  return (
    <Dialog open fullWidth maxWidth="md" onClose={dismiss}>
      <DialogHead title={notice.caption || t("play.programSays")} />
      <DialogContent sx={{ px: 4 }}>
        <Typography sx={{ whiteSpace: "pre-wrap" }}>{notice.text}</Typography>
        {developer && notice.trace && (
          <Box component="pre" sx={{ mt: 2, p: 2, maxHeight: "40vh", overflow: "auto", bgcolor: INK.ground,
            border: "1px solid", borderColor: "divider", borderRadius: "9px", fontSize: 12,
            color: "text.secondary", whiteSpace: "pre" }}>
            {notice.trace}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 4 }}>
        {developer && notice.trace && (
          <Button sx={{ mr: "auto" }} onClick={() => navigator.clipboard?.writeText(notice.trace ?? "")}>
            Copy trace
          </Button>
        )}
        {buttons.length > 0 ? (
          buttons.map((button) => (
            <Button
              key={button.id}
              autoFocus={button.id === notice.defaultButton}
              variant={button.id === notice.defaultButton ? "contained" : "outlined"}
              onClick={() => answer(button.id)}
            >
              {button.label}
            </Button>
          ))
        ) : (
          <Button variant="contained" onClick={onClose}>{t("button.close")}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** How long a wait on the bundle lasts before it is shown: shorter ones would only flicker. */
const BUNDLE_WAIT_SHOWN_MS = 300;

/**
 * A spinner in a corner of the picture while the game waits on a part of its
 * bundle still coming over the network, so a stall reads as the download and
 * not as the game hanging. It takes no input.
 *
 * @param {Object} props
 * @param {boolean} props.fetching
 */
function BundleWait({ fetching }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!fetching) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(true), BUNDLE_WAIT_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [fetching]);
  if (!shown) return null;
  return (
    <Box
      role="status"
      sx={{
        position: "absolute", bottom: 12, right: 12, zIndex: 2, pointerEvents: "none",
        display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 0.75,
        borderRadius: "9px", bgcolor: "rgba(0,0,0,0.6)", color: "#fff",
      }}
    >
      <CircularProgress size={16} thickness={5} color="inherit" />
      <Typography variant="caption">{t("play.loadingData")}</Typography>
    </Box>
  );
}

/**
 * What the person is waiting on, over the picture the game will draw into: the
 * logo, the game's name, a bar where the launch has a number to move it, and
 * the stage in a word. A developer is also told what the engine is doing, how
 * long it has taken, and what the first frame took on this machine before.
 *
 * @param {Object} props
 * @param {any} props.state
 * @param {string} props.name
 * @param {boolean} props.developer
 */
function Starting({ state, name, developer }) {
  const t = useT();
  const stage = state.stage in STAGE_TEXT ? state.stage : "fetch";
  const progress = state.progress && state.progress.total > 0 ? state.progress : null;
  const usual = state.usual;
  return (
    <Box sx={{ position: "absolute", inset: 0, zIndex: 1, display: "grid", placeContent: "center",
      textAlign: "center", gap: 2, p: 3, overflow: "auto", bgcolor: "#000" }}>
      <Box component="img" src={logo} alt="" sx={{ height: 72, mx: "auto" }} />
      <Typography sx={{ fontSize: 17, fontWeight: 600 }}>{name}</Typography>
      <LinearProgress
        variant={progress ? "determinate" : "indeterminate"}
        value={progress ? Math.min(100, (progress.read / progress.total) * 100) : 0}
        sx={{ width: 280, mx: "auto", height: 6, borderRadius: 3, bgcolor: INK.raised,
          "& .MuiLinearProgress-bar": { bgcolor: INK.text } }}
      />
      <Typography variant="body2" color="text.secondary">{t(`play.stage.${stage}`)}</Typography>
      {developer && (
        <Box sx={{ maxWidth: 520, color: "text.secondary", fontSize: 12 }}>
          <div>{state.detail || STAGE_TEXT[stage]}</div>
          {progress && <div>{progress.label} — {Math.round((progress.read / progress.total) * 100)}%</div>}
          {state.elapsed !== undefined && <div>{state.elapsed.toFixed(1)} s elapsed</div>}
          {state.stage === "loading" && (
            <div>
              {usual
                ? (usual.high - usual.low < 1
                  ? `First frame usually takes about ${seconds(usual.high)} s on a warm store.`
                  : `First frame usually takes ${seconds(usual.low)}–${seconds(usual.high)} s on a warm store.`)
                : "Its first frame has not been timed on this machine yet, so this launch is recording it."}
            </div>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * A duration in seconds: whole above ten, a tenth below, where the difference
 * between eight and ten is the one that matters.
 *
 * @param {number} value
 */
function seconds(value) {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/**
 * How the run ended, over the stage: the game closed on an error, or by
 * itself, or was stopped. Its saves are where they were; the ways on are the
 * same in every case. In developer mode, the engine's own account of it.
 *
 * @param {Object} props
 * @param {string} props.name
 * @param {boolean} props.crashed
 * @param {boolean} props.stopped  Stopped by the person, with nothing to say.
 * @param {{ reason: string, message: string, trace: string } | null} props.outcome
 * @param {boolean} props.developer
 * @param {() => void} props.onAgain
 * @param {(() => void) | null} props.onReport
 * @param {() => void} props.onBack
 */
function Ended({ name, crashed, stopped, outcome, developer, onAgain, onReport, onBack }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // The whole account rather than the dump alone: the reason and the message
  // say what went wrong, which registers and a stack do not.
  const account = outcome ? [outcome.reason, outcome.message, outcome.trace].filter(Boolean).join("\n\n") : "";
  return (
    <Box sx={{ position: "absolute", inset: 0, zIndex: 3, overflow: "auto", bgcolor: INK.ground }}>
      <Box sx={{ maxWidth: 640, mx: "auto", mt: "12vh", px: 3, pb: 4 }}>
        {crashed && <StatusText status="fails" dot strong>{t("play.crashed")}</StatusText>}
        <Typography component="h1" sx={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em",
          mt: 2, mb: 1.25 }}>
          {stopped ? t("play.stoppedTitle", { name }) : t("play.closedTitle", { name })}
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: "60ch" }}>
          {crashed ? t("play.crashedText") : t("play.closedText")}
        </Typography>
        <Box sx={{ display: "flex", gap: 1.25, flexWrap: "wrap", mt: 3 }}>
          <Button variant="contained" onClick={onAgain}>{t("play.again")}</Button>
          {crashed && onReport && <Button onClick={onReport}>{t("report.title")}</Button>}
          <Button onClick={onBack}>{t("play.toLibrary")}</Button>
        </Box>
        {developer && account && (
          <Box sx={{ mt: 4 }}>
            <Box sx={{ display: "flex", gap: 1.25 }}>
              <Button onClick={() => setOpen((on) => !on)}>{open ? "Hide trace" : "Show trace"}</Button>
              <Button onClick={() => navigator.clipboard?.writeText(account)}>Copy report</Button>
            </Box>
            {open && (
              <Box component="pre" sx={{ mt: 2, p: 2, maxHeight: "40vh", overflow: "auto", bgcolor: "#101113",
                border: "1px solid", borderColor: "divider", borderRadius: "9px", fontSize: 12,
                color: "text.secondary", whiteSpace: "pre-wrap" }}>
                {account}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
