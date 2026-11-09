#!/usr/bin/env node
// Self-authored minimal workspaces; no corpus/project assets are copied.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright, openOfficial, loadOfficialProject, officialUrl } from "./probe-kitten4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "tests/fixtures/kitten4");
const schema = JSON.parse(await readFile(path.join(root, "docs/kitten4-block-schema.json"), "utf8"));
const sceneA = "10000000-0000-4000-8000-000000000001";
const sceneB = "10000000-0000-4000-8000-000000000002";
const actorId = "20000000-0000-4000-8000-000000000001";
const empty = () => ({ blocks: {}, connections: {}, comments: {} });
let serial = 0;
const b = (type, fields = {}, inputs = {}, statements = {}) => ({ type, fields, inputs, statements });
const num = n => b("math_number", { NUM: String(n) });
const text = s => b("text", { TEXT: s });
const get = name => b("variables_get", { VAR: name });
const set = (name, value) => b("variables_set", { VAR: name }, { VALUE: value });
const inc = name => b("change_variable", { valname: name, method: "increase" }, { n: num(1) });
const wait = seconds => b("wait", {}, { time: num(seconds) });
const chain = (...blocks) => { for (let i = 1; i < blocks.length; i++) blocks[i - 1].next = blocks[i]; return blocks[0]; };
const start = (...blocks) => chain(b("start_on_click"), ...blocks);
const clone = () => b("mirror", { sprite: "__self" });
const isOriginal = () => b("logic_compare", { OP: "EQ" }, { A: b("get_current_clone_index"), B: num(0) });
const byInstance = (original, cloned) => ({ ...b("controls_if", {}, { IF0: isOriginal() }, { DO0: original, ELSE: cloned }), mutation: '<mutation else="1"></mutation>' });

