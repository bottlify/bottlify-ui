/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * The server's side of an install with the bridge (steam-store.mjs): its plan,
 * its check of the page's keys and codes, and the run it hands them to -- on
 * stdin and nowhere else. Steam is answered by a test's product info and the
 * engine's tools by stand-ins that keep what they were given.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSteamStore } from "../../steam-store.mjs";

const game = (/** @type {string} */ name) => ({
  common: { type: "game", name },
  config: { launch: { 0: { executable: "game.exe" } } },
  depots: { 101: { manifests: { public: { gid: "1111", size: String(3 * 2 ** 20) } } },
    102: { manifests: { public: { gid: "2222", size: "10" } } } },
});
const INFO = new Map([[70, game("Works")], [71, game("Fails")],
  [72, { common: { type: "tool", name: "A tool" } }]]);

/** The download: keeps its argv and stdin, says its progress; app 71's code has expired. */
const INSTALL = `
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const app = argv[argv.indexOf("--app") + 1];
writeFileSync("seen-" + app + ".json", JSON.stringify({ argv, stdin: readFileSync(0, "utf8") }));
console.log("depot 101: 2 files, 3 MiB");
console.log("  2 of 3 MiB (1.5 MiB/s), 0 MiB kept");
if (app === "71") {
  console.error("failed: depot 101's manifest was refused with the code given");
  process.exit(1);
}
`;
/** The packing: a bottle's manifest where make-btl writes it. */
const PACK = `
import { mkdirSync, writeFileSync } from "node:fs";
const [, , id] = process.argv.slice(2);
mkdirSync("bundles/" + id, { recursive: true });
writeFileSync("bundles/" + id + "/manifest.json", JSON.stringify({ id, entry: "game.exe" }));
`;

const KEY = "5a".repeat(32);
const CODE = "9876543210987654321";
/** @param {number} appId */
const request = (appId) => ({ appId, depots: [{ depot: 101, gid: "1111", key: KEY, code: CODE },
  { depot: 102, gid: "2222", key: "c3".repeat(32), code: "12345" }] });
const INSTALLER = "0123456789abcdef0123456789abcdef";

/** @param {() => boolean} done */
async function until(done) {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(done(), "in time");
}

test("an install with the bridge's keys: checked against the plan, handed over on stdin alone", async () => {
  const engine = await mkdtemp(join(tmpdir(), "steam-store-test-"));
  try {
    await mkdir(join(engine, "tools"));
    await writeFile(join(engine, "tools", "steam-install.mjs"), INSTALL);
    await writeFile(join(engine, "tools", "make-btl.mjs"), PACK);
    /** @type {number[][]} */
    const asked = [];
    const store = createSteamStore({ cache: join(engine, "cache"), bundles: join(engine, "bundles"),
      appInfo: async (ids) => {
        asked.push(ids);
        return new Map(ids.map((id) => [id, INFO.get(id)]));
      } });

    assert.deepEqual(await store.plan(70),
      { appId: 70, depots: [{ depot: 101, gid: "1111" }, { depot: 102, gid: "2222" }] });
    await assert.rejects(store.plan(72), { refused: true, message: /not a game/ });

    const wrong = { ...request(70), depots: request(70).depots.slice(0, 1) };
    await assert.rejects(store.installWithKeys(INSTALLER, wrong), (/** @type {any} */ e) => {
      assert.equal(e.refused, true);
      assert.doesNotMatch(e.message, new RegExp(`${KEY}|${CODE}`));
      return true;
    });
    assert.deepEqual(store.jobs(INSTALLER), [], "a refused request starts nothing");

    const job = await store.installWithKeys(INSTALLER, request(70));
    assert.equal(job.state, "downloading");
    assert.equal(job.total, 3);
    /** @type {string[]} */
    const messages = [];
    await until(() => {
      messages.push(job.message);
      return job.state === "done" || job.state === "failed";
    });
    assert.equal(job.state, "done", job.message);
    assert.equal(job.bundle, "steam-70");
    assert.deepEqual(store.jobs(INSTALLER), [job]);
    assert.deepEqual(store.jobs("f".repeat(32)), [], "another browser is not shown it");

    const seen = JSON.parse(await readFile(join(engine, "seen-70.json"), "utf8"));
    assert.deepEqual(seen.argv, ["--keys", "-", "--app", "70", "--out",
      join(engine, "bundles", ".staging", "steam-70")]);
    assert.deepEqual(JSON.parse(seen.stdin), request(70).depots);
    const kept = JSON.parse(await readFile(join(engine, "bundles", "steam-70", "manifest.json"), "utf8"));
    assert.equal(kept.title, "Works");
    assert.deepEqual(kept.steam, { appId: 70 });

    const failing = await store.installWithKeys(INSTALLER, request(71));
    await until(() => {
      messages.push(failing.message);
      return failing.state === "failed" || failing.state === "done";
    });
    assert.equal(failing.state, "failed");
    assert.match(failing.message, /failed: depot 101's manifest was refused/);
    assert.doesNotMatch(messages.join("\n"), new RegExp(`${KEY}|${CODE}|c3c3|12345`));
    assert.deepEqual(asked, [[70], [72], [71]], "Steam asked once an app in ten minutes");
  } finally {
    await rm(engine, { recursive: true, force: true });
  }
});
