import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pixelDifference, videoMask, mediaWaitCandidate, audioWaitCandidate, audioWaitIssue, selectedWork, distribution, rankWorks, visualWork } from '../tools/compat/k4-visual.mjs';
import { visualFixtures } from '../tools/compat/k4-visual-fixtures.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';
import { spriteGeometry } from '../web/renderer.js';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';

test('pixel metrics reject empty/mismatched buffers, ignore alpha and count per pixel',()=>{
  assert.throws(()=>pixelDifference([],[]));assert.throws(()=>pixelDifference([0,0,0,0],[]));
  const a=[0,0,0,255,100,100,100,255],b=[9,0,0,0,108,100,100,0];
  const m=pixelDifference(a,b,8);assert.equal(m.changedPixels,1);assert.equal(m.changedPercent,50);assert.equal(m.mae,17/6);
  assert.equal(pixelDifference(a,a).psnr,null);assert.throws(()=>pixelDifference(a,a,NaN));
});
test('selection excludes random and failed traces, distribution uses captured frames only',()=>{
  assert.ok(selectedWork({status:'equal'}));assert.ok(selectedWork({status:'different',randomness:{detected:false}}));
  assert.ok(!selectedWork({status:'equal',randomness:{detected:true}}));assert.ok(!selectedWork({status:'unverified'}));
  assert.deepEqual(distribution([]),{count:0,exact:0,under1:0,under5:0,median:null,p90:null,max:null});
  assert.equal(distribution([{status:'captured',frames:[{changedPercent:0},{changedPercent:5}]},{status:'unverified',frames:[{changedPercent:100}]}]).max,5);
});
test('video comparison masks union, clipped offstage bounds, and never passes an empty region',()=>{
  const a=new Uint8Array(10*10*4),b=a.slice();b.fill(255);
  const mask=videoMask(10,10,[{x:1,y:1,width:2,height:2},{x:3,y:1,width:2,height:2},{x:50,y:0,width:5,height:5}]);
  const metrics=pixelDifference(a,b,8,mask);assert.equal(metrics.maskedPixels,24);assert.equal(metrics.pixels,76);assert.equal(metrics.changedPercent,100);
  const empty=pixelDifference(a,b,8,videoMask(10,10,[{x:-2,y:-2,width:20,height:20}]));
  assert.equal(empty.pixels,0);assert.equal(empty.changedPercent,null);assert.equal(empty.mae,null);assert.equal(empty.rmse,null);
  assert.throws(()=>videoMask(10,10,[{x:NaN,y:0,width:1,height:1}]));assert.throws(()=>pixelDifference(a,b,8,[]));
});
test('visual ranking sorts maxima then means without treating missing captures as equal',()=>{
  const works=[{file:'b',status:'captured',frames:[{changedPercent:2},{changedPercent:10}]},
    {file:'a',status:'captured',frames:[{changedPercent:8},{changedPercent:10}]},
    {file:'failed',status:'unverified',frames:[{changedPercent:100}]},
    {file:'empty',status:'captured',frames:[{changedPercent:null}]}];
  assert.deepEqual(rankWorks(works),[{file:'a',max:10,mean:9},{file:'b',max:10,mean:6}]);
  assert.equal(works[0].file,'b');
});
test('video waits conservatively flag media-dependent non-video control flow',()=>{
  assert.ok(mediaWaitCandidate({compile_result:[{next_block:{type:'play_video_until_end'}}]}));
  assert.ok(mediaWaitCandidate({theatre:{actors:{a:{block_data_json:{blocks:{b:{type:'play_video_until_end'}}}}}}}));
  assert.ok(!mediaWaitCandidate({compile_result:[{type:'play_video'}]}));
});
test('audio waits require decoded duration and do not certify natural completion boundaries',()=>{
  const project={compile_result:[{type:'play_audio_and_wait_2'}]};
  assert.ok(audioWaitCandidate(project));
  assert.ok(audioWaitCandidate({theatre:{scenes:{s:{block_data_json:{type:'play_audio_and_wait'}}}}}));
  assert.equal(audioWaitIssue({compile_result:[{type:'play_audio_2'}]},[],60),null);
  assert.match(audioWaitIssue(project,[],60),/unavailable/);
  assert.match(audioWaitIssue(project,[{loaded:false,duration:null}],60),/unavailable/);
  assert.match(audioWaitIssue(project,[{loaded:true,duration:.5,rate:1}],60),/uncontrolled/);
  assert.equal(audioWaitIssue(project,[{loaded:true,duration:.5,rate:.1}],60),null);
  assert.equal(audioWaitIssue(project,[{loaded:true,duration:15.018666666666666}],60),null);
});
test('K4 left/right boundaries use right-facing heading without changing KN policy',()=>{
  const actor={scale:100,rotation_type:1},image={width:80,height:40};
  for(const [direction,flipped]of [[-90,true],[-89.99,false],[0,false],[90,false],[90.01,true],[180,true],[-180,true],[270,true]]){
    assert.equal(spriteGeometry({...actor,direction},image,true).width,flipped?-80:80,String(direction));
  }
  assert.equal(spriteGeometry({...actor,direction:-30},image).width,-80);
});
test('visual fixtures are reproducible, repository-owned inline media',async()=>{
  for(const [name,project]of Object.entries(await visualFixtures()))assert.deepEqual(await readJson(`tests/fixtures/kitten4/visual-${name}.bcm`),project);
});

