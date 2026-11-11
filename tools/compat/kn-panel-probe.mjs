#!/usr/bin/env node
// Original panel audit, not a runtime/device test. Third-party bytes stay in dist.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { catalogTypes, catalogSha256 } from "./kn-catalog-manifest.mjs";

export const apiAliasTypes = ["__break__", "change_script_variables", "get_sprite_property", "script_variables_set"];

// Deliberately has no 'retired' result: absence cannot establish past availability.
export function classifyPanelType(row) {
  if (row.managerCategories.length) return row.defaultHidden ? "panel-configurable-default-hidden" : "panel-default";
  if (row.hardwareCategories.length) return "hardware-extension-config-not-installed";
  if (row.flyoutCategories.length) return "panel-nested-or-dynamic";
  if (row.registered) return "registered-not-in-audited-panels";
  if (row.apiAlias) return "code-api-alias-not-block";
  return "not-found-in-audited-environment";
}

async function main() {
  const out = "dist/kn-panel";
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES || `${out}/deps/node_modules`, "package.json"));
  const { chromium } = require("playwright");
  await fs.mkdir(out, { recursive: true });
  const report = {
    schema: "nekoc-kn-panel-v1", checkedAt: new Date().toISOString(),
    editorUrl: "https://kn.codemao.cn/editor", catalogSha256,
    method: "Fresh anonymous desktop Edge. Expose webpack loader without changing official functions. Read initial toolbox/flyout nodes, render every ordinary/AI manager category, inspect exported hardware panel configs without installing or connecting devices. Construct/dispose candidate blocks with Blockly events temporarily disabled; read domain indices only, never invoke domains.",
    bundles: [], pageErrors: [],
    limitations: [
      "One anonymous desktop build and default sprite; not a historical, logged-in, mobile, kids or classroom audit.",
      "Hardware cards and exported panel configs are evidence of current extension definitions, not installed registration or working devices. No extension was installed and no device domain was invoked.",
      "Manager config entries, rendered block types, flyout nested types, registry definitions and domain indices are separate observations. None proves complete execution semantics.",
      "Not found does not mean unofficial or retired; retirement requires independent historical evidence. No candidate is certified retired here."
    ]
  };
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => report.pageErrors.push(error.message));
    await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
      const response = await route.fetch(), bytes = await response.body();
      const url = route.request().url(), name = path.basename(new URL(url).pathname);
      await fs.writeFile(path.join(out, name), bytes);
      report.bundles.push({ name, url, bytes: bytes.length, sha256: sha256(bytes) });
      const source = name.startsWith("main.") ? bytes.toString("utf8").replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") : bytes;
      await route.fulfill({ response, body: source });
    });
    await page.goto(report.editorUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.__nekocRequire?.(40742).BlinkInstance?.core?.mainWorkspace && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
    await page.locator('[class*="KittenNVersion_closeButton"]').click({ timeout: 5000 }).catch(() => {});
    await page.getByText("编程猫", { exact: true }).click();
    await page.waitForFunction(() => window.__nekocRequire(40742).BlinkInstance.core.mainWorkspace.toolbox_.children_.length > 0, null, { timeout: 30000 });
    report.initial = await page.evaluate(() => {
      const req = window.__nekocRequire, blink = req(40742).BlinkInstance, ws = blink.core.mainWorkspace;
      const types = nodes => [...new Set((Array.isArray(nodes) ? nodes : []).flatMap(node => [node, ...node.querySelectorAll("block,shadow")]).map(node => node.getAttribute("type")).filter(type => type && !type.startsWith("<")))].sort();
      return {
        version: req(91107).BcmInstance.getBcm().version,
        categories: ws.toolbox_.children_.map(node => ({ id: node.name_, disabled: node.disabled_, callback: typeof node.blocks === "string" ? node.blocks : null, types: types(node.get_blocks(true)) })),
        hiddenCategories: [...blink.hideComputedToolboxs].sort(), hiddenTypes: [...blink.hideComputedBlocks].sort()
      };
    });
    await page.screenshot({ path: `${out}/panel.png` });
    await page.locator('[class*="ToolboxManagerButton_toolboxManagerIcon"]').click();
    await page.getByText("积木盒", { exact: true }).first().waitFor({ timeout: 30000 });
    report.manager = await page.evaluate(() => {
      const req = window.__nekocRequire, blink = req(40742).BlinkInstance, store = req(56526).Z;
      return {
        categories: blink.toolboxOptions.map(o => ({ id: o.type, types: o.blocks || [], ai: req(65687).f.includes(o.type), invisible: store.invisibleToolboxs.includes(o.type) })),
        hardwareCardsRegistered: store.hardwareCardList.map(({ id, name }) => ({ id, name }))
      };
    });
    report.managerRendered = [];
    for (const option of report.manager.categories.filter(o => !o.invisible)) {
      // Read-only selection in the manager; do not confirm/add any extension.
      await page.evaluate(({ id, ai }) => { const store = window.__nekocRequire(56526).Z; store.setCurrentTab(ai ? 1 : 0); store.setSelectedToolbox(id); }, option);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      report.managerRendered.push(await page.evaluate(id => ({ id,
        types: [...new Set([...document.querySelectorAll('[class*="BlocksSelect_blocksXmlContainer"] svg > g')].flatMap(e => [...e.classList].filter(c => !c.startsWith("blockly") && c !== "svg_num")))].sort(),
        text: document.querySelector('[class*="ToolboxManager_wrapper"]')?.innerText || ""
      }), option.id));
    }
    await page.screenshot({ path: `${out}/manager-ai.png` });
    await page.getByText("硬件", { exact: true }).click();
    await page.locator('[class*="HardwareSelect_hardwareType"]').first().waitFor({ timeout: 30000 });
    report.hardwareCardsRendered = await page.locator('[class*="HardwareSelect_hardwareType"]').allTextContents();
    await page.screenshot({ path: `${out}/manager-hardware.png` });
    report.editor = await page.evaluate(names => {
      const req = window.__nekocRequire, blink = req(40742).BlinkInstance;
      const registry = req(26921).cG.get_instance().getHeart().core.get_registry();
      const hardwareConfigs = [], configErrors = [], sourceModules = [];
      for (const [id, factory] of Object.entries(req.m)) {
        const source = String(factory);
        if (!source.includes("blocks:[") || !/id:"(?:microbit|tudao|catbit|wand|kittenbit)/.test(source)) continue;
        try {
          for (const [key, v] of Object.entries(req(id))) if (v && typeof v === "object" && Array.isArray(v.blocks)) {
            hardwareConfigs.push({ moduleId: id, export: key, id: v.id, name: v.text, types: v.blocks.map(b => b.type).filter(t => t && !t.startsWith("<")) });
            sourceModules.push({ id, source });
          }
        } catch (error) { configErrors.push({ moduleId: id, error: error.message }); }
      }
      const availability = {};
      blink.core.events.disable();
      try {
        for (const type of names) {
          let block;
          const row = availability[type] = { definitionRegistered: !!blink.core.Blocks[type], domainIndex: registry.get_domain_function_index(type) ?? null };
          try { block = blink.core.mainWorkspace.new_block(type); row.registered = true; row.actualType = block.type; }
          catch (error) { row.registered = false; row.error = error.message; }
          finally { try { block?.dispose(); } catch (error) { row.disposeError = error.message; } }
        }
      } finally { blink.core.events.enable(); }
      // Only authored sample programs are retained, never official function bodies.
      const conversions = [];
      for (const code of ["get_sprite_property('--self', 'x');", "get_sprite_property('--self', 'size');", "get_sprite_property('--self', 'color');", "script_variables_set('panel_probe', 4);", "change_script_variables('panel_probe', 'increase', 2);", "break_loop();"]) {
        const result = req(96733)._j(code);
        const xml = new DOMParser().parseFromString(result.xml, "text/xml");
        conversions.push({ code, blockTypes: [...xml.querySelectorAll("block")].map(b => b.getAttribute("type")), errors: result.errors, warnings: result.warnings });
      }
      const declaredTypes = req(96733).ZH();
      const aliases = Object.fromEntries(["__break__", "script_variables_set", "change_script_variables", "get_sprite_property"].map(type => [type, { declarationPresent: !!declaredTypes[type] }]));
      return { hardwareConfigs, configErrors, availability, conversions, aliases, sourceModules };
    }, catalogTypes);
    report.sourceLocations = [];
    for (const { id, source } of report.editor.sourceModules) {
      if (report.sourceLocations.some(row => row.moduleId === id)) continue;
      for (const bundle of report.bundles) {
        const bytes = await fs.readFile(path.join(out, bundle.name)), text = bytes.toString("utf8"), index = text.indexOf(`${id}:${source}`);
        if (index < 0) continue;
        report.sourceLocations.push({ moduleId: id, bundle: bundle.name, bundleSha256: bundle.sha256, byteOffset: Buffer.byteLength(text.slice(0, index)), evaluatedFactorySha256: sha256(source) });
        break;
      }
    }
    delete report.editor.sourceModules;
    const hardwareTypes = new Set(report.editor.hardwareConfigs.flatMap(c => c.types));
    report.rows = catalogTypes.map(type => {
      const row = {
        type, ...report.editor.availability[type], apiAlias: apiAliasTypes.includes(type),
        managerCategories: report.manager.categories.filter(c => c.types.includes(type)).map(c => c.id),
        flyoutCategories: report.initial.categories.filter(c => c.types.includes(type)).map(c => c.id),
        hardwareCategories: report.editor.hardwareConfigs.filter(c => c.types.includes(type)).map(c => c.id),
        defaultHidden: report.initial.hiddenTypes.includes(type)
      };
      row.classification = classifyPanelType(row);
      return row;
    });
    report.typeGroups = Object.fromEntries([...new Set(report.rows.map(r => r.classification))].sort().map(group => [group, report.rows.filter(r => r.classification === group).map(r => r.type)]));
    report.checks = {
      all300: report.rows.length === 300,
      managerCategoriesRendered: report.managerRendered.length === report.manager.categories.filter(c => !c.invisible).length,
      hardwareConfigsRead: report.editor.hardwareConfigs.length >= 10 && report.editor.configErrors.length === 0,
      hardwareCandidatesHaveConfig: catalogTypes.filter(t => /^(?:microbit_|catbit_|wand_)|robot2?_master/.test(t)).every(t => hardwareTypes.has(t)),
      noUnknownUnclassified: !report.typeGroups["not-found-in-audited-environment"],
      noPageErrors: report.pageErrors.length === 0,
      noDisposeErrors: report.rows.every(r => !r.disposeError),
      definitionAndConstructionAgree: report.rows.every(r => r.definitionRegistered === r.registered)
    };
    report.ok = Object.values(report.checks).every(Boolean);
  } catch (error) { report.failure = error.stack; report.ok = false; }
  finally { await browser.close(); }
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.exitCode = 1;
  console.log(JSON.stringify({ ok: report.ok, failure: report.failure, version: report.initial?.version, checks: report.checks, typeGroups: report.typeGroups, report: `${out}/report.json` }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
