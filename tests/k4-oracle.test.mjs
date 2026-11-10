import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs, runtimeProject, runOracle, readJson, saveJson, allowedAsset, projectAssetUrls } from "../tools/compat/k4-oracle.mjs";
import { firstDifference, sameValue, executableTrees, mismatchingBlockTypes, compareWork, projectCapabilities, markdown } from "../tools/compat/k4-diff.mjs";

const trace = (actor = {}, variables = {}) => ({ schema: "nekoc-k4-trace-v1", frames: [{ frame: 1,
  current_scene_id: "s", actors: { a: { x: 1, y: 2, rotation: 0, scale: 100, scale_y: 100, visible: true, current_style_id: "c", ...actor } },
  variables, entity_variables: {} }] });

test("k4 oracle options reject malformed values and default to msedge", () => {
  assert.equal(parseArgs([]).channel, "msedge");
  assert.equal(parseArgs(["compile", "--input", "a.bcm"]).command, "compile");
  for (const args of [["run", "--frames", "NaN"], ["run", "--seed", "-1"], ["run", "--seed", "4294967296"], ["run", "--input"], ["what"]]) assert.throws(() => parseArgs(args));
});

test("runtime actor adaptation is non-mutating, handles cycles and preserves explicit order", () => {
  const input = { theatre: { scenes: { s: { group_order: ["loop", "g"] } }, actors: { a: { scene: "s" }, b: { scene: "s" } },
    groups: { loop: { is_group: true, group_order: ["loop"] }, g: { actors: ["b", "a"] } } } };
  const result = runtimeProject(input);
  assert.deepEqual(result.project.theatre.scenes.s.actors, ["a", "b"]);
  assert.equal(input.theatre.scenes.s.actors, undefined);
  input.theatre.scenes.s.actors = ["b", "a"];
  assert.deepEqual(runtimeProject(input).project.theatre.scenes.s.actors, ["b", "a"]);
});

test("trace comparison preserves types, raw rotations, lists and first frame", () => {
  assert.equal(firstDifference(trace(), trace({ x: 1 + 1e-8 })), null);
  assert.equal(firstDifference(trace(), trace({ rotation: 360 })).field, "rotation");
  assert.equal(firstDifference(trace({}, { v: 0 }), trace({}, { v: "0" })).field, "variables.v");
  assert.equal(sameValue([1, ["a"]], [1, ["a"]]), true);
  assert.equal(sameValue([1], ["1"]), false);
  const left = trace(), right = trace();
  right.frames.push({ ...right.frames[0], frame: 2 });
  assert.equal(firstDifference(left, right).frame, 2);
  right.frames[0].actors.b = right.frames[0].actors.a;
  assert.equal(firstDifference(left, right).actor, "b");
  assert.throws(() => firstDifference({}, trace()), /schema/);
});

test("compiler comparison ignores UI metadata, attributes changed source blocks", () => {
  const wrap = block => ({ actors: { actorsDict: { a: { nekoBlockJsonList: [block] } } } });
  const a = wrap({ id: "b", type: "math_number", fields: { NUM: "1" }, location: [2, 3] });
  const b = wrap({ id: "b", type: "math_number", fields: { NUM: "1" } });
  assert.deepEqual(executableTrees(a), executableTrees(b));
  b.actors.actorsDict.a.nekoBlockJsonList[0].fields.NUM = "2";
  const source = { theatre: { scenes: {}, actors: { a: { block_data_json: { blocks: { b: { type: "math_number" } } } } } } };
  assert.deepEqual(mismatchingBlockTypes(a, b, source).blockTypes, ["math_number"]);
});

