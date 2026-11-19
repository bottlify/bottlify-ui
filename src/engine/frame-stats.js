// Copyright © 2026 Bottlify Project
// Licensed under the Mozilla Public License, version 2.0
// See LICENSE for details

/**
 * What the fps meter says of the frames' times (milliseconds, oldest first,
 * the last ten seconds of them).
 *
 * - `fps`: frames in the last second of the run, by the newest frame's time.
 * - `frameMs`: the mean gap between frames over that second.
 * - `low1`: the 1% low - frames a second of the slowest hundredth of the gaps.
 * - `worstMs`: the longest gap.
 * - `drops`: gaps more than twice the median.
 * - `stalledMs`: how long the page has waited since the last new frame; a
 *   run that stopped presenting has no newest frame to count back from.
 *
 * @param {number[]} times @param {number} stalledMs
 */
export function frameStats(times, stalledMs) {
  const gaps = times.slice(1).map((at, n) => at - times[n]);
  if (gaps.length === 0) {
    return { fps: 0, frameMs: null, low1: null, worstMs: null, drops: 0, stalledMs };
  }
  const newest = times.at(-1);
  const lastSecond = times.filter((at) => at > newest - 1000);
  const recent = gaps.slice(-Math.max(lastSecond.length - 1, 1));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const slowest = sorted.slice(-Math.max(1, Math.ceil(sorted.length / 100)));
  const slowMean = slowest.reduce((sum, gap) => sum + gap, 0) / slowest.length;
  return {
    fps: lastSecond.length,
    frameMs: recent.reduce((sum, gap) => sum + gap, 0) / recent.length,
    low1: slowMean > 0 ? 1000 / slowMean : null,
    worstMs: sorted.at(-1),
    drops: gaps.filter((gap) => gap > median * 2).length,
    stalledMs,
  };
}
