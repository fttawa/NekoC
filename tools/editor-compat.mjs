#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: "https://kn.codemao.cn/editor" },
    channel: { type: "string" },
    out: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help || !positionals.length) {
  console.log("Usage: node tools/editor-compat.mjs <project.bcmkn> [...] [--channel msedge] [--out report.json]");
  process.exit(values.help ? 0 : 2);
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  if (process.env.NEKOC_NODE_MODULES) {
    return createRequire(path.join(process.env.NEKOC_NODE_MODULES, "package.json"))("playwright");
  }
  return require("playwright");
}

// The official runtime resolves a procedures_2_parameter through the param id
// in its mutation (id="..."), which must name one of the procedure's params
// and its procedures_2_stable_parameter block. Otherwise it raises
// procedure_no_such_parameter when the project starts.
function procedureParameterIssues(project) {
  const issues = [];
  for (const [procedureId, procedure] of Object.entries(project.procedures?.proceduresDict ?? {})) {
    const paramIds = new Set((procedure.params ?? []).map(param => param.id));
    const blocks = [];
    const walk = value => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        if (typeof value.type === "string") blocks.push(value);
        Object.values(value).forEach(walk);
      }
    };
    walk(procedure.nekoBlockJsonList);
    const defined = new Set(blocks.filter(block => block.type === "procedures_2_stable_parameter").map(block => block.id));
    for (const block of blocks) {
      if (block.type !== "procedures_2_parameter") continue;
      const id = /id="([^"]+)"/.exec(block.mutation ?? "")?.[1];
      if (!id || !paramIds.has(id) || !defined.has(id)) {
        issues.push({ kind: "procedure_no_such_parameter", owner: procedureId, block: block.id, param: block.fields?.param_name, paramId: id ?? null });
      }
    }
  }
  return issues;
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, ...(values.channel ? { channel: values.channel } : {}) });
  const report = { editorUrl: values.url, checkedAt: new Date().toISOString(), projects: [] };
  try {
    for (const input of positionals) {
      const project = JSON.parse(await readFile(input, "utf8"));
      const page = await browser.newPage();
      // Large native projects can exceed Playwright's deep argument serializer.
      // Transfer the exact JSON through a same-origin route, not evaluate args.
      const projectUrl = new URL("/__nekoc_editor_compat_project__.json", values.url).href;
      await page.route(projectUrl, route => route.fulfill({ contentType: "application/json", body: JSON.stringify(project) }));
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      // Expose the editor's module loader in this isolated browser only. Discover
      // modules by their exports rather than pinning build-specific numeric IDs.
      await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/, async route => {
        const response = await route.fetch();
        const source = await response.text();
        const marker = "var __webpack_exports__=";
        if (!source.includes(marker)) throw new Error("Editor bundle loader changed; update the compatibility probe");
        report.bundleUrl = route.request().url();
        await route.fulfill({ response, body: source.replace(marker, `window.__nekocRequire=__webpack_require__;${marker}`) });
      });
      await page.goto(values.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") &&
        (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 60000 });
      const result = await page.evaluate(async projectUrl => {
        const project = await (await fetch(projectUrl)).json();
        const req = window.__nekocRequire;
        function findExport(name) {
          for (const [id, factory] of Object.entries(req.m)) {
            if (!factory.toString().includes(`${name}:function`)) continue;
            const exports = req(id);
            if (exports[name]) return exports;
          }
          throw new Error(`Editor export missing: ${name}`);
        }
        const { BcmInstance: bcm, BcmHelpers: helpers } = findExport("BcmInstance");
        const { BlinkInstance: blink } = findExport("BlinkInstance");
        const stores = findExport("createStores").default;
        const editorVersion = bcm.getBcm().version;
        bcm.setBcm(project);
        blink.workspaceManager.loadWorkspacesFromBcm();
        blink.broadcastManager.loadBroadcastsFromBcm(project);
        const issues = [];
        if (!helpers.validateBcm(project)) issues.push({ kind: "invalid_project" });
        let blockCount = 0;
        for (const [id, workspace] of blink.workspaceManager.workspaces) {
          const sceneId = Object.values(project.scenes.scenesDict).find(scene => scene.id === id || scene.actorIds.includes(id))?.id
            ?? project.scenes.currentSceneId;
          bcm.setCurrentSceneId(sceneId);
          stores.ComponentsStore.SpritePanelStore.setCurrentSceneId(sceneId);
          stores.ComponentsStore.SpritePanelStore.selectSpriteId = id;
          const data = workspace.getWorkspaceDataJson();
          const expected = structuredClone(data);
          blink.workspaceManager.selectWorkspace(id, true);
          const rendered = blink.core.mainWorkspace;
          for (const block of Object.values(expected.blocks)) {
            blockCount++;
            const actual = rendered.get_block_by_id(block.id);
            if (!actual) { issues.push({ kind: "missing_block", owner: id, type: block.type }); continue; }
            for (const [childId, connection] of Object.entries(expected.connections[block.id] ?? {})) {
              const child = connection.type === "next" ? actual.get_next_block()
                : actual.get_input_target_block(connection.input_name);
              if (child?.id !== childId) issues.push({ kind: "changed_connection", owner: id, type: block.type, childId });
            }
            for (const [field, value] of Object.entries(block.fields ?? {})) {
              const actualValue = actual.get_field_value(field);
              // Extensions remove inactive fields, e.g. relative layer when
              // the absolute top/bottom layer selector is used.
              if (actualValue !== undefined && String(value) !== String(actualValue)) {
                issues.push({ kind: "changed_field", owner: id, type: block.type, field, expected: value, actual: actualValue });
              }
            }
          }
        }
        return { editorVersion, projectVersion: project.version, blockCount, issues };
      }, projectUrl);
      result.issues.push(...procedureParameterIssues(project));
      report.projects.push({ input: path.resolve(input), ...result, pageErrors, ok: !result.issues.length && !pageErrors.length });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  report.ok = report.projects.every(project => project.ok);
  const output = JSON.stringify(report, null, 2);
  if (values.out) await writeFile(values.out, output);
  console.log(output);
  if (!report.ok) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
