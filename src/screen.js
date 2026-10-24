/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The display a program is told it has on a phone.
 *
 * Everywhere else a bottle starts on the one screen of the settings
 * (`settings.js`). A phone is held sideways to play, and its picture is the
 * landscape viewport less the notch and the browser's bars: a 4:3 desktop
 * there is a narrow strip with black on both sides even for a program that
 * draws on its desktop. So the phone's desktop has that shape, and the lines
 * of the screen every other bottle starts on (768) where the phone has that
 * many pixels: a program sizes its windows against those, and the modes a
 * game picks from are every size of the era whatever the desktop is.
 */

/** Lines of the phone's desktop, where it has the pixels; and the widest it gets. */
export const PHONE_LINES = 768;
export const PHONE_WIDEST = 1920;

/**
 * @typedef {Object} View
 * @property {number} width   The visual viewport, in CSS pixels, as it stands.
 * @property {number} height
 * @property {number} dpr     Device pixels to a CSS pixel.
 * @property {{ top: number, right: number, bottom: number, left: number }} insets
 *     The safe area's insets as they stand, in CSS pixels.
 */

/**
 * The landscape rectangle a picture can fill, in CSS pixels: the long side
 * across. Held upright, the notch's insets at the top and bottom are the ones
 * at the sides once the phone is turned, and the height then is the width now.
 *
 * @param {View} view
 * @returns {{ width: number, height: number }}
 */
export function landscapeRoom(view) {
  const { top, right, bottom, left } = view.insets;
  return view.height > view.width
    ? { width: Math.max(1, view.height - top - bottom), height: Math.max(1, view.width) }
    : { width: Math.max(1, view.width - left - right), height: Math.max(1, view.height - top - bottom) };
}

/**
 * The phone's desktop: the landscape room's shape at `PHONE_LINES` lines, or
 * at the device pixels it has when fewer, no wider than `PHONE_WIDEST`; the
 * width a multiple of 8 and the height even, as display modes are.
 *
 * @param {View} view
 * @returns {{ width: number, height: number, bitsPerPixel: number }}
 */
export function phoneScreen(view) {
  const room = landscapeRoom(view);
  const pixels = { width: room.width * view.dpr, height: room.height * view.dpr };
  const scale = Math.min(PHONE_LINES / pixels.height, PHONE_WIDEST / pixels.width, 1);
  // A hair over, so a side the scale was worked out from lands on itself.
  const width = Math.max(640, Math.floor((pixels.width * scale) / 8 + 1e-9) * 8);
  const height = Math.max(480, Math.floor((pixels.height * scale) / 2 + 1e-9) * 2);
  return { width, height, bitsPerPixel: 32 };
}

/**
 * The safe area's insets, read through an element that is given them as its
 * padding: CSS knows them and script has no other way to ask.
 *
 * @param {Document} document
 * @returns {View["insets"]}
 */
export function safeInsets(document) {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;"
    + "padding:env(safe-area-inset-top) env(safe-area-inset-right) "
    + "env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

/**
 * The view as this page has it now.
 *
 * @param {Window} scope
 * @returns {View}
 */
export function viewOf(scope) {
  const visual = scope.visualViewport;
  return {
    width: visual?.width ?? scope.innerWidth,
    height: visual?.height ?? scope.innerHeight,
    dpr: scope.devicePixelRatio || 1,
    insets: safeInsets(scope.document),
  };
}
