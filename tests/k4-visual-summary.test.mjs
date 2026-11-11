import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedSummary } from '../tools/compat/k4-visual-summary.mjs';

test('paired visual distributions exclude missing frames, failures and changed video scope',()=>{
  const frame=(changedPercent,pixels=100)=>({frame:1,width:10,height:10,pixels,maskedPixels:100-pixels,scope:pixels===100?'canvas':'non-video',changedPercent});
  const work=(file,frames,status='captured')=>({file,frames,status});
  const report=works=>({captureFrames:[1],pixelTolerance:8,works});
  const before=report([work('a',[frame(10)]),work('b',[frame(2)]),work('c',[frame(3)])]);
  const after=report([work('a',[frame(1)]),work('b',[],'unverified'),work('c',[frame(0,90)])]);
  const result=pairedSummary(before,after);
  assert.equal(result.works,1);assert.equal(result.before.mean,10);assert.equal(result.after.mean,1);assert.equal(result.omitted.length,2);
  assert.throws(()=>pairedSummary(before,{...after,pixelTolerance:0}),/Incompatible/);
  assert.deepEqual(pairedSummary(before,report([])).omitted.map(w=>w.after),['missing','missing','missing']);
});
test('same-sized video masks at different positions cannot enter paired distributions',()=>{
  const frame=x=>({frame:1,width:10,height:10,pixels:50,maskedPixels:50,scope:'non-video',changedPercent:0,videoBounds:{nekoc:[{x,y:0,width:5,height:10}],official:[]}});
  const report=x=>({captureFrames:[1],pixelTolerance:8,works:[{file:'video',status:'captured',frames:[frame(x)]}]});
  assert.equal(pairedSummary(report(0),report(1)).works,0);
  assert.equal(pairedSummary(report(0),report(0)).works,1);
});
test('paired reports reject matching but incomplete, empty or non-finite captured samples',()=>{
  const report=frames=>({captureFrames:[1,30,60],pixelTolerance:8,works:[{file:'a',status:'captured',frames}]});
  assert.equal(pairedSummary(report([]),report([])).works,0);
  const frame=frame=>({frame,width:10,height:10,pixels:100,maskedPixels:0,scope:'canvas',changedPercent:0});
  const complete=[1,30,60].map(frame);
  assert.equal(pairedSummary(report(complete),report(complete)).works,1);
  for(const frames of [[frame(1)],[frame(1),frame(1),frame(1)],complete.map(f=>({...f,pixels:0})),complete.map(f=>({...f,changedPercent:null}))]){
    assert.equal(pairedSummary(report(frames),report(frames)).works,0);
  }
});
