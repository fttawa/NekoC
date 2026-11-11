// Same browser, identical 10k-segment stream; compare triangle-list and strip quads.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(path.join(process.env.NEKOC_NODE_MODULES,'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:4173');
  const result=await page.evaluate(async()=>{
    // Blob modules have no hierarchical base for the renderer's relative import.
    const source=(await(await fetch('/renderer.js')).text()).replace("from './pen-k4.js'", `from '${new URL('/pen-k4.js',location.href).href}'`);
    const variants={triangles:source,strip:source.replace('vec2 p[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));return p[gl_VertexID];','return vec2(float(gl_VertexID & 1),float(gl_VertexID >> 1));').replaceAll('gl.TRIANGLES,0,6','gl.TRIANGLE_STRIP,0,4')};
    const lines=new Float32Array(10000*9);let x=0,y=0;
    for(let i=0;i<10000;i++){const a=(i+1)*.8*Math.PI/180,nx=380*Math.sin(a),ny=220*Math.cos(a*1.013);lines.set([x,y,nx,ny,1,.2,.45,.3,1],i*9);x=nx;y=ny;}
    const renderers=[];
    for(const [variant,code]of Object.entries(variants)){
      const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));const {StageRenderer}=await import(url);URL.revokeObjectURL(url);
      const r=new StageRenderer(document.createElement('canvas'));await r.load({stageSize:{width:900,height:562},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:[]}}},actors:{actorsDict:{}}});
      renderers.push({variant,r,times:[]});
    }
    for(let round=0;round<24;round++)for(const item of (round%2?[...renderers].reverse():renderers)){
      const start=performance.now();item.r.apply({clear:true,sprites:[]},lines);
      const gl=item.r.gl,pixel=new Uint8Array(4);gl.bindFramebuffer(gl.FRAMEBUFFER,item.r.framebuffer);gl.readPixels(450,281,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      if(gl.getError())throw Error('WebGL error in benchmark');if(round>=4)item.times.push(performance.now()-start);
    }
    return renderers.map(({variant,r,times})=>{r.gl.getExtension('WEBGL_lose_context').loseContext();return {variant,times,medianMs:times.toSorted((a,b)=>a-b)[Math.floor(times.length/2)]};});
  });
  const report={browser:await browser.version(),gpu:'SwiftShader',scope:'Isolated draw plus synchronous framebuffer readback, alternating identical streams; not application FPS',result};
  await writeFile('docs/web-renderer-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
