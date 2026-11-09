#!/usr/bin/env node
// Self-authored clone lifecycle workspaces; inspect the unmodified official VM.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadPlaywright, openOfficial, loadOfficialProject, officialUrl } from "./probe-kitten4.mjs";

const directory = new URL("../tests/fixtures/kitten4/", import.meta.url);
const schema = JSON.parse(await readFile(new URL("../docs/kitten4-block-schema.json", import.meta.url), "utf8"));
export const actorId = "20000000-0000-4000-8000-000000000001";
const b = (type, fields = {}, inputs = {}, statements = {}) => ({ type, fields, inputs, statements });
const num = n => b("math_number", { NUM: String(n) });
const text = s => b("text", { TEXT: s });
const get = name => b("variables_get", { VAR: name });
const set = (name, value) => b("variables_set", { VAR: name }, { VALUE: value });
const inc = name => b("change_variable", { valname: name, method: "increase" }, { n: num(1) });
const wait = n => b("wait", {}, { time: num(n) });
const index = () => b("get_current_clone_index");
const eq = (a, c) => b("logic_compare", { OP: "EQ" }, { A: a, B: c });
const chain = (...nodes) => { for (let i = 1; i < nodes.length; i++) nodes[i - 1].next = nodes[i]; return nodes[0]; };
const start = (...nodes) => chain(b("start_on_click"), ...nodes);
const iff = (condition, body) => b("controls_if", {}, { IF0: condition }, { DO0: body });
const original = body => iff(eq(index(), num(0)), body);
const split = (x = 100, y = 0) => b("clone", { sprite: actorId }, { x: num(x), y: num(y) });
const mirror = () => b("mirror", { sprite: "__self" });
const count = () => b("get_clone_num", { sprite: actorId });
const property = (i, attribute) => b("get_clone_index_property", { sprite: actorId, attribute }, { index: num(i) });
const targetId = "20000000-0000-4000-8000-000000000002";

export function workspace(roots) {
  let serial = 0;
  const graph = { blocks: {}, connections: {}, comments: {} };
  function add(node, parent = null) {
    const id = `clone-probe-${++serial}`;
    const defaults = structuredClone(schema.blocks[node.type].defaults);
    graph.blocks[id] = { ...defaults, id, parent_id: parent, location: [0, 0], fields: { ...defaults.fields, ...node.fields }, ...(node.mutation ? { mutation: node.mutation } : {}) };
    graph.connections[id] = {};
    for (const [kind, children] of [["value", node.inputs], ["statement", node.statements]]) {
      for (const [name, child] of Object.entries(children)) graph.connections[id][add(child, id)] = { type: "input", input_type: kind, input_name: name };
    }
    if (node.next) graph.connections[id][add(node.next, id)] = { type: "next" };
    return id;
  }
  roots.forEach(node => add(node));
  return graph;
}

