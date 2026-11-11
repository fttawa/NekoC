#!/usr/bin/env node
// Original end-to-end probes using the shared official KN 0.27.4 harness.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadPlaywright } from "../probe-kitten4.mjs";
import { probe, matchingVariables, validateObservation, officialUrl } from "../semantics-kitten-n.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const fixture = "tests/fixtures/kn-semantics/partial-clone.bcmkn";
export function cloneProject(template) {
  const p = structuredClone(template), actor = Object.keys(p.actors.actorsDict)[0];
  const local = "30000000-0000-4000-8000-000000000001";
  let serial = 0;
  const b = (type, fields = {}, inputs = {}) => ({ id: `partial-${++serial}`, type, fields, inputs });
  const n = value => b("math_number", { NUM: String(value) });
  const set = (variable, value) => b("variables_set", { variable }, { value });
  const read = (attribute, index = n(1)) => b("get_clone_index_property", { sprite: "--self", attribute }, { index });
  const values = { done: 0, input_text: "1", input_bool: true }, blocks = [b("on_running_group_activated"),
    b("self_set_position_x", {}, { value: n(1.23456) }),
    b("self_set_position_y", {}, { value: n(-2.34567) }),
    b("set_width_height_scale", { type: "width" }, { value: n(123.456) }),
    b("set_width_height_scale", { type: "height" }, { value: n(56.789) }),
    b("self_point_towards", {}, { degrees: n(25.7142857) }),
    ...[0, 1, 2, 3, 4, 5, 6].map(scope => b("self_set_effect", { scope: String(scope) }, { value: n(scope === 0 ? -10.125 : 12.345) })),
    set(local, n(42)), b("mirror", { sprite: "--self" }), set(local, n(99))];
  for (const attribute of ["x", "y", "scale", "width", "height", "direction", "style_index", "0", "1", "2", "3", "4", "5", "6"]) {
    for (const index of [0, 1]) {
      const id = `p_${attribute}_${index}`;
      values[id] = 0;
      blocks.push(set(id, read(attribute, n(index))));
    }
  }
  for (const index of [0, 1]) {
    values[`local_${index}`] = 0;
    blocks.push(set(`local_${index}`, read(local, n(index))));
  }
  for (const [id, index] of [["text_index", b("variables_get", { variable: "input_text" })], ["bool_index", b("variables_get", { variable: "input_bool" })], ["fraction_index", n(0.5)], ["missing_index", n(999)], ["negative_index", n(-1)]]) {
    values[id] = 0;
    blocks.push(set(id, read("width", index)));
  }
  for (const [i, sprite] of ["--screen", "--self", actor].entries()) {
    for (const type of ["down", "click", "up"]) {
      const id = `mouse_${i}_${type}`;
      values[id] = 0;
      blocks.push(set(id, b("mouse_down", { sprite, type })));
    }
  }
  blocks.push(set("done", n(1)));
  for (let i = 1; i < blocks.length; i++) blocks[i - 1].next = blocks[i];
  p.projectName = "NekoC KN semantics partial-clone";
  p.actors.actorsDict = { [actor]: { ...p.actors.actorsDict[actor], nekoBlockJsonList: [blocks[0]] } };
  p.scenes.scenesDict[p.scenes.currentSceneId].actorIds = [actor];
  p.variables.variablesDict = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
    id, name: id, value, type: "any", isGlobal: true, currentEntityId: actor, visible: false, position: { x: 0, y: 0 },
  }]));
  p.variables.variablesDict[local] = { id: local, name: "private value", value: 0, type: "any", isGlobal: false, currentEntityId: actor, visible: false, position: { x: 0, y: 0 } };
  return p;
}

