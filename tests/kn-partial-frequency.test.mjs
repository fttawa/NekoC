import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  baselineCommit, baselineDocument, parseBaseline, selectCorpus,
  blockNodes, validateReferenceCatalog, frequency, priorityMarkdown,
} from "../tools/compat/kn-partial-frequency.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const baselineText = execFileSync("git", ["show", `${baselineCommit}:${baselineDocument}`], {
  cwd: root, encoding: "utf8",
});
const result = frequency(root);

test("baseline partial partition is frozen to task commit, not current coverage", () => {
  const rows = parseBaseline(baselineText);
  assert.equal(rows.length, 117);
  assert.equal(new Set(rows.map(r => r.type)).size, 117);
  assert.equal(rows.filter(r => r.hardware).length, 60);
  assert.equal(rows.filter(r => !r.hardware).length, 57);
  assert.equal(result.baseline.commit, baselineCommit);
  assert.throws(() => parseBaseline(baselineText.replaceAll("| 部分语义 |", "| 已升级 |")), /Expected baseline/);
});

test("only currently tracked baseline bcmkn files count; new partial fixtures stay excluded", () => {
  const old = ["samples/旧作品.bcmkn", "tests/fixtures/input-kn.bcmkn", "removed.bcmkn"];
  const current = ["samples/旧作品.bcmkn", "tests/fixtures/input-kn.bcmkn",
    "tests/fixtures/kn-partial-conversion/new.bcmkn",
    "tests/fixtures/kn-semantics/partial-clone.bcmkn", "new-example.bcmkn", "README.md"];
  const selected = selectCorpus(current, old);
  assert.deepEqual(selected.included, old.slice(0, 2));
  assert.deepEqual(selected.excluded.map(x => x.file), ["new-example.bcmkn",
    "tests/fixtures/kn-partial-conversion/new.bcmkn", "tests/fixtures/kn-semantics/partial-clone.bcmkn"]);
  assert.ok(selected.excluded.every(x => x.reason === "not-in-task-baseline-corpus"));
});

test("traverse connections, not fields.type, XML shadows, metadata or variable payloads", () => {
  const document = {
    variables: { variablesDict: { fake: { type: "mouse_down", value: {
      nekoBlockJsonList: [{ type: "mouse_down" }],
    } } } },
    actors: { actorsDict: { sprite: { nekoBlockJsonList: [{
      type: "sprite_on_tap", fields: { type: "mouse_down" },
      shadows: { text: '<shadow type="convert_type"/>' },
      metadata: { type: "setInterval" },
      next: { type: "convert_type", inputs: { text: { type: "math_number" } } },
      statements: { DO: { type: "setTimeout", inputs: { callback: { type: "convert_type" } } } },
    }, { type: "convert_type", id: "dormant" }] } } },
    scenes: { scenesDict: { scene: { nekoBlockJsonList: [{ type: "mouse_down" }] } } },
    procedures: { proceduresDict: { proc: { nekoBlockJsonList: [{ type: "procedures_2_defnoreturn",
      statements: { STACK: { type: "convert_type" } } }] } } },
  };
  const nodes = blockNodes(document);
  assert.deepEqual(nodes.map(n => n.type), ["sprite_on_tap", "convert_type", "math_number",
    "setTimeout", "convert_type", "convert_type", "mouse_down", "procedures_2_defnoreturn", "convert_type"]);
  assert.equal(nodes.filter(n => n.rootNode).length, 4);
  assert.equal(nodes.find(n => n.id === "dormant").rootType, "convert_type");
  assert.ok(nodes.find(n => n.type === "setTimeout").location.includes("statements"));
});

test("task corpus reproduces exact sample and regression partial frequencies", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(result.summary.groups).map(([g, s]) =>
    [g, [s.files, s.blocks, s.partialTypes, s.partialOccurrences]])), {
    projects: [16, 40421, 2, 4], samples: [9, 14132, 1, 3],
    fixtures: [39, 2037, 4, 43], other: [0, 0, 0, 0],
  });
  assert.deepEqual(result.rows.filter(r => r.occurrences).map(r => [r.type,
    r.counts.projects.occurrences, r.counts.samples.occurrences, r.counts.fixtures.occurrences]), [
    ["convert_type", 3, 3, 34], ["get_clone_index_property", 0, 0, 7],
    ["mouse_down", 1, 0, 0], ["setInterval", 0, 0, 1], ["setTimeout", 0, 0, 1],
  ]);
  assert.deepEqual(result.summary.hardware, { types: 60, occurrences: 0, zeroTypes: 60 });
  assert.deepEqual(result.summary.nonHardware, { types: 57, occurrences: 50, zeroTypes: 52 });
  assert.equal(result.referenceCheck, null);
  for (const row of result.rows) {
    assert.equal(row.hits.length, row.occurrences);
    assert.equal(Object.values(row.counts).reduce((n, x) => n + x.occurrences, 0), row.occurrences);
    assert.equal(new Set(row.hits.map(h => h.file)).size, row.files);
  }
  assert.ok(result.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
});

test("optional external catalog fails closed without external dependency in default tests", () => {
  assert.throws(() => validateReferenceCatalog(Buffer.from("{}")), /SHA-256 mismatch/);
});

test("reports retain dormant caveats, full zero rows and deterministic generated artifacts", () => {
  const markdown = priorityMarkdown(result);
  assert.match(markdown, /static, not execution/);
  assert.match(markdown, /游离/);
  assert.match(markdown, /PENCRAFT/);
  assert.match(markdown, /fields.type=mouse_down/);
  for (const row of result.rows.filter(r => !r.occurrences)) assert.ok(markdown.includes(`\`${row.type}\``));
  assert.equal(fs.readFileSync(new URL("../docs/kn-partial-priority.md", import.meta.url), "utf8"), markdown);
  const saved = JSON.parse(fs.readFileSync(new URL("../docs/kn-partial-frequency.json", import.meta.url), "utf8"));
  // Staging new round probes may change the explicit exclusion ledger, but never
  // frequencies. No test needs to create a file or mutate the Git index.
  assert.deepEqual({ ...saved, excludedFiles: [] }, { ...result, excludedFiles: [] });
});