// No vendor files or golden binaries needed. Explicit opt-in to installed browser.
test('renderer pixels: K4 rotation policy, pivot, hit-test and rotated text stamp',{
  skip:!process.env.K4_VISUAL_BROWSER,
},async()=>{
  const source=await readFile('web/renderer.js','utf8');
  const penSource=await readFile('web/pen-k4.js','utf8');
  const server=createServer((req,res)=>{const script=req.url==='/renderer.js'?source:req.url==='/pen-k4.js'?penSource:null;res.setHeader('Content-Type',script?'application/javascript':'text/html');res.end(script??'<!doctype html><canvas></canvas>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const results=await page.evaluate(async()=>{
      const {StageRenderer}=await import('/renderer.js');const r=new StageRenderer(document.querySelector('canvas'));r.resolutionScale=1;
      const url='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#e84030"/><rect width="20" height="15" fill="#20b060"/></svg>');
      await r.load({_nekocKitten4:{},stageSize:{width:320,height:240},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:['a']}}},actors:{actorsDict:{a:{currentStyleId:'c',scale:100}}},styles:{stylesDict:{c:{url,centerPoint:{x:13,y:-7}}}}});
      const expected=document.createElement('canvas');expected.width=320;expected.height=240;const ctx=expected.getContext('2d');const image=new Image();image.src=url;await image.decode();
      const pixels=()=>{r.dirty=true;r.render();const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d');x.drawImage(r.canvas,0,0);return x.getImageData(0,0,320,240).data;};
      const diff=()=>{const a=pixels(),b=ctx.getImageData(0,0,320,240).data;let changed=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])))>8)changed++;return changed;};
      const result=[];
      for(const [direction,rotation_type]of [[-60,0],[-180,1],[-60,1],[-60,2]]){
        const a={id:'a',style:'c',x:10,y:20,scale:125,direction,rotation_type,visible:true};
        r.apply({sprites:[a]},new Float32Array());ctx.fillStyle='white';ctx.fillRect(0,0,320,240);ctx.save();ctx.translate(170,100);
        const rad=rotation_type===0?direction*Math.PI/180:0;ctx.rotate(rad);const flip=rotation_type===1&&(direction<=-90||direction>90)?-1:1;ctx.scale(1.25*flip,1.25);ctx.drawImage(image,-40-13,-20+7);ctx.restore();
        result.push({changed:diff(),hit:r.hitTest(10,20)});
      }
      r.apply({sprites:[{id:'a',visible:false}],clear:true,text_stamps:[{text:'Pixel',x:0,y:0,size:24,direction:-30,align:'center',color:[0,0,0,1],before_line:0}]},new Float32Array());
      ctx.fillStyle='white';ctx.fillRect(0,0,320,240);ctx.save();ctx.translate(160,120);ctx.rotate(-Math.PI/6);ctx.font='bold 24px Arial, "Microsoft YaHei", sans-serif';ctx.fillStyle='black';ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText('Pixel',0,0);ctx.restore();
      result.push({changed:diff()});return result;
    });
    for(const [i,result]of results.entries()){assert.ok(result.changed<(i===4?30:450),JSON.stringify(result));if(result.hit!==undefined)assert.equal(result.hit,'a');}
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});

test('official fixed-frame pixels for owned probes stay within small edge tolerances',{
  skip:!process.env.K4_VISUAL_INTEGRATION,
},async()=>{
  for(const name of Object.keys(await visualFixtures())){
    const work=await visualWork(`tests/fixtures/kitten4/visual-${name}.bcm`,{captureFrames:[1,30,60],artifactsDir:'dist/k4-visual/regression'});
    assert.equal(work.status,'captured',work.error);assert.equal(work.frames.length,3);
    for(const frame of work.frames)assert.ok(frame.changedPercent<(name==='stamp'?.01:name==='pen'?.04:name==='layers'?.02:.001),`${name}/${frame.frame}: ${frame.changedPercent}`);
  }
});
