import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { round8MainPaths, scope8Markdown } from '../tools/compat/k4-partial-8-scope.mjs';
import { cloudDataTypes } from '../tools/compat/k4-block-catalog.mjs';
test('round 8 promotes only measured single-body boundary paths and keeps shader/shake gaps',()=>{
  const report=JSON.parse(fs.readFileSync('docs/kitten4-block-coverage.json','utf8')),rows=new Map(report.rows.map(r=>[r.type,r]));
  for(const [type,s]of round8MainPaths){const r=rows.get(type);assert.equal(r.semantics,'main-path-verified');assert.deepEqual(r.unverifiedBoundaries,[s.boundary]);assert.match(s.boundary,/0.118503/);assert.ok(!r.limitations.some(l=>/bounce 2\.797|friction \.703/.test(l)));}
  for(const t of ['self_set_effect_2','self_change_effect_3','self_change_effect','self_change_effect_2','self_set_effect','self_shake','set_scene_transition'])assert.equal(rows.get(t).semantics,'partial');
  assert.equal(report.rows.filter(r=>r.semantics==='partial').length,42);
  // Preserve the archived round-8 baseline instead of rewriting its old counts.
  const historical=structuredClone(report);
  for(const row of historical.rows)if(cloudDataTypes.has(row.type))row.semantics='partial';
  assert.equal(fs.readFileSync('docs/kitten4-partial-8.md','utf8').replaceAll('\r\n','\n'),scope8Markdown(historical));
});
