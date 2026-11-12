#!/usr/bin/env node
// Original projects and observations only; no official implementation is copied.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadPlaywright } from "../probe-kitten4.mjs";
import { probe, matchingVariables, validateObservation, matchingEditorCheck, officialUrl } from "../semantics-kitten-n.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const attributes = ["x", "y", "style_index", "scale", "width", "height", "direction", "color", "opacity", "brightness", "pixelate", "ripple", "distortion", "grayscale", "distance"];
export const fixture = kind => `tests/fixtures/kn-semantics/partial2-appearance-${kind}.bcmkn`;
export function validateInspection(kind, r) {
  const i = r.inspection;
  const expectedText = kind === "talk" ? "original\u00a0talk\u00a0text" : "界".repeat(90) + "...";
  if (i?.version !== "0.27.4" || i.registeredAlias !== false || i.afterDialog !== 1 ||
      i.dialog?.present !== true || i.dialog.text !== expectedText ||
      i.dialog.type !== (kind === "talk" ? "saying" : "thinking")) throw new Error("Incomplete native dialog evidence");
  if (!Array.isArray(i.conversions) || i.conversions.length !== attributes.length) throw new Error("Incomplete alias conversion evidence");
  for (const [index, c] of i.conversions.entries()) {
    const a = attributes[index];
    let type, key, value;
    if (["x", "y"].includes(a)) { type = "coordinate_of_sprite"; key = "coordinate"; value = a; }
    else if (a === "style_index") type = "style_of_sprite";
    else if (["scale", "width", "height", "direction"].includes(a)) { type = "appearance_of_sprite"; key = "appearance"; value = a; }
    else if (a === "distance") type = "distance_to";
    else { type = "effect_of_sprite"; key = "effect"; value = String(index - 7); }
    if (c.attribute !== a || c.type !== type || c.fields?.sprite !== "--self" ||
        (key && c.fields[key] !== value) || !Array.isArray(c.errors) || c.errors.length ||
        !Array.isArray(c.warnings) || c.warnings.length) throw new Error(`Invalid alias conversion evidence: ${a}`);
  }
  if (JSON.stringify(i.invalidSelfDistance) !== JSON.stringify({ $number: "NaN" })) throw new Error("Missing invalid distance target evidence");
  const expectedDialogs = [["empty", ""], ["number", "42"], ["boolean", "true"], ["list", "1,a\u00a0b"], ["object", "[object\u00a0Object]"]];
  if (i.dialogCalls?.length !== expectedDialogs.length || expectedDialogs.some(([label, text], index) => {
    const c = i.dialogCalls[index];
    return c.label !== label || c.error || c.resultType !== "undefined" || c.dialog?.present !== true || c.dialog.type !== "saying" || c.dialog.text !== text;
  })) throw new Error("Incomplete typed dialog observations");
}
export function projects(template) {
  return Object.fromEntries(["talk", "think"].map(kind => {
    const p = structuredClone(template), actor = Object.keys(p.actors.actorsDict)[0];
    let serial = 0;
    const b = (type, fields = {}, inputs = {}) => ({ id: `partial2-${kind}-${++serial}`, type, fields, inputs });
    const n = value => b("math_number", { NUM: String(value) });
    const text = value => b("text", { TEXT: value });
    const set = (variable, value) => b("variables_set", { variable }, { value });
    const values = { done: 0, after_dialog: 0 };
    const blocks = [b("on_running_group_activated"),
      b("self_set_position_x", {}, { value: n(1.23456) }),
      b("self_set_position_y", {}, { value: n(-2.34567) }),
      b("set_width_height_scale", { type: "width" }, { value: n(123.456) }),
      b("set_width_height_scale", { type: "height" }, { value: n(56.789) }),
      b("self_point_towards", {}, { degrees: n(25.7142857) }),
      ...Array.from({ length: 7 }, (_, scope) => b("self_set_effect", { scope: String(scope) }, { value: n(scope === 0 ? -10.125 : 12.345) }))];
    for (const [target, sprite] of [["self", "--self"], ["actor", actor]]) {
      for (const attribute of attributes) {
        // The editor rewrites this invalid distance target to '?'. Observe
        // its raw domain result separately rather than shipping an invalid file.
        if (target === "self" && attribute === "distance") continue;
        const id = `${target}_${attribute}`;
        values[id] = 0;
        const fields = { sprite };
        let type;
        if (["x", "y"].includes(attribute)) { type = "coordinate_of_sprite"; fields.coordinate = attribute; }
        else if (attribute === "style_index") type = "style_of_sprite";
        else if (["scale", "width", "height", "direction"].includes(attribute)) { type = "appearance_of_sprite"; fields.appearance = attribute; }
        else if (attribute === "distance") type = "distance_to";
        else { type = "effect_of_sprite"; fields.effect = String(attributes.indexOf(attribute) - 7); }
        blocks.push(set(id, b(type, fields)));
      }
    }
    blocks.push(b("self_dialog_wait", { type: kind }, { text: text(kind === "talk" ? "original talk text" : "界".repeat(91)) }),
      set("after_dialog", n(1)), set("done", n(1)));
    for (let i = 1; i < blocks.length; i++) blocks[i - 1].next = blocks[i];
    p.projectName = `NekoC KN semantics partial2-appearance-${kind}`;
    p.actors.actorsDict = { [actor]: { ...p.actors.actorsDict[actor], nekoBlockJsonList: [blocks[0]] } };
    p.scenes.scenesDict[p.scenes.currentSceneId].actorIds = [actor];
    p.variables.variablesDict = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
      id, name: id, value, type: "any", isGlobal: true, currentEntityId: actor, visible: false, position: { x: 0, y: 0 },
    }]));
    return [kind, p];
  }));
}

