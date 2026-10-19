/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import test from "node:test";
import assert from "node:assert/strict";
import { viewLibrary } from "./libraryView.js";

const bottle = (title, kind, labels, year) => ({ id: title, title, kind, labels, year });
const library = [
  bottle("Quake III Arena", "game", ["demo"], 1999),
  bottle("3DMark03", "game", ["benchmark"], 2003),
  bottle("WineHQ", "application", ["test"]),
  bottle("Doom 3", "game", ["demo"], 2004),
  bottle("Heroes 10", "game", [], 2010),
  bottle("Heroes 2", "game", [], 1996),
];
const everything = ["game", "application", "demo", "benchmark", "test", "unchecked"];
const all = { query: "", tags: everything, sort: "name" };
const titles = (view) => viewLibrary(library, view).map((one) => one.title);

test("with every tag on every bottle shows, by name, numbers as numbers", () => {
  assert.deepEqual(titles(all), [
    "3DMark03", "Doom 3", "Heroes 2", "Heroes 10", "Quake III Arena", "WineHQ"]);
  assert.deepEqual(titles({ ...all, sort: "name-desc" }).slice(0, 2), ["WineHQ", "Quake III Arena"]);
});

test("a quick search matches any part of the title, in any case", () => {
  assert.deepEqual(titles({ ...all, query: " ARENA" }), ["Quake III Arena"]);
  assert.deepEqual(titles({ ...all, query: "xyz" }), []);
});

test("a tag turned off takes away everything marked with it", () => {
  const without = (tag) => ({ ...all, tags: everything.filter((one) => one !== tag) });
  assert.deepEqual(titles(without("demo")), ["3DMark03", "Heroes 2", "Heroes 10", "WineHQ"]);
  assert.deepEqual(titles(without("benchmark")).includes("3DMark03"), false);
  assert.deepEqual(titles(without("application")).includes("WineHQ"), false);
  // The kind is a tag like the rest: a demo that is a game goes with the games.
  assert.deepEqual(titles(without("game")), ["WineHQ"]);
});

test("turned on, a tag brings its bottles back, and a bottle needs all of its tags on", () => {
  // The opening choice: the games and the demos. A game that is also a
  // benchmark is not there while benchmarks are off, an application is not
  // there at all.
  assert.deepEqual(titles({ ...all, tags: ["game", "demo", "unchecked"] }),
    ["Doom 3", "Heroes 2", "Heroes 10", "Quake III Arena"]);
  assert.deepEqual(titles({ ...all, tags: ["game", "demo", "benchmark", "unchecked"] }),
    ["3DMark03", "Doom 3", "Heroes 2", "Heroes 10", "Quake III Arena"]);
  // Demos on, games off: a demo that is a game has a tag that is off.
  assert.deepEqual(titles({ ...all, tags: ["demo"] }), []);
  assert.deepEqual(titles({ ...all, tags: [] }), []);
});

test("the search narrows what the tags let in", () => {
  assert.deepEqual(titles({ ...all, query: "doom" }), ["Doom 3"]);
  assert.deepEqual(titles({ ...all, tags: ["game"], query: "winehq" }), []);
});

test("by year, the bottle without one is last either way", () => {
  assert.deepEqual(titles({ ...all, sort: "year-asc" }),
    ["Heroes 2", "Quake III Arena", "3DMark03", "Doom 3", "Heroes 10", "WineHQ"]);
  assert.deepEqual(titles({ ...all, sort: "year-desc" }),
    ["Heroes 10", "Doom 3", "3DMark03", "Quake III Arena", "Heroes 2", "WineHQ"]);
});

test("the list asked about is not reordered", () => {
  const before = library.map((one) => one.title);
  viewLibrary(library, { ...all, sort: "year-desc" });
  assert.deepEqual(library.map((one) => one.title), before);
});

test("a status is one tag: a bottle nobody checked goes with the unchecked ones", () => {
  const checked = [
    { id: "a", title: "A", kind: "game", labels: [], status: "playable" },
    { id: "b", title: "B", kind: "game", labels: [], status: null },
  ];
  const shown = (tags) => viewLibrary(checked, { query: "", tags, sort: "name" }).map((one) => one.id);
  assert.deepEqual(shown(["game", "playable", "unchecked"]), ["a", "b"]);
  assert.deepEqual(shown(["game", "playable"]), ["a"]);
  assert.deepEqual(shown(["game", "unchecked"]), ["b"]);
});
