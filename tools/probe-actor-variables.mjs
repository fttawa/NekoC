#!/usr/bin/env node
// Read-only source excerpts and official-editor probes; vendor code stays in dist.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadPlaywright, openOfficial, loadOfficialProject } from "./probe-kitten4.mjs";

const mode = process.argv[2];
await mkdir("dist/actorvars", { recursive: true });
if (mode === "coverage") {
  const { readdir } = await import("node:fs/promises");
  const [exe, directory, output] = process.argv.slice(3);
  const files = (await readdir(directory)).filter(f => f.endsWith(".bcm")).map(f => `${directory}/${f}`);
  const result = spawnSync(exe, ["coverage", "--frames", "1", ...files], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error);
  const rows = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
  await writeFile(output, JSON.stringify(rows, null, 2) + "\n");
  const stages = {};
  for (const r of rows) stages[r.report.stage] = (stages[r.report.stage] || 0) + 1;
  console.log(JSON.stringify({ count: rows.length, stages, target: rows.find(r => r.file.includes("303779283")) }, null, 2));
} else if (mode === "archive") {
  const report = { description: "Self-authored fixtures in the live official editors; runtime manager reads, not monitor values.", cases: [] };
  for (const platform of ["k4", "kn"]) for (const scenario of ["inheritance", "deleted"]) {
    const value = JSON.parse(await readFile(`dist/actorvars/${platform}-${scenario}-oracle.json`, "utf8"));
    delete value.snapshot?.text;
    if (value.failure) throw new Error(value.failure);
    report.cases.push({ platform, scenario, ...value });
  }
  report.editorCompat = JSON.parse(await readFile("dist/actorvars/editor-compat.json", "utf8"));
  for (const project of report.editorCompat.projects) project.input = project.input.replace(/^.*[\\/]tests[\\/]/, "tests/").replaceAll("\\", "/");
  await writeFile("docs/actor-variables-official.json", JSON.stringify(report, null, 2) + "\n");
} else if (mode === "generate") {
  const actor = "20000000-0000-4000-8000-000000000001";
  const other = "20000000-0000-4000-8000-000000000002";
  const privateId = "30000000-0000-4000-8000-000000000001";
  const otherId = "30000000-0000-4000-8000-000000000002";
  const b = (type, fields = {}, inputs = {}, statements = {}) => ({ type, fields, inputs, statements });
  const n = value => b("math_number", { NUM: String(value) });
  const get = id => b("variables_get", { VAR: id });
  const set = (id, value) => b("variables_set", { VAR: id }, { VALUE: value });
  const property = (sprite, attribute, index) => index === undefined ? b("get_3", { sprite, attribute }) : b("get_clone_index_property", { sprite, attribute }, { index: n(index) });
  const chain = (...items) => { for (let i = 1; i < items.length; i++) items[i - 1].next = items[i]; return items[0]; };
  const wait = t => b("wait", {}, { time: n(t) });
  const schema = JSON.parse(await readFile("docs/kitten4-block-schema.json", "utf8"));
  let serial = 0;
  function graph(roots) {
    const g = { blocks: {}, connections: {}, comments: {} };
    function add(node, parent = null) {
      const id = `actorvars-${++serial}`;
      g.blocks[id] = { ...structuredClone(schema.blocks[node.type].defaults), id, parent_id: parent, location: [0, 0], fields: node.fields };
      g.connections[id] = {};
      for (const [kind, children] of [["value", node.inputs], ["statement", node.statements]]) for (const [name, child] of Object.entries(children)) g.connections[id][add(child, id)] = { type: "input", input_type: kind, input_name: name };
      if (node.next) g.connections[id][add(node.next, id)] = { type: "next" };
      return id;
    }
    roots.forEach(r => add(r));
    return g;
  }
  for (const deleted of [false, true]) {
    const project = JSON.parse(await readFile("tests/fixtures/kitten4/semantics-costume.bcm", "utf8"));
    project.project_name = `NekoC actor variables ${deleted ? "deleted" : "inheritance"}`;
    project.theatre.actors[other] = { ...structuredClone(project.theatre.actors[actor]), id: other, name: "Other", block_data_json: graph([]) };
    project.theatre.scenes[project.theatre.current_scene].actors.push(other);
    Object.values(project.theatre.groups)[0].actors.push(other);
    project.variables = {};
    for (const [id, value, owner] of [[privateId, 5, actor], [otherId, "other-value", other], ...["inherited", "cloneChanged", "original", "otherRead", "cloneRead", "done", "afterDelete"].map(id => [id, 0, null])]) {
      project.variables[id] = { id, name: id, value, type: "any", is_global: owner === null, current_entity: owner || actor, visible: false, position: { x: 0, y: 0 } };
    }
    project.variable_order = Object.keys(project.variables);
    project.theatre.actors[actor].block_data_json = graph([
      chain(b("start_on_click"), set(privateId, n(41)), b("mirror", { sprite: "__self" }), wait(0.3), set("original", get(privateId)), set("cloneRead", property(actor, privateId, 1)), set("otherRead", property(other, otherId)), set("done", n(1)), ...(deleted ? [wait(0.5), set("afterDelete", property(actor, privateId, 1))] : [])),
      b("start_as_a_mirror", {}, {}, { DO: chain(set("inherited", get(privateId)), set(privateId, n(99)), set("cloneChanged", property("__self", privateId)), ...(deleted ? [wait(0.5), b("dispose_clone")] : [])) }),
    ]);
    await writeFile(`tests/fixtures/kitten4/actor-variables${deleted ? "-deleted" : ""}.bcm`, JSON.stringify(project, null, 2) + "\n");
    // Native KN fixture uses the same self-authored scalar scenario.
    const kn = JSON.parse(await readFile("samples/kitten-n-0.27.4.bcmkn", "utf8"));
    const template = structuredClone(Object.values(kn.actors.actorsDict)[0]);
    const scene = kn.scenes.currentSceneId;
    kn.actors.actorsDict = {};
    for (const id of [actor, other]) kn.actors.actorsDict[id] = { ...structuredClone(template), id, name: id === actor ? "Probe" : "Other", sceneId: scene, nekoBlockJsonList: [] };
    kn.scenes.scenesDict[scene].actorIds = [actor, other];
    kn.scenes.scenesDict[scene].nekoBlockJsonList = [];
    kn.variables.variablesDict = Object.fromEntries(Object.entries(project.variables).map(([id, v]) => [id, { ...v, isGlobal: v.is_global, currentEntityId: v.current_entity, visible: true }]));
    const convert = node => {
      const out = { ...node, id: `kn-actorvars-${++serial}`, fields: { ...node.fields }, inputs: Object.fromEntries(Object.entries(node.inputs).map(([k, v]) => [k, convert(v)])), statements: Object.fromEntries(Object.entries(node.statements).map(([k, v]) => [k, convert(v)])) };
      if (node.type === "variables_set") { out.fields = { variable: node.fields.VAR }; out.inputs = { value: convert(node.inputs.VALUE) }; }
      if (node.type === "variables_get") out.fields = { variable: node.fields.VAR };
      if (node.type === "get_3") { out.type = "get_clone_index_property"; out.inputs.index = node.fields.sprite === "__self" ? { type: "get_current_clone_index", id: `kn-actorvars-${++serial}` } : convert(n(0)); }
      if (node.type === "start_on_click") out.type = "on_running_group_activated";
      if (out.fields.sprite === "__self") out.fields.sprite = "--self";
      if (node.next) out.next = convert(node.next);
      return out;
    };
    // Reconstruct the two roots from their graph to avoid depending on a compiler.
    const g = project.theatre.actors[actor].block_data_json;
    const tree = id => {
      const block = g.blocks[id], node = b(block.type, block.fields);
      for (const [child, edge] of Object.entries(g.connections[id])) {
        if (edge.type === "next") node.next = tree(child);
        else node[edge.input_type === "value" ? "inputs" : "statements"][edge.input_name] = tree(child);
      }
      return node;
    };
    kn.actors.actorsDict[actor].nekoBlockJsonList = Object.entries(g.blocks).filter(([, v]) => v.parent_id === null).map(([id]) => convert(tree(id)));
    await writeFile(`tests/fixtures/actor-variables${deleted ? "-deleted" : ""}.bcmkn`, JSON.stringify(kn, null, 2) + "\n");
  }
} else if (mode === "sources") {
  for (const file of process.argv.slice(3)) {
    const bytes = await readFile(file), source = bytes.toString("utf8");
    console.log(file, createHash("sha256").update(bytes).digest("hex"));
    for (const symbol of ["clone_entity_variables", "get_var_or_list", "get_clone_property", "get_target_sprite_property", "entity_variables", "currentEntityId", "isGlobal", "clone_variables", "cloneVariable", "sprite_variables", "variables_get:", "set_variable:"]) {
      let at = -1;
      for (let n = 0; n < 6; n++) {
        at = source.indexOf(symbol, at + 1);
        if (at < 0) break;
        console.log(symbol, at, source.slice(Math.max(0, at - 120), at + 1000));
      }
    }
  }
} else if (mode === "k4" || mode === "kn") {
  const input = process.argv[3];
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const report = { url: "https://kitten4.codemao.cn/", at: new Date().toISOString(), browser: browser.version(), errors: [] };
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => report.errors.push(String(e)));
    const source = await readFile(input, "utf8");
    report.fixture = input;
    report.sha256 = createHash("sha256").update(source).digest("hex");
    if (mode === "k4") {
      await openOfficial(page);
      await loadOfficialProject(page, JSON.parse(source));
      await page.locator("#btn_trigger").dispatchEvent("click");
    } else {
      await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/, async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") });
      });
      await page.route("https://kn.codemao.cn/actorvars.bcmkn", route => route.fulfill({ contentType: "application/json", body: source }));
      await page.goto("https://kn.codemao.cn/editor?previewUrl=" + encodeURIComponent("https://kn.codemao.cn/actorvars.bcmkn"), { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.__nekocRequire && document.body.innerText.includes("inherited"), null, { timeout: 120000 });
      await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
      const done = page.getByText(/^完成$/).last();
      if (await done.isVisible()) await done.dispatchEvent("click");
      await page.getByText(/^开始$/).last().dispatchEvent("click");
    }
    if (input.includes("deleted")) {
      await page.waitForTimeout(400);
      report.beforeDelete = mode === "k4" ? await page.evaluate(() => {
        const req = window.__nekocKitten4Require, doc = req("TzHo").e.getDoc();
        const manager = req("JnWR").b().get_runtime_manager();
        return Object.fromEntries(Object.entries(doc.variables).map(([id, v]) => [id, manager.get_variable(id, undefined, v.current_entity)]));
      }) : await page.evaluate(() => {
        const req = window.__nekocRequire, manager = req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
        const vars = req(91107).BcmInstance.variablesDict;
        return Object.fromEntries(Object.entries(vars).map(([id, v]) => [id, manager.get_variable(id, undefined, v.currentEntityId)]));
      });
    }
    await page.waitForTimeout(1500);
    report.snapshot = mode === "kn" ? await page.evaluate(() => {
      const req = window.__nekocRequire, manager = req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
      const vars = req(91107).BcmInstance.variablesDict;
      return { variables: Object.fromEntries(Object.entries(vars).map(([id, v]) => {
        const value = manager.get_variable(id, undefined, v.currentEntityId);
        return [id, typeof value === "number" && Number.isNaN(value) ? "NaN" : value];
      })), monitorVariables: Object.fromEntries(Object.values(req(69138).default.ComponentsStore.TheatreStore.stageVariable).map(v => [v.name, v.value])), text: document.body.innerText };
    }) : await page.evaluate(() => {
      const req = window.__nekocKitten4Require, doc = req("TzHo").e.getDoc();
      const manager = req("JnWR").b().get_runtime_manager();
      return { variables: Object.fromEntries(Object.entries(doc.variables).map(([id, v]) => [id, manager.get_variable(id, undefined, v.current_entity)])), error: req("ALsR").a.get_state().error_state };
    });
  } catch (e) { report.failure = String(e); }
  finally { await browser.close(); }
  report.url = mode === "kn" ? "https://kn.codemao.cn/editor" : report.url;
  await writeFile(`dist/actorvars/${mode}-${input.includes("deleted") ? "deleted" : "inheritance"}-oracle.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} else {
  throw new Error("Usage: probe-actor-variables.mjs generate | archive | sources <bundle...> | k4|kn <fixture> | coverage <exe> <corpus-directory> <out.json>");
}
