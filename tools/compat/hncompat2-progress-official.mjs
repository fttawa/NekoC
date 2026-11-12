#!/usr/bin/env node
// Passive wall-clock observations of exact originals. No scheduler/config/input patches.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES, "package.json"));
const { chromium } = require("playwright");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const out = "dist/hncompat2-progress";
const archive = "docs/compatibility/hncompat2-progress-official.json";
await fs.mkdir(out, { recursive: true });
await fs.mkdir(path.dirname(archive), { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const report = {
  schema: "nekoc-hncompat2-progress-official-v1", checkedAt: new Date().toISOString(),
  editorUrl: "https://kn.codemao.cn/editor", browserVersion: browser.version(),
  method: "Exact original UTF-8 project bytes via previewUrl; official online JavaScript unchanged except webpack loader exposure. Only editor Complete/Start UI events, then passive snapshots; no project edits, synthesized gameplay input, scheduler/config/time patches or local engines.",
  timeoutMsPerProject: 600000, sampleIntervalMs: 10000, cases: {},
  limitations: ["Wall-clock samples are not frame counts or equal-work comparisons.", "Milestone completion is not whole-project termination: both projects retain live event loops.", "No pixel, gameplay input, timer lifecycle or full runtime equivalence claim.", "List SHA-256 binds JSON.stringify(values) in order, not runtime storage bytes."]
};
const save = () => fs.writeFile(archive, JSON.stringify(report, null, 2) + "\n");
try {
  for (const fixture of ["projects/fangjie/fangjie.bcmkn", "projects/tiny-lm/tiny_lm.bcmkn"]) {
    const bytes = await fs.readFile(fixture), project = JSON.parse(bytes.toString("utf8"));
    const name = path.basename(path.dirname(fixture));
    const result = report.cases[name] = { fixture, sha256: sha256(bytes), projectVersion: project.version,
      pageErrors: [], bundles: [], samples: [], outcome: "pending" };
    const page = await browser.newPage();
    page.on("pageerror", error => result.pageErrors.push(String(error.stack)));
    try {
      await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
        const response = await route.fetch(), bytes = await response.body();
        const url = route.request().url(), bundle = path.basename(new URL(url).pathname);
        await fs.writeFile(path.join(out, bundle), bytes);
        result.bundles.push({ name: bundle, url, bytes: bytes.length, sha256: sha256(bytes) });
        let body = bytes.toString("utf8");
        if (bundle.startsWith("main.")) {
          const marker = "var __webpack_exports__=";
          if (!body.includes(marker)) throw new Error("Official loader changed");
          body = body.replace(marker, `window.__nekocRequire=__webpack_require__;${marker}`);
        }
        await route.fulfill({ response, body });
      });
      const projectUrl = "https://kn.codemao.cn/__nekoc_hncompat2_progress__.bcmkn";
      await page.route(projectUrl, route => route.fulfill({ contentType: "application/json", body: bytes }));
      await page.goto(`${report.editorUrl}?previewUrl=${encodeURIComponent(projectUrl)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(projectName => window.__nekocRequire && document.querySelector("canvas") &&
        window.__nekocRequire(91107).BcmInstance.getBcm().projectName === projectName &&
        (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), project.projectName, { timeout: 120000 });
      await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
      const done = page.getByText(/^完成$/).last();
      if (await done.isVisible()) await done.dispatchEvent("click");
      result.runtimeInspection = await page.evaluate(() => {
        const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core;
        return { editorVersion: req(91107).BcmInstance.getBcm().version, config: core.get_util().config.get(),
          visibilityState: document.visibilityState, userAgent: navigator.userAgent };
      });
      if (result.runtimeInspection.editorVersion !== "0.27.4") throw new Error(`Unexpected editor version ${result.runtimeInspection.editorVersion}`);
      let started;
      const snapshot = async label => {
        const row = await page.evaluate(({ label, full }) => {
          const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core;
          const manager = core.get_runtime_manager(), bcm = req(91107).BcmInstance;
          const encode = value => value === undefined ? { $undefined: true } : typeof value === "number" && !Number.isFinite(value) ? { $number: String(value) } : value;
          const lists = {};
          const variables = Object.fromEntries(Object.entries(bcm.variablesDict).filter(([id]) =>
            /chunk_x|chunk_z|world$|kn-var-(screen|gui_dirty|px|py|pz)$|lm_(generated|frames|phase|prefill|position|status|running|tokens_processed|output|ready|input_token|next_token|last_position|last_input|prompt_tokens|generated_ids|top_ids)$/.test(id)).map(([id, v]) => {
              const value = manager.get_variable(id, undefined, v.currentEntityId);
              if (full && Array.isArray(value)) lists[id] = value.map(encode);
              return [id, Array.isArray(value) ? { length: value.length, head: value.slice(0, 40).map(encode), tail: value.slice(-4).map(encode) } : encode(value)];
            }));
          const actors = Object.keys(bcm.getBcm().actors.actorsDict).map(id => {
            const found = req(54174).V.core.actors.get_actor(id);
            if (found.is_error(found.value)) return { id, error: String(found.value) };
            const actor = found.value;
            return { id, logicalPosition: actor.get_position(), position: { x: actor.position.x, y: actor.position.y }, visible: actor.visible };
          });
          return { label, at: performance.now(), running: core.get_runtime_data().is_running(), elapsedFrames: manager.get_elapsed_frames(),
            statistics: core.get_statistics(), variables, actors, lists, visibilityState: document.visibilityState };
        }, { label, full: label === "milestone-confirmed" || label === "timeout" });
        row.wallMsSinceStart = started === undefined ? null : Date.now() - started;
        if (Object.keys(row.lists).length) row.listDigests = Object.fromEntries(Object.entries(row.lists).map(([id, values]) => [id,
          { length: values.length, jsonSha256: sha256(JSON.stringify(values)), ...(values.every(v => v === values[0]) && values.length ? { allEqual: values[0] } : {}) }]));
        delete row.lists;
        result.samples.push(row);
        const v = row.variables;
        console.log(JSON.stringify({ name, label, wallMs: row.wallMsSinceStart, world: v["kn-list-world"]?.length,
          chunkX: v["kn-list-chunk_x"]?.length, y: row.actors[0]?.logicalPosition?.y,
          status: v["kn-var-lm_status"], generated: v["kn-var-lm_generated"], processed: v["kn-var-lm_tokens_processed"] }));
        await save();
        return row;
      };
      const reached = row => {
        const v = row.variables;
        return name === "fangjie" ? v["kn-list-world"]?.length === 524288 && v["kn-list-chunk_x"]?.length === 64 &&
          v["kn-list-chunk_z"]?.length === 64 && v["kn-var-gui_dirty"] === 0 && row.actors.some(a => a.id === "nekoc-default-actor" && a.logicalPosition?.y === -65)
          : v["kn-var-lm_running"] === 0 && v["kn-var-lm_position"] > 0 && v["kn-var-lm_status"] === "DONE / EOS";
      };
      await snapshot("before-start");
      started = Date.now();
      result.startedAt = new Date(started).toISOString();
      await page.getByText(/^开始$/).last().dispatchEvent("click");
      let row = await snapshot("after-start");
      while (!reached(row) && Date.now() - started < report.timeoutMsPerProject) {
        await page.waitForTimeout(Math.min(report.sampleIntervalMs, Math.max(1, report.timeoutMsPerProject - (Date.now() - started))));
        row = await snapshot("progress");
      }
      if (reached(row)) {
        result.firstMilestoneWallMs = row.wallMsSinceStart;
        await page.waitForTimeout(200);
        row = await snapshot("milestone-confirmed");
        result.outcome = reached(row) ? "milestone-complete" : "milestone-not-stable";
      } else {
        result.outcome = "timeout";
        result.timeoutReason = `Milestone predicate not met in ${report.timeoutMsPerProject}ms wall clock; last state retained, no inferred completion.`;
        await snapshot("timeout");
      }
      result.sourceUnchangedAfterRun = sha256(await fs.readFile(fixture)) === result.sha256;
    } catch (error) {
      result.failure = String(error.stack);
      result.outcome = "error";
    } finally {
      await page.close();
      await save();
    }
  }
} finally {
  await browser.close();
  report.completedAt = new Date().toISOString();
  report.ok = Object.values(report.cases).length === 2 && Object.values(report.cases).every(r =>
    r.outcome === "milestone-complete" && r.sourceUnchangedAfterRun && !r.pageErrors.length && !r.failure);
  await save();
}
if (!report.ok) process.exitCode = 1;
