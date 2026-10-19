/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Where the engine's THIRD-PARTY-NOTICES.md is: beside the installed
 * `@bottlify/core`'s package.json, the one path the package exports, so it
 * holds for a linked checkout, a registry install and any layout of
 * node_modules alike.
 *
 * The file is made by the engine's build (copied from its repository root), so
 * a checkout whose engine was never built has none. That is an error, said in
 * words: the page that carries the licences must never be built without them.
 *
 * @returns {string}
 */
export function noticesPath() {
  const require = createRequire(import.meta.url);
  const file = join(dirname(require.resolve("@bottlify/core/package.json")), "THIRD-PARTY-NOTICES.md");
  if (!existsSync(file)) {
    throw new Error(
      `${file} is missing. The License page is built from the engine's notices, which the engine's `
      + "own build puts there: run `npm run build` in the engine checkout (or install a published "
      + "@bottlify/core), then build this again.",
    );
  }
  return file;
}
