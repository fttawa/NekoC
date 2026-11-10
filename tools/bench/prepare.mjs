#!/usr/bin/env node
// Compile repository-owned microbenchmarks once with the external official compiler.
// Both runtimes then consume identical published ASTs, including procedure definitions.
import path from "node:path";
import { fixtures } from "./fixtures.mjs";
import { runOracle, saveJson } from "../compat/k4-oracle.mjs";

const out = process.argv[2] || "dist/bench/prepared";
if (!path.resolve(out).startsWith(path.resolve("dist") + path.sep)) throw new Error("Output must be under dist/");
for (const [name, input] of Object.entries(await fixtures())) {
  const { project, diagnostics } = await runOracle(input, { command: "compile" });
  for (const section of ["scenes", "actors"]) for (const entity of Object.values(project.theatre[section])) delete entity.block_data_json;
  await saveJson(`${out}/${name}.bcm`, project);
  await saveJson(`${out}/${name}-compile.json`, diagnostics);
  console.log(name);
}
