import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { partialEffects10Fixtures } from '../tools/compat/k4-partial-effects-10-fixtures.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('round 10 actual VM fixes full ASCII chain and hue without masks or tolerance changes',async()=>{
  const report=JSON.parse(await readFile('docs/kitten4-partial-effects-10-pixels.json','utf8'));
  const isolated=JSON.parse(await readFile('docs/kitten4-partial-effects-10-renderer.json','utf8'));
  assert.equal(report.rendererLfSha256,'0bbee910e20a704dc9dcc085028336fb9b5b07a767693f6da24b449444510327','historical integrated round 10 renderer');
  assert.equal(isolated.rendererLfSha256,report.rendererLfSha256);
  let frames=0;
  for(const [name,spec]of Object.entries(await partialEffects10Fixtures())){
    const c=report.cases[name];assert.equal(c.sha256,hash(JSON.stringify(spec.project,null,2)+'\n'));
    assert.equal(c.status,'captured',c.error);assert.equal(c.frames.length,spec.frames);
    assert.deepEqual(isolated.cases[name].errors,[]);assert.deepEqual(isolated.cases[name].pageErrors,[]);
    assert.equal(isolated.cases[name].frames.length,spec.frames);
    for(const f of isolated.cases[name].frames){assert.equal(f.pixels,960*720);assert.equal(f.maskedPixels,0);assert.equal(f.tolerance,8);assert.equal(f.changedPixels,0,`${name}/${f.frame}: isolated`);}
    assert.ok(c.kernelAssets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
    for(const f of c.frames){frames++;assert.equal(f.pixels,960*720);assert.equal(f.maskedPixels,0);assert.equal(f.additionalTolerances[8].changedPixels,0,`${name}/${f.frame}`);}
  }
  assert.equal(frames,64);
});
test('round 10 official source metadata and Start ordering stay bound to original input',async()=>{
  const source=JSON.parse(await readFile('docs/kitten4-partial-effects-10-source.json','utf8'));
  assert.equal(source.sha256,'0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160');
  assert.equal(Object.keys(source.anchors).length,8);
  for(const a of Object.values(source.anchors)){assert.ok(a.offset>0);assert.match(a.windowSha256,/^[a-f0-9]{64}$/);}
  const order=source.startOrder;
  assert.equal(order.fixtureSha256,hash(await readFile('tests/fixtures/kitten4/partial-transition-9-none-left.bcm')));
  assert.deepEqual(order.errors,[]);assert.equal(order.externalAllowed,0);
  assert.deepEqual(order.starts.map(e=>[e.frame,e.hat,e.priorities.creation_counter]),[[1,'start',0],[1,'old-activate',1],[2,'new-activate',2]]);
  assert.equal(order.oldActivationResumes,0);
});