export async function fixtures() {
  const base = JSON.parse(await readFile(new URL("semantics-keys-split.bcm", directory), "utf8"));
  function project(name, roots, vars = {}) {
    const p = structuredClone(base);
    p.project_name = `NekoC clone ${name}`;
    p.theatre.actors[actorId].block_data_json = workspace(roots);
    p.variables = Object.fromEntries(Object.entries(vars).map(([id, value]) => [id, { id, name: id, value, type: "any", is_global: true, current_entity: actorId, visible: false, position: { x: 0, y: 0 } }]));
    if (name === "variables") p.variables.private.is_global = false;
    if (name === "collision") {
      const target = structuredClone(p.theatre.actors[actorId]);
      target.id = targetId; target.name = "Target"; target.x = 100;
      target.block_data_json = workspace([]);
      p.theatre.actors[targetId] = target;
      p.theatre.scenes[p.theatre.current_scene].actors.push(targetId);
      p.theatre.groups.group.actors.push(targetId);
    }
    p.variable_order = Object.keys(vars);
    return p;
  }
  return {
    events: project("events", [
      start(inc("started"), original(chain(split(), wait(0.3), set("count", count()), set("ready", num(1)), b("self_broadcast", {}, { message: text("probe") }), set("gate", num(1)), wait(0.3), set("gate", num(0))))),
      b("start_as_a_mirror", {}, {}, { DO: inc("cloneStarted") }),
      b("on_keydown", { key: "65", key_event_type: "down" }, {}, { DO: inc("keys") }),
      b("when", {}, { condition: eq(get("gate"), num(1)) }, { DO: chain(inc("conditions"), wait(0.1)) }),
      b("sprite_on_tap", { actor: "__self", type: "mouse_click" }, {}, { DO: inc("clicked") }),
      b("self_listen", {}, { message: text("probe") }, { DO: inc("broadcasts") }),
    ], { started: 0, cloneStarted: 0, count: 0, ready: 0, keys: 0, conditions: 0, gate: 0, clicked: 0, broadcasts: 0 }),
    state: project("state", [
      start(original(chain(
        b("self_set_position", { coordinary: "x" }, { value: num(30) }), b("self_set_position", { coordinary: "y" }, { value: num(40) }),
        b("set_costume", {}, { index: num(2) }),
        b("set_scale", {}, { scale: num(150) }),
        b("self_set_pen_color", { color: "#123456" }), b("self_set_pen_size", {}, { size: num(7) }), b("self_pen_down"),
        set("shared", num(12)), split(100, -80), wait(0.3), set("x", property(1, "0")), set("y", property(1, "1")), set("costume", property(1, "2")),
      ))),
      b("on_keydown", { key: "66", key_event_type: "down" }, {}, { DO: iff(eq(index(), num(1)), chain(
        b("self_set_position", { coordinary: "x" }, { value: num(110) }), b("self_pen_down"),
        b("self_set_position", { coordinary: "x" }, { value: num(120) }), wait(1),
      )) }),
    ], { shared: 0, x: 0, y: 0, costume: 0 }),
    variables: project("variables", [
      start(original(chain(set("private", num(12)), set("shared", num(20)), split(), wait(0.5), set("originalPrivate", get("private")), set("sharedAfter", get("shared")))),
        iff(eq(index(), num(1)), chain(set("inheritedPrivate", get("private")), inc("private"), inc("shared"), set("clonePrivate", get("private"))))),
    ], { private: 1, shared: 0, originalPrivate: 0, inheritedPrivate: 0, clonePrivate: 0, sharedAfter: 0 }),
    mixed: project("mixed", [
      start(inc("started"), original(chain(mirror(), split(100, 0), wait(0.3), set("count", count()), set("firstX", property(1, "0")), set("secondX", property(2, "0")), b("self_broadcast", {}, { message: text("probe") })))),
      b("start_as_a_mirror", {}, {}, { DO: inc("cloneStarted") }),
      b("self_listen", {}, { message: text("probe") }, { DO: inc("broadcasts") }),
    ], { started: 0, cloneStarted: 0, count: 0, firstX: -1, secondX: -1, broadcasts: 0 }),
    recurse: project("recurse", [
      start(inc("started"), original(split()), iff(eq(index(), num(1)), split(200, 0))),
    ], { started: 0 }),
    dispose: project("dispose", [
      start(original(chain(split(), split(200, 0), wait(0.3), b("self_broadcast", {}, { message: text("delete") }), wait(0.3), set("count", count()), set("remainingX", property(2, "0")), split(300, 0), wait(0.2), set("newX", property(3, "0")), b("dispose"), inc("afterOriginal")))),
      b("self_listen", {}, { message: text("delete") }, { DO: iff(eq(index(), num(1)), chain(b("dispose"), inc("afterClone"))) }),
      b("on_keydown", { key: "65", key_event_type: "down" }, {}, { DO: inc("keys") }),
    ], { count: 0, remainingX: 0, newX: 0, afterOriginal: 0, afterClone: 0, keys: 0 }),
    limit: project("limit", [
      start(original(chain(b("repeat_n_times", {}, { times: num(350) }, { DO: split() }), wait(0.3), set("count", count()), wait(0.3), b("repeat_n_times", {}, { times: num(350) }, { DO: split() }), wait(0.3), set("laterCount", count())))),
    ], { count: 0, laterCount: 0 }),
    mirrorSelf: project("mirrorSelf", [
      start(original(mirror())),
      b("start_as_a_mirror", {}, {}, { DO: mirror() }),
    ]),
    burst: project("burst", [
      start(original(chain(...[100, 100, 100, 5].map(n => iff(b("logic_boolean", { BOOL: "TRUE" }), chain(...Array.from({ length: n }, () => split())))), wait(0.3), set("count", count()), split(), wait(0.3), set("laterCount", count())))),
    ], { count: 0, laterCount: 0 }),
    collision: project("collision", [
      start(original(split())),
      b("when", {}, { condition: b("bump", { sprite1: "__self", sprite2: targetId }) }, { DO: chain(inc("collisions"), wait(0.1)) }),
    ], { collisions: 0 }),
  };
}

