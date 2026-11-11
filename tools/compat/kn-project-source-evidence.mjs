#!/usr/bin/env node
// Locate official source, never reimplement or transplant it.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const out = "dist/kn-project-progress";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const bundles = {
  "crc_libs.8196dbd1.js": [
    ["default warp limits", "max_warp_iterations_per_interpreter_step:3e4", 360],
    ["compiled warp loop boundary", "t.prototype.step_iteration_yield=function", 470],
    ["debug warp loop boundary", "var a=this.warp_tick_start+this.warp_interpreter_millisecond_time_limit", 260],
    ["compiled warp preserves loop checks", "t.prototype.compile_warp=function", 430],
    ["compiled loop check generation", "t.prototype.create_iteration_yield_point=function", 220],
    ["domain parameters only", "t.prototype.compile_domain_functions=function", 1150],
    ["compile_params", "t.prototype.compile_params=function", 1400],
  ],
  "main.8ccf2442.js": [
    ["timeout accepts real function else substitutes empty function", "setTimeout:function(e)", 180],
    ["interval accepts real function else substitutes empty function", "setInterval:function(e)", 185],
  ],
};
const report = { schema: "nekoc-kn-project-source-locations-v1", checkedAt: new Date().toISOString(), sources: [] };
for (const [bundle, terms] of Object.entries(bundles)) {
  const bytes = await fs.readFile(path.join(out, bundle)), source = bytes.toString("utf8");
  for (const [purpose, anchor, length] of terms) {
    const charOffset = source.indexOf(anchor);
    if (charOffset < 0) throw new Error(`Official source changed: ${anchor}`);
    const excerpt = source.slice(charOffset, charOffset + length);
    report.sources.push({ purpose, bundle, bundleSha256: sha256(bytes), charOffset,
      byteOffset: Buffer.byteLength(source.slice(0, charOffset)), excerpt, excerptSha256: sha256(excerpt) });
  }
}
await fs.writeFile(path.join(out, "source-locations.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.sources.map(({ purpose, bundle, byteOffset }) => ({ purpose, bundle, byteOffset })), null, 2));
