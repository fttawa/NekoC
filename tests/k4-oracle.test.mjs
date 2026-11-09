import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, runtimeProject, runOracle, readJson } from "../tools/compat/k4-oracle.mjs";
import { firstDifference, sameValue, executableTrees, mismatchingBlockTypes } from "../tools/compat/k4-diff.mjs";

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