async function snapshot(page) {
  return page.evaluate(() => {
    const req = window.__nekocKitten4Require;
    const doc = req("TzHo").e.getDoc();
    const heart = req("JnWR").b();
    const manager = heart.get_runtime_manager();
    const stage = req("HP1x").a();
    const sprites = [];
    // Read-only runtime state, including clones (the editor document has originals only).
    const ids = ["20000000-0000-4000-8000-000000000001", ...(heart.get_runtime_data().get_sprite_clones?.("20000000-0000-4000-8000-000000000001") ?? [])];
    for (const id of ids.slice(0, 8)) {
      const a = stage.get_actor_by_id(id);
      if (!a) continue;
      const brush = a.get_brush();
      sprites.push({ id, position: a.get_position(), scale: a.get_scale?.(), style: a.get_current_style_id?.(), visible: a.get_visible(), brush: Object.fromEntries(Object.entries(brush).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))), brushState: Object.getOwnPropertyNames(Object.getPrototypeOf(brush)).filter(k => /^get_|is_/.test(k)).map(k => { try { return [k, brush[k]()]; } catch { return [k, null]; } }) });
    }
    return { variables: Object.fromEntries(Object.entries(doc.variables).map(([id, v]) => [id, manager.get_variable(id, undefined, v.current_entity)])), cloneCount: ids.length - 1, sprites, error: req("ALsR").a.get_state().error_state, running: heart.get_runtime_data().is_running() };
  });
}

