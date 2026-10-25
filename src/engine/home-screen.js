/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A bottle as a bookmark and a home-screen icon: what the server answers for
 * one before it has ever been started -- its manifest, and its program's own
 * icon (`@bottlify/core/icon`) drawn as a PNG -- and what the page's head says
 * while it is open. Plain JavaScript with nothing of a page's or Node's of its
 * own, so the server and the page say the same thing; the server hands in
 * Node's deflate.
 */

/** The icon sizes served: a tab's, Apple's touch icon, the manifest's two. */
export const ICON_SIZES = Object.freeze([64, 180, 192, 512]);

/** Where a bottle's bookmark files are, beside its bundle. */
export const homeManifestPath = (/** @type {string} */ id) =>
  `/bundles/${encodeURIComponent(id)}/home.webmanifest`;
export const iconPath = (/** @type {string} */ id, /** @type {number} */ size) =>
  `/bundles/${encodeURIComponent(id)}/icon-${size}.png`;

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
export function iconPlacement(side, box, fill = 0.8) {
  const room = box * fill;
  const scale = side <= room ? Math.max(1, Math.floor(room / side)) : room / side;
  const size = Math.round(side * scale);
  return { size, at: Math.floor((box - size) / 2) };
}

/**
 * The web app manifest that makes a home-screen icon open this bottle,
 * named as it.
 *
 * @param {{ id: string, title: string, icons: { src: string, size: number }[], origin?: string }} bottle
 *     `origin`: written before the addresses, for a manifest with no address of its own to
 *     resolve them against (one carried in a data URL); none for one the server serves.
 */
export function homeManifest({ id, title, icons, origin = "" }) {
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
 * A bitmap icon on black at `box` pixels, as RGBA: placed by whole pixels,
 * each pixel laid over the black by its alpha.
 *
 * @param {{ width: number, height: number, rgba: Uint8ClampedArray | Uint8Array }} icon
 * @param {number} box
 * @returns {Uint8Array}
 */
export function iconOnBlack(icon, box) {
  const out = new Uint8Array(box * box * 4);
  for (let at = 3; at < out.length; at += 4) out[at] = 255;
  const { size, at } = iconPlacement(Math.max(icon.width, icon.height), box);
  const scale = size / Math.max(icon.width, icon.height);
  const left = at + Math.floor((size - icon.width * scale) / 2);
  const top = at + Math.floor((size - icon.height * scale) / 2);
  const width = Math.round(icon.width * scale);
  const height = Math.round(icon.height * scale);
  for (let y = 0; y < height; y++) {
    const from = Math.min(icon.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const source = (from * icon.width + Math.min(icon.width - 1, Math.floor(x / scale))) * 4;
      const alpha = icon.rgba[source + 3];
      const target = ((top + y) * box + left + x) * 4;
      out[target] = Math.round((icon.rgba[source] * alpha) / 255);
      out[target + 1] = Math.round((icon.rgba[source + 1] * alpha) / 255);
      out[target + 2] = Math.round((icon.rgba[source + 2] * alpha) / 255);
    }
  }
  return out;
}

/** CRC-32 as PNG's chunks carry it. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * RGBA pixels as a PNG file: one IDAT, no filtering.
 *
 * @param {Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {(bytes: Uint8Array) => Uint8Array} deflate  zlib's, as Node's deflateSync makes it.
 * @returns {Uint8Array}
 */
export function encodePng(rgba, width, height, deflate) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  /** @param {string} type @param {Uint8Array} data */
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const file = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}

/**
 * The icon file for a program's icon at `box` pixels: a bitmap drawn on black,
 * a PNG image handed over as it is (a browser scales it, a home screen puts
 * black behind it).
 *
 * @param {{ width: number, height: number, rgba?: Uint8ClampedArray | Uint8Array, png?: Uint8Array }} icon
 * @param {number} box
 * @param {(bytes: Uint8Array) => Uint8Array} deflate
 */
export function iconFile(icon, box, deflate) {
  if (icon.png) return icon.png;
  return encodePng(iconOnBlack(/** @type {any} */ (icon), box), box, box, deflate);
}

/**
 * The page's head for a bottle, written into the app's index.html when a
 * bottle's address is asked for: so the first load of that address already
 * names the game and points at its manifest and icons, whatever reads the
 * head before the page has run.
 *
 * @param {string} html
 * @param {{ id: string, title: string }} bottle
 */
export function headForBottle(html, { id, title }) {
  const text = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${text}</title>`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*"/, `$1${text}"`)
    .replace(/(<link rel="manifest" href=")[^"]*"/, `$1${homeManifestPath(id)}"`)
    .replace(/(<link rel="apple-touch-icon" href=")[^"]*"/, `$1${iconPath(id, 180)}"`)
    .replace(/<link rel="icon" type="image\/svg\+xml" href="[^"]*"/,
      `<link rel="icon" type="image/png" href="${iconPath(id, 64)}"`);
}
