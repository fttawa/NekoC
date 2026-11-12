import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { effectTypes, effectScopes, partialEffects11Fixtures, selectEffects11Cases } from '../tools/compat/k4-effects-11-fixtures.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('round 11 five setter/changer aliases retain actual VM full-canvas evidence',async()=>{
  const renderer=hash((await readFile('web/renderer.js','utf8')).replaceAll('\r\n','\n'));
  const fixtures=await partialEffects11Fixtures();assert.equal(Object.keys(fixtures).length,14);
  for(const type of effectTypes)for(const mode of ['isolated','chain'])assert.ok(fixtures[`${type}-actor-${mode}`]);
  for(const [name,spec]of Object.entries(fixtures)){
    const file=`docs/kitten4-partial-effects-11-${name}.json`,fixture=`tests/fixtures/kitten4/partial-effects-11-${name}.bcm`;
    const bytes=await readFile(fixture),c=JSON.parse(await readFile(file,'utf8'));
    assert.equal(bytes.toString(),JSON.stringify(spec.project,null,2)+'\n');assert.equal(c.fixtureSha256,hash(bytes));
    assert.equal(c.rendererLfSha256,renderer);assert.match(c.executableSha256,/^[a-f0-9]{64}$/);assert.ok((await stat(file)).size<300000);
    assert.deepEqual(c.scopes,effectScopes);assert.deepEqual(c.operations,spec.operations);assert.equal(c.coverageStatus,'partial');
    assert.ok(['captured','unverified'].includes(c.status));
    if(c.status==='captured'){
      assert.equal(c.frames.length,spec.frames);assert.equal(c.identitiesStable,true);assert.equal(c.fullCanvasCaptureComplete,true);
    }
    if(c.kernelAssets)assert.ok(c.kernelAssets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
    for(const f of c.frames){assert.equal(f.pixels,960*720);assert.equal(f.maskedPixels,0);assert.equal(f.tolerance,8);}
  }
});
test('round 11 selector fails closed and never silently records zero cases',async()=>{
  const cases=await partialEffects11Fixtures();
  assert.equal(selectEffects11Cases(cases,[]).length,14);
  assert.throws(()=>selectEffects11Cases(cases,['missing']),/Unknown case/);
  assert.throws(()=>selectEffects11Cases(cases,['--case']),/requires/);
  assert.equal(selectEffects11Cases(cases,['--case=self_set_effect-actor-chain']).length,1);
});
test('round 11 source metadata records target projection and the overridden filter fit',async()=>{
  const c=JSON.parse(await readFile('docs/kitten4-partial-effects-11-source.json','utf8'));
  assert.equal(c.sha256,'0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160');
  for(const anchor of Object.values(c.anchors)){assert.ok(anchor.offset>0);assert.match(anchor.windowSha256,/^[a-f0-9]{64}$/);}
});
