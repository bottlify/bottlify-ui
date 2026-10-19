/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { noticesPath } from "../notices-source.mjs";
import { inlineOf, labelOf, parseNotices } from "./notices.js";

const SAMPLE = [
  "# Notices",
  "",
  "A first paragraph",
  "over two lines.",
  "",
  "## A component",
  "",
  "- Source: upstream https://example.org/x, at a tag",
  "  that carries on here (https://example.org/y)",
  "- License: MIT",
  "",
  "```",
  "Copyright (c) someone",
  "  kept as it is",
  "```",
  "",
  "Closing words.",
].join("\r\n");

test("headings, paragraphs, bullets and fenced blocks are read as such", () => {
  assert.deepEqual(parseNotices(SAMPLE), [
    { type: "h1", text: "Notices" },
    { type: "p", text: "A first paragraph over two lines." },
    { type: "h2", text: "A component" },
    {
      type: "ul",
      items: [
        "Source: upstream https://example.org/x, at a tag that carries on here (https://example.org/y)",
        "License: MIT",
      ],
    },
    { type: "pre", text: "Copyright (c) someone\n  kept as it is" },
    { type: "p", text: "Closing words." },
  ]);
});

test("a link keeps the address, not the punctuation a sentence put after it", () => {
  assert.deepEqual(inlineOf("see https://example.org/x, and `a/b.js` or [name](https://example.org/z)."), [
    { type: "text", text: "see " },
    { type: "link", text: "https://example.org/x", href: "https://example.org/x" },
    { type: "text", text: ", and " },
    { type: "code", text: "a/b.js" },
    { type: "text", text: " or " },
    { type: "link", text: "name", href: "https://example.org/z" },
    { type: "text", text: "." },
  ]);
  // An address inside code is code, not a link.
  assert.deepEqual(inlineOf("`http://example.org/a.crt`"), [{ type: "code", text: "http://example.org/a.crt" }]);
});

test("a bullet's label is set apart, and one without a label is all text", () => {
  assert.deepEqual(labelOf("Source: upstream"), { label: "Source", text: "upstream" });
  assert.deepEqual(labelOf("What it is: a root"), { label: "What it is", text: "a root" });
  assert.deepEqual(labelOf("no label here: just words and more words that go on and on and on and on"),
    { label: "", text: "no label here: just words and more words that go on and on and on and on" });
});

// The real file, when the engine is installed and built: every section of it
// comes out as a heading and nothing of markdown is left in the text.
const REAL = (() => {
  try {
    return noticesPath();
  } catch {
    return null;
  }
})();
test("the engine's own notices are read whole", { skip: REAL === null }, () => {
  const text = readFileSync(REAL, "utf8");
  const blocks = parseNotices(text);
  const headings = blocks.filter((one) => one.type === "h2").map((one) => one.text);
  assert.equal(headings.length, (text.match(/^## /gm) ?? []).length);
  assert.ok(headings.length > 0);
  for (const one of blocks) {
    if (one.type === "p" || one.type === "h2") assert.doesNotMatch(one.text, /^#|```/, "no markdown left");
    if (one.type === "ul") for (const item of one.items) assert.doesNotMatch(item, /^- /);
  }
});
