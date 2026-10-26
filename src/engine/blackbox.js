/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * What a run was doing when the browser took the page away.
 *
 * A tab the system kills for its memory -- Safari on a phone does, past a
 * limit the page is never told -- dies without an event, a log line or a
 * report: the page simply loads again. So a run writes down where it is as it
 * goes, and a run that never wrote its end is one that was cut off; the next
 * visit to the same game says how far it got.
 */

const KEY = "bottlify.run-in-progress";

/**
 * @typedef {Object} RunRecord
 * @property {string} id        The bottle.
 * @property {string} title
 * @property {number} startedAt Wall-clock milliseconds.
 * @property {number} elapsed   Seconds since the launch began, when last written.
 * @property {string} stage     The launch's stage then (`SessionReport.stage`).
 * @property {number} [frames]  Frames presented by then, when the run had drawn.
 * @property {number} [instructions] Guest instructions retired by then.
 * @property {string} [detail]  The last line the run showed about itself.
 * @property {string} [memory]  What the run held by its own account when last written.
 * @property {string} [query]   The page's address switches, `?graphicsWorker=off` and the like.
 */

/**
 * @param {Pick<Storage, "getItem">} storage
 * @returns {RunRecord | null}
 */
function read(storage) {
  try {
    const record = JSON.parse(storage.getItem(KEY) ?? "null");
    return record && typeof record.id === "string" && Number.isFinite(record.elapsed)
      ? record : null;
  } catch {
    return null;
  }
}

/**
 * Writes where the run is now, over what was written before.
 *
 * @param {Pick<Storage, "setItem">} storage
 * @param {RunRecord} record
 */
export function noteRun(storage, record) {
  try {
    storage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Nowhere to write: a cut-off run then goes unnoticed, as before.
  }
}

/**
 * The run ended in a way the page saw -- stopped, exited, failed, closed --
 * so there is nothing to report on the next visit.
 *
 * @param {Pick<Storage, "removeItem">} storage
 */
export function endRun(storage) {
  try {
    storage.removeItem(KEY);
  } catch {
    // As above.
  }
}

/**
 * The record of a run of this bottle that never wrote its end, taken off the
 * store so it is told once; null when the last run ended as runs do.
 *
 * @param {Pick<Storage, "getItem" | "removeItem">} storage
 * @param {string} id
 * @returns {RunRecord | null}
 */
export function takeCutOffRun(storage, id) {
  const record = read(storage);
  if (!record || record.id !== id) return null;
  endRun(storage);
  return record;
}

/**
 * The sentence a person reads about a run that was cut off.
 *
 * @param {RunRecord} record
 * @returns {string}
 */
export function describeCutOff(record) {
  const parts = [`${record.elapsed.toFixed(1)} s in`];
  if (record.frames) {
    parts.push(`${record.frames.toLocaleString("en-US")} frames drawn`);
  } else {
    parts.push(`while ${record.stage === "running" ? "running" : `at "${record.stage}"`}, no frame drawn yet`);
  }
  if (record.instructions) {
    parts.push(`${(record.instructions / 1e9).toFixed(2)} billion guest instructions`);
  }
  return `The last start of this game ended without a word from the browser: ${parts.join(", ")}`
    + `${record.query ? `, run as ${record.query}` : ""}.`
    + `${record.detail ? ` Its last line: ${record.detail}.` : ""}`
    + `${record.memory ? ` It held: ${record.memory}.` : ""}`;
}
