import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The local web backend serves the player from include_bytes! routes, so a
// module the pages import but web.rs does not route fails to load in Studio.
const source = fs.readFileSync(new URL("../src/bin/web.rs", import.meta.url), "utf8");
const routed = new Set([...source.matchAll(/"\/([\w.-]+\.js)" => Some/g)].map(match => match[1]));

function staticImports(file) {
  const text = fs.readFileSync(new URL(`../web/${file}`, import.meta.url), "utf8");
  return [...text.matchAll(/(?:^|[;\n])\s*import\s[^'"]*?['"]\.\/([\w.-]+\.js)['"]/g)].map(match => match[1]);
}

test("web.rs serves every module the player and Studio import", () => {
  // wasm-worker.js runs only with the wasm backend, which local pages never pick.
  const seen = new Set(), pending = ["app.js", "play.js"];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    pending.push(...staticImports(file));
  }
  assert.ok(seen.has("backend.js"), [...seen].join(", "));
  for (const file of seen) assert.ok(routed.has(file), `web.rs does not serve /${file}`);
});
