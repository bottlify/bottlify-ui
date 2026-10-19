/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A program's text file as an editor shows it, and back to the bytes it was,
 * byte for byte where nothing was changed. A config of this age is as often
 * Windows-1252 as UTF-8 and ends its lines with CR LF; read as UTF-8 and saved
 * with LF it would come back with its accents broken and its lines run
 * together for a program that splits on CR LF.
 */

/** Windows-1252's own characters at 0x80-0x9F, where Latin-1 has controls. */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];
const CP1252_BACK = new Map(CP1252_HIGH.map((code, index) => [code, 0x80 + index]));

/**
 * @typedef {Object} TextForm
 * @property {string} text  With LF line ends, as a text field holds it.
 * @property {"utf-8" | "windows-1252"} encoding
 * @property {boolean} bom   UTF-8 that began with a byte order mark.
 * @property {boolean} crlf  Lines ended with CR LF.
 */

/**
 * @param {Uint8Array} bytes
 * @returns {TextForm}
 */
export function decodeText(bytes) {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text;
  /** @type {"utf-8" | "windows-1252"} */
  let encoding = "utf-8";
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    encoding = "windows-1252";
    // By hand rather than through TextDecoder, which in Node reads this label
    // as Latin-1 and so disagrees with a browser over 0x80-0x9F.
    text = "";
    for (let at = 0; at < bytes.length; at += 4096) {
      text += String.fromCharCode(...Array.from(bytes.subarray(at, at + 4096),
        (byte) => (byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : byte)));
    }
  }
  const crlf = text.includes("\r\n");
  return { text: crlf ? text.replace(/\r\n/g, "\n") : text, encoding, bom, crlf };
}

/**
 * The bytes of `text` in the form the file was read in. A character
 * Windows-1252 has no byte for is written as `?`, as Windows does.
 *
 * @param {string} text
 * @param {Omit<TextForm, "text">} form
 * @returns {Uint8Array}
 */
export function encodeText(text, { encoding, bom, crlf }) {
  const lines = crlf ? text.replace(/\r?\n/g, "\r\n") : text;
  if (encoding === "utf-8") {
    const body = new TextEncoder().encode(lines);
    if (!bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const out = new Uint8Array(lines.length);
  for (let at = 0; at < lines.length; at++) {
    const code = lines.charCodeAt(at);
    out[at] = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : CP1252_BACK.get(code) ?? 0x3f;
  }
  return out;
}
