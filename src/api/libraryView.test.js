/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { viewLibrary, withSteamGames } from "./libraryView.js";

const bottle = (title, kind, labels, year) => ({ id: title, title, kind, labels, year });
const library = [
  bottle("Quake III Arena", "game", ["demo"], 1999),
  bottle("3DMark03", "game", ["benchmark"], 2003),
  bottle("WineHQ", "application", ["test"]),
  bottle("Doom 3", "game", ["demo"], 2004),
  bottle("Heroes 10", "game", [], 2010),
  bottle("Heroes 2", "game", [], 1996),
];
const all = { query: "", filters: [], sort: "name" };
const titles = (view) => viewLibrary(library, view).map((one) => one.title);
const only = (...filters) => titles({ ...all, filters });

test("with nothing checked every bottle shows, by name, numbers as numbers", () => {
  assert.deepEqual(titles(all), [
    "3DMark03", "Doom 3", "Heroes 2", "Heroes 10", "Quake III Arena", "WineHQ"]);
  assert.deepEqual(titles({ ...all, sort: "name-desc" }).slice(0, 2), ["WineHQ", "Quake III Arena"]);
});

test("a quick search matches any part of the title, in any case", () => {
  assert.deepEqual(titles({ ...all, query: " ARENA" }), ["Quake III Arena"]);
  assert.deepEqual(titles({ ...all, query: "xyz" }), []);
});

test("within a group, every value checked adds what answers it", () => {
  assert.deepEqual(only("demo"), ["Doom 3", "Quake III Arena"]);
  assert.deepEqual(only("demo", "benchmark"), ["3DMark03", "Doom 3", "Quake III Arena"]);
  assert.deepEqual(only("application"), ["WineHQ"]);
  // The kind is a value like the labels: a demo that is a game is a game.
  assert.deepEqual(only("game"), ["3DMark03", "Doom 3", "Heroes 2", "Heroes 10", "Quake III Arena"]);
  assert.deepEqual(only("game", "application"), titles(all));
});

test("across groups a bottle has to pass each group that has something checked", () => {
  const checked = [
    { id: "a", title: "A", kind: "game", labels: ["demo"], status: "playable" },
    { id: "b", title: "B", kind: "game", labels: [], status: null },
    { id: "c", title: "C", kind: "application", labels: [], status: "playable" },
  ];
  const shown = (...filters) => viewLibrary(checked, { ...all, filters }).map((one) => one.id);
  assert.deepEqual(shown("playable"), ["a", "c"]);
  assert.deepEqual(shown("unchecked"), ["b"]);
  assert.deepEqual(shown("game", "playable"), ["a"]);
  assert.deepEqual(shown("demo", "application", "playable"), ["a", "c"]);
  assert.deepEqual(shown("demo", "unchecked"), []);
});

test("a value the view does not know checks nothing", () => {
  assert.deepEqual(only("nonsense"), titles(all));
});

test("the search narrows what the filters let in", () => {
  assert.deepEqual(titles({ ...all, query: "doom" }), ["Doom 3"]);
  assert.deepEqual(titles({ ...all, filters: ["game"], query: "winehq" }), []);
});

test("by year, the bottle without one is last either way, filtered or not", () => {
  assert.deepEqual(titles({ ...all, sort: "year-asc" }),
    ["Heroes 2", "Quake III Arena", "3DMark03", "Doom 3", "Heroes 10", "WineHQ"]);
  assert.deepEqual(titles({ ...all, sort: "year-desc" }),
    ["Heroes 10", "Doom 3", "3DMark03", "Quake III Arena", "Heroes 2", "WineHQ"]);
  assert.deepEqual(titles({ ...all, filters: ["demo"], sort: "year-desc" }), ["Doom 3", "Quake III Arena"]);
});

test("the list asked about is not reordered", () => {
  const before = library.map((one) => one.title);
  viewLibrary(library, { ...all, sort: "year-desc" });
  assert.deepEqual(library.map((one) => one.title), before);
});

test("a Steam game not installed is Steam's and not checked; the rest are Other", () => {
  const card = { id: "steam:400", title: "Portal", kind: "game", labels: [], status: null,
    steam: { appId: 400 }, store: {} };
  const mixed = [...library.slice(0, 2), card];
  const from = (...filters) => viewLibrary(mixed, { ...all, filters }).map((one) => one.title);
  assert.deepEqual(from("steam"), ["Portal"]);
  assert.deepEqual(from("other"), ["3DMark03", "Quake III Arena"]);
  assert.deepEqual(from("steam", "other"), ["3DMark03", "Portal", "Quake III Arena"]);
  assert.deepEqual(from("unchecked"), ["3DMark03", "Portal", "Quake III Arena"]);
  assert.deepEqual(from("steam", "unchecked", "game"), ["Portal"]);
  assert.deepEqual(from("steam", "playable"), []);
});

test("a Steam game shows as a card only while it has a Windows build and no bottle", () => {
  const launch = { executable: "game.exe", arguments: "" };
  const game = (appId, name, more = {}) => ({ appId, name, capsule: "", launch, bundle: null, ...more });
  const installed = { ...bottle("Half-Life", "game", []), steam: { appId: 70 } };
  const merged = withSteamGames([installed], [
    game(400, "Portal"),
    game(500, "Mac only", { launch: null }),
    game(600, "No option", { launch: undefined }),
    game(70, "Half-Life"),
    game(220, "Packed", { bundle: "hl2" }),
  ]);
  assert.deepEqual(merged.map((one) => one.id), ["Half-Life", "steam:400"]);
  assert.deepEqual(merged[1].steam, { appId: 400 });
  assert.equal(merged[1].store.name, "Portal");
  // Without Steam, or with an account that does not own it, a Steam bottle is hidden.
  assert.deepEqual(withSteamGames([installed, bottle("Quake", "game", [])], []).map((one) => one.id),
    ["Quake"]);
  assert.deepEqual(withSteamGames([installed], [game(400, "Portal")]).map((one) => one.id),
    ["steam:400"]);
});
