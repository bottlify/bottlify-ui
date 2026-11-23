/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STRINGS, bytesIn, languageOf, translate, whenIn } from "./i18n.js";

const SRC = fileURLToPath(new URL(".", import.meta.url));

/** Every source of the app, by path. @param {string} dir @returns {string[]} */
const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
  ? sources(join(dir, entry.name))
  : /\.jsx?$/.test(entry.name) && !/\.test\.js$/.test(entry.name) ? [join(dir, entry.name)] : []));

const placeholders = (/** @type {string} */ text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("both languages say every text, with the same blanks to fill", () => {
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  for (const key of Object.keys(STRINGS.en)) {
    assert.deepEqual(placeholders(STRINGS.ru[key]), placeholders(STRINGS.en[key]), key);
  }
});

test("every text the app asks for by name is in the dictionary", () => {
  const namespaces = new Set(Object.keys(STRINGS.en).map((key) => key.split(".")[0]));
  const missing = [];
  for (const file of sources(SRC)) {
    const code = readFileSync(file, "utf8");
    // Any quoted key of a namespace the dictionary has: in t("…") and in the
    // ternaries and lists a key is chosen from alike.
    for (const [, key] of code.matchAll(/["']([a-z]+\.[\w.-]+)["']/gi)) {
      if (namespaces.has(key.split(".")[0]) && !/\.(js|jsx|json|svg|png|webp|css)$/.test(key)
        && !(key in STRINGS.en)) missing.push(`${file}: ${key}`);
    }
    // A key built from a value: its fixed part has to begin some key.
    for (const [, prefix] of code.matchAll(/\bt\(`([a-z]+\.[\w.]*)\$\{/gi)) {
      if (!Object.keys(STRINGS.en).some((key) => key.startsWith(prefix))) missing.push(`${file}: ${prefix}…`);
    }
  }
  assert.deepEqual(missing, []);
});

test("the language is the one chosen, else the browser's Russian, else English", () => {
  assert.equal(languageOf("en", "ru-RU"), "en");
  assert.equal(languageOf("", "ru-RU"), "ru");
  assert.equal(languageOf("", "ru"), "ru");
  assert.equal(languageOf("", "de-DE"), "en");
  assert.equal(languageOf("", undefined), "en");
});

test("a text is filled from what is given, and a gap shows as its key", () => {
  assert.equal(translate("ru", "rate.title", { name: "Myst" }), "Как работает Myst?");
  assert.equal(translate("en", "nothing.here"), "nothing.here");
});

test("sizes and days are said the language's way", () => {
  assert.equal(bytesIn("en", 5.1 * 2 ** 30), "5.1 GB");
  assert.equal(bytesIn("ru", 5.1 * 2 ** 30), "5,1 ГБ");
  assert.equal(bytesIn("ru", 512 * 2 ** 20), "512 МБ");
  const now = new Date(2026, 10, 23, 12).getTime();
  assert.equal(whenIn("ru", now - 3_600_000, now), "Сегодня");
  assert.equal(whenIn("en", now - 86_400_000, now), "Yesterday");
  assert.equal(whenIn("ru", now - 3 * 86_400_000, now), "3 дня назад");
});
