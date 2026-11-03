// Native-block probe: no runtime behavior or scheduler limits are replaced.
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(path.join(process.env.NEKOC_NODE_MODULES,'package.json'));
const {chromium}=require('playwright');
const temp=await mkdtemp('D:/AppData/Local/Temp/opencode/nekoc-locals-');
const source=`
function mn(a:number,b:number):number{return (a+b-mathFunc("abs",a-b))/2;}
function mx(c:number,d:number):number{return (c+d+mathFunc("abs",c-d))/2;}
defineProc("nested",[],()=>{warp(()=>{
  setVar("nestedRead",scriptVar("scratch"));
  changeVar("LOCAL_scratch",7);
  setVar("nestedAfter",scriptVar("scratch"));
});});
onStart(()=>{warp(()=>{
  scriptVars("scratch");
  setVar("LOCAL_scratch",35);
  setVar("before",scriptVar("scratch"));
  callProc("nested");
  setVar("after",scriptVar("scratch"));
  setVar("x",100000);setVar("y",-202.25);
  setVar("minResult",mn(getVar("x") as number,getVar("y") as number));
  setVar("maxResult",mx(getVar("x") as number,getVar("y") as number));
  setVar("ready",1);
});});`;
await writeFile(path.join(temp,'probe.ts'),source);
execFileSync(path.resolve('target/debug/nekoc.exe'),['compile-ts-bcmkn',path.join(temp,'probe.ts'),'--template','samples/kitten-n-0.27.4.bcmkn','--out',path.join(temp,'probe.bcmkn')]);
const project=JSON.parse(await readFile(path.join(temp,'probe.bcmkn'),'utf8'));
const local=Object.values(project.variables.variablesDict).find(v=>v.name==='LOCAL_scratch').id;
function walk(o){if(!o||typeof o!=='object')return;if(o.fields?.variable===local)o.fields.variable=JSON.stringify({name:'scratch',type:'NEKO_SCRIPT_VARIABLE_TYPE-957f2554-87af'});for(const v of Object.values(o))walk(v);}
walk(project);
await writeFile(path.join(temp,'probe.bcmkn'),JSON.stringify(project));
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('var __webpack_exports__=','window.__nekocRequire=__webpack_require__;var __webpack_exports__=')});});
  await page.route('**/probe.bcmkn',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(project)}));
  await page.goto('https://kn.codemao.cn/editor?previewUrl='+encodeURIComponent('https://kn.codemao.cn/probe.bcmkn'),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__nekocRequire&&document.body.innerText.includes('ready'));
  await page.addStyleTag({content:'#DialogContainer{display:none!important}'});
  const done=page.getByText(/^完成$/).last();if(await done.isVisible())await done.dispatchEvent('click');
  await page.getByText(/^开始$/).last().dispatchEvent('click');
  await page.waitForFunction(()=>Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable).some(v=>v.name==='ready'&&v.value===1));
  const result=await page.evaluate(()=>{
    const req=window.__nekocRequire;
    return {vars:Object.fromEntries(Object.values(req(69138).default.ComponentsStore.TheatreStore.stageVariable).map(v=>[v.name,v.value])),
      descriptorType:req(86142).Q,prefix:req(90667).Ms,
      localBlocks:Object.values(req(40742).BlinkInstance.core.mainWorkspace.get_all_blocks()).filter(b=>b.type.includes('script_variable')).map(b=>({type:b.type,fields:b.get_field_value('TEXT'),mutation:b.mutation_to_dom?.()?.outerHTML})),
      exported:[...req(40742).BlinkInstance.workspaceManager.workspaces.values()].map(w=>w.getWorkspaceDataJson()),
      warnings:document.body.innerText.match(/.{0,30}(找不到|未定义|已忽略执行).{0,70}/g)};
  });
  await writeFile(path.join(temp,'report.json'),JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({temp,vars:result.vars,descriptorType:result.descriptorType,localBlocks:result.localBlocks,warnings:result.warnings,errors},null,2));
  assert.equal(result.vars.before,35);assert.equal(result.vars.nestedRead,35);assert.equal(result.vars.after,42);
  assert.equal(result.vars.minResult,-202.25);assert.equal(result.vars.maxResult,100000);
}finally{await browser.close();}