test("declared extensionless media is allowed only on approved HTTPS CDNs", () => {
  const declared = projectAssetUrls({ theatre: { styles: { s: { url: "https://creation.codemao.cn/445/kitten/base64=" } } } });
  assert.ok(allowedAsset(new URL("https://creation.codemao.cn/445/kitten/base64=?imageView2/0/format/webp"), declared));
  assert.ok(allowedAsset(new URL("https://kn-cdn.codemao.cn/kitten/image.png"), declared));
  for (const url of ["https://creation.codemao.cn/api/unknown", "http://creation.codemao.cn/445/kitten/base64=", "https://evil.example/image.png", "https://collection.codemao.cn/report/kitten"]) {
    assert.equal(allowedAsset(new URL(url), declared), false);
  }
  for (const host of ["static.codemao.cn", "creation.bcmcdn.com"]) {
    const url = `https://${host}/kitten/image-key`;
    assert.ok(allowedAsset(new URL(url + "?imageView2/0/format/webp"), new Set([url])));
    assert.equal(allowedAsset(new URL(`https://${host}/api/unknown.json`), declared), false);
  }
});

test("published projects skip compilation and retain original AST; random differences stay unverified", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "k4-oracle-test-"));
  try {
    const project = await readJson("samples/kitten4-demo.bcm");
    for (const section of ["scenes", "actors"]) for (const entity of Object.values(project.theatre[section])) delete entity.block_data_json;
    project.compile_result = [{ id: "a", compiled_block_map: {}, procedures: {} }];
    const input = path.join(directory, "published.bcm");
    const options = { artifactsDir: path.join(directory, "artifacts"), frames: 1 };
    const calls = [];
    const dependencies = {
      native: async (file, extra = []) => extra.includes("--lowered") ? {} : trace(),
      runOracle: async (received, opts) => { calls.push(opts.command); assert.deepEqual(received.compile_result, project.compile_result); return trace(); },
    };
    await saveJson(input, project);
    const equal = await compareWork(input, options, dependencies);
    assert.equal(equal.status, "equal");
    assert.equal(equal.compile.status, "skipped");
    assert.deepEqual(calls, ["run"]);
    assert.match(markdown({ frames: 1, tolerance: 1e-6, works: [equal] }), /跳过（仅发布 AST）/);
    project.compile_result[0].compiled_block_map.rng = { id: "rng", type: "random" };
    assert.deepEqual(projectCapabilities(project), { compiledOnly: true, randomBlocks: ["random"] });
    await saveJson(input, project);
    dependencies.runOracle = async () => trace({ x: 42 });
    const random = await compareWork(input, options, dependencies);
    assert.equal(random.status, "unverified");
    assert.equal(random.firstDifference.field, "x");
    assert.equal(random.randomness.detected, true);
    delete project.compile_result[0].compiled_block_map.rng;
    await saveJson(input, project);
    const different = await compareWork(input, options, dependencies);
    assert.equal(different.status, "different");
    assert.equal(different.firstDifference.official, 42);
    const unsupported = await compareWork(input, options, { ...dependencies, native: async () => { throw new Error("unsupported block"); } });
    assert.equal(unsupported.status, "nekoc-unsupported");
    const failed = await compareWork(input, options, { ...dependencies, runOracle: async () => {
      throw Object.assign(new Error("load failed"), { diagnostics: { phase: "container", pageErrors: ["probe"] } });
    } });
    assert.equal(failed.status, "unverified");
    assert.equal((await readJson(path.join(failed.artifacts, "failure.json"))).phase, "container");
    project.theatre.actors[Object.keys(project.theatre.actors)[0]].block_data_json = { blocks: {} };
    assert.equal(projectCapabilities(project).compiledOnly, false);
    delete project.compile_result;
    assert.equal(projectCapabilities(project).compiledOnly, false);
    project.theatre.actors[Object.keys(project.theatre.actors)[0]].block_data_json.blocks = {
      face: { type: "self_face_to", fields: { sprite: "__random" } },
      move: { type: "self_move_specify", fields: { target: "__random" } },
    };
    assert.deepEqual(projectCapabilities(project).randomBlocks, ["self_face_to", "self_move_specify"]);
    const malformed = await compareWork(path.join(directory, "missing.bcm"), options, dependencies);
    assert.equal(malformed.status, "unverified");
    project.theatre.actors[Object.keys(project.theatre.actors)[0]].block_data_json = { blocks: {} };
    await saveJson(input, project);
    const workspaceCalls = [];
    const workspace = await compareWork(input, options, {
      native: async (file, extra = []) => extra.includes("--program") ? { program: "same" } : extra.includes("--lowered") ? {} : trace(),
      runOracle: async (received, opts) => {
        workspaceCalls.push(opts.command);
        return opts.command === "compile" ? { project: { ...received, compile_result: [] } } : trace();
      },
    });
    assert.equal(workspace.status, "equal");
    assert.equal(workspace.compile.status, "compared");
    assert.equal(workspace.compile.programEqual, true);
    assert.deepEqual(workspaceCalls, ["compile", "run"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// Opt-in only: no proprietary assets, browser, or network required by test:tools.
test("offline native compiler and fixed-step traces are repeatable", { skip: !process.env.K4_ORACLE_INTEGRATION }, async () => {
  const project = await readJson("samples/kitten4-demo.bcm");
  const options = { frames: 60, seed: 7, channel: "msedge", timeoutMs: 30000 };
  const compiled = await runOracle(project, { ...options, command: "compile" });
  assert.equal(compiled.project.compile_result.length, 2);
  const [a, b] = await Promise.all([runOracle(compiled.project, options), runOracle(compiled.project, options)]);
  assert.equal(a.frames.length, 60);
  assert.deepEqual(a.frames, b.frames);
  assert.equal(a.frames[59].variables["kn-var-ready"], 1);
  assert.ok(a.diagnostics.assets.some(asset => asset.source.endsWith(".orig")));
  assert.ok(a.diagnostics.externalRequests.every(request => request.action === "blocked"));
  // Repository-owned sample only; no published third-party work in this test.
  const published = structuredClone(compiled.project);
  for (const section of ["scenes", "actors"]) for (const entity of Object.values(published.theatre[section])) delete entity.block_data_json;
  const c = await runOracle(published, options);
  assert.deepEqual(c.frames, a.frames);
  assert.equal(c.diagnostics.localRequests.filter(request => request.url === "/new/abcdef0123456789" && request.destination === "document").length, 1);
  assert.ok(c.diagnostics.localRequests.some(request => request.url === "/new/abcdef0123456789" && request.destination !== "document" && request.status === 200));
});

test("official PCG random probe repeats with seed and advances on each frame", { skip: !process.env.K4_ORACLE_INTEGRATION }, async () => {
  const project = await readJson("samples/kitten4-demo.bcm");
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  const actorId = Object.keys(project.theatre.actors)[0];
  const variable = Object.keys(project.variables)[0];
  const blocks = {}, connections = {};
  function block(id, type, fields = {}, parent = null) {
    blocks[id] = { ...structuredClone(schema[type].defaults), id, fields, parent_id: parent, location: [0, 0] };
  }
  block("hat", "start_on_click");
  block("loop", "repeat_forever", {}, "hat");
  block("set", "variables_set", { VAR: variable }, "loop");
  block("rng", "random", {}, "set");
  block("lo", "math_number", { NUM: "1" }, "rng");
  block("hi", "math_number", { NUM: "1000000" }, "rng");
  connections.hat = { loop: { type: "next" } };
  connections.loop = { set: { type: "input", input_type: "statement", input_name: "DO" } };
  connections.set = { rng: { type: "input", input_type: "value", input_name: "VALUE" } };
  connections.rng = { lo: { type: "input", input_type: "value", input_name: "a" }, hi: { type: "input", input_type: "value", input_name: "b" } };
  project.theatre.actors[actorId].block_data_json = { blocks, connections, comments: {} };
  delete project.compile_result;
  const options = { frames: 12, seed: 42, channel: "msedge", timeoutMs: 30000 };
  const a = await runOracle(project, options), b = await runOracle(project, options);
  assert.deepEqual(a.frames, b.frames);
  assert.ok(new Set(a.frames.map(frame => frame.variables[variable])).size > 1);
  const c = await runOracle(project, { ...options, seed: 43 });
  assert.notDeepEqual(a.frames.map(frame => frame.variables), c.frames.map(frame => frame.variables));
});
