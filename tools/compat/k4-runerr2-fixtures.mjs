#!/usr/bin/env node
// Repository-owned minimal probes; never derive fixtures from the corpus.
import { createHash } from "node:crypto";
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";
import { workspace } from "./k4-scheduling-fixtures.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const b = (id, type, fields = {}, inputs = {}, statements = {}) => ({ id, type, fields, inputs, statements });
const num = n => b("", "math_number", { NUM: String(n) });
const text = s => b("", "text", { TEXT: s });
const split = s => b("", "text_split", {}, { TEXT_TO_SPLIT: text(s), SPLIT_TEXT: text(" ") });
const list = () => b("", "lists_get", { VAR: "result" });
const append = value => b("", "lists_append", {}, { VAR: list(), VALUE: value });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const compare = (a, c, op = "EQ") => b("", "logic_compare", { OP: op }, { A: a, B: c });

export async function runerr2Fixtures() {
  const base = await readJson("tests/fixtures/kitten4/runerr-addition.bcm");
  base.application_version = "4.11.19";
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  const actor = Object.keys(base.theatre.actors)[0];
  const cases = {
    equality: chain(b("start", "start_on_click"),
      append(compare(split("1 2"), split("1 2"))),
      append(compare(split("1 2"), split("1 3"), "NEQ")),
      // Equality is structural, but indexOf/includes must remain reference-based.
      append(split("1 2")),
      append(b("search", "lists_is_exist", {}, { VAR: list(), VALUE: split("1 2") })),
      b("branch", "controls_if", {}, { IF0: compare(split("3 4"), split("3 4")) }, {
        DO0: b("matched", "variables_set", { VAR: "log" }, { VALUE: num(1) }),
      })),
    trig: chain(b("start", "start_on_click"),
      ...[["COS", 18], ["SIN", 18], ["SIN", -72], ["ATAN", 0.5]].map(([OP, n]) =>
        append(b(`trig-${OP}-${n}`, "math_trig", { OP }, { NUM: num(n) })))),
    clock: chain(b("start", "start_on_click"),
      append(b("year", "get_time", { op: "year" })),
      append(b("weekday", "get_time", { op: "week" })),
      append(num(1)),
      b("wait", "wait", {}, { time: num(0) }),
      append(num(2))),
  };
  return Object.fromEntries(Object.entries(cases).map(([name, root]) => {
    const project = structuredClone(base);
    project.project_name = `NekoC runerr2 ${name}`;
    project.theatre.actors[actor].block_data_json = workspace([root], schema);
    return [name, project];
  }));
}

async function main() {
  const evidence = { schema: "nekoc-k4-runerr2-evidence-v1", cases: {} };
  for (const [name, project] of Object.entries(await runerr2Fixtures())) {
    const file = `tests/fixtures/kitten4/runerr2-${name}.bcm`;
    await saveJson(file, project);
    if (process.argv.includes("--record")) {
      const trace = await runOracle(project, { frames: 4, seed: 1, blocks: true, virtualTime: true });
      evidence.assets = trace.diagnostics.assets;
      evidence.cases[name] = { sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
        variables: trace.frames.map(f => f.variables), errors: trace.errors };
      console.log(name, JSON.stringify(evidence.cases[name]));
    }
  }
  if (process.argv.includes("--record")) await saveJson("docs/kitten4-runerr2-evidence.json", evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
