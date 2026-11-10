#!/usr/bin/env node
// Original, read-only object API probe. Official source remains ignored.
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import crypto from "node:crypto";
const out = "dist/kn-objects";
await fs.mkdir(out, { recursive: true });
const require = createRequire(path.join(process.env.NEKOC_NODE_MODULES, "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const report = { checkedAt: new Date().toISOString(), bundles: [], pageErrors: [] };
try {
  const page = await browser.newPage();
  page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const name = path.basename(new URL(route.request().url()).pathname);
    await fs.writeFile(path.join(out, name), bytes);
    report.bundles.push({ name, url: route.request().url(), sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    let source = bytes.toString("utf8");
    if (name.startsWith("main.")) source = source.replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=")
      .replace("return n}var m=n(8586)", "return n}window.__knObjectsFactory=A;var m=n(8586)");
    await route.fulfill({ response, body: source });
  });
  await page.goto("https://kn.codemao.cn/editor", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  report.observations = await page.evaluate(() => {
    const req = window.__nekocRequire;
    const blinkId = Object.entries(req.m).find(([, factory]) => factory.toString().includes("BlinkInstance:function"))[0];
    const workspace = req(blinkId).BlinkInstance.core.mainWorkspace;
    const names = ["_object_literal", "_object_get", "_object_set", "_object_delete", "_object_keys", "Object.keys", "Object.values", "Object.entries", "Object.assign", "Object.hasOwnProperty", "Object.toString", "Object.delete", "JSON.parse", "JSON.stringify", "typeof", "type_of", "_typeof", "delete"];
    const availability = {};
    for (const type of names) {
      let block;
      try { block = workspace.new_block(type); availability[type] = { registered: true, inputs: block.inputList.map(i => ({ name: i.name, fields: i.fieldRow.map(f => ({ name: f.name, value: f.get_value?.() })) })) }; }
      catch (e) { availability[type] = { registered: false, error: e.message }; }
      finally { block?.dispose(); }
    }
    const signal = { immediate: { sub() {} } };
    const heart = { get_event_bus: () => ({ runtime_manager: { start: signal, stop: signal, restart: signal } }) };
    const extra = window.__knObjectsFactory({ runtime: { getHeart: () => ({ core: heart }) } });
    const encode = v => v === undefined ? { $undefined: true } : typeof v === "number" && !Number.isFinite(v) ? { $number: String(v) } : Array.isArray(v) ? v.map(encode) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, v]) => [k, encode(v)])) : v;
    const tests = [];
    const run = (name, args) => { try { tests.push({ name, args: encode(args), value: encode(extra[name](args)) }); } catch (e) { tests.push({ name, error: e.message }); } };
    run("_object_literal", { key0: "a", value0: 1, key1: "", value1: 2, key2: "b", value2: 3 });
    run("_object_literal", { key0: 12, value0: 1, key1: "b", value1: 2 });
    run("_object_literal", { key0: "a", value0: 1, key1: "a", value1: 2 });
    for (const obj of [{ a: 1 }, null, 12, "abc", [4, 5]]) for (const key of ["a", "missing", "length", 0]) run("_object_get", { obj, key });
    run("_object_set", { obj: { a: 1 }, key: "b", value: 2 });
    run("_object_set", { obj: 12, key: "b", value: 2 });
    run("Object.keys", { obj: { z: 1, 2: 2, 1: 3, a: 4 } });
    run("JSON.parse", { text: "bad" });
    const conv = req(58890), conversions = [];
    for (const code of ["({a: 1, b: 2});", "a.x = 2;", "Object.keys({a: 1});", "JSON.parse('{}');", "JSON.stringify({a: 1});", "typeof a;", "delete a.x;"]) {
      try { conversions.push({ code, result: conv._j(code) }); } catch (e) { conversions.push({ code, error: e.message }); }
    }
    return { availability, domainNames: Object.keys(extra).filter(n => /Object|JSON|typeof|delete|_object/.test(n)), tests, conversions };
  });
} finally { await browser.close(); await fs.writeFile(`${out}/oracle.json`, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify(report.observations, null, 2));
