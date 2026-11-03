import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.NEKOC_NODE_MODULES, 'package.json'));
const { chromium } = require('playwright');
const out = path.resolve(process.argv[3] || 'samples/eisei-brush-verification');
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true,channel:'msedge'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('var __webpack_exports__=','window.__nekocRequire=__webpack_require__;var __webpack_exports__=')});
  });
  await page.route('**/brush-probe.bcmkn',async route=>route.fulfill({contentType:'application/json',body:await readFile(process.argv[2])}));
  await page.goto('https://kn.codemao.cn/editor?previewUrl=https%3A%2F%2Fkn.codemao.cn%2Fbrush-probe.bcmkn',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__nekocRequire && document.body.innerText.includes('pv_state'),null,{timeout:180000});
  await page.addStyleTag({content:'#DialogContainer {display:none !important}'});
  const done=page.getByText(/^完成$/).last();
  if(await done.isVisible()) await done.dispatchEvent('click');
  await page.evaluate(()=>window.__nekocRequire(69138).default.ComponentsStore.ConsolePanelStore.closeAll());
  await page.getByText(/^开始$/).last().dispatchEvent('click');
  await page.waitForFunction(()=>Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable).some(v=>v.name==='pv_state'&&v.value===1),null,{timeout:120000});
  const result=await page.evaluate(()=>{
    const core=window.__nekocRequire(26921).cG.get_instance().stage.core;
    const scene=core.scenes.get_current_scene();
    const found=core.actors.get_actor(core.actors.get_actor_ids()[0]);
    window.__brushCore=core;
    window.__brushActor=found.value || found;
    const a=window.__brushActor,b=a.brush,ctx=b.ctx;
    function bounds() {
      const {width,height}=ctx.canvas, d=ctx.getImageData(0,0,width,height).data;
      let count=0,minX=width,minY=height,maxX=-1,maxY=-1;
      for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const k=(y*width+x)*4;
        if(d[k+3] && (d[k]>30||d[k+1]>30||d[k+2]>30)) {count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      }
      return {count,minX,minY,maxX,maxY};
    }
    b.clear();b.set_pen_up();b.set_color('ffffff');a.set_position(-300,210);b.draw_text_stamp('WWWW衛星',14,'left',0);
    const before=bounds(),image=ctx.canvas.toDataURL();
    b.set_color('060616');b.set_size(20);a.set_position(-652,210);b.set_pen_down();a.set_position(652,210);b.set_pen_up();
    const after=bounds();
    return {before,after,image,afterImage:ctx.canvas.toDataURL(),canvas:{width:ctx.canvas.width,height:ctx.canvas.height},view:{width:a.app.get_app().view.width,height:a.app.get_app().view.height},stageTransform:a.app.get_app().stage.worldTransform};
  });
  await writeFile(path.join(out,'before.png'),Buffer.from(result.image.split(',')[1],'base64'));
  await writeFile(path.join(out,'after.png'),Buffer.from(result.afterImage.split(',')[1],'base64'));
  delete result.image;delete result.afterImage;
  await page.evaluate(()=>{
    window.__eraseChecks=[];
    const b=window.__brushActor.brush;
    const down=b.set_pen_down,up=b.set_pen_up;
    b.set_pen_down=function(...args) {
      if(window.__eraseChecks.length<72) {
        this.__testRow=Math.round(this.ctx.canvas.height/2+this.actor.y);
        this.__testStart=this.actor.x;
        // Seed stale ink at both edges and in the middle before native erasing.
        const c=this.ctx;c.save();c.fillStyle='#ffffff';c.globalAlpha=1;
        for(const x of [1,320,640,960,1275]) c.fillRect(x,this.__testRow-5,4,10);
        c.restore();
      }
      return down.apply(this,args);
    };
    b.set_pen_up=function(...args) {
      const ret=up.apply(this,args);
      if(this.__testRow!==undefined) {
        const d=this.ctx.getImageData(0,this.__testRow-8,this.ctx.canvas.width,16).data;
        let residualPixels=0;
        for(let i=0;i<d.length;i+=4) if(d[i+3] && (d[i]>30||d[i+1]>30||d[i+2]>30)) residualPixels++;
        window.__eraseChecks.push({y:this.__testRow,startX:this.__testStart,endX:this.actor.x,residualPixels});
        delete this.__testRow;
      }
      return ret;
    };
  });
  await page.locator('canvas:visible').first().click({force:true});
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.down('Enter');await page.waitForTimeout(120);await page.keyboard.up('Enter');
  await page.waitForTimeout(7000);
  result.eraseChecks=await page.evaluate(()=>window.__eraseChecks);
  console.log(JSON.stringify(result,null,2));
  await writeFile(path.join(out,'inspection.json'),JSON.stringify(result,null,2));
  assert.ok(result.eraseChecks.length>=36,'Checked at least one full frame of rows');
  assert.ok(result.eraseChecks.every(r=>r.startX===-652&&r.endX===652&&r.residualPixels===0),'Native row wipes remove stale pixels across the full stage');
} finally {await browser.close();}
