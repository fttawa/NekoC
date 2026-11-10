#!/usr/bin/env node
// Self-authored probes, independent of the external corpus.
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";
import { workspace } from "./k4-scheduling-fixtures.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const b = (id, type, fields = {}, inputs = {}, statements = {}) => ({ id, type, fields, inputs, statements });
const num = n => b("", "math_number", { NUM: String(n) });
const text = s => b("", "text", { TEXT: s });
const get = () => b("", "variables_get", { VAR: "log" });
const set = (id, value) => b(id, "variables_set", { VAR: "log" }, { VALUE: value });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const start = (id, ...body) => chain(b(id, "start_on_click"), ...body);
const add = (id, a, c) => b(id, "math_arithmetic", { OP: "ADD" }, { A: a, B: c });
const append = s => b("", "lists_append", {}, { VAR: b("", "lists_get", { VAR: "result" }), VALUE: s });
const repeat = (id, count, body) => b(id, "repeat_n_times", {}, { times: num(count) }, { DO: body });
const warp = body => b("", "warp", {}, {}, { DO: body });

export async function runErrorFixtures() {
  const base = await readJson("tests/fixtures/kitten4/scheduling-order.bcm");
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  const actor = Object.keys(base.theatre.actors)[0];
  const arithmetic = start("addition",
    set("numeric", add("sum", num(2), num(3))), append(get()),
    set("string", add("concat", num(6), text(",11,14"))), append(get()),
    append(b("split", "text_split", {}, { TEXT_TO_SPLIT: get(), SPLIT_TEXT: text(",") })),
    set("nested", add("nested-add", add("inner", num(2), text("3")), num(4))), append(get()),
    set("reset", num(6)), b("change", "change_variable", { valname: "log", method: "increase" }, { n: text(",11,14") }),
    append(get()), append(b("changed-split", "text_split", {}, { TEXT_TO_SPLIT: get(), SPLIT_TEXT: text(",") })));
  const cases = { addition: [arithmetic], random: [start("random",
    ...[[1.25, 4.75], [-1.5, 2.5], [6, 4]].map(([a, c], i) =>
      append(b(`random-${i}`, "random", {}, { a: num(a), b: num(c) }))))] };
  for (const count of [10000, 10001, 10002, 30002]) {
    cases[`warp-${count}`] = [start("producer", warp(repeat("loop", count, set("increment", add("count", get(), num(1))))), set("done", num(-1))),
      start("initializer", append(get()))];
  }
  cases["warp-nested"] = [start("producer", warp(repeat("outer", 2, repeat("inner", 15001, set("increment", add("count", get(), num(1)))))), set("done", num(-1))), start("initializer", append(get()))];
  cases["warp-until"] = [start("producer", warp(b("until", "repeat_forever_until", {}, {
    condition: b("limit", "logic_compare", { OP: "GTE" }, { A: get(), B: num(10003) }),
  }, { DO: set("increment", add("count", get(), num(1))) })), set("done", num(-1))), start("initializer", append(get()))];
  const projects = {};
  for (const [name, roots] of Object.entries(cases)) {
    const project = structuredClone(base);
    delete project.compile_result;
    project.project_name = `NekoC run error probe ${name}`;
    project.variables.log.value = 0;
    project.variables.result = { ...project.variables.log, id: "result", name: "result", type: "list", value: [] };
    project.variable_order.push("result");
    project.theatre.actors[actor].block_data_json = workspace(roots, schema);
    projects[name] = project;
  }
  return projects;
}

async function main() {
  const evidence = { schema: "nekoc-k4-run-error-evidence-v1", cases: {} };
  for (const [name, project] of Object.entries(await runErrorFixtures())) {
    await saveJson(`tests/fixtures/kitten4/runerr-${name}.bcm`, project);
    if (process.argv.includes("--record")) {
      const trace = await runOracle(project, { frames: 4, seed: 6, blocks: true, blockFilter: "done", randomSource: "nekoc" });
      evidence.assets = trace.diagnostics.assets;
      evidence.cases[name] = { sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
        variables: trace.frames.map(f => f.variables),
        execution: trace.events.filter(e => ["resume", "yield", "finish"].includes(e.event)) };
      console.log(name, JSON.stringify(evidence.cases[name].variables));
    }
  }
  if (process.argv.includes("--record")) await saveJson("docs/kitten4-run-error-evidence.json", evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
