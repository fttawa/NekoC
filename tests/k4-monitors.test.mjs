import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { monitorFixtures, widgetSnapshot } from "../tools/compat/k4-monitor-fixtures.mjs";
import { readJson, runOracle } from "../tools/compat/k4-oracle.mjs";

test("original initial monitor fixtures are deterministic and evidence is tied to their bytes", async () => {
  const evidence = await readJson("docs/kitten4-monitor-evidence.json");
  for (const [name, project] of Object.entries(await monitorFixtures())) {
    const file = `tests/fixtures/kitten4/monitors-${name}.bcm`;
    const bytes = await readFile(file);
    assert.deepEqual(JSON.parse(bytes), project);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.cases[name].sha256);
    assert.deepEqual(evidence.cases[name].errors, []);
    assert.equal(evidence.cases[name].widgets.length, 8);
    assert(evidence.cases[name].initial.every(widget => widget.exists));
  }
});

test("recorded widgets include actor/scene private monitors without show blocks", async () => {
  const evidence = await readJson("docs/kitten4-monitor-evidence.json");
  const idle = evidence.cases.idle;
  const ids = widgets => widgets.filter(w => w.visible).map(w => w.id);
  assert.deepEqual(ids(idle.initial), ["z-score", "a-text", "m-items", "private-score", "private-items", "stage-score", "inactive-score"]);
  for (const frame of idle.widgets) assert.deepEqual(ids(frame), ids(idle.initial));
  const dynamic = evidence.cases.dynamic.widgets.map(ids);
  assert(dynamic.some(frame => frame.includes("hidden") && !frame.includes("z-score") && !frame.includes("private-items")));
  assert.deepEqual(dynamic.at(-1), dynamic[0]);
});

test("unmodified offline K4 widget visibility matches recorded probes", {
  skip: process.env.K4_ORACLE_INTEGRATION !== "1",
}, async () => {
  const evidence = await readJson("docs/kitten4-monitor-evidence.json");
  for (const [name, project] of Object.entries(await monitorFixtures())) {
    const widgets = [];
    let initial;
    const trace = await runOracle(project, { frames: 8, seed: 1, virtualTime: true,
      beforeStart: async page => { initial = await widgetSnapshot(page, project); },
      onFrame: async page => { widgets.push(await widgetSnapshot(page, project)); },
    });
    // Page serialization omits undefined get_visible() for absent saved flags.
    assert.deepEqual(JSON.parse(JSON.stringify(initial)), evidence.cases[name].initial);
    assert.deepEqual(JSON.parse(JSON.stringify(widgets)), evidence.cases[name].widgets);
    assert.deepEqual(trace.frames.map(frame => frame.variables), evidence.cases[name].variables);
    assert.deepEqual(trace.errors, []);
  }
});
