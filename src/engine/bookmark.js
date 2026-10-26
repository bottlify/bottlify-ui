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
 * person adds it to the home screen, so while a game is open they all say the
 * game. A bottle the server holds has its manifest and its program's icon
 * there (`home-screen.js`), from before it is started; one kept only in this
 * browser has its title at once and its icon once a run has read its
 * executable, drawn here the same way. Leaving the game puts the launcher's
 * own back.
 */

import { TOUCH_ICON_SIZE, homeManifest, homeManifestPath, iconPath, iconPixels } from "./home-screen.js";

/**
 * The launcher's own head, as index.html has it: what leaving a game puts
 * back -- not what the page had before the game, which for a page opened by a
 * game's address is the game, as the server wrote it.
 */
export const LAUNCHER_HEAD = Object.freeze({
  title: "Bottlify",
  manifest: "/manifest.webmanifest",
  tabIcon: "/favicon.svg",
  tabIconType: "image/svg+xml",
  touchIcon: "/icons/icon-180.png",
});

/**
 * Writes a head: the title, the Apple title, the icons and the manifest.
 *
 * @param {Document} page
 * @param {{ title: string, manifest?: string, tabIcon?: string, tabIconType?: string,
 *     touchIcon?: string }} head  Addresses; a field left out is left as it is.
 */
function writeHead(page, { title, manifest, tabIcon, tabIconType = "image/png", touchIcon }) {
  page.title = title;
  /** @param {string} selector @param {string} attribute @param {string | undefined} value */
  const set = (selector, attribute, value) => {
    if (value !== undefined) page.head.querySelector(selector)?.setAttribute(attribute, value);
  };
  set('meta[name="apple-mobile-web-app-title"]', "content", title);
  set('link[rel="icon"]', "href", tabIcon);
  set('link[rel="icon"]', "type", tabIcon === undefined ? undefined : tabIconType);
  set('link[rel="apple-touch-icon"]', "href", touchIcon);
  set('link[rel="manifest"]', "href", manifest);
}

/**
 * Puts the game on the page's head and answers the function that puts the
 * launcher's back.
 *
 * @param {Document} page
 * @param {{ title: string, manifest?: string, tabIcon?: string, touchIcon?: string }} game
 * @returns {() => void}
 */
export function showGame(page, game) {
  writeHead(page, game);
  return () => writeHead(page, LAUNCHER_HEAD);
}

/**
 * Whether a bottle is opened, and left, by loading its address as a page of
 * its own rather than by a history entry. Apple's WebKit -- every browser on
 * an iPhone, Safari on a Mac -- reads a page's manifest once per load, against
 * the address the page was loaded at (WebCore's
 * DocumentLoader::loadApplicationManifest), so a game reached by pushState was
 * added to the home screen as the launcher, its address and its icon, whatever
 * the head said by then. Loaded, /play/<id> comes with the game's head from
 * the server. A bottle kept only in this browser has no page there.
 *
 * @param {{ local?: boolean }} bottle
 * @param {{ userAgent?: string }} [browser]
 */
export function opensAsPage(bottle, browser = globalThis.navigator ?? {}) {
  const agent = String(browser.userAgent ?? "");
  return !bottle.local && /AppleWebKit\//.test(agent) && !/Chrome\/|Chromium\/|Android/.test(agent);
}

/**
 * What the head says for a bottle the server holds: its own manifest and
 * icons, from the first moment.
 *
 * @param {{ id: string, title: string }} bottle
 */
export const servedHead = ({ id, title }) => ({
  title, manifest: homeManifestPath(id), tabIcon: iconPath(id, 64), touchIcon: iconPath(id, 180),
});

/**
 * What the head says for a bottle kept only in this browser: its title and a
 * manifest that opens it, with the launcher's icons until the run has the
 * program's -- small enough to ride in the address, which no icon is.
 *
 * @param {{ id: string, title: string }} bottle
 */
export const keptHead = ({ id, title }) => ({
  title,
  manifest: `data:application/manifest+json,${encodeURIComponent(JSON.stringify(homeManifest({
    id, title, origin: location.origin,
    icons: [192, 512].map((size) => ({ src: `${location.origin}/icons/icon-${size}.png`, size })),
  })))}`,
});

/**
 * A program's icon at `box` pixels as a PNG data URL, drawn the way the server
 * draws it: with its transparency, on black for the touch icon.
 *
 * @param {{ width: number, height: number, rgba?: Uint8ClampedArray, png?: Uint8Array }} icon
 * @param {number} box
 * @returns {Promise<string>}
 */
export async function drawIcon(icon, box) {
  const canvas = document.createElement("canvas");
  canvas.width = box;
  canvas.height = box;
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  if (icon.png) {
    if (box === TOUCH_ICON_SIZE) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, box, box);
    }
    const picture = await createImageBitmap(new Blob([icon.png], { type: "image/png" }));
    context.drawImage(picture, 0, 0, box, box);
  } else {
    context.putImageData(new ImageData(new Uint8ClampedArray(iconPixels(/** @type {any} */ (icon), box)),
      box, box), 0, 0);
  }
  return canvas.toDataURL("image/png");
}
