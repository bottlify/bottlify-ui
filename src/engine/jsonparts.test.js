import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonParts } from "./jsonparts.js";

test("the pieces join into what JSON.stringify writes", () => {
  const value = {
    name: "graphics",
    skipped: undefined,
    call: () => 0,
    device: {
      dumps: [{ frame: 0, lines: ["#0 a", "#1 \"b\""] }, { frame: 10, lines: [] }],
      holes: [1, undefined, () => 0, null],
      words: new Float32Array([1.5, 2]),
      at: new Date(0),
      deep: { a: { b: { c: { d: [1, { e: 2 }] } } } },
    },
  };
  assert.equal(jsonParts(value).join(""), JSON.stringify(value));
  assert.equal(jsonParts(null).join(""), "null");
  assert.equal(jsonParts(undefined).join(""), "null");
  assert.ok(jsonParts(value).length > 10, "opened into pieces rather than one string");
});
