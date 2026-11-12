import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { k4cloudFixtures } from '../tools/compat/k4cloud-fixtures.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';
const evidence=JSON.parse(await readFile('docs/k4cloudui-evidence.json','utf8'));

test('cloud UI fixtures reproduce; evidence is compact and covers every update',async()=>{
  const fixtures={...Object.fromEntries(Object.entries(await k4cloudFixtures()).filter(([n])=>['monitors','ranking'].includes(n))),...await k4cloudFixtures({ui:true})};
  assert.ok((await stat('docs/k4cloudui-evidence.json')).size<300000);
  for(const[name,{project,frames}]of Object.entries(fixtures)){
    const bytes=await readFile(`tests/fixtures/kitten4/k4cloud-${name}.bcm`),record=evidence.cases[name];
    assert.deepEqual(JSON.parse(bytes),project);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
    assert.equal(record.frames.length,frames);assert.equal(record.pixels.length,frames);
    assert.deepEqual(record.pageErrors,[]);
    assert.ok(record.externalRequests.every(r=>r.action==='blocked'));
    assert.deepEqual(record.frames.map(f=>f.frame),Array.from({length:frames},(_,i)=>i+1));
  }
});

test('ranking DOM structure/text follows the actual anonymous offline shell every frame',()=>{
  for(const name of ['ranking','ui-ranking-values'])for(const f of evidence.cases[name].frames){
    const {dom,ranking}=f.official;
    assert.equal(!!f.local,ranking.show);
    assert.deepEqual(ranking.user_list,[]);
    assert.deepEqual(f.local?.text,dom?.text,`${name} frame ${f.frame}`);
    if(dom){assert.deepEqual(f.local.roles,dom.roles.filter(r=>r!=='scale-wrap'));assert.equal(f.local.rows,0);}
  }
});

test('pixel regressions retain measured residuals, never promote approximate monitors',()=>{
  for(const[name,c]of Object.entries(evidence.cases))for(const p of c.pixels){
    assert.equal(p.tolerance,8);assert.ok(Number.isFinite(p.mae));
    // A regression ceiling is not an exact-equivalence claim.
    assert.ok(p.changedPixels<=500,`${name} frame ${p.frame}: ${p.changedPixels}`);
    if(name.includes('ranking'))assert.equal(p.changedPixels,0);
  }
  assert.ok(evidence.cases.monitors.pixels.some(p=>p.changedPixels>0));
});

test('real official list drag advances one row without modifying cloud values',()=>{
  const frames=evidence.cases['ui-empty-rows'].frames;
  const before=frames.find(f=>f.frame===16),after=frames.find(f=>f.frame===17);
  assert.deepEqual(after.official.items,before.official.items);
  const texts=f=>f.official.widgets.find(w=>w.id==='items').texts;
  assert.ok(texts(before).includes('1'));assert.ok(!texts(after).includes('1'));
  assert.ok(texts(after).includes('5'));assert.ok(texts(after).includes('fifth'));
});

test('live official cloud monitor pixel regression (RGB 8, residual ceiling not parity)',{skip:!process.env.K4_CLOUD_UI_INTEGRATION},async()=>{
  const result=await visualWork('tests/fixtures/kitten4/k4cloud-monitors.bcm',{
    captureFrames:Array.from({length:27},(_,i)=>i+1),artifactsDir:'dist/k4cloudui/regression',
  });
  assert.equal(result.status,'captured',result.error);
  assert.equal(result.frames.length,27);
  for(const f of result.frames)assert.ok(f.changedPixels<=500,`frame ${f.frame}: ${f.changedPixels}`);
});