async function main() {
  if (process.argv.includes("--generate")) {
    const template = JSON.parse(await fs.readFile(path.join(root, "samples/kitten-n-0.27.4.bcmkn"), "utf8"));
    for (const [kind, p] of Object.entries(projects(template))) await fs.writeFile(path.join(root, fixture(kind)), JSON.stringify(p, null, 2) + "\n");
    return;
  }
  const report = { officialUrl, verifiedAt: new Date().toISOString(), cases: {} };
  const browser = await loadPlaywright().chromium.launch({ channel: "msedge", headless: true });
  report.browserVersion = browser.version();
  try {
    for (const kind of ["talk", "think"]) {
      const source = await fs.readFile(path.join(root, fixture(kind)), "utf8");
      const r = report.cases[kind] = { fixture: fixture(kind), sha256: createHash("sha256").update(source).digest("hex"), pageErrors: [] };
      const page = await browser.newPage();
      page.on("pageerror", e => r.pageErrors.push(String(e)));
      try {
        await probe(page, source, r);
        r.inspection = await page.evaluate(attributes => {
          const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core;
          const manager = req(54174).V.core.components.get_actor_dialog_manager();
          const actor = Object.keys(req(91107).BcmInstance.getBcm().actors.actorsDict)[0];
          const cache = manager.dialog_cache;
          const dialog = cache.get(actor);
          const renderedText = dialog?.actor_dialog.children.find(child => child.name === "text")?.text;
          const originalDialog = { present: !!dialog, type: dialog?.type, text: renderedText };
          const registry = core.get_registry();
          const distance = registry.domain_function_list[registry.get_domain_function_index("distance_to")];
          const invalidSelfDistance = distance({ sprite: "--self" }, "probe", actor, actor, "probe", {});
          const conversions = attributes.map(attribute => {
            const result = req(96733)._j(`get_sprite_property('--self', '${attribute}');`);
            const xml = new DOMParser().parseFromString(result.xml, "text/xml");
            const block = [...xml.querySelectorAll("block")].find(b => b.getAttribute("type") !== "_execute");
            return { attribute, type: block?.getAttribute("type"), fields: Object.fromEntries([...block?.querySelectorAll("field") || []].map(f => [f.getAttribute("name"), f.textContent])), errors: result.errors, warnings: result.warnings };
          });
          const dialogCalls = [];
          const say = registry.domain_function_list[registry.get_domain_function_index("self_dialog_wait")];
          for (const [label, text] of [["empty", ""], ["number", 42], ["boolean", true], ["list", [1, "a b"]], ["object", { a: 1 }]]) {
            try {
              const result = say({ type: "talk", text }, "probe", actor, actor, "probe", {});
              const d = cache.get(actor);
              dialogCalls.push({ label, input: text, resultType: typeof result, dialog: { present: !!d, type: d?.type, text: d?.actor_dialog.children.find(child => child.name === "text")?.text } });
            } catch (e) { dialogCalls.push({ label, error: String(e) }); }
          }
          return { version: req(91107).BcmInstance.getBcm().version,
            dialog: originalDialog, dialogCalls,
            conversions,
            registeredAlias: !!req(40742).BlinkInstance.core.Blocks.get_sprite_property,
            invalidSelfDistance: typeof invalidSelfDistance === "number" && Number.isNaN(invalidSelfDistance) ? { $number: "NaN" } : invalidSelfDistance,
            afterDialog: core.get_runtime_manager().get_variable("after_dialog") };
        }, attributes);
        const run = spawnSync(path.join(root, "target/debug/kn-trace.exe"), [path.join(root, fixture(kind))], { encoding: "utf8", timeout: 30000 });
        if (run.status !== 0) throw new Error(run.stderr || String(run.error));
        r.nekoc = JSON.parse(run.stdout);
        r.equal = matchingVariables(r.variables, r.nekoc.variables);
      } catch (e) { r.error = String(e); }
      finally { await page.close(); }
    }
  } finally { await browser.close(); }
  const out = path.join(root, "dist/kn-partial2-appearance/report.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  for (const [kind, r] of Object.entries(report.cases)) {
    validateObservation(r, JSON.parse(await fs.readFile(path.join(root, r.fixture), "utf8")));
    validateInspection(kind, r);
  }
  if (process.argv.includes("--archive")) {
    const editor = JSON.parse(await fs.readFile(path.join(root, "dist/kn-partial2-appearance/editor-compat.json"), "utf8"));
    for (const p of editor.projects) p.input = path.relative(root, p.input).replaceAll("\\", "/");
    if (!editor.ok || editor.projects.length !== 2 || Object.values(report.cases).some(r => !editor.projects.some(p => matchingEditorCheck(p, r) && p.editorVersion === "0.27.4"))) throw new Error("Missing/stale editor evidence");
    await fs.writeFile(path.join(root, "docs/kn-partial2-appearance-official.json"), JSON.stringify({ ...report, editorCompat: editor }, null, 2) + "\n");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
