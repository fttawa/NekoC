import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { drawSoftMeshTriangles, softMeshUVAt, validateSoftMesh } from '../web/renderer.js';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';

// Handwritten repository-owned geometry, not extracted official implementation.
const mesh={vertices:[[0,20,0,0],[40,20,1,0],[40,0,1,1],[0,0,0,1]],triangles:[[0,1,2],[0,2,3]]};

test('soft mesh wire validates vertices, UVs, indices and bounded sizes',()=>{
  assert.equal(validateSoftMesh(mesh),mesh);
  assert.doesNotThrow(()=>validateSoftMesh({vertices:[],triangles:[]}));
  for(const invalid of [null,{}, {...mesh,vertices:[[NaN,0,0,0]]}, {...mesh,vertices:[[0,0,-.1,0]]}, {...mesh,triangles:[[0,1,4]]}, {...mesh,triangles:[[0,1,1.5]]}, {...mesh,vertices:Array(65537).fill([0,0,0,0])}])assert.throws(()=>validateSoftMesh(invalid),/柔体网格/);
});

test('triangle affine maps source pixels to y-up world, skips degeneracy and restores context',()=>{
  const transforms=[],clips=[];let draws=0,saves=0,restores=0;
  const ctx={save(){saves++;},restore(){restores++;},setTransform(...v){transforms.push(v);},beginPath(){},moveTo(...v){clips.push(v);},lineTo(){},closePath(){},clip(){},drawImage(){draws++;}};
  drawSoftMeshTriangles(ctx,{width:20,height:10},mesh,2,3,50,60);
  assert.equal(draws,2);assert.equal(saves,restores);assert.deepEqual(clips,[[50,0],[50,0]]);
  for(const m of [transforms[1],transforms[3]])m.forEach((v,i)=>assert.equal(v===0?0:v,[4,0,0,6,50,0][i]));
  drawSoftMeshTriangles(ctx,{width:20,height:10},{vertices:mesh.vertices,triangles:[[0,0,1]]});
  assert.equal(draws,2);
});

test('deformed triangle picking uses top-left UV alpha and passes transparent texels through',()=>{
  const image={width:2,height:2,alpha:[255,0,255,255]};
  assert.deepEqual(softMeshUVAt(mesh,10,15,image),[.25,.25]);
  assert.equal(softMeshUVAt(mesh,30,15,image),null);
  assert.deepEqual(softMeshUVAt(mesh,30,5,image),[.75,.75]);
  assert.equal(softMeshUVAt(mesh,-10,15,image),null);
});

test('skewed triangle affine mapping interpolates every UV vertex independently',()=>{
  const skew={vertices:[[-13,17,.1,.2],[28,11,.9,.1],[7,-23,.3,.8]],triangles:[[0,1,2]]};
  let transform;
  const ctx={save(){},restore(){},setTransform(...m){transform=m;},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},drawImage(){}};
  drawSoftMeshTriangles(ctx,{width:80,height:60},skew,1.5,2,20,40);
  const [a,b,c,d,e,f]=transform;
  for(const [x,y,u,v]of skew.vertices){
    assert.ok(Math.abs(a*u*80+c*v*60+e-(20+x*1.5))<1e-10);
    assert.ok(Math.abs(b*u*80+d*v*60+f-(40-y*2))<1e-10);
  }
});

test('browser soft mesh substitutes quad, redraws deformation, removes cleanly and preserves opacity',{
  skip:!process.env.NEKOC_SOFT_MESH_BROWSER,
},async()=>{
  const sources=Object.fromEntries(await Promise.all(['renderer.js','pen-k4.js'].map(async name=>['/'+name,await readFile('web/'+name,'utf8')])));
  const server=createServer((req,res)=>{res.setHeader('Content-Type',sources[req.url]?'application/javascript':'text/html');res.end(sources[req.url]??'<!doctype html><canvas></canvas>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async mesh=>{
      const {StageRenderer}=await import('/renderer.js');const r=new StageRenderer(document.querySelector('canvas'));r.resolutionScale=1;
      const source=document.createElement('canvas');source.width=20;source.height=20;const ctx=source.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,20,10);ctx.fillStyle='blue';ctx.fillRect(0,10,20,10);
      await r.load({_nekocKitten4:{},stageSize:{width:100,height:100},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:['a']}}},actors:{actorsDict:{a:{currentStyleId:'c'}}},styles:{stylesDict:{c:{url:source.toDataURL()}}}});
      const a={id:'a',style:'c',x:-30,y:-30,direction:0,scale:100,visible:true,opacity:1,soft_mesh:mesh};
      const capture=()=>{const c=document.createElement('canvas');c.width=100;c.height=100;c.getContext('2d').drawImage(r.canvas,0,0);return c.getContext('2d');};
      const at=(c,x,y)=>[...c.getImageData(x+50,50-y,1,1).data];
      const apply=a=>r.apply({sprites:[a]},new Float32Array());
      // Interior samples intentionally avoid the Canvas antialiased shared edge;
      // shared-edge/subpixel parity is a documented partial limitation.
      apply(a);let c=capture();const top=at(c,8,15),bottom=at(c,30,7),oldQuad=at(c,-30,-30),hit=r.hitTest(10,15);
      apply({...a,soft_mesh:{...mesh,vertices:mesh.vertices.map(([x,...v])=>[x+20,...v])}});c=capture();const moved=at(c,8,15),redrawn=at(c,25,15);
      apply({...a,opacity:.5});c=capture();const opacity=at(c,8,15);
      const {soft_mesh,...plain}=a;apply(plain);c=capture();const removed=at(c,10,15),fallback=at(c,-35,-25);
      const error=r.gl.getError();r.gl.getExtension('WEBGL_lose_context').loseContext();
      return {top,bottom,oldQuad,hit,moved,redrawn,opacity,removed,fallback,error};
    },mesh);
    assert.deepEqual(result.top,[255,0,0,255]);assert.deepEqual(result.bottom,[0,0,255,255]);
    assert.deepEqual(result.oldQuad,[255,255,255,255]);assert.equal(result.hit,'a');
    assert.deepEqual(result.moved,[255,255,255,255]);assert.deepEqual(result.redrawn,[255,0,0,255]);
    assert.equal(result.opacity[0],255);assert.ok(result.opacity[1]>=126&&result.opacity[1]<=129);assert.equal(result.opacity[1],result.opacity[2]);
    assert.deepEqual(result.removed,[255,255,255,255]);assert.deepEqual(result.fallback,[255,0,0,255]);assert.equal(result.error,0);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
