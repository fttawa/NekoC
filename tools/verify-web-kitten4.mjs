// Build/start the current Web Studio first, e.g. cargo run --bin web -- samples/kitten4-demo.bcm --port 4184
// NEKOC_NODE_MODULES=... node tools/verify-web-kitten4.mjs [output-directory] [http://127.0.0.1:4184]
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const modules=process.env.NEKOC_NODE_MODULES;
const require=createRequire(modules?path.join(modules,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output=process.argv[2]||'D:/AppData/Local/Temp/opencode/nekoc-web-kitten4-verification';
const base=process.argv[3]||process.env.NEKOC_WEB_URL||'http://127.0.0.1:4184';
await mkdir(output,{recursive:true});
const native=JSON.parse((await readFile('samples/kitten4-demo.bcm','utf8')).replace(/^\uFEFF/,''));
native.webOpaqueExtension={unknown:[null,1,'two',{xml:'<future keep="yes"/>',type:'opaque-future',id:'opaque-id'}]};
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',dialog=>dialog.accept());
const report={browser:await browser.version(),url:base,tests:[],errors};
const upload=async(name,value)=>{
  await page.evaluate(()=>{window.nekoImportReport=null;});
  await page.locator('#file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from('\uFEFF'+JSON.stringify(value))});
  await page.waitForFunction(()=>!!window.nekoImportReport);
};
const download=async()=>{
  const ready=page.waitForEvent('download');await page.locator('#save').click();
  const file=await ready;return {name:file.suggestedFilename(),value:JSON.parse(await readFile(await file.path(),'utf8'))};
};
const source=async()=>{
  await page.locator('[data-tab="json"]').click();
  return JSON.parse(await page.locator('#json-source').inputValue());
};
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.nekoImportReport);
  assert.match(await page.locator('#file').getAttribute('accept'),/\.bcm,/);
  await upload('Kitten4 opaque.bcm',native);
  const imported=await page.evaluate(()=>window.nekoImportReport);
  assert.equal(imported.format,'kitten4-json');assert.equal(imported.export_extension,'bcm');
  assert.equal(imported.editor_format,'bcmkn-json');assert.equal(imported.fast_runtime_ready,true);
  assert.equal(imported.project.toolType,'KN');assert.ok(imported.project._nekocKitten4);
  assert.match(await page.locator('#logs').textContent(),/Kitten4 \.bcm/);
  assert.match(await page.locator('#save').textContent(),/导出 \.bcm /);
  report.tests.push('BOM native Kitten4 import returns canonical KN, identifies Kitten4, advertises .bcm export');

  // Select an actual motion input rather than a property field or opaque native copy.
  const edit=await page.evaluate(()=>{
    const p=window.nekoImportReport.project;
    function walk(b){
      if(!b||typeof b!=='object')return null;
      if(b.type==='self_move_to'&&b.inputs?.x?.type==='math_number')return {id:b.id,input:'x',value:b.inputs.x.fields.NUM};
      for(const child of [...Object.values(b.statements||{}),...Object.values(b.inputs||{}),b.next]){const found=walk(child);if(found)return found;}
      return null;
    }
    for(const [kind,dict]of [['#sprites',p.actors.actorsDict],['#scenes',p.scenes.scenesDict]])for(const [id,owner]of Object.entries(dict))for(const b of owner.nekoBlockJsonList||[]){const found=walk(b);if(found)return {...found,ownerId:id,kind,index:Object.keys(dict).indexOf(id)};}
    return null;
  });
  assert.ok(edit,'sample needs a self_move_to numeric X input');
  await page.locator(`${edit.kind} .entity`).nth(edit.index).click();
  const field=()=>page.locator(`[data-block=${JSON.stringify(edit.id)}] > .fields input[type="number"]`).first();
  const changed=Number(edit.value)+7;
  await field().fill(String(changed));await field().dispatchEvent('change');
  await page.getByTitle('撤销',{exact:true}).click();assert.equal(await field().inputValue(),String(edit.value));
  await page.getByTitle('重做',{exact:true}).click();assert.equal(await field().inputValue(),String(changed));
  const canonical=await source();
  assert.deepEqual(canonical._nekocKitten4,imported.project._nekocKitten4);
  assert.match(await page.locator('#json-note').textContent(),/内部规范 KN JSON/);
  report.tests.push('numeric block input edit, undo/redo; internal canonical JSON clearly labeled and provenance unchanged');

  // Losing metadata through JSON apply must fail visibly and leave the editor intact.
  const missing=structuredClone(canonical);delete missing._nekocKitten4;
  await page.locator('#json-source').fill(JSON.stringify(missing));
  const rejected=page.waitForResponse(r=>r.url()===`${base}/api/project`&&r.request().method()==='POST');
  await page.locator('#apply-json').click();assert.equal((await rejected).status(),400);
  await page.waitForFunction(()=>document.querySelector('#logs').textContent.includes('请保留 Kitten4'));
  assert.deepEqual((await source())._nekocKitten4,canonical._nekocKitten4);
  const renamed={...canonical,projectName:'Kitten4 Web E2E edited'};
  await page.locator('#json-source').fill(JSON.stringify(renamed));
  await page.locator('#apply-json').click();
  await page.waitForFunction(()=>document.querySelector('#project-name').value==='Kitten4 Web E2E edited');
  report.tests.push('canonical JSON apply rejects metadata loss atomically; valid JSON edit succeeds');
  await page.locator('[data-tab="blocks"]').click();

  await page.getByRole('button',{name:'▶ 运行',exact:true}).click();
  await page.waitForFunction(()=>window.nekoDiagnostics().frame?.sequence>=2);
  await page.getByTitle('暂停',{exact:true}).click();
  const diagnostics=await page.evaluate(()=>window.nekoDiagnostics());
  assert.equal(diagnostics.started,true);assert.ok(diagnostics.bytes>4);assert.equal(diagnostics.pipeline.transport,'websocket');
  await page.screenshot({path:path.join(output,'kitten4-edited-runtime.png'),fullPage:true});
  await page.getByTitle('停止',{exact:true}).click();
  await page.waitForFunction(()=>window.nekoDiagnostics().started===false);
  report.tests.push('edited Kitten4 executes in Rust VM over WebSocket/binary frames and renders on WebGL2');

  const saved=await download();assert.match(saved.name,/\.bcm$/);assert.ok(!saved.value._nekocKitten4);
  assert.deepEqual(saved.value.webOpaqueExtension,native.webOpaqueExtension);
  await writeFile(path.join(output,saved.name),JSON.stringify(saved.value,null,2));
  await upload(saved.name,saved.value);
  const reimported=await page.evaluate(()=>window.nekoImportReport);
  assert.equal(reimported.format,'kitten4-json');assert.equal(reimported.fast_runtime_ready,true);
  assert.equal(reimported.project.projectName,renamed.projectName);
  const owner=reimported.project.actors.actorsDict[edit.ownerId]||reimported.project.scenes.scenesDict[edit.ownerId];
  const find=(v,id)=>{if(!v||typeof v!=='object')return null;if(v.id===id&&v.type)return v;for(const child of Object.values(v)){const b=find(child,id);if(b)return b;}return null;};
  assert.equal(Number(find(owner.nekoBlockJsonList,edit.id).inputs[edit.input].fields.NUM),changed);
  const resaved=await download();assert.deepEqual(resaved.value.webOpaqueExtension,native.webOpaqueExtension);
  report.tests.push('native .bcm download/reimport preserves edited input, project name and opaque metadata across two roundtrips');

  const kn=JSON.parse(await readFile('samples/native-studio.bcmkn','utf8'));
  kn.futureWebExtension={unknown:['bcmkn',null]};
  kn.actors.actorsDict.sprite.nekoBlockJsonList[0].next={id:'unsupported-sound',type:'play_audio',mutation:'<mutation unknown="keep"/>'};
  await upload('standard.bcmkn',kn);
  assert.match(await page.locator('#save').textContent(),/导出 \.bcmkn/);
  const standard=await download();assert.match(standard.name,/\.bcmkn$/);assert.deepEqual(standard.value,kn);
  report.tests.push('standard bcmkn keeps original save label, extension and lossless unknown-block export');
  assert.deepEqual(errors,[]);
  report.diagnostics=diagnostics;
  await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
