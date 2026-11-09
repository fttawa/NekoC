#!/usr/bin/env node
// Read-only official bundle evidence; writes diagnostics only under dist/kngap.
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(path.join(process.env.NEKOC_NODE_MODULES, "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage();
  const evidence = { sources: [] };
  await page.route(/\/(main|crc_libs)\.[\w-]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    let source = await response.text();
    if (route.request().url().includes("/main.")) {
      for (const name of ["_variable_set", "_variable_get", "math_add_assign", "math_sub_assign", "math_mul_assign", "math_div_assign", "math_mod_assign", "math_increment", "math_decrement", "logic_to_boolean", "atob", "btoa", "parseInt", "parseFloat", "isNaN", "isFinite"]) {
        const at = source.indexOf(`${name}:function`);
        evidence.sources.push({ name, url: route.request().url(), offset: at,
          excerpt: at < 0 ? null : source.slice(at, at + 260) });
      }
      source = source.replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=");
    } else {
      source = source.replace('throw new Error("Something wrong with json data. Unable to convert it to workspace.")',
        'throw new Error("Workspace underlying error: "+n.stack)');
    }
    await route.fulfill({ response, body: source });
  });
  await page.goto("https://kn.codemao.cn/editor", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") &&
    (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"));
  const project = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
  evidence.load = await page.evaluate(project => {
    const req = window.__nekocRequire;
    const find = name => {
      for (const [id, factory] of Object.entries(req.m)) {
        if (!factory.toString().includes(`${name}:function`)) continue;
        const exp = req(id);
        if (exp[name]) return exp[name];
      }
      throw new Error(name);
    };
    const availability = {};
    const workspace = find("BlinkInstance").core.mainWorkspace;
    for (const type of ["script_variables_set","change_script_variables","_variable_get","_variable_set","math_add_assign","math_sub_assign","math_mul_assign","math_div_assign","math_mod_assign","math_increment","math_decrement","logic_to_boolean","btoa","atob","parseInt","parseFloat","get_timer","reset_timer","isNaN","isFinite","controls_while"]) {
      try { const block = workspace.new_block(type); availability[type] = { fields: block.get_field_value("radix"), inputs: block.inputList?.map(input => input.name) }; block.dispose(); }
      catch (error) { availability[type] = error.message; }
    }
    try {
      find("BcmInstance").setBcm(project);
      find("BlinkInstance").workspaceManager.loadWorkspacesFromBcm();
      find("BlinkInstance").workspaceManager.selectWorkspace("nekoc-default-actor", true);
      return { ok: true, availability };
    } catch (error) { return { ok: false, availability, error: error.stack }; }
  }, project);
  await fs.writeFile("dist/kngap/official-evidence.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence.load, null, 2));
} finally { await browser.close(); }
