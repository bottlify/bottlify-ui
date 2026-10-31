/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeDepotAccess } from "@bottlify/core/steam";
import { checkInstallRequest, depotOpenings, describeApp } from "./install.js";

/** Product info in the shape PICS answers, trimmed to what an install reads. */
const INFO = {
  common: { type: "Game", name: "A Game" },
  extended: { installscript: "installscript.vdf" },
  config: { launch: {
    0: { executable: "mac/game.app", config: { oslist: "macos" } },
    1: { executable: "bin/game.exe", arguments: "-windowed", config: { oslist: "windows" } },
  } },
  depots: {
    101: { manifests: { public: { gid: "1111111111111111111", size: "1000" } } },
    102: { config: { oslist: "windows" }, manifests: { public: { gid: "2222", size: "20" } } },
    103: { config: { oslist: "macos" }, manifests: { public: { gid: "3333", size: "30" } } },
    104: { config: { oslist: "windows", language: "english" },
      manifests: { public: { gid: "4444", size: "40" } } },
    105: { config: { oslist: "windows", language: "german" },
      manifests: { public: { gid: "5555", size: "50" } } },
    106: { dlcappid: "999", manifests: { public: { gid: "6666", size: "60" } } },
    107: { manifests: { public: { gid: "7777", size: "0" } } },
    108: { manifests: { beta: { gid: "8888", size: "80" } } },
    228986: { config: { oslist: "windows" }, depotfromapp: "228980", sharedinstall: "1" },
    228999: { config: { oslist: "macos" }, depotfromapp: "228980" },
    branches: { public: { buildid: "4242" } },
  },
};

const PLAN = { appId: 70, depots: [{ depot: 101, gid: "1111111111111111111" },
  { depot: 102, gid: "2222" }, { depot: 104, gid: "4444" }] };
const KEYS = new Map(PLAN.depots.map(({ depot }) =>
  [depot, Uint8Array.from({ length: 32 }, (_, i) => (depot + i) & 0xFF)]));
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString("hex");

/**
 * The bridge as far as an install asks it: a key per depot, a code per
 * manifest, and every question kept.
 */
function fakeBridge() {
  /** @type {Array<[string, Record<string, unknown>]>} */
  const asked = [];
  /** @param {string} op @param {Record<string, any>} args */
  const ask = async (op, args) => {
    asked.push([op, args]);
    if (op === "depotKey") return KEYS.get(args.depot);
    if (op === "manifestCode") return String(BigInt(args.gid) % 1000n + BigInt(args.depot) * 1000n);
    throw new Error(`no op ${op}`);
  };
  return { ask, asked };
}

test("the plan is Windows', the language's and every language's depots, not a DLC's", () => {
  const described = describeApp(INFO, "english");
  assert.deepEqual(described.depots, [{ id: 101, gid: 1111111111111111111n }, { id: 102, gid: 2222n },
    { id: 104, gid: 4444n }]);
  assert.equal(described.bytes, 1060);
  assert.deepEqual(described.shared, [{ id: 228986, app: 228980 }], "Windows' redistributables");
  assert.equal(described.build, "4242");
  assert.deepEqual(described.launch, { executable: "bin/game.exe", arguments: "-windowed" });
  assert.equal(described.installscript, "installscript.vdf");
  assert.deepEqual(describeApp(INFO, "german").depots.map(({ id }) => id), [101, 102, 105]);
  assert.deepEqual(describeApp(null, "english"),
    { bytes: 0, depots: [], shared: [], build: "", launch: null, installscript: "" });
});

/** A request with the bridge's keys and codes, as a page would hand it to the server. */
async function request(/** @type {ReturnType<typeof fakeBridge>["ask"]} */ ask) {
  return { appId: 70, depots: writeDepotAccess(await depotOpenings(PLAN, ask)) };
}

test("the page asks the bridge for each planned depot's key and code, a redistributable's under its owner",
  async () => {
    const { ask, asked } = fakeBridge();
    const plan = { ...PLAN, shared: [{ depot: 228986, app: 228980, gid: "9999" },
      { depot: 228987, app: 228980 }] };
    KEYS.set(228986, new Uint8Array(32));
    const openings = await depotOpenings(plan, ask);
    assert.deepEqual(asked.filter(([op]) => op === "depotKey").map(([, args]) => args), [
      ...PLAN.depots.map(({ depot }) => ({ app: 70, depot })), { app: 228980, depot: 228986 }],
    "one with no manifest named is left out");
    assert.deepEqual(asked.filter(([op]) => op === "manifestCode").map(([, args]) => args), [
      ...PLAN.depots.map(({ depot, gid }) => ({ app: 70, depot, gid })),
      { app: 228980, depot: 228986, gid: "9999" }]);
    assert.deepEqual(openings[0], { depot: 101, gid: 1111111111111111111n, shared: false,
      key: KEYS.get(101), code: 101111n });
    assert.deepEqual(openings.map(({ shared }) => shared), [false, false, false, true]);
    // What a page would hand the server, as the server reads it.
    const sent = JSON.parse(JSON.stringify(await request(ask)));
    assert.deepEqual(sent.depots[0], { depot: 101, gid: "1111111111111111111",
      key: hex(/** @type {Uint8Array} */ (KEYS.get(101))), code: "101111" });
    assert.deepEqual(checkInstallRequest(sent, PLAN), sent.depots);
  });

test("the server refuses a request that is not its plan, and says so without a key or code", async () => {
  const { ask } = fakeBridge();
  const good = JSON.parse(JSON.stringify(await request(ask)));
  const secrets = new RegExp(good.depots.flatMap((/** @type {any} */ d) => [d.key, d.code]).join("|"));
  const other = { depot: 105, gid: "5555", key: "ab".repeat(32), code: "77" };
  const cases = [
    [null, /not for app 70/],
    [{ ...good, appId: 71 }, /not for app 70/],
    [{ ...good, appId: "70" }, /not for app 70/],
    [{ appId: 70 }, /depot access/],
    [{ ...good, depots: good.depots.slice(1) }, /takes depots 101, 102, 104/],
    [{ ...good, depots: [...good.depots, other] }, /depot 105 is not one/],
    [{ ...good, depots: [{ ...good.depots[0], gid: "1" }, ...good.depots.slice(1)] }, /changed on Steam/],
    [{ ...good, depots: [{ ...good.depots[0], key: "00" }, ...good.depots.slice(1)] }, /depot access/],
    [{ ...good, depots: [good.depots[0], good.depots[0], good.depots[1]] }, /depot access/],
  ];
  for (const [body, expected] of cases) {
    assert.throws(() => checkInstallRequest(body, PLAN), (/** @type {Error} */ e) => {
      assert.match(e.message, /** @type {RegExp} */ (expected));
      assert.doesNotMatch(e.message, secrets);
      return true;
    });
  }
});
