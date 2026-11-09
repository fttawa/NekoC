import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';

test('WebGL pen fills: concavity, nonzero winding, ordering, persistence and legacy frames', {
  skip: !process.env.NEKOC_RENDERER_URL,
}, async () => {
  const browser = await loadPlaywright().chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage();
    await page.goto(process.env.NEKOC_RENDERER_URL,{waitUntil:'domcontentloaded',timeout:120000});
    const result=await page.evaluate(async()=>{
      const {StageRenderer}=await import('/renderer.js');
      const r=new StageRenderer(document.createElement('canvas'));r.resolutionScale=1;
      await r.load({stageSize:{width:100,height:100},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:[]},t:{actorIds:[]}}},actors:{actorsDict:{}}});
      const sample=(x,y)=>{const gl=r.gl,p=new Uint8Array(4);gl.bindFramebuffer(gl.FRAMEBUFFER,r.framebuffer);gl.readPixels(Math.floor((x+50)*r.canvas.width/100),Math.floor((y+50)*r.canvas.height/100),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);gl.bindFramebuffer(gl.FRAMEBUFFER,null);return [...p];};
      const fill=(points,color,before_line=0)=>({points,color,before_line,before_text:0,before_image:0});
      const empty=new Float32Array();
      const concave=fill([[-30,-30],[30,-30],[30,-10],[-10,-10],[-10,30],[-30,30]],[1,0,0,1]);
      r.apply({sprites:[],clear:true,pen_fills:[concave]},empty);
      const inside=sample(-20,20),notch=sample(20,20);
      // Two identical loops: even-odd would incorrectly leave the centre empty.
      const square=[[-20,-20],[20,-20],[20,20],[-20,20]];
      r.apply({sprites:[],clear:true,pen_fills:[fill([...square,...square],[0,1,0,1])]},empty);
      const nonzero=sample(0,0);
      const line=new Float32Array([-40,0,40,0,6,0,0,1,1]);
      r.apply({sprites:[],clear:true,pen_fills:[fill(square,[1,0,0,1])]},line);
      const lineAfter=sample(0,0);
      r.apply({sprites:[],clear:true,pen_fills:[fill(square,[1,0,0,1],1)]},line);
      const fillAfter=sample(0,0);
      r.drawImageStamp=()=>r.drawPenFill(fill(square,[0,0,1,1]));
      const image_stamps=[{before_line:0}];
      r.apply({sprites:[],clear:true,image_stamps,pen_fills:[{...fill(square,[1,0,0,1]),before_image:1}]},empty);
      const stampBefore=sample(0,0);
      r.apply({sprites:[],clear:true,image_stamps,pen_fills:[fill(square,[1,0,0,1])]},empty);
      const stampAfter=sample(0,0);
      // Original stamp arrays group text before images. A fill must still sit
      // between an earlier image and a later text at exactly the same line.
      r.drawTextStamp=()=>r.drawPenFill(fill(square,[0,1,0,1]));
      r.apply({sprites:[],clear:true,image_stamps,text_stamps:[{before_line:0}],pen_fills:[{...fill(square,[1,0,0,1]),before_image:1}]},empty);
      const mixedStampAfter=sample(0,0);
      r.apply({sprites:[],clear:true,pen_fills:[fill(square,[1,0,0,1])]},empty);
      r.apply({sprites:[]},empty);const idle=sample(0,0);
      r.setResolution(2);const resized=sample(0,0);
      r.apply({sprites:[],scene:'t'},empty);const otherScene=sample(0,0);
      r.apply({sprites:[],scene:'s'},empty);const restored=sample(0,0);
      r.apply({sprites:[],clear:true},empty);const cleared=sample(0,0);
      const error=r.gl.getError();
      r.gl.getExtension('WEBGL_lose_context').loseContext();
      return {inside,notch,nonzero,lineAfter,fillAfter,stampBefore,stampAfter,mixedStampAfter,idle,resized,otherScene,restored,cleared,error};
    });
    assert.deepEqual(result,{inside:[255,0,0,255],notch:[0,0,0,0],nonzero:[0,255,0,255],lineAfter:[0,0,255,255],fillAfter:[255,0,0,255],stampBefore:[255,0,0,255],stampAfter:[0,0,255,255],mixedStampAfter:[0,255,0,255],idle:[255,0,0,255],resized:[255,0,0,255],otherScene:[0,0,0,0],restored:[255,0,0,255],cleared:[0,0,0,0],error:0});
  } finally { await browser.close(); }
});
