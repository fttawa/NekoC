#!/usr/bin/env node
// Read-only timing instrumentation in an isolated official-editor browser.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(process.env.NEKOC_NODE_MODULES ? path.join(process.env.NEKOC_NODE_MODULES,"package.json") : import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch({channel:"msedge",headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/,async route=>{
    const response=await route.fetch();const body=await response.text();
    await route.fulfill({response,body:body.replace("var __webpack_exports__=","window.__profileRequire=__webpack_require__;var __webpack_exports__=")});
  });
  await page.route("**/profile.bcmkn",async route=>route.fulfill({contentType:"application/json",body:await readFile(process.argv[2]??"samples/pen_display_fast.bcmkn","utf8")}));
  await page.goto("https://kn.codemao.cn/editor?previewUrl="+encodeURIComponent("https://kn.codemao.cn/profile.bcmkn"),{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForFunction(()=>window.__profileRequire && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display==="none"),null,{timeout:60000});
  await page.evaluate(()=>{
    const req=window.__profileRequire;
    const prototype=req(83084).OptiRunner.prototype;
    const original=prototype.step_iteration_yield;
    window.__profile={warpChecks:0,warpYields:0,ordinaryYields:0,raf:0};
    prototype.step_iteration_yield=function(warp){
      const result=original.call(this,warp);
      if (this.current_frame.is_warped || warp) {
        window.__profile.warpChecks++;
        if(result)window.__profile.warpYields++;
      }else if(result)window.__profile.ordinaryYields++;
      return result;
    };
    const raf=()=>{window.__profile.raf++;requestAnimationFrame(raf);};requestAnimationFrame(raf);
  });
  await page.addStyleTag({content:"#DialogContainer {display:none !important}"});
  await page.waitForFunction(()=>document.body.innerText.includes("__pd_frames"),null,{timeout:60000});
  const done=page.getByText(/^完成$/).last();
  if(await done.isVisible())await done.dispatchEvent("click");
  await page.getByText(/^开始$/).last().dispatchEvent("click");
  await page.waitForFunction(()=>/__pd_frames\n：\n[1-9]/.test(document.body.innerText),null,{timeout:90000});
  const state=()=>page.evaluate(()=>{
    const match=document.body.innerText.match(/__pd_frames\n：\n([^\n]+)/);
    return {...window.__profile,frames:Number(match?.[1]),time:performance.now()};
  });
  const before=await state();await page.waitForTimeout(8000);const after=await state();
  const delta=Object.fromEntries(Object.keys(before).map(key=>[key,after[key]-before[key]]));
  const result={delta,fps:delta.frames/delta.time*1000,rafHz:delta.raf/delta.time*1000};
  console.log(JSON.stringify(result,null,2));
  if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(result,null,2));
}finally{await browser.close();}