async function main() {
  if (process.argv.includes("--generate")) {
    const template = JSON.parse(await fs.readFile(path.join(root, "samples/kitten-n-0.27.4.bcmkn"), "utf8"));
    await fs.writeFile(path.join(root, fixture), JSON.stringify(cloneProject(template), null, 2) + "\n");
    return;
  }
  const source = await fs.readFile(path.join(root, fixture), "utf8");
  const result = { fixture, sha256: createHash("sha256").update(source).digest("hex"), pageErrors: [] };
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => result.pageErrors.push(String(e)));
    await probe(page, source, result);
    result.actorInspection = await page.evaluate(() => {
      const bcm = window.__nekocRequire(91107).BcmInstance.getBcm();
      const actor = window.__nekocRequire(54174).V.core.actors.get_actor(Object.keys(bcm.actors.actorsDict)[0]).value;
      return { alpha: actor.get_alpha(), rawTransparency: 100 * (1 - actor.get_alpha()), formulaAlpha: (100 - 12.345) / 100 };
    });
    result.domainCalls = await page.evaluate(() => {
      const req = window.__nekocRequire, registry = req(26921).cG.get_instance().getHeart().core.get_registry();
      const actor = Object.keys(req(91107).BcmInstance.getBcm().actors.actorsDict)[0];
      const encode = value => value === undefined ? { $undefined: true } : typeof value === "number" && !Number.isFinite(value) ? { $number: String(value) } : value;
      const calls = [];
      for (const attribute of ["camp", "distance", "unknown", "7", "?"]) {
        const fn = registry.domain_function_list[registry.get_domain_function_index("get_clone_index_property")];
        calls.push({ type: "get_clone_index_property", attribute, result: encode(fn({ sprite: "--self", attribute, index: 0 }, "probe", actor, actor, "probe", {})) });
      }
      const clone = registry.domain_function_list[registry.get_domain_function_index("get_clone_index_property")];
      calls.push({ type: "get_clone_index_property", scene: true, result: encode(clone({ sprite: "--self", attribute: "x", index: 0 }, "probe", req(91107).BcmInstance.getBcm().scenes.currentSceneId, actor, "probe", {})) });
      for (const sprite of ["missing-actor", "?"]) {
        const fn = registry.domain_function_list[registry.get_domain_function_index("mouse_down")];
        calls.push({ type: "mouse_down", sprite, result: encode(fn({ sprite, type: "down" }, "probe", actor, actor, "probe", {})) });
      }
      return calls;
    });
    const rect = await page.evaluate(() => {
      const canvas = window.__nekocRequire(54174).V.core.get_view();
      const r = canvas.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (!rect) throw new Error("No official canvas");
    const pointerSample = label => page.evaluate(label => {
      const req = window.__nekocRequire, registry = req(26921).cG.get_instance().getHeart().core.get_registry();
      const fn = registry.domain_function_list[registry.get_domain_function_index("mouse_down")];
      const actor = Object.keys(req(91107).BcmInstance.getBcm().actors.actorsDict)[0];
      return { label, values: Object.fromEntries(["--screen", "--self", actor, "missing-actor"].flatMap(sprite =>
        ["down", "click", "up"].map(type => [`${sprite}:${type}`, fn({ sprite, type }, "probe", actor, actor, "probe", {})]))) };
    }, label);
    result.pointerSamples = [await pointerSample("before")];
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    result.pointerSamples.push(await pointerSample("held"));
    await page.mouse.up();
    await page.waitForTimeout(80);
    result.pointerSamples.push(await pointerSample("released"));
    const run = spawnSync(path.join(root, "target/debug/kn-trace.exe"), [path.join(root, fixture)], { encoding: "utf8", timeout: 30000 });
    if (run.status !== 0) throw new Error(run.stderr || String(run.error));
    result.nekoc = JSON.parse(run.stdout);
    result.equal = matchingVariables(result.variables, result.nekoc.variables);
  } catch (e) { result.error = String(e); }
  finally { await browser.close(); }
  const out = path.join(root, "dist/kn-partial/clone.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  const report = { officialUrl, verifiedAt: new Date().toISOString(), result };
  await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  validateObservation(result, JSON.parse(source));
  if (process.argv.includes("--archive")) {
    if (result.domainCalls.length !== 8 || result.pointerSamples.length !== 3 ||
        result.pointerSamples[0].values["--screen:down"] !== false ||
        result.pointerSamples[1].values["--screen:down"] !== true ||
        result.pointerSamples[2].values["--screen:down"] !== false) throw new Error("Incomplete pointer evidence");
    const editor = JSON.parse(await fs.readFile(path.join(root, "dist/kn-partial/editor-compat.json"), "utf8"));
    if (!editor.ok || editor.projects.length !== 1 || editor.projects[0].sha256 !== result.sha256 || editor.projects[0].editorVersion !== "0.27.4") throw new Error("Missing or stale editor validation");
    editor.projects[0].input = fixture;
    await fs.writeFile(path.join(root, "docs/kn-partial-official.json"), JSON.stringify({ ...report, editorCompat: editor }, null, 2) + "\n");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
