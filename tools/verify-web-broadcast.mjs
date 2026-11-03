import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output='D:/AppData/Local/Temp/opencode/neko-broadcast-validation';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(60000);
const errors=[],report={browser:browser.version(),tests:[],errors};
page.on('pageerror',e=>errors.push(e.message));
try{
  const project=JSON.parse(await readFile('samples/pen_display_columns.bcmkn','utf8'));
  const ids=Object.keys(project.variables.variablesDict).filter(id=>project.variables.variablesDict[id].type!=='list').sort();
  const slots=Object.fromEntries(ids.map((id,i)=>[id.replace(/^kn-var-/,''),i]));
  await page.goto('http://127.0.0.1:4173/play');
  await page.waitForFunction(()=>window.nekoPlayDiagnostics?.().busy===false);
  await page.locator('#file').setInputFiles('samples/pen_display_columns.bcmkn');
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame?.variables[i]>=5,slots.__pd_frames);
  assert.equal(await page.locator('#notice').isVisible(),false);
  await page.locator('#settings-toggle').click();
  await page.locator('#budget').selectOption('2');
  await page.locator('#settings-toggle').click();
  // Sample real WebSocket playback and GPU work, not an arithmetic benchmark.
  report.performance=await page.evaluate(async slots=>{
    const before=window.nekoPlayDiagnostics(),start=performance.now(),v=before.frame.variables;
    let peaks=0,budgetYields=0,samples=0,last=before.totalUpdates,vmMs=0;
    await new Promise(resolve=>{function sample(){
      const d=window.nekoPlayDiagnostics();
      if(d.totalUpdates!==last){last=d.totalUpdates;samples++;peaks=Math.max(peaks,d.frame.active);budgetYields+=Number(d.frame.budget_yield);vmMs+=d.frame.execute_us/1000;}
      performance.now()-start>=6000?resolve():requestAnimationFrame(sample);
    }requestAnimationFrame(sample);});
    const after=window.nekoPlayDiagnostics(),seconds=(performance.now()-start)/1000;
    return {seconds,updatesPerSecond:(after.totalUpdates-before.totalUpdates)/seconds,
      completeFramesPerSecond:(after.frame.variables[slots.__pd_frames]-v[slots.__pd_frames])/seconds,
      drawingFPS:after.drawFps,meanVmMs:vmMs/samples,budgetYields,peakActiveTasks:peaks,samples};
  },slots);
  assert.ok(report.performance.completeFramesPerSecond>1);
  assert.ok(report.performance.peakActiveTasks<=33);
  // Pause to get a stable image, and inspect the actual stage pixels.
  await page.locator('#toggle').click();await page.waitForFunction(()=>!window.nekoPlayDiagnostics().pending);
  // preserveDrawingBuffer=false: a later drawImage(WebGL canvas) reads a
  // discarded backbuffer. Inspect the browser's compositor screenshot instead.
  const png=await page.locator('#stage').screenshot();
  const image=await page.evaluate(async url=>{
    const source=new Image();source.src=url;await source.decode();
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let colorful=0;const colors=new Set();for(let i=0;i<pixels.length;i+=4){
      const max=Math.max(pixels[i],pixels[i+1],pixels[i+2]),min=Math.min(pixels[i],pixels[i+1],pixels[i+2]);
      if(max-min>35&&max>60){colorful++;colors.add(`${pixels[i]>>4},${pixels[i+1]>>4},${pixels[i+2]>>4}`);}
    }return {colorful,colors:colors.size,width:canvas.width,height:canvas.height};
  },`data:image/png;base64,${png.toString('base64')}`);
  assert.ok(image.colorful>10000&&image.colors>=8,JSON.stringify(image));report.pixels=image;
  await page.screenshot({path:`${output}/columns.png`});
  report.tests.push('32-column broadcast-and-wait renderer: private import, moving color bands, stable task count, actual WebGL pixels, measured complete frames at 2ms budget');
  await page.locator('#toggle').click();await page.locator('#stage').press('1');
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame.variables[i]===15,slots.__pd_fps);
  await page.locator('#stage').press('3');
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame.variables[i]===60,slots.__pd_fps);
  await page.locator('#restart').click();
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame?.variables[i]===30,slots.__pd_fps);
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame?.variables[i]>=3,slots.__pd_frames);
  report.tests.push('Key events change project refresh rate to 15/60; restart resets VM, broadcasts and refresh rate to 30');
  const poly=JSON.parse(await readFile('samples/pen_polyhedron.bcmkn','utf8'));
  const polyIds=Object.keys(poly.variables.variablesDict).filter(id=>poly.variables.variablesDict[id].type!=='list').sort();
  const polySlots=Object.fromEntries(polyIds.map((id,i)=>[id.replace(/^kn-var-/,''),i]));
  const waitPoly=(name,value)=>page.waitForFunction(({i,value})=>window.nekoPlayDiagnostics().frame?.variables[i]===value,{i:polySlots[name],value});
  await page.locator('#file').setInputFiles('samples/pen_polyhedron.bcmkn');
  await waitPoly('poly_presented_solid',2);await waitPoly('poly_presented_mode',4);
  assert.equal(await page.locator('#notice').isVisible(),false);
  await page.locator('#stage').press('Space');await waitPoly('poly_auto',0);
  await page.locator('#stage').press('1');await waitPoly('poly_presented_mode',1);
  await page.locator('#stage').press('e');await waitPoly('poly_faces',8);await waitPoly('poly_presented_solid',3);
  await page.locator('#stage').press('h');await waitPoly('poly_wireframe',1);
  await page.locator('#stage').press('h');await waitPoly('poly_wireframe',0);
  await page.locator('#stage').press('q');await waitPoly('poly_faces',6);await waitPoly('poly_presented_solid',2);
  await page.screenshot({path:`${output}/polyhedron-fixed-negation.png`});
  report.tests.push('Regenerated current polyhedron: prefix ! operands survive export, hidden-edge/list membership executes, Space/key-release controls, grid switch, E/Q solids and H x-ray toggle');
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:`${output}/failure.png`});console.log(await page.locator('#notice-text').textContent());throw error;}
finally{await browser.close();}
