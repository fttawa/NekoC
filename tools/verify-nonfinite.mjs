#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { loadPlaywright, openOfficial, loadOfficialProject } from "./probe-kitten4.mjs";
import { fixture, actorId } from "./nonfinite-fixtures.mjs";

const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge", args: ["--disable-dev-shm-usage"] });
const report = { checkedAt: new Date().toISOString(), browser: browser.version(), cases: {} };
await mkdir("dist/nonfinite", { recursive: true });
try {
  for (const product of ["kitten4", "kn"]) for (const list of [false, true]) {
    const name = `${product}${list ? "-list" : ""}`;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const result = report.cases[name] = { snapshots: [], pageErrors: [] };
    page.on("pageerror", e => result.pageErrors.push(e.message));
    try {
      const { project, phases } = await fixture(product, list);
      result.sha256 = createHash("sha256").update(JSON.stringify(project) + "\n").digest("hex");
      if (product === "kitten4") {
        await openOfficial(page);
        await loadOfficialProject(page, project);
        await page.locator("#btn_trigger").dispatchEvent("click");
      } else {
        await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/, async route => {
          const response = await route.fetch();
          await route.fulfill({ response, body: (await response.text()).replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") });
        });
        await page.route("https://kn.codemao.cn/nonfinite.bcmkn", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(project) }));
        await page.goto("https://kn.codemao.cn/editor?previewUrl=" + encodeURIComponent("https://kn.codemao.cn/nonfinite.bcmkn"), { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForFunction(() => window.__nekocRequire && document.body.innerText.includes("negativeZero"), null, { timeout: 120000 });
        await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
        const done = page.getByText(/^完成$/).last();
        if (await done.isVisible()) await done.dispatchEvent("click");
        await page.getByText(/^开始$/).last().dispatchEvent("click");
      }
      result.url = page.url();
      result.scripts = await page.evaluate(() => [...document.scripts].map(s => s.src).filter(Boolean));
      for (const phase of phases) {
        await page.waitForFunction(({ product, phase }) => {
          const req = product === "kitten4" ? window.__nekocKitten4Require : window.__nekocRequire;
          if (product === "kitten4") {
            const manager = req("JnWR").b().get_runtime_manager();
            return manager.get_variable("phase", undefined, Object.keys(req("TzHo").e.getDoc().theatre.actors)[0]) === phase;
          }
          return Object.values(req(69138).default.ComponentsStore.TheatreStore.stageVariable).some(v => v.name === "phase" && v.value === phase);
        }, { product, phase: phase.phase }, { timeout: 15000 });
        const state = await page.evaluate(({ product, actorId }) => {
          const req = product === "kitten4" ? window.__nekocKitten4Require : window.__nekocRequire;
          const encode = v => typeof v === "number" && !Number.isFinite(v) ? String(v)
            : Array.isArray(v) ? v.map(encode)
              : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, encode(n)])) : v;
          let actor, variables, running, error;
          if (product === "kitten4") {
            const doc = req("TzHo").e.getDoc(), heart = req("JnWR").b();
            actor = req("HP1x").a().get_actor_by_id(actorId);
            variables = Object.fromEntries(Object.entries(doc.variables).map(([id, v]) => [id, encode(heart.get_runtime_manager().get_variable(id, undefined, v.current_entity))]));
            running = heart.get_runtime_data().is_running();
            error = req("ALsR").a.get_state().error_state;
          } else {
            const runtime = req(26921).cG.get_instance();
            actor = req(62804).getStageTarget("nekoc-default-actor");
            variables = Object.fromEntries(Object.values(req(69138).default.ComponentsStore.TheatreStore.stageVariable).map(v => [v.name, encode(v.value)]));
            running = runtime.heart.core.get_runtime_data().is_running();
          }
          return encode({ variables, running, error, actor: actor ? { position: actor.get_position(), rotation: actor.get_rotation(), scale: actor.get_scale(), visible: actor.get_visible(), opacity: actor.get_alpha?.() ?? actor.alpha,
            hitAtOriginal: actor.hit_test(100, 20), hitAtOrigin: actor.hit_test(0, 0), collisionWithSelf: actor.check_bumped_other(actor), bounds: actor.get_bounds_LTRB() } : null });
        }, { product, actorId });
        result.snapshots.push({ ...phase, ...state });
      }
      await page.waitForTimeout(800);
      result.finalText = (await page.locator("body").innerText()).slice(-3000);
      result.final = await page.evaluate(product => {
        if (product === "kitten4") {
          const req = window.__nekocKitten4Require, heart = req("JnWR").b();
          const doc = req("TzHo").e.getDoc();
          const read = id => heart.get_runtime_manager().get_variable(id, undefined, doc.variables[id].current_entity);
          return { running: heart.get_runtime_data().is_running(), error: req("ALsR").a.get_state().error_state, done: read("done"), listRead: doc.variables.listRead ? String(read("listRead")) : undefined };
        }
        const req = window.__nekocRequire;
        const variables = Object.fromEntries(Object.values(req(69138).default.ComponentsStore.TheatreStore.stageVariable).map(v => [v.name, v.value]));
        return { running: req(26921).cG.get_instance().heart.core.get_runtime_data().is_running(), done: variables.done, listRead: variables.listRead === undefined ? undefined : String(variables.listRead) };
      }, product);
      await page.screenshot({ path: `dist/nonfinite/${name}.png` });
      const modules = await page.evaluate(product => {
        const req = product === "kitten4" ? window.__nekocKitten4Require : window.__nekocRequire;
        return Object.entries(req.m).filter(([id, fn]) => id === "75337" || /self_move_to|math_arithmetic|self_set_scale/.test(String(fn))).map(([id, fn]) => ({ id, source: String(fn) }));
      }, product);
      await writeFile(`dist/nonfinite/${name}-live-sources.json`, JSON.stringify(modules, null, 2));
      for (const snapshot of result.snapshots) {
        const nanScale = product === "kn" && snapshot.property === "scale" && snapshot.input === "NaN";
        assert.deepEqual(snapshot.actor.position, { x: 100, y: 20 });
        assert.ok(Math.abs(snapshot.actor.rotation - 35 * Math.PI / 180) < 1e-10);
        assert.deepEqual(snapshot.actor.scale, nanScale ? { x: "NaN", y: "NaN" } : { x: 0.8, y: 0.8 });
        assert.equal(snapshot.actor.visible, true);
        assert.equal(snapshot.actor.opacity, 0.75);
        assert.equal(snapshot.actor.hitAtOriginal, !nanScale);
        assert.equal(snapshot.actor.hitAtOrigin, false);
        assert.equal(snapshot.actor.collisionWithSelf, !nanScale);
        for (const [id, text] of Object.entries({ nan: "NaN", inf: "Infinity", sqrt: "NaN", log: "-Infinity", modulo: "NaN", badNumber: "not-a-number", huge: "1e+21", tiny: "1e-7", negativeZero: "0" })) {
          assert.equal(snapshot.variables[id], text);
        }
      }
      const listError = product === "kitten4" && list;
      assert.equal(result.final.running, !listError);
      assert.equal(result.final.done, listError ? 0 : 1);
      if (listError) assert.match(result.final.error.error_string, /列表的项数不合规范/);
      if (product === "kn" && list) assert.equal(result.final.listRead, "NaN");
    } catch (e) { result.error = String(e); }
      await page.close();
    console.log(name, result.error ?? result.snapshots.map(s => ({ phase: s.phase, property: s.property, input: s.input, actor: s.actor, variables: s.variables })));
  }
} finally { await browser.close(); }
await writeFile("dist/nonfinite/official.json", JSON.stringify(report, null, 2) + "\n");
// A failed probe must not look like a successful conformance check in CI.
if (Object.values(report.cases).some(result => result.error || result.snapshots.length !== 30 || result.pageErrors.length)) {
  process.exitCode = 1;
}
