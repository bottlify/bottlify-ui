// Copyright © 2026 Bottlify Project
// Licensed under the Mozilla Public License, version 2.0
// See LICENSE for details

/**
 * The speaker over the last ten seconds, from samples of its counters
 * (`readSoundTable`) taken on the page's animation frames: what share of the
 * last second it played silence for want of sound, and how many of the
 * samples found a gap - each gap a crackle a person hears.
 *
 * @param {{ at: number, starvedFrames: number }[]} samples  oldest first, `at` in ms
 * @param {number} rate  the device's frames a second
 * @returns {{ silentShare: number | null, gaps: number }}
 *     silentShare from 0 to 1, null with less than a second to go by
 */
export function soundStats(samples, rate){
  let gaps = 0;
  for (let n = 1; n < samples.length; n++)
  {
    if (samples[n].starvedFrames > samples[n - 1].starvedFrames) gaps++;
  }
  const newest = samples.at(-1);
  const second = newest ? samples.find((sample) => sample.at >= newest.at - 1000) : undefined;
  if (!newest || !second || rate <= 0 || newest.at - samples[0].at < 1000) return { silentShare: null, gaps };
  const played = (newest.at - second.at) / 1000 * rate;
  return {
    silentShare: played > 0 ? Math.min(1, (newest.starvedFrames - second.starvedFrames) / played) : null,
    gaps,
  };
}
