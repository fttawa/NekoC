import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { physicsSoftFixtures, physicsSoftBlockedFixture } from "../tools/compat/k4-partial-physics-9-fixtures.mjs";
const report=JSON.parse(readFileSync("docs/kitten4-partial-physics-9-evidence.json"));
test("original soft fixtures bind 420 official frames without runtime errors",()=>{
  let frames=0;
  for(const [name,spec] of Object.entries(physicsSoftFixtures())) {
    const c=report.cases[name], bytes=readFileSync(c.fixture,"utf8").replace(/\r\n/g,"\n");
    assert.equal(bytes,JSON.stringify(spec.project,null,2)+"\n");
    assert.equal(c.sha256,createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(c.errors,[]); assert.deepEqual(c.diagnostics.pageErrors,[]);
    assert.equal(c.frames.length,spec.frames); frames+=spec.frames;
    for(const [i,f] of c.frames.entries()) assert.equal(f.frame,i+1);
  }
  assert.equal(frames,420);
});
test("rectangle watchdog negative stays failed with zero valid frames",()=>{
  const c=JSON.parse(readFileSync("docs/kitten4-partial-physics-9-blocked-evidence.json"));
  const bytes=readFileSync(c.fixture,"utf8").replace(/\r\n/g,"\n");
  assert.equal(bytes,JSON.stringify(physicsSoftBlockedFixture(),null,2)+"\n");
  assert.equal(c.sha256,createHash("sha256").update(bytes).digest("hex"));
  assert.equal(c.status,"unverified-timeout"); assert.equal(c.frames,0);
  assert.ok(c.diagnostics.watchdog.includes("exceeded"));
  assert.equal(c.environment.uniformVectors,1024);
});
test("flexibility mutates strength without a new group; texture repeat is idempotent; scale reconstructs",()=>{
  const frames=report.cases.rebuild.frames;
  const at=n=>frames[n-1].soft;
  assert.equal(at(1).count,92); assert.equal(at(31).count,171);
  assert.equal(at(10).strength,2.5); assert.equal(at(11).strength,.5);
  assert.equal(at(11).groupId,at(1).groupId); assert.equal(at(21).groupId,at(1).groupId);
  assert.notEqual(at(31).groupId,at(30).groupId); assert.equal(at(31).meanSpeedPx,0);
  assert.ok(at(30).meanSpeedPx>199); assert.equal(at(41).groupId,null);
  assert.notEqual(at(51).groupId,at(31).groupId);
});
test("quantified deformation disproves any subpixel rigid substitute on both impacts",()=>{
  for(const [name,minimum] of [["impact-25",3],["impact-90",16]]) {
    const lower=Math.max(...report.cases[name].frames.map(f=>f.soft.deformation.rigidMaxErrorLowerBoundPx));
    assert.ok(lower>minimum,`${name}: ${lower}`);
    const {rest,points}=report.cases[name].deformationWitness;
    let chord=0;
    for(let i=0;i<points.length;i++) for(let j=0;j<i;j++) chord=Math.max(chord,Math.abs(
      Math.hypot(points[i][0]-points[j][0],points[i][1]-points[j][1])-Math.hypot(rest[i][0]-rest[j][0],rest[i][1]-rest[j][1])));
    assert.ok(Math.abs(chord/2-lower)<1e-10);
  }
});
