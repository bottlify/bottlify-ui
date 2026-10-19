/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Whether a message box the engine announced is put in front of the person.
 *
 * A program's own box is: it is the program speaking, and one of its threads
 * is parked until somebody answers. The engine's notice that the program has
 * finished (`exit`, id 0) is not: the launcher tells an ending itself -- the
 * play screen's outcome, and for an install the form that saves the bottle --
 * and the notice, drawn like the program's boxes, reads as the program saying
 * it, under the name of whichever process happened to stop last.
 *
 * @param {{ id?: number, exit?: { code: number } }} notice
 * @returns {boolean}
 */
export function shownToThePerson(notice) {
  return !notice.exit;
}
