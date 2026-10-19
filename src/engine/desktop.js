/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * What the guest's desktop shows where no window is: the bottle's wallpaper,
 * scaled to cover the screen, or -- for a bottle without one -- the Bottlify
 * mark on black. The engine paints its desktop with it in
 * place of the grey a Windows desktop has, so what is on the canvas before
 * and around a program's own windows is the bottle's, not an empty desktop.
 * The stage does not show it before the first frame: it got in the way of the
 * loader.
 *
 * @param {{ wallpaper?: string }} bundle
 * @param {{ width: number, height: number }} screen
 * @returns {Promise<{ picture: { width: number, height: number, bits: Uint8Array } } | null>}
 *     `bits` 32 a pixel, B, G, R and a byte unused, top row first, as the
 *     engine takes it.
 */
export async function desktopPicture(bundle, screen) {
  if (typeof OffscreenCanvas !== "function") return null;
  const { width, height } = screen;
  const canvas = new OffscreenCanvas(width, height);
  const paint = canvas.getContext("2d");
  if (!paint) return null;
  paint.fillStyle = "#000";
  paint.fillRect(0, 0, width, height);
  if (bundle.wallpaper) {
    const image = await createImageBitmap(await (await fetch(bundle.wallpaper)).blob());
    // Covering the screen, centred: a wallpaper of another shape loses its
    // edges rather than leaving bars.
    const scale = Math.max(width / image.width, height / image.height);
    const drawnWidth = image.width * scale;
    const drawnHeight = image.height * scale;
    paint.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
    image.close();
  } else {
    const mark = new Image();
    mark.src = "/favicon.svg";
    await mark.decode();
    const size = Math.round(height / 4);
    paint.drawImage(mark, (width - size) / 2, (height - size) / 2, size, size);
  }
  const rgba = paint.getImageData(0, 0, width, height).data;
  const bits = new Uint8Array(width * height * 4);
  for (let at = 0; at < bits.length; at += 4) {
    bits[at] = rgba[at + 2];
    bits[at + 1] = rgba[at + 1];
    bits[at + 2] = rgba[at];
  }
  return { picture: { width, height, bits } };
}
