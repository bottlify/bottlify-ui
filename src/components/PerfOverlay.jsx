/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { overlayRows, smoothRows, tabMemoryOf } from "../engine/overlay.js";
import { CHANGED, loadSettings, saveSettings } from "../settings.js";

/**
 * How often the overlay reads the engine while it is on; `?overlayMs=250` on
 * the launcher's address reads it more often, for a finer series.
 */
const POLL_MS = Math.max(100, Number(new URLSearchParams(window.location.search).get("overlayMs"))
  || 1000);

/** How many of the overlay's looks the page keeps (`window.bottlifyOverlaySeries`). */
const SERIES_KEPT = 3600;

/**
 * How often the tab's memory is measured: the browser answers at its next
 * garbage collection, seconds later at times, and allows it only to a page
 * isolated across origins (which this launcher always is).
 */
const TAB_MEMORY_MS = 10000;

/**
 * fps, guest code speed and what the frame is made of, over the corner of the
 * canvas -- off by default, and costing nothing at all while it is off: no
 * listener beyond the one key that turns it on reads the engine, and no timer
 * runs. Toggled by F3 (a key no title in this tree binds) and by the switch in
 * the settings panel; both write the same stored setting, so either one turns
 * the other's next look on.
 *
 * `app.diagnostics()` with no layer name costs the same as asking for one --
 * the engine always builds every layer's table first and filters afterwards
 * (`src/host/serve.js`) -- so one such call a second reads `cpu`, `graphics`,
 * `log` and `bridge` together rather than four times over. That is also the
 * only way to read `graphics` and `bridge` at all: neither publishes a table
 * of its own yet (`docs/core/host.md` §"What became asynchronous, and why"),
 * so a request to the engine's thread is the sole path to them. At the once-a-
 * second rate this polls, that is a fraction the profile below has a number
 * for: measured at a 20 ms rate, this same call was 6-12% of a frame; a
 * cadence fifty times slower is a cadence fifty times cheaper.
 *
 * @param {Object} props
 * @param {any} props.app        The running engine, or null.
 * @param {boolean} props.active Whether the canvas has a frame on it -- the
 *        overlay reads nothing and shows nothing before the first one.
 * @param {any} [props.symbols]  This bundle's own `symbols.json`
 *        (`session.js`'s own `symbols`), for naming the "guest code" block's
 *        functions rather than their bare `image+0xrva`. Undefined for a
 *        bundle that carries none.
 */
