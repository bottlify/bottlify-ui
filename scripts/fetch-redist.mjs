/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Fetches the redistributables a layer is built from (`src/engine/redist.js`)
 * from their publisher into the directory the server serves `/redist/` from,
 * keeping each only when its SHA-256 is the one pinned there. One already
 * there and right is not fetched again.
 *
 *   node scripts/fetch-redist.mjs        # npm run redist; REDIST_DIR, default ./redist
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REDISTRIBUTABLES } from "../src/engine/redist.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIR = resolve(process.env.REDIST_DIR ?? join(ROOT, "redist"));

/** @param {Uint8Array} bytes */
const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(DIR, { recursive: true });
for (const one of REDISTRIBUTABLES) {
  const path = join(DIR, one.name);
  const held = await readFile(path).catch(() => null);
  if (held && digestOf(held) === one.sha256) {
    console.log(`${one.name}: kept, ${held.length} bytes`);
    continue;
  }
  console.log(`${one.name}: fetching ${one.source}`);
  const response = await fetch(one.source);
  if (!response.ok) throw new Error(`${one.source} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = digestOf(bytes);
  if (digest !== one.sha256) {
    throw new Error(`${one.name}: SHA-256 ${digest}, not the pinned ${one.sha256}; not kept`);
  }
  // Written beside and renamed, so a fetch cut short never leaves a wrong file to be served.
  await writeFile(`${path}.part`, bytes);
  await rm(path, { force: true });
  await rename(`${path}.part`, path);
  console.log(`${one.name}: ${bytes.length} bytes, SHA-256 checked`);
}
