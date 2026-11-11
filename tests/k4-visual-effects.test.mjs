import test from 'node:test';
import assert from 'node:assert/strict';
import { effectsFixture } from '../tools/compat/k4-visual-effects-fixtures.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';

test('colour-effect probe is reproducible with only original inline artwork',async()=>{
  assert.deepEqual(await readJson('tests/fixtures/kitten4/visual3-effects.bcm'),await effectsFixture());
});
test('WebGL K4 matrices preserve alpha and filter order without changing KN hue',{
  skip:!process.env.K4_VISUAL_BROWSER,
},async()=>{
  const source=await readFile('web/renderer.js','utf8');
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/renderer.js'?'application/javascript':'text/html');res.end(req.url==='/renderer.js'?source:'<!doctype html><canvas></canvas>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const samples=await page.evaluate(async()=>{
      const {StageRenderer}=await import('/renderer.js');const r=new StageRenderer(document.querySelector('canvas'));r.resolutionScale=1;
      const url='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="20" fill="#d02850"/><rect y="20" width="80" height="20" fill="#d02850" opacity="0.5"/></svg>');
      const project={_nekocKitten4:{},stageSize:{width:160,height:120},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:['a']}}},actors:{actorsDict:{a:{currentStyleId:'c',scale:100}}},styles:{stylesDict:{c:{url}}}};
      await r.load(project);const out=[];
      for(const [kitten4,hue,brightness,gray]of [[true,65,0,0],[true,-110,0,0],[true,0,0,100],[true,125,0,70],[true,0,30,0],[false,100,0,0]]){
        r.kitten4=kitten4;r.apply({sprites:[{id:'a',style:'c',x:0,y:0,direction:0,scale:100,visible:true,opacity:1,effects:[hue,0,brightness,0,0,0,gray]}]},new Float32Array());
        const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');ctx.drawImage(r.canvas,0,0);
        out.push({kitten4,hue,brightness,gray,pixels:[...ctx.getImageData(60,45,1,1).data,...ctx.getImageData(60,75,1,1).data]});
      }return out;
    });
    for(const sample of samples.filter(s=>s.kitten4))for(const [i,alpha]of [1,128/255].entries()){
      let rgb=[208,40,80].map(v=>v/255);
      if(sample.hue){
        const a=sample.hue*Math.PI/180,c=Math.cos(a),s=Math.sin(a)/Math.sqrt(3),mean=rgb.reduce((x,y)=>x+y)/3;
        rgb=rgb.map((v,i)=>c*v+(1-c)*mean+s*(rgb[(i+2)%3]-rgb[(i+1)%3]));
        rgb=rgb.map(v=>Math.round(Math.max(0,Math.min(1,v*alpha))*255)/255/alpha);
      }
      if(sample.brightness)rgb=rgb.map(v=>Math.round(Math.max(0,Math.min(1,(v+sample.brightness/100)*alpha))*255)/255/alpha);
      const mean=rgb.reduce((x,y)=>x+y)/3;
      rgb=rgb.map(v=>v*(1-sample.gray/100)+mean*sample.gray/100);
      const expected=rgb.map(v=>Math.min(255,Math.round(Math.max(0,Math.min(1,v*alpha))*255+255*(1-alpha))));
      const actual=sample.pixels.slice(i*4,i*4+3);
      actual.forEach((v,c)=>assert.ok(Math.abs(v-expected[c])<=3,JSON.stringify({sample,alpha,actual,expected})));
    }
    const kn=samples.at(-1).pixels;assert.ok(kn[0]<55&&kn[1]>200&&kn[2]>160,JSON.stringify(kn));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
test('K4 hue and grayscale match official colour matrices, including alpha and combined filters',{
  skip:!process.env.K4_VISUAL_INTEGRATION,
},async()=>{
  const work=await visualWork('tests/fixtures/kitten4/visual3-effects.bcm',{
    captureFrames:[1,30,60],artifactsDir:'dist/visual3-effects/regression',
  });
  assert.equal(work.status,'captured',work.error);
  assert.equal(work.frames.length,3);
  for(const frame of work.frames)assert.ok(frame.changedPercent<.01,`${frame.frame}: ${frame.changedPercent}%`);
});