function workspace(roots) {
  const graph = empty();
  function add(node, parent = null) {
    const id = `probe-${++serial}`;
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

function project(name, roots, variables) {
  serial = 0;
  const entity = (id, name, styles) => ({ id, name, styles, current_style_id: styles[0], x: 0, y: 0, scale: 100, rotation: 0, rotation_type: 0, draggable: false, visible: true, workspace_offset: { x: 40, y: 40 }, block_data_json: empty() });
  const style = (id, name, width, height) => ({ id, name, adaptive: false, pivot: { x: 0, y: 0 }, rotate_center: { x: 0, y: 0 }, cdn_url: "", url: `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#336699"/></svg>`).toString("base64")}` });
  const result = {
    hidden_toolbox: { toolbox: [], blocks: [] }, work_source_label: 1, version: 25, application_version: "4.11.20", work_type: "KITTEN", size: { width: 1280, height: 720 }, type: 1, project_name: `NekoC semantics ${name}`,
    theatre: {
      current_entity: "actor", current_scene: sceneA, scenes_order: [sceneA, sceneB],
      scenes: {
        [sceneA]: { ...entity(sceneA, "Background A", ["background"]), actors: ["actor"], screen_name: "Scene A", group_order: ["group"] },
        [sceneB]: { ...entity(sceneB, "Background B", ["background"]), actors: [], screen_name: "Scene B", group_order: [] },
      },
      actors: { actor: { ...entity("actor", "Probe", ["costume-a", "costume-b"]), scene: sceneA, lock: false, editable_in_tuition_mode: true, user_change_r_c: false, block_data_json: workspace(roots) } },
      groups: { group: { id: "group", name: "", is_fold: false, is_group: false, actors: ["actor"], scene: sceneA, visible: true } },
      styles: { background: style("background", "Background", 1280, 720), "costume-a": style("costume-a", "蓝色方块", 20, 20), "costume-b": style("costume-b", "第二个造型", 30, 20) }, videos: {}, timer: {},
    },
    variables: Object.fromEntries(Object.entries(variables).map(([id, value]) => [id, { id, name: id, value, type: "any", is_global: true, current_entity: "actor", visible: false, position: { x: 0, y: 0 } }])),
    variable_order: Object.keys(variables), cloud_variables: {}, audio: {}, audio_order: [], midimusic: [], midi_order: [], matrix: {}, models: {}, toolbox: { current_type: "event", pen: false }, toolbox_order: ["event", "control", "action", "appearance", "sensing", "operator", "data"], last_toolbox_order: [], hardware_type: "", is_partial: false, ai_lab: {}, broadcasts: {}, painter: { color: [] },
  };
  // Official runtime treats UUIDs as entity IDs; other strings are names.
  return JSON.parse(JSON.stringify(result).replaceAll('"actor"', JSON.stringify(actorId)));
}

function fixtures() {
  const condition = () => b("logic_compare", { OP: "EQ" }, { A: get("gate"), B: num(1) });
  const when = (body, cond = condition()) => b("when", {}, { condition: cond }, { DO: body });
  const screen = (stay, target) => b("check_screen", { is_stay: String(stay) }, { screen: b("get_sensing_current_scene", { scene: target }) });
  const screenValue = (stay, value) => b("check_screen", { is_stay: String(stay) }, { screen: value });
  const costume = attribute => b("get_3", { sprite: "__self", attribute });
  const select = (s, n) => ({ ...b("text_select_changeable", {}, { STRING: text(s), NUM0: num(n) }), mutation: '<mutation items="1"></mutation>' });
  const cases = {
    when: project("when", [
      start(clone(), wait(0.2), set("gate", num(1)), wait(0.7), set("gate", num(0)), wait(0.2), set("gate", num(1)), wait(0.7), set("gate", num(0)), wait(0.3), set("done", num(1))),
      when(byInstance(chain(inc("originalEnter"), wait(0.15), inc("originalExit")), chain(inc("cloneEnter"), wait(0.15), inc("cloneExit")))),
      when(inc("always"), b("logic_boolean", { BOOL: "TRUE" })),
    ], { gate: 0, originalEnter: 0, originalExit: 0, cloneEnter: 0, cloneExit: 0, always: 0, done: 0 }),
    screen: project("screen", [start(
      set("stayA", screen(true, sceneA)), set("leaveA", screen(false, sceneA)), set("stayB", screen(true, sceneB)), set("leaveB", screen(false, sceneB)),
      set("nameA", screenValue(true, text("Scene A"))), set("numberA", screenValue(true, num(1))), set("numberB", screenValue(true, num(2))),
      set("invalidStay", screenValue(true, text("missing"))), set("invalidLeave", screenValue(false, text("missing"))),
      wait(0.2), set("stayA_later", screen(true, sceneA)), set("leaveA_later", screen(false, sceneA)), set("done", num(1)),
    )], { stayA: 0, leaveA: 0, stayB: 0, leaveB: 0, nameA: 0, numberA: 0, numberB: 0, invalidStay: 0, invalidLeave: 0, stayA_later: 0, leaveA_later: 0, done: 0 }),
    dispose: project("dispose", [
      start(clone(), wait(0.3), inc("beforeOriginal"), b("dispose"), inc("afterOriginal")),
      b("start_as_a_mirror", {}, {}, { DO: chain(inc("beforeClone"), b("dispose"), inc("afterClone")) }),
      b("on_keydown", { key: "65", key_event_type: "down" }, {}, { DO: inc("keyAfterDispose") }),
    ], { beforeOriginal: 0, afterOriginal: 0, beforeClone: 0, afterClone: 0, keyAfterDispose: 0 }),
    costume: project("costume", [start(
      set("nameA", costume("4")), set("numberA", costume("2")), set("literalA", b("get_current_costume", { style_id: "costume-a" })),
      b("set_costume", {}, { index: b("get_current_costume", { style_id: "costume-b" }) }),
      set("nameB", costume("4")), set("numberB", costume("2")), set("literalB", b("get_current_costume", { style_id: "costume-b" })), set("done", num(1)),
      set("literalText", { ...b("text_join", {}, { ADD0: get("literalB"), ADD1: text("") }), mutation: '<mutation items="2"></mutation>' }),
    )], { nameA: 0, numberA: 0, literalA: 0, nameB: 0, numberB: 0, literalB: 0, literalText: 0, done: 0 }),
    keys: project("keys", [
      start(clone(), wait(0.2), set("done", num(1))),
      b("start_as_a_mirror", {}, {}, { DO: inc("cloneStarted") }),
      b("on_keydown", { key: "65", key_event_type: "down" }, {}, { DO: byInstance(chain(inc("originalEnter"), wait(0.15), inc("originalExit")), chain(inc("cloneEnter"), wait(0.15), inc("cloneExit"))) }),
    ], { originalEnter: 0, originalExit: 0, cloneEnter: 0, cloneExit: 0, cloneStarted: 0, done: 0 }),
    text: project("text", [start(
      ...[0, 1, 2, 4, 5, -1].map(n => set(`index${n}`, select("abcd", n))),
      set("unicode", select("A猫BC", 2)), set("empty", select("", 1)), set("done", num(1)),
    )], { index0: 0, index1: 0, index2: 0, index4: 0, index5: 0, "index-1": 0, unicode: 0, empty: 0, done: 0 }),
  };
  for (const name of ["when", "keys"]) {
    const split = structuredClone(cases[name]);
    split.project_name += " split";
    const graph = split.theatre.actors[actorId].block_data_json;
    const id = Object.keys(graph.blocks).find(id => graph.blocks[id].type === "mirror");
    const next = Object.entries(graph.connections[id]).find(([, edge]) => edge.type === "next");
    graph.blocks[id] = { ...graph.blocks[id], type: "clone", fields: { sprite: actorId } };
    // Gate the one split on the original's clone index: copied start hats must
    // not recursively split another generation and obscure the event probe.
    const guard = `${id}-guard`, condition = `${id}-condition`, index = `${id}-index`, zero = `${id}-zero`;
    const parent = graph.blocks[id].parent_id;
    graph.blocks[guard] = { ...structuredClone(schema.blocks.controls_if.defaults), id: guard, parent_id: parent, fields: {}, mutation: '<mutation></mutation>', location: [0, 0] };
    graph.connections[parent][guard] = graph.connections[parent][id];
    delete graph.connections[parent][id];
    graph.blocks[id].parent_id = guard;
    graph.blocks[condition] = { ...structuredClone(schema.blocks.logic_compare.defaults), id: condition, parent_id: guard, fields: { OP: "EQ" }, location: [0, 0] };
    graph.blocks[index] = { ...structuredClone(schema.blocks.get_current_clone_index.defaults), id: index, parent_id: condition, location: [0, 0] };
    graph.blocks[zero] = { ...structuredClone(schema.blocks.math_number.defaults), id: zero, parent_id: condition, fields: { NUM: "0" }, location: [0, 0] };
    graph.connections[guard] = { [condition]: { type: "input", input_type: "value", input_name: "IF0" }, [id]: { type: "input", input_type: "statement", input_name: "DO0" } };
    graph.connections[condition] = { [index]: { type: "input", input_type: "value", input_name: "A" }, [zero]: { type: "input", input_type: "value", input_name: "B" } };
    graph.connections[index] = {}; graph.connections[zero] = {};
    if (next) {
      delete graph.connections[id][next[0]];
      graph.connections[guard][next[0]] = next[1];
      graph.blocks[next[0]].parent_id = guard;
    }
    for (const axis of ["x", "y"]) {
      const child = `${id}-${axis}`;
      graph.blocks[child] = { ...structuredClone(schema.blocks.math_number.defaults), id: child, parent_id: id, location: [0, 0], fields: { NUM: axis === "x" ? "100" : "0" } };
      graph.connections[id][child] = { type: "input", input_type: "value", input_name: axis };
      graph.connections[child] = {};
    }
    cases[`${name}-split`] = split;
  }
  return cases;
}

async function snapshot(page) {
  return page.evaluate(() => {
    const req = window.__nekocKitten4Require;
    const doc = req("TzHo").e.getDoc();
    const heart = req("JnWR").b();
    const manager = heart.get_runtime_manager();
    const stage = req("HP1x").a();
    const actor = stage.get_actor_by_id(Object.keys(doc.theatre.actors)[0]);
    return { variables: Object.fromEntries(Object.entries(doc.variables).map(([id, v]) => [id, manager.get_variable(id, undefined, v.current_entity)])),
      actor: actor ? { position: actor.get_position(), visible: actor.get_visible() } : null,
      error: req("ALsR").a.get_state().error_state, running: heart.get_runtime_data().is_running() };
  });
}

async function main() {
  if (process.argv.includes("--generate")) {
    await mkdir(directory, { recursive: true });
    for (const [name, value] of Object.entries(fixtures())) await writeFile(path.join(directory, `semantics-${name}.bcm`), JSON.stringify(value, null, 2) + "\n");
    return;
  }
  const out = process.argv[process.argv.indexOf("--out") + 1];
  if (!process.argv.includes("--out")) throw new Error("Usage: node tools/semantics-kitten4.mjs --generate | --out report.json [--case name]");
  const selected = process.argv.includes("--case") ? [process.argv[process.argv.indexOf("--case") + 1]] : Object.keys(fixtures());
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const report = { officialUrl, verifiedAt: new Date().toISOString(), browserVersion: browser.version(), cases: {} };
  try {
    for (const name of selected) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const result = report.cases[name] = { checkpoints: [], pageErrors: [] };
      page.on("pageerror", error => result.pageErrors.push(String(error)));
      try {
        await openOfficial(page);
        if (process.argv.includes("--inspect")) {
          const sources = await page.evaluate(() => Object.entries(window.__nekocKitten4Require.m).filter(([, fn]) => /check_screen|text_select_changeable|destruct_entity|clone_entity|action_state/.test(String(fn))).map(([id, fn]) => ({ id, source: String(fn) })));
          await mkdir(path.join(root, "dist/semantics"), { recursive: true });
          await writeFile(path.join(root, "dist/semantics/vendor-modules.json"), JSON.stringify(sources, null, 2));
        }
        const filename = path.join(directory, `semantics-${name}.bcm`);
        const source = await readFile(filename, "utf8");
        const input = JSON.parse(source);
        result.fixture = path.relative(root, filename).replaceAll("\\", "/");
        result.sha256 = createHash("sha256").update(source).digest("hex");
        await loadOfficialProject(page, input);
        result.applicationVersion = await page.evaluate(() => window.__nekocKitten4Require("3PHN").d().application_version);
        result.vendorScripts = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
        result.workspaces = await page.evaluate(() => {
          const req = window.__nekocKitten4Require;
          req("Fye/").B.select_workspace_by_id(Object.keys(req("TzHo").e.getDoc().theatre.actors)[0]);
          return Blockly.json.workspace_to_json(Blockly.mainWorkspace);
        });
        result.workspaceIssues = [];
        const wanted = input.theatre.actors[actorId].block_data_json;
        for (const [id, block] of Object.entries(wanted.blocks)) {
          const actual = result.workspaces.blocks[id];
          if (actual?.type !== block.type) result.workspaceIssues.push(`${id}: missing/changed type`);
          for (const [key, value] of Object.entries(block.fields)) if (String(actual?.fields[key]) !== String(value)) result.workspaceIssues.push(`${id}.${key}: changed field`);
          for (const [child, edge] of Object.entries(wanted.connections[id])) if (Object.entries(edge).some(([key, value]) => result.workspaces.connections[id]?.[child]?.[key] !== value)) result.workspaceIssues.push(`${id}->${child}: changed connection`);
        }
        if (result.workspaceIssues.length) throw new Error(result.workspaceIssues.join("; "));
        await page.locator("#btn_trigger").dispatchEvent("click");
        for (const delay of name.startsWith("when") ? [550, 600, 1000] : [700]) {
          await page.waitForTimeout(delay);
          result.checkpoints.push({ afterDelayMs: delay, state: await snapshot(page) });
        }
        if (name.startsWith("keys") || name === "dispose") {
          await page.keyboard.down("a");
          await page.waitForTimeout(700);
          result.checkpoints.push({ label: "held 700ms", state: await snapshot(page) });
          await page.waitForTimeout(500);
          result.checkpoints.push({ label: "held 1200ms", state: await snapshot(page) });
          await page.keyboard.up("a");
          await page.waitForTimeout(300);
          result.checkpoints.push({ label: "released", state: await snapshot(page) });
        }
        if (result.checkpoints.some(point => point.state.error.show_error)) process.exitCode = 1;
      } catch (error) { result.error = String(error); process.exitCode = 1; }
      finally { await page.close(); }
      console.log(JSON.stringify({ name, ...result, workspaces: undefined }, null, 2));
      delete result.workspaces;
    }
  } finally { await browser.close(); }
  report.ok = Object.values(report.cases).every(result => !result.error && !result.pageErrors.length && !result.workspaceIssues?.length && result.checkpoints.length && result.checkpoints.every(point => !point.state.error.show_error));
  if (!report.ok) process.exitCode = 1;
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });

export { workspace, fixtures };
