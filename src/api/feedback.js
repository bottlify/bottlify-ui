/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * @typedef {Object} Feedback
 * @property {"rating" | "report"} kind  A person's rating of how a game runs, or a report of
 *     a run that stopped.
 * @property {{ id: string, title: string, store: string | null }} game
 * @property {"works" | "issues" | "fails"} [status]  A rating's.
 * @property {string} comment  What the person wrote; may be empty.
 * @property {Record<string, unknown>} [details]  A report's: versions and the engine's journal.
 */

/**
 * Where a rating or a report would go. No service receives them yet, so this
 * is the one place that will send them once one does; until then it sends
 * nothing and says so, and the page tells the person their words were not sent.
 *
 * @param {Feedback} feedback  What a service will be sent, once there is one.
 * @returns {Promise<{ sent: boolean }>}
 */
export async function sendFeedback(feedback) { // eslint-disable-line no-unused-vars
  return { sent: false };
}
