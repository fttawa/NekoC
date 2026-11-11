import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const evidence = async () => JSON.parse(await fs.readFile(new URL("docs/compatibility/hncompat2-progress-official.json", root), "utf8"));

test("long-run oracle source keeps original projects, clocks and scheduler untouched", async () => {
  const source = await fs.readFile(new URL("tools/compat/hncompat2-progress-official.mjs", root), "utf8");
  assert.match(source, /timeoutMsPerProject: 600000/);
  assert.match(source, /body: bytes/);
  assert.doesNotMatch(source, /short-world|config\.set|Math\.random\s*=|requestAnimationFrame\s*=|manager\.update\(/);
  assert.match(source, /world.*length === 524288/);
  assert.match(source, /logicalPosition\?\.y === -65/);
  assert.match(source, /=== "DONE \/ EOS"/);
});

test("long-run observations bind exact original files and official 0.27.4", async () => {
  const report = await evidence();
  assert.equal(report.schema, "nekoc-hncompat2-progress-official-v1");
  assert.equal(report.editorUrl, "https://kn.codemao.cn/editor");
  assert.ok(report.completedAt);
  assert.deepEqual(Object.keys(report.cases), ["fangjie", "tiny-lm"]);
  for (const result of Object.values(report.cases)) {
    assert.equal(sha256(await fs.readFile(new URL(result.fixture, root))), result.sha256);
    assert.equal(result.projectVersion, "0.27.4");
    assert.equal(result.runtimeInspection.editorVersion, "0.27.4");
    assert.equal(result.runtimeInspection.config.max_warp_iterations_per_interpreter_step, 30000);
    assert.equal(result.runtimeInspection.config.warp_interpreter_millisecond_time_limit, 4);
    assert.equal(result.sourceUnchangedAfterRun, true);
    assert.deepEqual(result.pageErrors, []);
    assert.ok(result.bundles.some(b => b.name.startsWith("main.")));
    assert.ok(result.bundles.some(b => b.name.startsWith("crc_libs.")));
    assert.equal(result.bundles.find(b => b.name === "main.8ccf2442.js")?.sha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
    assert.equal(result.bundles.find(b => b.name === "crc_libs.8196dbd1.js")?.sha256, "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7");
    assert.equal(result.samples[0].label, "before-start");
    let wallMs = -1;
    for (const row of result.samples.slice(1)) {
      assert.ok(row.wallMsSinceStart >= wallMs);
      wallMs = row.wallMsSinceStart;
    }
    for (const [id, digest] of Object.entries(result.samples.at(-1).listDigests ?? {})) {
      assert.equal(result.samples.at(-1).variables[id].length, digest.length);
      if (Object.hasOwn(digest, "allEqual")) assert.equal(sha256(JSON.stringify(Array(digest.length).fill(digest.allEqual))), digest.jsonSha256);
    }
  }
});

test("completion and timeout claims agree with actual last observations", async () => {
  const report = await evidence();
  for (const [name, result] of Object.entries(report.cases)) {
    const final = result.samples.at(-1), v = final.variables;
    if (result.outcome === "timeout") {
      assert.equal(final.label, "timeout");
      assert.ok(final.wallMsSinceStart >= report.timeoutMsPerProject);
      assert.match(result.timeoutReason, /no inferred completion/);
      continue;
    }
    assert.equal(result.outcome, "milestone-complete");
    assert.equal(final.label, "milestone-confirmed");
    if (name === "fangjie") {
      assert.equal(v["kn-list-world"].length, 524288);
      assert.equal(v["kn-list-chunk_x"].length, 64);
      assert.equal(v["kn-list-chunk_z"].length, 64);
      assert.equal(v["kn-var-gui_dirty"], 0);
      assert.equal(final.actors.find(a => a.id === "nekoc-default-actor").logicalPosition.y, -65);
    } else {
      assert.equal(v["kn-var-lm_status"], "DONE / EOS");
      assert.equal(v["kn-var-lm_running"], 0);
      assert.equal(v["kn-var-lm_position"], 18);
      assert.equal(v["kn-var-lm_tokens_processed"], 18);
      assert.equal(v["kn-var-lm_generated"], 15);
      assert.deepEqual(v["kn-list-lm_generated_ids"].head, [66, 15, 31, 4, 78, 58, 64, 7, 8, 2, 27, 33, 32, 35, 2]);
      assert.equal(v["kn-var-lm_output"], "走到山上，看见了云。它很开心。");
    }
  }
  assert.equal(report.ok, Object.values(report.cases).every(r => r.outcome === "milestone-complete" && !r.failure && !r.pageErrors.length && r.sourceUnchangedAfterRun));
});

test("optional local raw observations and official bundle bytes match archived hashes", async t => {
  const report = await evidence();
  const files = [
    ...(report.rawReport ? [report.rawReport] : []),
    ...report.cases.fangjie.bundles.map(bundle => ({ path: `dist/hncompat2-progress/${bundle.name}`, sha256: bundle.sha256 }))
  ];
  for (const file of files) {
    let bytes;
    try { bytes = await fs.readFile(new URL(file.path, root)); }
    catch (error) { if (error.code === "ENOENT") return t.skip("Optional ignored raw observations/bundles absent"); throw error; }
    assert.equal(sha256(bytes), file.sha256);
  }
  for (const anchor of report.sourceAnchors ?? []) {
    const bytes = await fs.readFile(new URL(`dist/hncompat2-progress/${anchor.bundle}`, root));
    assert.equal(sha256(bytes), anchor.bundleSha256);
    assert.equal(sha256(bytes.subarray(anchor.byteOffset).toString("utf8").slice(0, anchor.excerptCharacters)), anchor.excerptSha256);
  }
});
