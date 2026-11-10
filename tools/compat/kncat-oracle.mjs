#!/usr/bin/env node
// Original read-only KN evidence probe. Third-party responses remain in dist/kncat.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const out = "dist/kncat";
await fs.mkdir(out, { recursive: true });
const candidates = ["__break__", "_break_statement", "_continue_statement", "_return_statement", "controls_while", "calculate", "get_timer", "reset_timer", "script_variables_set", "change_script_variables", "_execute", "_array_literal"];
const require = createRequire(path.join(process.env.NEKOC_NODE_MODULES, "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const report = { checkedAt: new Date().toISOString(), bundles: [], pageErrors: [] };
try {
  const page = await browser.newPage();
  page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const bytes = await response.body();
    const name = path.basename(new URL(route.request().url()).pathname);
    await fs.writeFile(path.join(out, name), bytes);
    report.bundles.push({ name, url: route.request().url(), bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    let source = bytes.toString("utf8");
    if (name.startsWith("main.")) source = source.replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=")
      .replace("return n}var m=n(8586)", "return n}window.__kncatDomainFactory=A;var m=n(8586)");
    await route.fulfill({ response, body: source });
  });
  await page.goto("https://kn.codemao.cn/editor", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 90000 });
  report.editor = await page.evaluate(candidates => {
    const req = window.__nekocRequire;
    function find(name) {
      for (const [id, factory] of Object.entries(req.m)) {
        if (!factory.toString().includes(`${name}:function`)) continue;
        const exp = req(id);
        if (exp[name]) return exp[name];
      }
      throw new Error(name);
    }
    const blink = find("BlinkInstance");
    const bcm = find("BcmInstance");
    const workspace = blink.core.mainWorkspace;
    const availability = {};
    for (const type of [...candidates, "break", "break_loop", "controls_whileUntil", "procedures_2_return_value", "variables_set", "change_variables", "timer", "math_calculate"]) {
      let block;
      try {
        block = workspace.new_block(type);
        availability[type] = { registered: true, actualType: block.type, inputs: block.inputList?.map(input => ({ name: input.name, fields: input.fieldRow?.map(field => ({ name: field.name, value: field.get_value?.() })) })) };
      } catch (error) { availability[type] = { registered: false, error: error.message }; }
      finally { block?.dispose(); }
    }
    const moduleMatches = [];
    for (const [id, factory] of Object.entries(req.m)) {
      const source = factory.toString();
      const names = candidates.filter(name => source.includes(name));
      if (names.length) moduleMatches.push({ id, names, length: source.length });
    }
    const modules = {};
    for (const id of [8541, 36041, 59153, 70542, 96733, 96901]) {
      modules[id] = { source: req.m[id].toString() };
      try { modules[id].exports = JSON.parse(JSON.stringify(req(id))); } catch (error) { modules[id].error = error.message; }
    }
    const constants = [];
    for (const [id, factory] of Object.entries(req.m)) {
      const source = factory.toString();
      if (!["whileLoop:", "breakStatement:", "returnStatement:", "resetTimer:", "getTimer:"].some(word => source.includes(word))) continue;
      try { constants.push({ id, exports: JSON.parse(JSON.stringify(req(id))), source }); } catch {}
    }
    const conv = req(58890), basic = req(96733);
    const conversions = [];
    for (const code of ["while (false) { break; }", "while (true) { break; }", "return 7;", "[3, 1, 2];", "script_variables_set('a', 4);", "change_script_variables('a', 'increase', 2);", "break_loop();"]) {
      try { const xml = conv._j(code); conversions.push({ code, toXml: xml, toJs: xml.xml ? conv.Eb(xml.xml) : null }); }
      catch (error) { conversions.push({ code, error: error.stack }); }
    }
    const xmlConversions = [];
    for (const xml of ['<xml><block type="_return_statement"><value name="VALUE"><shadow type="math_number"><field name="NUM">7</field></shadow></value></block></xml>', '<xml><block type="change_variables"><field name="variable">{"type":"NEKO_SCRIPT_VARIABLE_TYPE-957f2554-87af","name":"a"}</field><field name="method">increase</field><value name="value"><shadow type="math_number"><field name="NUM">2</field></shadow></value></block></xml>']) {
      try { xmlConversions.push({ xml, toJs: conv.Eb(xml) }); } catch (error) { xmlConversions.push({ xml, error: error.stack }); }
    }
    const generated = basic.iJ().generateBasicConfig();
    const configs = generated.categories.flatMap(category => category.blocks).filter(block => [...candidates, "break"].includes(block.type));
    const types = basic.ZH();
    const candidateTypes = Object.fromEntries([...candidates, "break"].filter(name => types[name]).map(name => [name, types[name]]));
    const domain = req(70542).get_domain_functions({}, {}, {}, { user: { block_bad_math_expression: data => ({ kind: "block_bad_math_expression", ...data }) } }, [], {})();
    const calculate = [];
    for (const input of ["1+2*3", "(1+2)*3", "2^3", "2**3", "sin(30)", "sqrt(9)", "1/0", "bad(", "", "1e2+1", "-3+2", "2+", 7]) {
      try { calculate.push({ input, value: String(domain.calculate({ input })) }); }
      catch (error) { calculate.push({ input, error: JSON.parse(JSON.stringify(error)) }); }
    }
    const runtimeTests = { calculate };
    try {
      const heart = req(26921).cG.get_instance().getHeart().core;
      const registry = heart.get_registry();
      runtimeTests.registry = Object.fromEntries([...candidates, "break", "variables_set", "change_variables"].map(type => [type, registry.get_domain_function_index(type) ?? null]));
    } catch (error) { runtimeTests.registryError = error.stack; }
    const timerClass = req(8541).RuntimeManagerImpl;
    if (timerClass) {
      const proto = timerClass.prototype, timer = { timer_block_date: Date.now() - 1234 };
      const before = proto.get_timer_elapsed_s.call(timer);
      proto.reset_timer.call(timer);
      const after = proto.get_timer_elapsed_s.call(timer);
      runtimeTests.timer = { before, after, origin: timer.timer_block_date, functions: { get: proto.get_timer_elapsed_s.toString(), reset: proto.reset_timer.toString(), run: proto.run.toString() } };
    }
    try {
      req(65191);
      const signal = { immediate: { sub() {} } };
      const heart = { get_event_bus: () => ({ runtime_manager: { start: signal, stop: signal, restart: signal } }) };
      const extra = window.__kncatDomainFactory({ runtime: { getHeart: () => ({ core: heart }) } });
      runtimeTests.arrayLiteral = [{ input: { items0: "a", items1: "b" }, value: extra._array_literal({ items0: "a", items1: "b" }) }, { input: { 2: "two", 1: "one", z: "last" }, value: extra._array_literal({ 2: "two", 1: "one", z: "last" }) }];
      let calls = 0;
      runtimeTests.execute = { returnType: typeof extra._execute({ action: () => { calls++; } }), calls };
    } catch (error) { runtimeTests.extraError = error.stack; }
    return { version: bcm.getBcm().version, availability, moduleMatches, modules, constants, conversions, xmlConversions, configs, candidateTypes, runtimeTests };
  }, candidates);
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, "oracle-editor.json"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ version: report.editor?.version, bundles: report.bundles.length, modules: Object.keys(report.editor?.modules ?? {}), constants: report.editor?.constants?.map(item => item.id) }, null, 2));
