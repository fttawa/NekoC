import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

test("published hncompat2 replay preserves all historical inputs, raw failures and normalization distinction", async () => {
  const old = await read("docs/kncompat-hateneko-evidence.json");
  const current = await read("docs/compatibility/hncompat2-hateneko-evidence.json");
  const identities = works => works.map(w => [w.file.replaceAll("\\", "/"), w.sha256]);
  assert.deepEqual(identities(current.works), identities(old.works));
  assert.equal(current.works.length, 41);
  assert.equal(current.binary_unchanged, true);
  assert.equal(current.reference.unchanged, true);
  assert.equal(current.works.filter(w => w.equal_observed_state).length, 18);
  assert.equal(current.works.filter(w => w.equal_normalized_state).length, 18);
  for (const work of current.works) {
    assert.equal(hash(await readFile(new URL(`../${work.file.replaceAll("\\", "/")}`, import.meta.url))), work.sha256);
    assert.equal(work.runs.length, 1);
    assert.equal(work.frames, 12);
    assert.equal(work.speedup_h_over_n, undefined);
    assert.equal(work.runs[0].nekoc.status, "ok");
    if (work.file.includes("actor-variables")) {
      assert.equal(work.runs[0].comparison.equal, false);
      assert.equal(work.runs[0].normalized_comparison.equal, false);
      assert.deepEqual(work.runs[0].normalized_comparison.differences.map(d => d.key), ["state.variables.cloneChanged"]);
    }
  }
  const unsupported = current.works.filter(w => w.runs[0].hateneko.status === "unsupported");
  assert.equal(unsupported.length, 1);
  assert.match(unsupported[0].file, /object-json/);
  assert.equal(unsupported[0].equal_normalized_state, false);
});

test("the verdict document lists every exact input once, with explicit scope limits", async () => {
  const evidence = await read("docs/compatibility/hncompat2-hateneko-evidence.json");
  const markdown = await readFile(new URL("../docs/compatibility/hateneko-verdicts.md", import.meta.url), "utf8");
  const rows = markdown.split(/\r?\n/).filter(line => /^\| \d+ \|/.test(line));
  assert.equal(rows.length, 41);
  for (const work of evidence.works) {
    const file = work.file.replaceAll("\\", "/");
    assert.equal(rows.filter(row => row.includes(`\`${file}\``)).length, 1, file);
  }
  assert.match(markdown, /音频完成/);
  assert.match(markdown, /未验证/);
  assert.match(markdown, /不会|不将|不把/);
  const categories = rows.map(row => row.split("|")[4].trim());
  assert.deepEqual(Object.fromEntries(["和 H 一致", "官方裁定 NekoC 正确", "NekoC 已修复", "无法裁定"].map(
    category => [category, categories.filter(c => c === category).length])), {
    "和 H 一致": 18, "官方裁定 NekoC 正确": 20, "NekoC 已修复": 0, "无法裁定": 3,
  });
});

test("all eight long pairs retain complete samples and distinguish EOS, LIMIT and residual inputs", async () => {
  const report = await read("docs/compatibility/hncompat2-long-evidence.json");
  const official = await read("docs/compatibility/hncompat2-progress-official.json");
  assert.equal(report.runs.length, 8);
  for (const row of report.runs) {
    assert.equal(row.frames, 600);
    assert.equal(row.binary_unchanged, true);
    assert.equal(row.reference.unchanged, true);
    const { nekoc: n, hateneko: h } = row.runs[0].runtimes;
    for (const r of [n, h]) {
      assert.equal(r.status, "ok");
      assert.equal(r.measured_frames, 600);
      assert.equal(r.measured_warmup, 0);
    }
    assert.equal(n.milestone_reached, true);
    assert.equal(row.runs[0].comparison.equal, false);
    assert.equal(row.runs[0].normalized_comparison.equal, false);
    if (row.file.includes("fangjie")) {
      const expected = official.cases.fangjie.samples.at(-1);
      for (const id of ["kn-list-world", "kn-list-chunk_x", "kn-list-chunk_z"]) {
        assert.equal(n.final_state.variables[id].sha256, expected.listDigests[id].jsonSha256);
        assert.equal(h.final_state.variables[id].sha256, expected.listDigests[id].jsonSha256);
      }
      assert.deepEqual(row.runs[0].normalized_comparison.differences.map(d => d.key), [
        "state.variables.kn-var-guimx", "state.variables.kn-var-guimy", "state.variables.kn-var-mx0", "state.variables.kn-var-my0",
      ]);
    } else if (row.file.includes("tiny-lm")) {
      const expected = official.cases["tiny-lm"].samples.at(-1).variables;
      assert.deepEqual(n.final_state.variables["kn-list-lm_generated_ids"], expected["kn-list-lm_generated_ids"].head);
      assert.equal(n.final_state.variables["kn-var-lm_output"], expected["kn-var-lm_output"]);
      assert.equal(h.final_state.variables["kn-var-lm_status"], "DONE / LIMIT");
      assert.deepEqual(h.final_state.variables["kn-list-lm_generated_ids"], [20, 29, 71, 71, ...Array(28).fill(58)]);
      assert.equal(h.milestone_reached, false);
    } else {
      assert.equal(n.final_state.variables.cloneChanged, 99);
      assert.equal(n.final_state.variables.cloneRead, 99);
      assert.equal(h.final_state.variables.cloneChanged, 0);
      assert.equal(h.final_state.variables.cloneRead, 0);
    }
  }
  for (const file of new Set(report.runs.map(r => r.file))) {
    assert.deepEqual(report.runs.filter(r => r.file === file).map(r => r.interpreter).sort(), [false, true]);
  }
});
