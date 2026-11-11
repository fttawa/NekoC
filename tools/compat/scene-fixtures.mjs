#!/usr/bin/env node
// Repository-owned probes only. Reuse our workspace builder, never corpus data.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, workspace } from "../semantics-kitten4.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";

export const sceneA = "10000000-0000-4000-8000-000000000001";
export const sceneB = "10000000-0000-4000-8000-000000000002";
export const actorA = "20000000-0000-4000-8000-000000000001";
export const actorB = "20000000-0000-4000-8000-000000000002";
const b = (type, fields = {}, inputs = {}, statements = {}) => ({ type, fields, inputs, statements });
const num = n => b("math_number", { NUM: String(n) });
const text = value => b("text", { TEXT: value });
const inc = id => b("change_variable", { valname: id, method: "increase" }, { n: num(1) });
const wait = seconds => b("wait", {}, { time: num(seconds) });
const chain = (...nodes) => { for (let i = 1; i < nodes.length; i++) nodes[i - 1].next = nodes[i]; return nodes[0]; };
const start = (...nodes) => chain(b("start_on_click"), ...nodes);
const activate = (...nodes) => chain(b("on_running_group_activated"), ...nodes);
const switchTo = id => b("switch_to_screen", {}, { screen: b("get_current_scene", { scene: id }) });

export function sceneFixtures() {
  const base = fixtures().screen;
  base.project_name = "NekoC scene probe";
  base.theatre.current_scene = sceneB;
  base.theatre.current_entity = actorB;
  base.theatre.actors[actorA].block_data_json = workspace([]);
  base.theatre.actors[actorB] = { ...structuredClone(base.theatre.actors[actorA]), id: actorB, name: "Controller", scene: sceneB };
  base.theatre.scenes[sceneB].actors = [actorB];
  base.theatre.scenes[sceneB].group_order = ["controller-group"];
  base.theatre.groups["controller-group"] = { ...structuredClone(base.theatre.groups.group), id: "controller-group", actors: [actorB], scene: sceneB };
  base.variables = {};
  base.variable_order = [];
  const result = { initial: structuredClone(base) };
  result.reordered = structuredClone(base);
  result.reordered.theatre.scenes_order = [sceneB, sceneA];
  result.reordered.theatre.current_scene = sceneA;
  const lifecycle = structuredClone(base);
  for (const id of ["globalA", "globalB", "activationA", "activationB", "activationTail", "listenerEnter", "listenerTail", "afterSwitch", "cloneStarted", "done"]) {
    lifecycle.variables[id] = { id, name: id, value: 0, type: "any", is_global: true, current_entity: actorA, visible: false, position: { x: 0, y: 0 } };
    lifecycle.variable_order.push(id);
  }
  lifecycle.theatre.actors[actorA].block_data_json = workspace([
    start(inc("globalA"), b("self_move_to", {}, { x: num(73), y: num(-29) }), b("self_rotate", {}, { degrees: num(37) }),
      b("set_scale", {}, { scale: num(135) }), b("set_costume", {}, { index: b("get_current_costume", { style_id: "costume-b" }) }),
      b("mirror", { sprite: "__self" }), wait(0.15), b("self_broadcast", {}, { message: text("scene-ping") })),
    activate(inc("activationA"), wait(1), inc("activationTail")),
    b("self_listen", {}, { message: text("scene-ping") }, { DO: chain(inc("listenerEnter"), wait(0.6), inc("listenerTail")) }),
    b("start_as_a_mirror", {}, {}, { DO: inc("cloneStarted") }),
  ]);
  lifecycle.theatre.actors[actorB].block_data_json = workspace([
    start(inc("globalB"), wait(0.35), switchTo(sceneB),
      inc("afterSwitch"), wait(0.7), switchTo(sceneA), wait(1.4), inc("done")),
    activate(inc("activationB")),
  ]);
  result.lifecycle = lifecycle;
  // A scene-bound activation that switches away must not execute its tail.
  result.activationSwitch = structuredClone(base);
  result.activationSwitch.variables = structuredClone(lifecycle.variables);
  result.activationSwitch.variable_order = [...lifecycle.variable_order];
  result.activationSwitch.theatre.scenes[sceneA].block_data_json = workspace([
    activate(switchTo(sceneB), inc("afterSwitch")),
  ]);
  result.sameScene = structuredClone(base);
  result.sameScene.variables = structuredClone(lifecycle.variables);
  result.sameScene.variable_order = [...lifecycle.variable_order];
  result.sameScene.theatre.actors[actorA].block_data_json = workspace([
    activate(inc("activationA"), switchTo(sceneA), inc("afterSwitch")),
  ]);
  return result;
}

async function main() {
  const cases = sceneFixtures();
  const directory = "tests/fixtures/kitten4/scenes";
  if (process.argv.includes("--generate")) {
    for (const [name, project] of Object.entries(cases)) await saveJson(`${directory}/${name}.bcm`, project);
    return;
  }
  const report = {};
  for (const name of Object.keys(cases)) {
    const result = await runOracle(cases[name], { frames: 180, seed: 1, channel: "msedge" });
    await saveJson(`dist/scene/fixtures/${name}.json`, result);
    report[name] = { first: result.frames[0], last: result.frames.at(-1), diagnostics: result.diagnostics };
  }
  await saveJson("dist/scene/fixtures/summary.json", report);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
