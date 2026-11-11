#!/usr/bin/env node
// Compact observations only. Preserve original raw report in ignored dist.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

const archive = "docs/compatibility/hncompat2-progress-official.json";
const rawPath = "dist/hncompat2-progress/raw-report.json";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const text = await fs.readFile(archive, "utf8"), report = JSON.parse(text);
if (!report.completedAt || Object.values(report.cases).some(r => r.outcome === "pending")) throw new Error("Run has not completed; refusing to compact live output");
if (report.rawReport) throw new Error("Already compacted; refusing to replace raw evidence");
await fs.writeFile(rawPath, text);
report.rawReport = { path: rawPath, sha256: sha256(text) };
const bundleName = "crc_libs.8196dbd1.js";
const bundleBytes = await fs.readFile(`dist/hncompat2-progress/${bundleName}`), bundleSource = bundleBytes.toString("utf8");
report.sourceAnchors = [
  ["Official default warp iteration and wall-clock limits (live config also recorded)", "max_warp_iterations_per_interpreter_step:3e4", 240],
  ["List append pushes then reports update; not evidence of listener cost", "lists_append:function", 100],
  ["List update publishes runtime_data.list_update event; listener behavior not inferred", "report_list_updated=function", 145]
].map(([purpose, marker, excerptCharacters]) => {
  const offset = bundleSource.indexOf(marker);
  if (offset < 0) throw new Error(`Official source anchor changed: ${marker}`);
  return { purpose, bundle: bundleName, bundleSha256: sha256(bundleBytes), byteOffset: Buffer.byteLength(bundleSource.slice(0, offset)),
    excerptCharacters, excerptSha256: sha256(bundleSource.slice(offset, offset + excerptCharacters)) };
});
for (const result of Object.values(report.cases)) {
  result.bundles = result.bundles.filter(b => /^(main\.|crc_libs\.)/.test(b.name));
  result.rawSampleCount = result.samples.length;
  result.samples = result.samples.filter((row, index, rows) => row.label !== "progress" ||
    index === 2 || index === rows.length - 1 || index === rows.length - 2 || (index - 1) % 6 === 0);
  for (const [index, row] of result.samples.entries()) {
    delete row.statistics;
    for (const [id, value] of Object.entries(row.variables)) {
      if (!value || !Array.isArray(value.head)) continue;
      // Complete tiny-lm ids retained; uniform large lists bound by full-list digests at final snapshot.
      if (!/lm_generated_ids|lm_prompt_tokens|lm_top_ids/.test(id)) value.head = value.head.slice(0, 4);
    }
    if (index > 0 && index < result.samples.length - 1) {
      row.variables = Object.fromEntries(Object.entries(row.variables).map(([id, value]) => [id,
        value && Array.isArray(value.head) && !/lm_generated_ids/.test(id) ? { length: value.length } : value]));
    }
  }
}
await fs.writeFile(archive, JSON.stringify(report, null, 2) + "\n");
console.log(`Archived ${Object.values(report.cases).reduce((n, r) => n + r.samples.length, 0)} genuine samples; raw evidence ${report.rawReport.sha256}`);
