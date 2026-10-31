/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeBundle } from "./bundles.js";

test("a bottle's labels are the known ones, and a version of demo is read as the label", () => {
  const legacy = describeBundle("old", { title: "Old", version: "Demo" });
  assert.deepEqual([legacy.version, legacy.labels, legacy.kind], ["", ["demo"], "game"]);

  const marked = describeBundle("new", {
    title: "New", version: "1.2", labels: ["benchmark", "retail", "test"], kind: "application",
  });
  assert.deepEqual([marked.version, marked.labels, marked.kind], ["1.2", ["benchmark", "test"], "application"]);
  assert.equal(marked.id, "new");

  assert.equal(describeBundle("x", { kind: "movie" }).kind, "game", "an unknown kind is a game");
  assert.deepEqual(describeBundle("y", { version: "demo", labels: ["demo"] }).labels, ["demo"],
    "the label once, however it is said");
});

test("a picture set from the launcher is the bottle's own file, the others where they were", () => {
  const set = describeBundle("my-game", {
    coverLarge: "./cover-0123456789ab.webp",
    coverSmall: "./cover-0123456789ab.webp",
    wallpaper: "./wallpaper-ba9876543210.jpg",
  });
  assert.equal(set.coverLarge, "/bundles/my-game/cover-0123456789ab.webp");
  assert.equal(set.coverSmall, "/bundles/my-game/cover-0123456789ab.webp");
  assert.equal(set.wallpaper, "/bundles/my-game/wallpaper-ba9876543210.jpg");
  const shipped = describeBundle("doom-3", { coverLarge: "doom-3-cover.webp" });
  assert.equal(shipped.coverLarge, "/covers/doom-3-cover.webp", "a name alone is the launcher's art");
  assert.equal(shipped.wallpaper, "/covers/doom-3-cover.webp", "and the stage falls back to the cover");
});

test("Steam's pictures are shown from Steam, the bridge opening them to the page", () => {
  const cover = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/400/library_600x900.jpg";
  const hero = "https://cdn.akamai.steamstatic.com/steam/apps/400/library_hero.jpg?t=1";
  const bottle = describeBundle("steam-400", { coverLarge: cover, wallpaper: hero });
  assert.equal(bottle.coverSmall, cover);
  assert.equal(bottle.wallpaper, hero);
  assert.equal(describeBundle("x", { coverLarge: "https://example.com/apps/1/a.jpg" }).coverLarge,
    "https://example.com/apps/1/a.jpg", "another site's picture stays where it is");
});
