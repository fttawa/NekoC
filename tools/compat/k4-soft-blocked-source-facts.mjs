#!/usr/bin/env node
// Source locator only: persists hashes and coordinates, never vendor bodies.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { saveJson } from "./k4-oracle.mjs";
const root = process.env.K4_PLAYER_DIR;
if (!root) throw new Error("Set K4_PLAYER_DIR to the read-only external app");
const entries = [
  ["player_v2.2d180c468559fbd29528.js.orig", [
    ["physics constants module", '"49df":function'],
    ["flexibility block", "physics2_set_flexibility:function"],
    ["strength clamp and mapping", 'case"strength":'],
    ["default body strength", "density:.1,strength:2.5"],
    ["max anchor hardware-derived budget", "static get_max_anchors()"],
    ["elastic group and filter initialization", "init(t,e){if(!e)return;const n=this.generate_position_data(e)"],
    ["rest-to-current renderer anchors", "on_tick(){if(!this.soft_filter"],
    ["point sampling entry", "generate_position_data(t){"],
    ["zero boundary sampling increment", "let x=Math.floor(c.length/k)"],
    ["zero-increment loop", "for(let t=0;t<c.length;t+=x)"],
    ["live group strength update", "this.set_strength=(t=>"],
    ["world fixed step", "this.world.Step(Wt.f,Wt.l,Wt.j)"],
    ["particle radius", "o.radius=1.2"],
    ["soft filter module", "sdMR:function"],
    ["soft filter anchor update", "set_anchors(t,e,n){"],
  ]],
  ["2.b8370041782df6e86958.js", [
    ["particle iteration count formula", "function Qn("],
    ["anchor-relative rest positions", "UpdateAnchor(){"],
    ["particle system default elastic strength", "this.elasticStrength=.25"],
    ["triad strength live callback", "A.strength=(()=>"],
    ["particle substep loop", "for(this.m_iterationIndex=0;"],
    ["elastic triad velocity solver", "SolveElastic(t){"],
    ["stride", "GetParticleStride(){"],
    ["world default particle iterations", "Step(t,e,s,i=this.CalculateReasonableParticleIterations(t))"],
  ]],
];
const evidence = { schema: "nekoc-k4-soft-blocked-source-locations-v1", coordinateConvention: "one-based line and UTF-16 column; offsets zero-based", files: [] };
for (const [name, markers] of entries) {
  const bytes = await readFile(path.join(root, "src/player/build", name)), source = bytes.toString("utf8");
  const locations = markers.map(([fact, marker]) => {
    const offset = source.indexOf(marker);
    if (offset < 0) throw new Error(`Missing source marker: ${fact}`);
    const before = source.slice(0, offset), line = before.split("\n").length;
    return { fact, offset, line, column: offset - before.lastIndexOf("\n") };
  });
  evidence.files.push({ name, sha256: createHash("sha256").update(bytes).digest("hex"), locations });
}
await saveJson("docs/kitten4-soft-blocked-source-locations.json", evidence);
console.log(JSON.stringify(evidence, null, 2));
