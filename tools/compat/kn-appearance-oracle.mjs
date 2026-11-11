#!/usr/bin/env node
// Original probe; official bundle bodies are unchanged, apart from exposing webpack.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const out = "dist/kncat";
await fs.mkdir(out, { recursive: true });
const require = createRequire(path.join(process.env.NEKOC_NODE_MODULES, "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const report = { bundles: [], pageErrors: [] };
try {
  const page = await browser.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const name = path.basename(new URL(route.request().url()).pathname);
    await fs.writeFile(path.join(out, name), bytes);
    report.bundles.push({ name, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    const source = bytes.toString("utf8").replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=");
    await route.fulfill({ response, body: source });
  });
  await page.goto("https://kn.codemao.cn/editor", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 90000 });
  report.tests = await page.evaluate(() => {
    const req = window.__nekocRequire;
    function find(name) {
      for (const [id, factory] of Object.entries(req.m)) {
        if (!factory.toString().includes(`${name}:function`)) continue;
        const exp = req(id); if (exp[name]) return exp[name];
      }
      throw Error(name);
    }
    const workspace = find("BlinkInstance").core.mainWorkspace;
    const registered = {};
    for (const type of ["appearance_of_sprite", "self_dialog_wait", "get_sprite_property", "procedures_2_actor_param"]) {
      let b;
      try { b = workspace.new_block(type); registered[type] = { ok: true, inputs: b.inputList.map(i => ({ name: i.name, fields: i.fieldRow.map(f => ({ name: f.name, value: f.get_value?.() })) })) }; }
      catch (e) { registered[type] = { ok: false, error: e.message }; }
      finally { b?.dispose(); }
    }
    const property = find("getSceneOrActorProperty");
    const actor = { type: "actor", get_current_style: () => null, get_scale: () => ({ x: 1.23456, y: 0.56789 }), get_position: () => ({ x: 1.23456, y: -2.34567 }), get_rotation: () => Math.PI / 7, get_visible: () => false, get_alpha: () => 0.25 };
    const properties = Object.fromEntries(["x", "y", "scale", "width", "height", "direction", "1"].map(key => [key, property(actor, key)]));
    const conv = req(58890);
    const conversions = ["get_sprite_property('--self', 'height');", "get_sprite_property('--self', 'camp');"].map(code => ({ code, result: conv._j(code) }));
    const calls = [], tasks = [];
    const dialogManager = { load_actor_dialog: (...a) => calls.push(a), destroy_actor_dialog: () => {} };
    const runtime = { getHeart: () => ({ core: { get_runtime_manager: () => ({ add_task: x => { tasks.push({ lifetime: x.lifetime, blocking: x.blocking }); return { stop() {} }; } }) } }) };
    const stage = req(97339).V;
    const old = stage.core.actors.get_actor;
    stage.core.actors.get_actor = id => ({ value: actor, is_error: () => false });
    actor.get_visible = () => true;
    let dialog;
    try {
      const options = { runtime, basicStage: { core: { components: { get_actor_dialog_manager: () => dialogManager } } } };
      const bubble = req(17889).d;
      bubble("probe-actor", "a b", Infinity, "talk", false, "thread", options);
      bubble("probe-actor", "x".repeat(91), Infinity, "think", false, "thread", options);
      bubble("probe-actor", "timed", 0.25, "talk", true, "thread", options);
      dialog = { calls, tasks };
    } catch (e) { dialog = { calls, tasks, error: e.stack }; }
    finally { stage.core.actors.get_actor = old; }
    return { registered, properties, conversions, dialog };
  });
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, "appearance-dialog-oracle.json"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report.tests, null, 2));
