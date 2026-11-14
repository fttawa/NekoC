import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import init, * as wasm from "../dist/web/nekoc_wasm.js";
import { api } from "../api.mjs";
import { decodeFrame } from "../frame.mjs";

test("web-target bindings initialize and execute the shared API", async () => {
  await init({ module_or_path: fs.readFileSync(new URL("../dist/web/nekoc_wasm_bg.wasm", import.meta.url)) });
  const { compile, check, createPlayer } = api(wasm);
  const files = { "/main.ts": 'onStart(() => { console.log("web-target"); });' };
  assert.equal(check("/main.ts", { files }).ok, true);
  const player = createPlayer(compile("/main.ts", { files }).bcmkn);
  try {
    const logs = [];
    for (let n = 0; n < 30; n++) logs.push(...decodeFrame(player.handle({ dt: 1 / 60, budget_ms: 16 })).logs);
    assert.deepEqual(logs, ["web-target"]);
  }
  finally { player.free(); }
});
