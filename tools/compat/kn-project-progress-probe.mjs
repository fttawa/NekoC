#!/usr/bin/env node
// Read-only official KN project progress oracle. No local runtime or benchmark.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const out = "dist/kn-project-progress";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES, "package.json"));
const { chromium } = require("playwright");
const settle = process.argv.includes("--settle");
const shortWorld = process.argv.includes("--short-world");
const reportName = shortWorld ? "short-world-report.json" : settle ? "settled-report.json" : "report.json";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const report = { checkedAt: new Date().toISOString(), editorUrl: "https://kn.codemao.cn/editor",
  method: `${shortWorld ? "Explicit short-world diagnostic project" : "Exact original projects"} via previewUrl; official bundle unchanged except webpack loader exposure. Passive variable/list/actor snapshots; no synthesized input. Wall-clock samples are NOT frame counts.`,
  browserVersion: browser.version(), cases: {} };
try {
  const files = process.argv.slice(2).filter(a => !a.startsWith("--"));
  for (const fixture of files.length ? files : ["projects/fangjie/fangjie.bcmkn", "projects/tiny-lm/tiny_lm.bcmkn"]) {
    let source = await fs.readFile(fixture, "utf8"), project = JSON.parse(source);
    const originalSha256 = sha256(source);
    if (shortWorld) {
      let changed = 0;
      const walk = node => {
        if (!node || typeof node !== "object") return;
        if (node.type === "math_number" && String(node.fields?.NUM) === "524287") { node.fields.NUM = "7"; changed++; }
        Object.values(node).forEach(walk);
      };
      walk(project);
      if (changed !== 1) throw new Error(`Expected one world loop bound, got ${changed}`);
      source = JSON.stringify(project);
      await fs.writeFile(path.join(out, "fangjie-short-world.bcmkn"), source);
    }
    const name = path.basename(path.dirname(fixture));
    const result = report.cases[name] = { fixture, sha256: sha256(source), pageErrors: [], bundles: [], samples: [] };
    if (shortWorld) Object.assign(result, { fixture: `${out}/fangjie-short-world.bcmkn`, originalFixture: fixture, originalSha256, diagnosticChange: "Only traverse_number upper bound math_number 524287 -> 7 (world initialization 524288 -> 8 iterations)" });
    const page = await browser.newPage();
    page.on("pageerror", e => result.pageErrors.push(e.stack));
    try {
      await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
        const response = await route.fetch(), bytes = await response.body();
        const url = route.request().url(), name = path.basename(new URL(url).pathname);
        await fs.writeFile(path.join(out, name), bytes);
        result.bundles.push({ name, url, bytes: bytes.length, sha256: sha256(bytes) });
        let body = bytes.toString("utf8");
        if (name.startsWith("main.")) {
          const marker = "var __webpack_exports__=";
          if (!body.includes(marker)) throw new Error("Official loader changed");
          body = body.replace(marker, `window.__nekocRequire=__webpack_require__;${marker}`);
        }
        await route.fulfill({ response, body });
      });
      const projectUrl = "https://kn.codemao.cn/__nekoc_project_progress__.bcmkn";
      await page.route(projectUrl, route => route.fulfill({ contentType: "application/json", body: source }));
      await page.goto(`${report.editorUrl}?previewUrl=${encodeURIComponent(projectUrl)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(projectName => window.__nekocRequire && document.querySelector("canvas") &&
        window.__nekocRequire(91107).BcmInstance.getBcm().projectName === projectName &&
        (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), project.projectName, { timeout: 120000 });
      await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
      const done = page.getByText(/^完成$/).last();
      if (await done.isVisible()) await done.dispatchEvent("click");
      result.runtimeInspection = await page.evaluate(() => {
        const core = window.__nekocRequire(26921).cG.get_instance().getHeart().core;
        const describe = value => ({ own: Object.keys(value), prototype: Object.getOwnPropertyNames(Object.getPrototypeOf(value)) });
        return { core: describe(core), manager: describe(core.get_runtime_manager()), data: describe(core.get_runtime_data()), config: core.get_util().config.get() };
      });
      const snapshot = async label => {
        const sample = await page.evaluate(label => {
          const req = window.__nekocRequire, runtime = req(26921).cG.get_instance(), core = runtime.getHeart().core;
          const manager = core.get_runtime_manager(), bcm = req(91107).BcmInstance;
          const encode = value => value === undefined ? { $undefined: true } : typeof value === "number" && !Number.isFinite(value) ? { $number: String(value) } : value;
          const variables = Object.fromEntries(Object.entries(bcm.variablesDict).filter(([id]) =>
            /chunk_x|chunk_z|world$|kn-var-(screen|gui_dirty|px|py|pz)$|lm_(generated|frames|phase|prefill|position|status|running|tokens_processed|output|ready|input_token|next_token|last_position|last_input|prompt_tokens|generated_ids|keys|values|logits|top_ids)$/.test(id)).map(([id, v]) => {
              const value = manager.get_variable(id, undefined, v.currentEntityId);
              return [id, Array.isArray(value) ? { length: value.length, head: value.slice(0, 40).map(encode), tail: value.slice(-4).map(encode) } : encode(value)];
            }));
          const stage = req(54174).V;
          const actors = Object.keys(bcm.getBcm().actors.actorsDict).map(id => {
            const found = stage.core.actors.get_actor(id);
            if (found.is_error(found.value)) return { id, error: String(found.value) };
            const actor = found.value;
            return { id, x: actor.x, y: actor.y, position: { x: actor.position.x, y: actor.position.y }, logicalPosition: actor.get_position(), visible: actor.visible,
              ownKeys: Object.keys(actor).filter(k => /data|position|transform/.test(k)) };
          });
          return { label, at: performance.now(), running: core.get_runtime_data().is_running(), elapsedFrames: manager.get_elapsed_frames(), statistics: core.get_statistics(), variables, actors,
            text: document.body.innerText.slice(-800) };
        }, label);
        result.samples.push(sample);
        console.log(name, label, JSON.stringify({ variables: sample.variables, actors: sample.actors }));
        return sample;
      };
      await snapshot("before-start");
      await page.getByText(/^开始$/).last().dispatchEvent("click");
      for (const delay of [0, 100, 400, 1000, 2500, 5000]) {
        if (delay) await page.waitForTimeout(delay);
        await snapshot(`after-extra-${delay}ms`);
      }
      if (settle) {
        try { await page.waitForFunction(name => {
          const manager = window.__nekocRequire(26921).cG.get_instance().getHeart().core.get_runtime_manager();
          const actor = window.__nekocRequire(54174).V.core.actors.get_actor("nekoc-default-actor");
          return name === "fangjie" ? manager.get_variable("kn-list-chunk_x").length === 64 && manager.get_variable("kn-var-gui_dirty") === 0 && actor.value.get_position().y === -65
            : manager.get_variable("kn-var-lm_running") === 0 && manager.get_variable("kn-var-lm_position") > 0;
        }, name, { timeout: 300000 }); }
        catch (error) { await snapshot("settle-timeout"); throw error; }
        await page.waitForTimeout(200);
        await snapshot("settled");
      }
    } catch (e) { result.failure = e.stack; }
    finally { await page.close(); }
    await fs.writeFile(path.join(out, reportName), JSON.stringify(report, null, 2) + "\n");
  }
} finally { await browser.close(); }
report.ok = Object.values(report.cases).every(r => !r.failure && !r.pageErrors.length && r.samples.length === (settle ? 8 : 7));
await fs.writeFile(path.join(out, reportName), JSON.stringify(report, null, 2) + "\n");
if (!report.ok) process.exitCode = 1;
