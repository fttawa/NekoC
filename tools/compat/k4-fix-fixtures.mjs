#!/usr/bin/env node
// Repository-owned minimal probes for timer, pen fill, sprite scale and stage dialog.
// Never derive fixtures from the corpus.
import { createHash } from "node:crypto";
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";
import { workspace } from "./k4-scheduling-fixtures.mjs";
import { layerDialogFixtures } from "./k4-layer-dialog-fixtures.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const b = (id, type, fields = {}, inputs = {}, statements = {}) => ({ id, type, fields, inputs, statements });
const num = n => b("", "math_number", { NUM: String(n) });
const list = () => b("", "lists_get", { VAR: "result" });
const append = value => b("", "lists_append", {}, { VAR: list(), VALUE: value });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const timer = () => append(b("", "get_timer"));
const wait0 = () => b("", "wait", {}, { time: num(0) });
const state = actions => b("", "set_timer_state", { actions });

// The same script under both sides of the official 4.1.1 get_timer boundary.
const timerScript = () => chain(b("start", "start_on_click"),
  timer(), wait0(), timer(),
  state("stop"), wait0(), timer(),
  state("reset"), timer(), wait0(), timer(),
  state("start"), wait0(), timer(), wait0(), timer());

export const FRAMES = 12;

export async function k4fixFixtures() {
  const base = await readJson("tests/fixtures/kitten4/runerr-addition.bcm");
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  const actor = Object.keys(base.theatre.actors)[0];
  const cases = {
    "timer-new": { version: "4.11.19", root: timerScript() },
    "timer-boundary": { version: "4.1.1", root: timerScript() },
    "timer-noncanonical": { version: "4.1.01", root: timerScript() },
    "timer-legacy": { version: "4.1.0", root: timerScript() },
    "timer-resume": { version: "4.11.19", root: chain(b("start", "start_on_click"),
      state("start"), wait0(), timer(), state("stop"), wait0(), timer(),
      state("start"), wait0(), timer(), state("reset"), timer(), wait0(), timer()) },
    // Closed pen path filled white (pen stays up), redrawn every frame
    // after clear_drawing (the shape of a frame-by-frame vector animation).
    fill: { version: "4.11.19", root: chain(b("start", "start_on_click"),
      b("fill-color", "set_fill_style", { color: "#FFFFFF" }),
      b("pen-color", "self_set_pen_color", { color: "#000000" }),
      b("loop", "repeat_forever", {}, {}, { DO: chain(
        b("clear", "clear_drawing"),
        b("p0", "self_move_to", {}, { x: num(-300), y: num(200) }),
        b("begin", "set_pen_path", { point: "start_point" }),
        b("p1", "self_move_to", {}, { x: num(250), y: num(220) }),
        b("p2", "self_move_to", {}, { x: num(120), y: num(-250) }),
        b("p3", "self_move_to", {}, { x: num(-200), y: num(-150) }),
        b("end", "set_pen_path", { point: "end_point" }),
        b("away", "self_move_to", {}, { x: num(600), y: num(600) })) })) },
    // No pointer event has reached the stage: the official mouse position is NaN,
    // so a sprite under the stage centre is not "touching the mouse".
    mouse: { version: "4.11.19", root: chain(b("start", "start_on_click"),
      append(b("", "get_mouse_info", { position: "x" })),
      append(b("", "get_mouse_info", { position: "y" })),
      b("loop", "repeat_forever", {}, {}, {
        DO: b("grow", "controls_if", {}, { IF0: b("", "bump", { sprite1: "__self", sprite2: "__mouse" }) }, {
          DO0: chain(b("hover", "variables_set", { VAR: "log" }, { VALUE: num(1) }),
            b("grow-size", "set_scale", {}, { scale: num(120) })),
        }),
      })) },
  };
  const projects = Object.fromEntries(Object.entries(cases).map(([name, { version, root }]) => {
    const project = structuredClone(base);
    project.application_version = version;
    project.project_name = `NekoC k4fix ${name}`;
    project.theatre.actors[actor].block_data_json = workspace([root], schema);
    return [name, project];
  }));
  projects.dialog = (await layerDialogFixtures()).dialog;
  projects.dialog.project_name = "NekoC k4fix dialog";
  return projects;
}

async function main() {
  const record = process.argv.includes("--record");
  const evidence = { schema: "nekoc-k4-fix-evidence-v1", frames: FRAMES, cases: {} };
  for (const [name, project] of Object.entries(await k4fixFixtures())) {
    await saveJson(`tests/fixtures/kitten4/k4fix-${name}.bcm`, project);
    if (!record) continue;
    const dialogs = [];
    const trace = await runOracle(project, { frames: FRAMES, seed: 1, blocks: true, virtualTime: true,
      onFrame: async page => dialogs.push(await page.evaluate(() => {
        const dialog = window.__k4OracleRequire("a1xw").a().core.components.get_stage_dialog();
        return dialog?.visible ? { printing: dialog.is_printing, text: dialog.content.text } : null;
      })) });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = { sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
      variables: trace.frames.map(f => f.variables),
      scales: trace.frames.map(f => Object.fromEntries(Object.entries(f.actors).map(([id, actor]) => [id, actor.scale]))),
      dialogs, errors: trace.errors };
    console.log(name, JSON.stringify(evidence.cases[name]));
  }
  if (record) await saveJson("docs/kitten4-fix-evidence.json", evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