export function PerfOverlay({ app, active, symbols }) {
  const [on, setOn] = useState(() => loadSettings().overlayOn);
  useEffect(() => {
    const sync = () => setOn(loadSettings().overlayOn);
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);

  // F3 is read here rather than in the session or the input layer: it is a
  // page-side switch over what the page shows, never something the guest is
  // asked about, and it must work whether or not the overlay is currently on.
  // A Mac keyboard gives F3 to Mission Control unless fn is held, so the same
  // switch also answers Ctrl/Cmd+Shift+P, which no title here binds either.
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      const chord = (event.ctrlKey || event.metaKey) && event.shiftKey
        && event.key.toLowerCase() === "p";
      if (event.key === "F3" || chord) {
        if (chord) event.preventDefault();
        saveSettings({ overlayOn: !loadSettings().overlayOn });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const [rows, setRows] = useState(/** @type {import("../engine/overlay.js").OverlayRows | null} */ (null));
  const previous = useRef(/** @type {{ layers: any[], at: number } | null} */ (null));
  const [tab, setTab] = useState(/** @type {ReturnType<typeof tabMemoryOf>} */ (null));
  const tabNow = useRef(tab);

  useEffect(() => {
    const measure = /** @type {any} */ (performance).measureUserAgentSpecificMemory;
    if (!on || !active || typeof measure !== "function" || !window.crossOriginIsolated) {
      setTab(null);
      tabNow.current = null;
      return undefined;
    }
    let cancelled = false;
    let timer = 0;
    const look = async () => {
      try {
        const measured = tabMemoryOf(await measure.call(performance));
        if (cancelled) return;
        tabNow.current = measured;
        setTab(measured);
      } catch (error) {
        console.error("tab memory not measured:", error);
      }
      if (!cancelled) timer = setTimeout(look, TAB_MEMORY_MS);
    };
    look();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [on, active]);

  useEffect(() => {
    if (!on || !active || !app) {
      previous.current = null;
      setRows(null);
      return undefined;
    }
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const layers = await app.diagnostics();
        const at = performance.now();
        if (cancelled) return;
        const fresh = overlayRows(
          previous.current?.layers ?? null, layers, at - (previous.current?.at ?? at), symbols,
        );
        // Every look as it was taken, unsmoothed, for a tool to chart a stretch
        // of play (`tools/frame-series.mjs` in the engine's repository): one
        // frame or one look varies by a quarter, a series shows what a scene costs.
        if (fresh) {
          const page = /** @type {any} */ (window);
          const series = (page.bottlifyOverlaySeries ??= []);
          const heap = /** @type {any} */ (performance).memory?.usedJSHeapSize;
          const look = {
            at: Date.now(), ...fresh, tabMemory: tabNow.current,
            pageHeapMB: typeof heap === "number" ? heap / (1 << 20) : null,
          };
          series.push(look);
          // A recorder outside the page (`tools/cdp_test/live/series-record.mjs`)
          // binds this and keeps every look on disk, past the page's own death.
          if (typeof page.bottlifySeriesSink === "function") page.bottlifySeriesSink(JSON.stringify(look));
          if (series.length > SERIES_KEPT) series.splice(0, series.length - SERIES_KEPT);
        }
        setRows((shown) => {
          if (!fresh) return shown;
          if (!shown) return fresh;
          return {
            ...fresh,
            budget: smoothRows(shown.budget, fresh.budget, ["ms"], 6),
            phases: smoothRows(shown.phases, fresh.phases, ["ms"], 8),
            hooks: fresh.hooks && {
              msPerFrame: fresh.hooks.msPerFrame,
              top: smoothRows(shown.hooks?.top ?? [], fresh.hooks.top, ["ms", "calls"], 6),
            },
            guestCode: smoothRows(
              shown.guestCode, fresh.guestCode, ["share", "instructionsPerSecond", "ms"], 8,
            ),
            threads: smoothRows(shown.threads, fresh.threads, ["share", "instructionsPerSecond"], 6),
          };
        });
        previous.current = { layers, at };
        timer = setTimeout(tick, POLL_MS);
      } catch (error) {
        // The engine is gone (disposed, or never started this deep): nothing
        // left worth polling, and a stale number is worse than none. Said in
        // the console, since a layer whose diagnostics throw looks the same.
        console.error("performance overlay stopped:", error);
        if (!cancelled) setRows(null);
      }
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [on, active, app, symbols]);

  if (!on || !rows) return null;

  return (
    <Box
      sx={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 2,
        px: 1.25,
        py: 1,
        minWidth: 190,
        // A corner of the picture, not a page over it: a long row is cut, not
        // a reason for the box to cross the canvas.
        maxWidth: "min(360px, 45%)",
        bgcolor: "rgba(20,21,23,0.72)",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        pointerEvents: "none",
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        fontSize: 11,
        lineHeight: 1.4,
        color: "text.primary",
      }}
    >
      <Row label="fps" value={`${rows.fps.toFixed(0)} (${rows.frameMs?.toFixed(1) ?? "—"} ms)`} />
      <Row
        label="speed"
        value={`${(rows.instructionsPerSecond / 1e6).toFixed(1)} Mips`
          + ` (${rows.nsPerInstruction === null ? "—" : rows.nsPerInstruction.toFixed(0)} ns/i)`}
      />
      <Row label="GPU, ms per frame" value={rows.gpuMs === null ? "not measured" : rows.gpuMs.toFixed(1)} />
      <Row label="draws" value={rows.drawsPerFrame.toFixed(0)} />
      <Row
        label="memory, MiB"
        value={`tab ${tab ? tab.totalMB.toFixed(0) : "not measured"} · guest ${rows.guestMappedMB.toFixed(0)}`}
      />
      {tab && tab.top.length > 0 && (
        <Row label="  by" value={tab.top.slice(0, 3).map((part) => `${part.name} ${part.mb.toFixed(0)}`).join(" · ")} />
      )}
      {rows.shownBy.length > 0 && (
        <Row label="on the canvas" value={rows.shownBy.map((row) => `${row.name} ${row.count}`).join(" · ")} />
      )}
      {rows.lastFrame && <Row label="last frame" value={rows.lastFrame} />}
      {rows.hooks && (
        <Row label="hooks" value={`${rows.hooks.msPerFrame.toFixed(2)} ms/frame`} />
      )}
      {rows.budget.length > 0 && rows.frameMs !== null && (
        <Box sx={{ mt: 0.5, opacity: 0.85 }}>
          <Row label="the frame, ms" value={rows.frameMs.toFixed(1)} />
          {rows.budget.map((row) => (
            <Row key={row.name} label={row.name} value={row.ms.toFixed(1)} bar={(row.ms / (rows.frameMs ?? 1)) * 100} />
          ))}
        </Box>
      )}
      <Row
        label="not in any phase, ms"
        value={rows.notInPhaseMs === null ? "not measured" : rows.notInPhaseMs.toFixed(1)}
        bar={rows.notInPhaseMs === null ? undefined : (rows.notInPhaseMs / (rows.frameMs ?? 1)) * 100}
      />
      {rows.phases.length > 0 && rows.frameMs !== null && (
        <Box sx={{ mt: 0.5, opacity: 0.85 }}>
          <Row label="host calls by function, ms" value="" />
          {rows.phases.map((phase) => (
            <Row key={phase.name} label={phase.name} value={phase.ms.toFixed(2)} bar={(phase.ms / (rows.frameMs ?? 1)) * 100} />
          ))}
        </Box>
      )}
      {rows.phases.length === 0 && rows.budget.length > 0 && (
        <Box sx={{ mt: 0.5, opacity: 0.6 }}>
          <Row label="(settings → Profile host calls splits them)" value="" />
        </Box>
      )}
      {rows.hooks && rows.hooks.top.length > 0 && (
        <Box sx={{ mt: 0.5, opacity: 0.85 }}>
          <Row label="kernels (share of the second · calls/s)" value="" />
          {rows.hooks.top.map((hook) => (
            <Row key={hook.name} label={hook.name} value={`${(hook.ms / 10).toFixed(2)}% · ${hook.calls.toFixed(0)}`} bar={hook.ms / 10} />
          ))}
        </Box>
      )}
      {rows.guestCode.length > 0 && (
        <Box sx={{ mt: 0.5, opacity: 0.85 }}>
          <Row label="guest code, last second" value="" />
          {rows.guestCode.slice(0, 5).map((row) => (
            <Row
              key={row.name}
              // A module by its file name: its folder is the game's install path.
              label={row.name.replace(/^.*[\\/]/, "")}
              value={`${row.share.toFixed(0)}% · ${(row.instructionsPerSecond / 1e6).toFixed(1)}M/s · ${row.ms.toFixed(1)}ms`}
              bar={row.share}
            />
          ))}
        </Box>
      )}
      {rows.threads.length > 0 && (
        <Box sx={{ mt: 0.5, opacity: 0.85 }}>
          <Row
            label="guest threads, last second"
            value={rows.parallelBound === null ? "" : `parallel ×${rows.parallelBound.toFixed(2)}`}
          />
          {rows.threads.slice(0, 5).map((thread) => (
            <Row
              key={thread.name}
              label={`${thread.name} (${thread.state})`}
              value={`${thread.share.toFixed(0)}% · ${(thread.instructionsPerSecond / 1e6).toFixed(1)}M/s`}
              bar={thread.share}
            />
          ))}
        </Box>
      )}
      {rows.entryWork.length > 0 && rows.frameMs !== null && (
        <Box sx={{ mt: 0.5, opacity: 0.85 }}>
          <Row label="Direct3D entry by part, ms" value="" />
          {rows.entryWork.map((row) => (
            <Row key={row.name} label={row.name} value={row.ms.toFixed(2)} bar={(row.ms / (rows.frameMs ?? 1)) * 100} />
          ))}
        </Box>
      )}
      <Box sx={{ mt: 0.5, opacity: rows.worker ? 0.85 : 0.6 }}>
        {rows.worker ? (
          <>
            <Row label="graphics worker, ms" value={`${rows.worker.batchesPerSecond.toFixed(0)} batches/s`} />
            <Row label="batch-read" value={rows.worker.readMs === null ? "not measured" : rows.worker.readMs.toFixed(2)} />
            <Row label="batch-sweep" value={rows.worker.sweepMs === null ? "not measured" : rows.worker.sweepMs.toFixed(2)} />
          </>
        ) : (
          <Row label="graphics worker: not measured" value="" />
        )}
      </Box>
    </Box>
  );
}

/**
 * @param {Object} props @param {string} props.label @param {string} props.value
 * @param {number} [props.bar]  A percent to draw as a faint bar under the row.
 */
function Row({ label, value, bar }) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "space-between",
        gap: 1.5,
        position: "relative",
        ...(bar !== undefined && {
          backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.10) ${Math.min(100, bar)}%, transparent ${Math.min(100, bar)}%)`,
        }),
      }}
    >
      <Typography component="span" variant="inherit" sx={{ color: "text.secondary", minWidth: 0 }} noWrap>
        {label}
      </Typography>
      <Typography component="span" variant="inherit" sx={{ minWidth: 0, flexShrink: 0, maxWidth: "75%" }}
        noWrap>
        {value}
      </Typography>
    </Box>
  );
}
