import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runerr2Fixtures } from "../tools/compat/k4-runerr2-fixtures.mjs";
import { readJson, runOracle, parseArgs } from "../tools/compat/k4-oracle.mjs";

test("runerr2 probes are self-authored and pinned to official observations", async () => {
  const evidence = await readJson("docs/kitten4-runerr2-evidence.json");
  const projects = await runerr2Fixtures();
  assert.deepEqual(Object.keys(projects), Object.keys(evidence.cases));
  for (const [name, project] of Object.entries(projects)) {
    const text = await readFile(`tests/fixtures/kitten4/runerr2-${name}.bcm`, "utf8");
    assert.equal(text, JSON.stringify(project, null, 2) + "\n");
    assert.equal(createHash("sha256").update(text).digest("hex"), evidence.cases[name].sha256);
    assert.deepEqual(evidence.cases[name].errors, []);
  }
  assert.equal(parseArgs(["--virtual-time", "--variable-filter", "a,b"]).virtualTime, true);
  assert.equal(parseArgs(["--variable-filter", "a,b"]).variableFilter, "a,b");
});

test("runerr2 official probes reproduce with explicitly virtualized Date", { skip: !process.env.K4_ORACLE_INTEGRATION }, async () => {
  const evidence = await readJson("docs/kitten4-runerr2-evidence.json");
  for (const [name, project] of Object.entries(await runerr2Fixtures())) {
    const trace = await runOracle(project, { frames: 4, seed: 1, virtualTime: true });
    assert.deepEqual(trace.frames.map(f => f.variables), evidence.cases[name].variables, name);
    assert.deepEqual(trace.errors, []);
    const filtered = await runOracle(project, { frames: 1, virtualTime: true, variableFilter: "log" });
    assert.deepEqual(Object.keys(filtered.frames[0].variables), ["log"]);
  }
});
