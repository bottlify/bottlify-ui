/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The journal, as text: the same line the Logs panel prints for a record, and
 * the report the "Download report" button (`SettingsDrawer.jsx`) saves -- every
 * record the ring holds, whatever areas are switched on, with every layer's
 * diagnostics. Framework-free and pure, so it is tested without a browser.
 */

/**
 * One journal record as the Logs panel prints it.
 *
 * @param {{ time: number, levelName: string, category: string, text: string }} record
 * @returns {string}
 */
export function journalLine(record) {
  return `${(record.time / 1000).toFixed(3)} ${record.levelName.slice(0, 4).padEnd(4)}`
    + ` ${record.category} ${record.text}`;
}

/**
 * @param {string} bundleId
 * @param {Date} [at]
 * @returns {string}
 */
export function journalFilename(bundleId, at = new Date()) {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `${bundleId}-journal-${stamp}.txt`;
}

/**
 * Everything a run can say about itself, as one value for one file: a header
 * of the run, the engine's own account (`app.report()`: every layer's
 * diagnostics, the phase profile, the frames, the trace, the threads and the
 * guest's hottest code) with the layers by name, and the journal's lines. One
 * button and one file, so a report of a run never lacks the part that would
 * have explained it.
 *
 * @param {{ time: number, levelName: string, category: string, text: string }[]} records
 * @param {{ diagnostics: { name: string }[] } & Record<string, unknown>} engine
 *        `app.report()`'s answer, or `{ diagnostics }` from an engine without one
 * @param {{ bundleId: string, presents: number, drawsPerFrame: number, at?: Date,
 *     userAgent?: string }} run
 */
export function buildReport(records, engine, { bundleId, presents, drawsPerFrame,
  at = new Date(), userAgent = "" }) {
  const { diagnostics, ...rest } = engine;
  return {
    bundleId,
    at: at.toISOString(),
    userAgent,
    presents,
    drawsPerFrame: Math.round(drawsPerFrame * 10) / 10,
    layers: Object.fromEntries(diagnostics.map((layer) => [layer.name, layer])),
    ...rest,
    journal: records.map(journalLine),
  };
}

/**
 * @param {string} bundleId
 * @param {Date} [at]
 * @returns {string}
 */
export function reportFilename(bundleId, at = new Date()) {
  return journalFilename(bundleId, at).replace("-journal-", "-report-").replace(/\.txt$/, ".json");
}

/**
 * A promise's value, or `fallback(reason)` once it fails or `ms` pass without
 * an answer: a part of a report a worker that died never sends is said to be
 * missing rather than holding the whole report back.
 *
 * @template T
 * @param {Promise<T>} promise @param {number} ms
 * @param {(reason: string) => T} fallback
 * @returns {Promise<T>}
 */
export function within(promise, ms, fallback) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([
    Promise.resolve(promise).catch((e) => fallback(e?.message ?? String(e))),
    late,
  ]).finally(() => clearTimeout(timer));
}

/**
 * The parts of a report, each asked of the engine on its own and each
 * answered within `ms` -- what a part never answered says why in `missing`.
 *
 * @param {any} app @param {number} capacity  the journal records asked for
 * @param {number} [ms]
 */
export async function reportParts(app, capacity, ms = 4000) {
  /** @type {Record<string, string>} */
  const missing = {};
  /** @param {string} part */
  const noted = (part) => (/** @type {string} */ reason) => {
    missing[part] = reason;
    return null;
  };
  const [records, presented, report] = await Promise.all([
    within(app.log.recent(capacity), ms, noted("journal")),
    within(app.presented(), ms, noted("presented")),
    // An engine from before report() answers with its layers alone.
    within(typeof app.report === "function" ? app.report()
      : app.diagnostics().then((/** @type {any[]} */ diagnostics) => ({ diagnostics })),
    ms, noted("engine")),
  ]);
  return { records, presented, engine: report, missing };
}

/**
 * The report taken as the last run ended, while its engine could still answer:
 * a run whose worker died after cannot be asked again, and this is what is
 * saved for it.
 *
 * @type {{ parts: Awaited<ReturnType<typeof reportParts>>, at: Date } | null}
 */
let lastEnding = null;

/** @param {Awaited<ReturnType<typeof reportParts>>} parts */
export function keepEnding(parts) {
  lastEnding = { parts, at: new Date() };
}

export function lastEndingReport() {
  return lastEnding;
}
