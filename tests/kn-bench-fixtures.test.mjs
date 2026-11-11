import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fixtures, writeKnFixtures } from "../tools/bench/kn-fixtures.mjs";

const names = ["numeric", "list", "string", "clones", "broadcast", "recursion", "pen"];
function blocks(value) {
  if (!value || typeof value !== "object") return [];
  return [...(typeof value.type === "string" && typeof value.parent_id === "string" ? [value] : []), ...Object.values(value).flatMap(blocks)];
}

test("KN benchmarks use native generator blocks with K4-equivalent batch sizes", async () => {
  const projects = await fixtures();
  assert.deepEqual(Object.keys(projects), names);
  const counts = { numeric: 4000, list: 1000, string: 2000, clones: 200, broadcast: 100, recursion: 40, pen: 4000 };
  for (const [name, project] of Object.entries(projects)) {
    assert.equal(project.toolType, "KN");
    const actor = Object.values(project.actors.actorsDict)[0];
    assert.equal(actor.sceneId, project.scenes.currentSceneId);
    const start = actor.nekoBlockJsonList.find(block => block.type === "on_running_group_activated");
    assert.equal(start.next.type, "repeat_forever");
    assert.equal(start.next.statements.DO.type, "warp");
    const all = blocks(project);
    assert.equal(new Set(all.map(block => block.id)).size, all.length, name);
    const repeat = all.find(block => block.type === "repeat_n_times");
    assert.equal(Number(repeat.inputs.times.fields.NUM), counts[name]);
    assert.deepEqual(project.variables.variablesDict.result.value, []);
    assert.ok(Object.values(project.variables.variablesDict).every(variable => variable.visible === false));
    assert.ok(Object.values(project.styles.stylesDict).every(style => style.url.startsWith("data:image/svg+xml,")));
  }
  const all = name => blocks(projects[name]);
  assert.ok(all("numeric").some(block => block.type === "math_arithmetic" && block.fields.type === "multiply"));
  assert.ok(all("list").some(block => block.type === "list_append"));
  assert.ok(all("list").some(block => block.type === "list_index_of"));
  assert.match(all("string").find(block => block.type === "text_join").mutation, /items="2"/);
  assert.equal(all("clones").find(block => block.type === "mirror").fields.sprite, "--self");
  assert.equal(all("clones").find(block => block.type === "start_as_a_mirror").statements.DO.type, "dispose_clone");
  assert.equal(all("broadcast").filter(block => block.type === "self_listen").length, 12);
  assert.deepEqual(projects.broadcast.broadcasts.broadcastsDict[projects.broadcast.scenes.currentSceneId], ["bench"]);
  const [procedure] = Object.values(projects.recursion.procedures.proceduresDict);
  assert.equal(procedure.type, "NORMAL");
  // KN stores the procedure's display label in params as well. It is not a
  // value parameter and needs neither a stable parameter nor an argument.
  assert.equal(procedure.params.length, 1);
  assert.equal(procedure.params[0].type, "Label");
  assert.equal(procedure.params[0].name, "recur");
  const definition = procedure.nekoBlockJsonList[0];
  assert.equal(definition.id, procedure.id);
  assert.equal(definition.type, "procedures_2_defnoreturn");
  assert.equal(all("recursion").filter(block => block.type === "procedures_2_callnoreturn").length, 2);
  assert.ok(all("recursion").filter(block => block.type === "procedures_2_callnoreturn").every(block => block.mutation.includes(`def_id="${procedure.id}"`)));
  assert.ok(all("recursion").some(block => block.type === "logic_compare" && block.fields.OP === "LT" && Number(block.inputs.B.fields.NUM) === 20));
  assert.ok(all("pen").some(block => block.type === "self_pen_down"));
  assert.ok(all("pen").some(block => block.type === "self_move_to"));
});

test("writeKnFixtures creates seven deterministic .bcmkn files in the requested directory", async () => {
  // Leave generated works under ignored dist for the required editor check.
  const directory = path.resolve("dist/bench/kn-fixture-test");
  const paths = await writeKnFixtures(directory);
  assert.deepEqual(paths, names.map(name => path.join(directory, `${name}.bcmkn`)));
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith(".bcmkn")).sort(), names.map(name => `${name}.bcmkn`).sort());
  const expected = await fixtures();
  for (const [index, file] of paths.entries()) {
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), expected[names[index]]);
  }
});
