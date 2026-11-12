import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('shake clock-origin evidence keeps 640 native updates and strict-threshold counterexamples',async()=>{
 const e=JSON.parse(await readFile('docs/kitten4-shake-9-evidence.json','utf8'));
 assert.deepEqual(e.originsMs,[0,.1,1024,1000000]);assert.equal(Object.keys(e.cases).length,4);
 assert.ok(e.assets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
 const id='20000000-0000-4000-8000-000000000001';
 for(const c of Object.values(e.cases)){
  assert.equal(c.sha256,createHash('sha256').update(await readFile(c.fixture)).digest('hex'));
  for(const sample of Object.values(c.origins)){
   assert.equal(sample.variables.length,40);assert.equal(sample.actors.length,40);assert.deepEqual(sample.errors,[]);assert.deepEqual(sample.pageErrors,[]);assert.equal(sample.externalAllowed,0);
   for(let f=1;f<40;f++){assert.equal(sample.variables[f].sampleX,sample.actors[f-1][id].x);assert.equal(sample.variables[f].sampleY,sample.actors[f-1][id].y);}
  }
 }
 assert.equal(e.cases['single-0.14'].origins[0].actors[3][id].x,0);
 assert.equal(e.cases['single-0.14'].origins[.1].actors[3][id].x,5);
 assert.equal(e.cases['single-0.4'].origins[0].variables[25].phase,2);
 assert.equal(e.cases['single-0.4'].origins[1000000].variables[25].phase,1);
});
