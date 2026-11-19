// Copyright © 2026 Bottlify Project
// Licensed under the Mozilla Public License, version 2.0
// See LICENSE for details

import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { readFrameClock } from "@bottlify/core/frame-clock";
import { CHANGED, loadSettings, saveSettings } from "../settings.js";
import { frameStats } from "../engine/frame-stats.js";

/** How much of the run the wave shows, in milliseconds. */
const SPAN_MS = 10000;
const WIDTH = 240;
const HEIGHT = 64;

/**
 * Frames a second and the wave of every frame's time over the last ten
 * seconds, in the corner of the canvas: a drop is a spike, a stall a gap.
 *
 * Read straight from the engine's frame clock (`@bottlify/core/frame-clock`):
 * the engine writes each frame's time as it reaches the canvas, every API and
 * path alike, and this reads the shared buffer on the page's own animation
 * frames - no request to the engine, no profiler. Off by default and reading
 * nothing while off; F3 (or Ctrl/Cmd+Shift+P, F3 being Mission Control's on a
 * Mac) and the switch in the settings both toggle it.
 *
 * @param {Object} props
 * @param {any} props.app        The running engine, or null.
 * @param {boolean} props.active Whether the canvas has a frame on it.
 */
export function FpsMeter({ app, active }) {
  const [on, setOn] = useState(() => loadSettings().overlayOn);
  useEffect(() => {
    const sync = () => setOn(loadSettings().overlayOn);
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);

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

  const wave = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const [stats, setStats] = useState(/** @type {ReturnType<typeof frameStats> | null} */ (null));
  const [failed, setFailed] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    if (!on || !active || !app?.frameClock) {
      setStats(null);
      return undefined;
    }
    let cancelled = false;
    let raf = 0;
    /** @type {number[]} */
    let times = [];
    let seen = 0;
    let lastNew = performance.now();
    let shownAt = 0;
    const step = (buffer) => {
      if (cancelled) return;
      const read = readFrameClock(buffer, seen);
      if (read.count !== seen) {
        times = times.concat(read.times);
        seen = read.count;
        lastNew = performance.now();
      }
      const newest = times.at(-1) ?? 0;
      times = times.filter((at) => at > newest - SPAN_MS);
      const pageNow = performance.now();
      // A quarter of a second between redraws of the numbers: the wave is
      // drawn on every animation frame, the text would only flicker.
      if (pageNow - shownAt > 250) {
        shownAt = pageNow;
        setStats(frameStats(times, pageNow - lastNew));
      }
      drawWave(wave.current, times);
      raf = requestAnimationFrame(() => step(buffer));
    };
    Promise.resolve(app.frameClock()).then((buffer) => {
      if (cancelled) return;
      if (!(buffer instanceof SharedArrayBuffer)) {
        setFailed("not measured: the engine shares no frame clock with this page");
        return;
      }
      setFailed(null);
      step(buffer);
    }, (error) => setFailed(`not measured: ${error?.message ?? error}`));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [on, active, app]);

  if (!on || !active) return null;
  return (
    <Box
      sx={{
        position: "absolute", top: 10, right: 10, zIndex: 2, p: 1,
        bgcolor: "rgba(20,21,23,0.72)", border: "1px solid", borderColor: "divider",
        borderRadius: 1, pointerEvents: "none", color: "text.primary",
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 11, lineHeight: 1.4,
      }}
    >
      {failed && <div>{failed}</div>}
      {!failed && stats && (
        <>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {stats.stalledMs > 1000 ? `0 fps · no frame for ${(stats.stalledMs / 1000).toFixed(1)} s`
              : `${stats.fps.toFixed(0)} fps · ${stats.frameMs === null ? "—" : stats.frameMs.toFixed(1)} ms`}
          </div>
          <div>
            {`1% low ${stats.low1 === null ? "—" : stats.low1.toFixed(0)} · worst ${
              stats.worstMs === null ? "—" : stats.worstMs.toFixed(0)} ms · drops ${stats.drops} in 10 s`}
          </div>
        </>
      )}
      <canvas ref={wave} width={WIDTH} height={HEIGHT} style={{ display: "block", marginTop: 4, width: WIDTH, height: HEIGHT }} />
    </Box>
  );
}

/**
 * Every frame's time as a bar at its moment, over the last ten seconds:
 * guides at 60 and 30 fps, a frame more than twice the median in red.
 *
 * @param {HTMLCanvasElement | null} canvas @param {number[]} times
 */
function drawWave(canvas, times) {
  const context = canvas?.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  const gaps = times.slice(1).map((at, n) => at - times[n]);
  const top = Math.max(50, ...gaps);
  const y = (ms) => HEIGHT - (Math.min(ms, top) / top) * HEIGHT;
  context.strokeStyle = "rgba(255,255,255,0.25)";
  for (const guide of [1000 / 60, 1000 / 30]) {
    context.beginPath();
    context.moveTo(0, y(guide));
    context.lineTo(WIDTH, y(guide));
    context.stroke();
  }
  if (gaps.length === 0) return;
  const median = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
  const newest = times.at(-1);
  for (let n = 0; n < gaps.length; n++) {
    const x = WIDTH - ((newest - times[n + 1]) / SPAN_MS) * WIDTH;
    context.fillStyle = gaps[n] > median * 2 ? "#ff5a52" : "#7fd67f";
    context.fillRect(Math.floor(x) - 1, y(gaps[n]), 2, HEIGHT - y(gaps[n]));
  }
}
