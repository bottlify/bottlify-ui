/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The game a page plays is what the browser keeps of it: the tab's title and
 * icon, and a bookmark or a phone's home-screen icon, which opens that game
 * and is named and drawn as it.
 *
 * A phone reads the page's manifest, its Apple tags and its touch icon when a
 * person adds it to the home screen, so while a game plays they all say the
 * game: its title, its address as the start, its own icon -- the one its
 * executable carries, as Explorer shows the file -- drawn whole-pixel on
 * black with the Bottlify bottle in a corner, so the home screen tells the
 * game first and where it runs second. Leaving the game puts the launcher's
 * own back.
 */

/** The sizes a home screen asks for: Apple's touch icon, and the manifest's two. */
export const TOUCH_SIZE = 180;
export const MANIFEST_SIZES = Object.freeze([192, 512]);
/** The tab's icon. */
export const TAB_SIZE = 64;

/**
 * Where an icon of `side` pixels goes on a square of `box`: the largest
 * whole-pixel scale that leaves a margin, so an old 32 or 48 pixel icon stays
 * crisp instead of smeared; a larger one is scaled down to fit.
 *
 * @param {number} side  The icon's larger side.
 * @param {number} box
 * @param {number} [fill]  The share of the box the icon may take.
 * @returns {{ size: number, at: number }}
 */
export function iconPlacement(side, box, fill = 0.75) {
  const room = box * fill;
  const scale = side <= room ? Math.max(1, Math.floor(room / side)) : room / side;
  const size = Math.round(side * scale);
  return { size, at: Math.floor((box - size) / 2) };
}

/**
 * The web app manifest that makes a home-screen icon open this game.
 *
 * @param {{ title: string, id: string, origin: string, icons: { src: string, size: number }[] }} game
 */
export function gameManifest({ title, id, origin, icons }) {
  return {
    name: title,
    short_name: title,
    start_url: `${origin}/play/${encodeURIComponent(id)}`,
    scope: `${origin}/`,
    display: "fullscreen",
    background_color: "#000000",
    theme_color: "#000000",
    icons: icons.map(({ src, size }) => ({ src, sizes: `${size}x${size}`, type: "image/png" })),
  };
}

/**
 * Puts the game on the page's head -- its title, icons and manifest -- and
 * answers the function that puts back what was there.
 *
 * @param {Document} page
 * @param {{ title: string, manifest?: object, tabIcon?: string, touchIcon?: string }} game
 * @returns {() => void}
 */
export function showGame(page, { title, manifest, tabIcon, touchIcon }) {
  /** @type {(() => void)[]} */
  const undo = [];
  const before = page.title;
  page.title = title;
  undo.push(() => {
    page.title = before;
  });
  /** @param {string} selector @param {string} attribute @param {string | undefined} value */
  const set = (selector, attribute, value) => {
    if (value === undefined) return;
    const element = page.head.querySelector(selector);
    if (!element) return;
    const was = element.getAttribute(attribute);
    element.setAttribute(attribute, value);
    undo.push(() => {
      if (was === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, was);
    });
  };
  set('meta[name="apple-mobile-web-app-title"]', "content", title);
  set('link[rel="icon"]', "href", tabIcon);
  set('link[rel="icon"]', "type", tabIcon === undefined ? undefined : "image/png");
  set('link[rel="apple-touch-icon"]', "href", touchIcon);
  set('link[rel="manifest"]', "href", manifest === undefined ? undefined
    : `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`);
  return () => {
    for (const step of undo.reverse()) step();
  };
}

/**
 * The game's icon drawn on black at `box` pixels, as a PNG data URL; with the
 * bottle in the corner where `badge` is given.
 *
 * @param {{ width: number, height: number, rgba?: Uint8ClampedArray, png?: Uint8Array }} icon
 * @param {number} box
 * @param {HTMLImageElement | null} badge
 * @returns {Promise<string>}
 */
export async function drawIcon(icon, box, badge) {
  const canvas = document.createElement("canvas");
  canvas.width = box;
  canvas.height = box;
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  context.fillStyle = "#000";
  context.fillRect(0, 0, box, box);
  /** @type {CanvasImageSource} */
  let source;
  if (icon.png) {
    source = await createImageBitmap(new Blob([icon.png], { type: "image/png" }));
  } else {
    const raw = document.createElement("canvas");
    raw.width = icon.width;
    raw.height = icon.height;
    /** @type {CanvasRenderingContext2D} */ (raw.getContext("2d")).putImageData(
      new ImageData(/** @type {Uint8ClampedArray} */ (icon.rgba), icon.width, icon.height), 0, 0);
    source = raw;
  }
  const { size, at } = iconPlacement(Math.max(icon.width, icon.height), box, badge ? 0.72 : 0.9);
  context.imageSmoothingEnabled = size < Math.max(icon.width, icon.height);
  context.drawImage(source, at, at, size, size);
  if (badge) {
    // The bottle, small in the lower right: where the game runs, said second.
    const mark = Math.round(box * 0.3);
    const height = Math.round(mark * (badge.naturalHeight / badge.naturalWidth || 1));
    context.imageSmoothingEnabled = true;
    context.globalAlpha = 0.9;
    context.drawImage(badge, box - mark - Math.round(box * 0.04), box - height - Math.round(box * 0.04),
      mark, height);
  }
  return canvas.toDataURL("image/png");
}