async function main() {
  const cases = await fixtures();
  if (process.argv.includes("--generate")) {
    for (const [name, value] of Object.entries(cases)) await writeFile(new URL(`clone-${name}.bcm`, directory), JSON.stringify(value, null, 2) + "\n");
    return;
  }
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "dist/clone-official.json";
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const report = { officialUrl, verifiedAt: new Date().toISOString(), browserVersion: browser.version(), cases: {} };
  try {
    const selected = process.argv.includes("--case") ? [process.argv[process.argv.indexOf("--case") + 1]] : process.argv.includes("--inspect") ? ["events"] : Object.keys(cases);
    for (const name of selected) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const result = report.cases[name] = { checkpoints: [], pageErrors: [] };
      page.on("pageerror", error => result.pageErrors.push(String(error)));
      try {
        await openOfficial(page);
        if (process.argv.includes("--inspect")) {
          const sources = await page.evaluate(() => Object.entries(window.__nekocKitten4Require.m).filter(([, fn]) => /clone_entity|clone:function|destruct_entity|get_clone_num|clone_actor|entity_max_clones_per_frame|clone_created|clones_max|MAX_CLONE|per_entity_clone_limit/.test(String(fn))).map(([id, fn]) => ({ id, source: String(fn) })));
          await mkdir("dist/clone", { recursive: true });
          await writeFile("dist/clone/vendor-modules.json", JSON.stringify(sources, null, 2));
        }
        const source = await readFile(new URL(`clone-${name}.bcm`, directory), "utf8");
        result.fixture = `tests/fixtures/kitten4/clone-${name}.bcm`;
        result.sha256 = createHash("sha256").update(source).digest("hex");
        const input = JSON.parse(source);
        await loadOfficialProject(page, input);
        result.applicationVersion = await page.evaluate(() => window.__nekocKitten4Require("3PHN").d().application_version);
        result.vendorScripts = await page.evaluate(() => [...document.scripts].map(s => s.src).filter(Boolean));
        result.workspaceIssues = await page.evaluate(({ actorId, wanted }) => {
          window.__nekocKitten4Require("Fye/").B.select_workspace_by_id(actorId);
          const actual = Blockly.json.workspace_to_json(Blockly.mainWorkspace);
          const issues = [];
          for (const [id, block] of Object.entries(wanted.blocks)) {
            if (actual.blocks[id]?.type !== block.type) issues.push(`${id}: changed type`);
            for (const [key, value] of Object.entries(block.fields)) if (String(actual.blocks[id]?.fields[key]) !== String(value)) issues.push(`${id}.${key}: changed field`);
            for (const [child, edge] of Object.entries(wanted.connections[id])) if (Object.entries(edge).some(([key, value]) => actual.connections[id]?.[child]?.[key] !== value)) issues.push(`${id}->${child}: changed connection`);
          }
          return issues;
        }, { actorId, wanted: input.theatre.actors[actorId].block_data_json });
        if (result.workspaceIssues.length) throw new Error(result.workspaceIssues.join("; "));
        await page.locator("#btn_trigger").dispatchEvent("click");
        await page.waitForTimeout(name === "limit" ? 12000 : 1000);
        // Dismiss the official site's promotional modal (UI only; no VM patch).
        const close = page.locator('[class*="close"]').filter({ visible: true });
        for (const button of await close.all()) {
          const box = await button.boundingBox();
          if (box && box.width < 80 && box.height < 80) { await button.click({ force: true }); }
        }
        await page.waitForTimeout(600);
        result.checkpoints.push({ label: "settled", state: await snapshot(page) });
        if (name === "events") {
          // Input injection through the official stage event bus. The original
          // official click responder and block body execute unmodified. This
          // verifies runtime semantics, not browser texture hit-testing.
          result.pointerInput = await page.evaluate(() => {
            const req = window.__nekocKitten4Require;
            const id = req("JnWR").b().get_runtime_data().get_sprite_clones("20000000-0000-4000-8000-000000000001")[0];
            req("HP1x").a().core.events.emit("actor:click", { target_id: id });
            return { method: "official stage actor:click event", target: id };
          });
          await page.waitForTimeout(150);
          result.checkpoints.push({ label: "official stage click on split", state: await snapshot(page) });
        }
        if (["events", "dispose", "mixed"].includes(name)) {
          await page.keyboard.down("a");
          await page.waitForTimeout(400);
          await page.keyboard.up("a");
          await page.waitForTimeout(150);
          result.checkpoints.push({ label: "keys released", state: await snapshot(page) });
        }
        if (name === "state") {
          await page.keyboard.down("b");
          await page.waitForTimeout(100);
          await page.keyboard.up("b");
          result.checkpoints.push({ label: "clone draws with fresh brush", state: await snapshot(page) });
        }
      } catch (error) { result.error = String(error); }
      finally { await page.close(); }
      console.log(JSON.stringify({ name, ...result }, null, 2));
    }
  } finally { await browser.close(); }
  report.ok = Object.entries(report.cases).every(([name, r]) => !r.error && !r.pageErrors.length && !r.workspaceIssues.length && r.checkpoints.length && r.checkpoints.every(p => name === "mirrorSelf" ? p.state.error.show_error : !p.state.error.show_error));
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/clone-kitten4.mjs") || process.argv[1] === "tools/clone-kitten4.mjs") main().catch(error => { console.error(error); process.exitCode = 1; });
