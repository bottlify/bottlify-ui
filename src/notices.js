/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The engine's THIRD-PARTY-NOTICES.md, read into what the License page draws.
 *
 * The page shows that file and nothing of its own: what the repository says is
 * distributed with the product and what the page says cannot differ, because
 * there is only one text. It uses a small part of markdown -- headings,
 * paragraphs, bullet lists, fenced blocks, links and `code` -- and this reads
 * exactly that; a line that is none of them is a paragraph.
 *
 * @typedef {{ type: "h1" | "h2" | "h3" | "p", text: string }
 *   | { type: "ul", items: string[] }
 *   | { type: "pre", text: string }} Block
 */

/**
 * @param {string} text
 * @returns {Block[]}
 */
export function parseNotices(text) {
  /** @type {Block[]} */
  const blocks = [];
  /** @type {string[]} */
  let paragraph = [];
  /** @type {string[] | null} */
  let list = null;
  /** @type {string[] | null} */
  let fence = null;
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const endList = () => {
    if (list) blocks.push({ type: "ul", items: list });
    list = null;
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (fence) {
      if (line.startsWith("```")) {
        blocks.push({ type: "pre", text: fence.join("\n") });
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (line.startsWith("```")) {
      endParagraph();
      endList();
      fence = [];
      continue;
    }
    const heading = /^(#{1,3}) +(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({ type: /** @type {"h1" | "h2" | "h3"} */ (`h${heading[1].length}`), text: heading[2].trim() });
      continue;
    }
    if (line.startsWith("- ")) {
      endParagraph();
      list ??= [];
      list.push(line.slice(2).trim());
      continue;
    }
    // A bullet carries on over the lines indented under it.
    if (list && /^ {2,}\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (line.trim() === "") {
      endParagraph();
      endList();
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  if (fence) blocks.push({ type: "pre", text: fence.join("\n") });
  endParagraph();
  endList();
  return blocks;
}

/**
 * One line of text as pieces: plain text, `code`, and links -- the written
 * `[name](address)` kind and a bare address, which loses the punctuation a
 * sentence put after it.
 *
 * @param {string} text
 * @returns {({ type: "text" | "code", text: string } | { type: "link", text: string, href: string })[]}
 */
export function inlineOf(text) {
  const pieces = [];
  // Plain text next to plain text is one piece.
  const say = (/** @type {string} */ words) => {
    const last = pieces.at(-1);
    if (last?.type === "text") last.text += words;
    else pieces.push({ type: "text", text: words });
  };
  const pattern = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)`]+)/g;
  let from = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > from) say(text.slice(from, match.index));
    if (match[1] !== undefined) {
      pieces.push({ type: "code", text: match[1] });
    } else if (match[2] !== undefined) {
      pieces.push({ type: "link", text: match[2], href: match[3] });
    } else {
      const address = match[4].replace(/[.,;:]+$/, "");
      pieces.push({ type: "link", text: address, href: address });
      if (address.length < match[4].length) say(match[4].slice(address.length));
    }
    from = match.index + match[0].length;
  }
  if (from < text.length) say(text.slice(from));
  return pieces;
}

/**
 * A bullet written as "Label: what it says" split in two, for the label to be
 * set apart; a bullet without one is all text.
 *
 * @param {string} item
 * @returns {{ label: string, text: string }}
 */
export function labelOf(item) {
  const match = /^([A-Z][^:`]{0,38}): (.*)$/.exec(item);
  return match ? { label: match[1], text: match[2] } : { label: "", text: item };
}
