/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { askPlan, depotOpenings, describeApp, installPlan, storeGame } from "./install.js";

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
  });

const OWNER = { common: { type: "Config" },
  depots: { 228986: { manifests: { public: { gid: "8782296191957114623" } } } } };

test("a game as the library shows it: its name, its depots added up, installable by its launch", () => {
  const game = /** @type {any} */ (storeGame(70, INFO));
  assert.deepEqual([game.id, game.appId, game.name, game.bytes, game.exact, game.installable],
    ["70", 70, "A Game", 1060, false, true]);
  assert.deepEqual(game.launch, { executable: "bin/game.exe", arguments: "-windowed" });
  assert.equal(/** @type {any} */ (storeGame(71, { ...INFO, config: {} })).installable, false,
    "no Windows launch option: nothing an install could start");
  assert.equal(storeGame(228980, OWNER), null, "an app that is not a game is not shown");
  assert.equal(storeGame(1, undefined), null);
});

test("an install's plan: the app's depots, the redistributables at their owner's manifest, how it starts",
  async () => {
    const expected = { appId: 70, name: "A Game",
      depots: [{ depot: 101, gid: "1111111111111111111" }, { depot: 102, gid: "2222" },
        { depot: 104, gid: "4444" }],
      shared: [{ depot: 228986, app: 228980, gid: "8782296191957114623" }],
      installscript: "installscript.vdf",
      launch: { executable: "bin/game.exe", arguments: "-windowed" } };
    assert.deepEqual(installPlan(70, INFO, new Map([[228980, OWNER]])), expected);
    /** @type {Array<[string, any]>} */
    const asked = [];
    const ask = async (/** @type {string} */ op, /** @type {any} */ args) => {
      asked.push([op, args]);
      return Object.fromEntries(args.apps.flatMap((/** @type {number} */ id) =>
        (id === 70 ? [[70, INFO]] : id === 228980 ? [[228980, OWNER]] : [])));
    };
    assert.deepEqual(await askPlan(70, ask), expected);
    assert.deepEqual(asked, [["productInfo", { apps: [70] }], ["productInfo", { apps: [228980] }]],
      "the app, then the apps that own its redistributables");
    await assert.rejects(askPlan(71, ask), /does not describe app 71/);
  });
