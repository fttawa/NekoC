import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync,existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pointMetrics } from "../tools/compat/k4-soft-compare.mjs";

test("soft point-set metric does not invent particle correspondence",()=>{
  assert.deepEqual(pointMetrics([[0,0]],[[0,0],[1,0]]),{actualCount:1,expectedCount:2,hausdorffPx:1,indexedMaxPx:null});
  assert.equal(pointMetrics([[0,0],[1,0]],[[1,0],[0,0]]).indexedMaxPx,1);
  assert.equal(pointMetrics([[0,0],[1,0]],[[1,0],[0,0]]).hausdorffPx,0);
});

test("soft progress evidence retains 420 official updates and partial status",()=>{
  let frames=0;
  for(const name of ["coast","impact-25","impact-90","rebuild"]) {
    const file=`docs/kitten4-soft-${name}-evidence.json`;
    assert.ok(existsSync(file),`missing ${file}`);
    const bytes=readFileSync(file),r=JSON.parse(bytes);
    assert.ok(bytes.length<=300000);
    assert.equal(r.certification,"partial");assert.equal(r.sameParticleCorrespondence,false);
    assert.deepEqual(r.errors,[]);assert.deepEqual(r.pageErrors,[]);
    assert.equal(r.fixtureSha256,createHash("sha256").update(readFileSync(r.fixture)).digest("hex"));
    assert.ok(r.assets.some(a=>a.sha256==="0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160"));
    assert.equal(r.officialInitial.points.length,92);
    assert.ok(r.frames.some(f=>f.localCount!==f.officialCount),"topology mismatch must remain visible");
    assert.deepEqual(r.modes.default,r.modes.interpreter);
    assert.equal(r.modes.default.sameParticleMaxPx,null);
    assert.ok(r.frames.every((f,i)=>f.frame===i+1&&Number.isFinite(f.centerErrorPx)));
    frames+=r.frames.length;
  }
  assert.equal(frames,420);
});
