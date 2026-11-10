import assert from "node:assert/strict";
import test from "node:test";
import { excerpts, names } from "../tools/compat/kncat-evidence.mjs";

test("official source evidence records missing names instead of inventing implementations", () => {
  const entries = excerpts("_execute:function(e){}", "https://example.invalid/main.js");
  assert.equal(entries.length, names.length);
  assert.equal(entries.find(e => e.name === "_execute").offset, 0);
  assert.equal(entries.find(e => e.name === "get_timer").offset, -1);
  assert.equal(entries.find(e => e.name === "get_timer").excerpt, null);
  assert.ok(entries.every(e => e.url === "https://example.invalid/main.js"));
});
