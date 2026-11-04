import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const out=path.resolve(process.argv[2]||'projects/pencraft/pencraft-verification');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const report={errors:[],samples:[]};
page.on('pageerror',e=>report.errors.push(e.message));
async function state(){return page.evaluate(()=>{
  const all=Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable);
  const vars=Object.fromEntries(all.filter(v=>v.type!=='list').map(v=>[v.name,v.value]));
  return {at:performance.now(),vars,bag:all.find(v=>v.name==='bag')?.value,
    warnings:/找不到|已忽略执行|无效值/.test(document.body.innerText)};
});}
async function set(values){await page.evaluate(values=>{
  const req=window.__nekocRequire,store=req(69138).default.ComponentsStore.TheatreStore;
  const manager=req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
  for(const v of Object.values(store.stageVariable)) if(v.type!=='list'&&v.name in values){manager.set_variable(v.id,values[v.name]);store.setStageVariableProperty({id:v.id,value:values[v.name]});}
},values);}
async function key(k,ms=120){await page.keyboard.down(k);await page.waitForTimeout(ms);await page.keyboard.up(k);}
async function until(name,test,value,timeout=30000){await page.waitForFunction(({name,test,value})=>{
  const v=Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable).find(v=>v.name===name)?.value;
  return test==='gt'?v>value:test==='lt'?v<value:v===value;
},{name,test,value},{timeout});}
async function frames(count=2){const f=(await state()).vars.frames;await until('frames','gt',f+count-1);}
async function shot(name){
  await page.evaluate(()=>{const c=window.__nekocRequire(26921).cG.get_instance().stage.core;c.actors.get_actor(c.actors.get_actor_ids()[0]).value.brush.__capture=true;});
  await page.waitForFunction(()=>{const c=window.__nekocRequire(26921).cG.get_instance().stage.core;return !c.actors.get_actor(c.actors.get_actor_ids()[0]).value.brush.__capture;},null,{timeout:60000});
  await page.screenshot({path:path.join(out,name+'.png')});
  const data=await page.evaluate(()=>{
    const core=window.__nekocRequire(26921).cG.get_instance().stage.core;
    const brush=core.actors.get_actor(core.actors.get_actor_ids()[0]).value.brush;
    return brush.__completeImage || brush.ctx.canvas.toDataURL();
  });
  await writeFile(path.join(out,name+'-stage.png'),Buffer.from(data.split(',')[1],'base64'));
}
try {
  await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/,async route=>{
    const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('var __webpack_exports__=','window.__nekocRequire=__webpack_require__;var __webpack_exports__=')});
  });
  await page.route('**/pencraft.bcmkn',async route=>route.fulfill({contentType:'application/json',body:await readFile(process.env.NEKOC_PROJECT||'projects/pencraft/pencraft.bcmkn')}));
  await page.goto('https://kn.codemao.cn/editor?previewUrl=https%3A%2F%2Fkn.codemao.cn%2Fpencraft.bcmkn',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__nekocRequire&&document.body.innerText.includes('ready'),null,{timeout:120000});
  await page.addStyleTag({content:'#DialogContainer{display:none!important}'});
  const done=page.getByText(/^完成$/).last();if(await done.isVisible())await done.dispatchEvent('click');
  // Check already-imported workspace connections without re-rendering the
  // entire large project a second time (the generic probe can stall there).
  report.compatibility=await page.evaluate(()=>{
    const blink=window.__nekocRequire(40742).BlinkInstance,rendered=blink.core.mainWorkspace;
    const actualBlocks=rendered.get_all_blocks(),issues=[];let checked=0;
    for(const workspace of blink.workspaceManager.workspaces.values()) {
      const data=workspace.getWorkspaceDataJson(),blocks=Object.values(data.blocks);
      if(!blocks.some(b=>rendered.get_block_by_id(b.id)))continue;
      for(const block of blocks) {
        checked++;const actual=rendered.get_block_by_id(block.id);
        if(!actual){issues.push({kind:'missing_block',type:block.type});continue;}
        for(const [childId,c] of Object.entries(data.connections[block.id]??{})) {
          const child=c.type==='next'?actual.get_next_block():actual.get_input_target_block(c.input_name);
          if(child?.id!==childId)issues.push({kind:'changed_connection',type:block.type,childId});
        }
        for(const [field,value] of Object.entries(block.fields??{})) {
          const actualValue=actual.get_field_value(field);
          if(actualValue!==undefined&&String(actualValue)!==String(value))issues.push({kind:'changed_field',type:block.type,field});
        }
      }
    }
    return {scope:'imported visible workspace',renderedBlocks:actualBlocks.length,checked,issues};
  });
  assert.ok(report.compatibility.checked>0);assert.deepEqual(report.compatibility.issues,[]);
  await page.evaluate(()=>window.__nekocRequire(69138).default.ComponentsStore.ConsolePanelStore.closeAll());
  await page.getByText(/^开始$/).last().dispatchEvent('click');
  await page.waitForFunction(()=>Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable).some(v=>v.name==='frames'&&v.value>2),null,{timeout:60000});
  await page.evaluate(()=>{
    const core=window.__nekocRequire(26921).cG.get_instance().stage.core;
    const brush=core.actors.get_actor(core.actors.get_actor_ids()[0]).value.brush,original=brush.clear;
    const presentation=window.__presentation={pending:false,started:0,commits:0,rafSamples:0,partialSamples:0,commitMs:[]};
    // Capture the complete previous frame immediately before the next clear.
    // A requested capture incurs one readback, outside the benchmark window.
    brush.clear=function(...args){if(this.__capture){this.__completeImage=this.ctx.canvas.toDataURL();this.__capture=false;}presentation.pending=true;presentation.started=performance.now();return original.apply(this,args);};
    const theatre=window.__nekocRequire(69138).default.ComponentsStore.TheatreStore;
    const phase=Object.values(theatre.stageVariable).find(v=>v.name==='phase')?.id;
    const frame=Object.values(theatre.stageVariable).find(v=>v.name==='frames')?.id;
    const update=theatre.setStageVariableProperty.bind(theatre);window.__phases=[];
    theatre.setStageVariableProperty=function(p){
      if(p.id===phase)window.__phases.push([p.value,performance.now()]);
      if(p.id===frame&&presentation.pending){presentation.pending=false;presentation.commits++;presentation.commitMs.push(performance.now()-presentation.started);}
      return update(p);
    };
    const observe=()=>{presentation.rafSamples++;if(presentation.pending)presentation.partialSamples++;requestAnimationFrame(observe);};requestAnimationFrame(observe);
  });
  await page.locator('canvas:visible').first().click({force:true});await page.evaluate(()=>document.activeElement?.blur());
  await set({help:0});await frames();await shot('initial');
  const profiler=process.env.NEKOC_PROFILE?await page.context().newCDPSession(page):null;
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
  const a=await state();report.samples.push(a);report.benchmarkWindows=[];
  for(let window=0;window<3;window++) {
    const previous=report.samples.at(-1);await page.waitForTimeout(8000);const current=await state();
    report.samples.push(current);report.benchmarkWindows.push((current.vars.frames-previous.vars.frames)/((current.at-previous.at)/1000));
  }
  const b=report.samples.at(-1);
  if(profiler){const {profile}=await profiler.send('Profiler.stop');await writeFile(path.join(out,'cpu.cpuprofile'),JSON.stringify(profile));}
  report.fps=(b.vars.frames-a.vars.frames)/((b.at-a.at)/1000);
  report.phases=await page.evaluate(()=>window.__phases);
  if(process.env.NEKOC_PRESENT_ONLY) {
    await key('ArrowRight',1500);await frames();await shot('turning');
    await key('w',1000);await frames();await shot('moving');
    report.presentation=await page.evaluate(()=>window.__presentation);
    report.ok=true;
  } else {
  await key('w',700);await frames();report.moved=await state();await shot('moved');
  assert.ok(report.moved.vars.pz>b.vars.pz+0.2,'held W moves the player');
  await key('ArrowRight',600);await frames();report.turned=await state();await shot('turned');
  assert.ok(report.turned.vars.yaw>report.moved.vars.yaw+5,'arrow key turns the camera');
  // Deterministic test position. Actions themselves execute native key blocks.
  await set({px:7.5,py:4,pz:3.5,yaw:0,pitch:-65});await frames();
  const beforeMine=await state();await page.keyboard.down('f');
  try{await until('edits','gt',beforeMine.vars.edits);}finally{await page.keyboard.up('f');}
  await frames();report.mined=await state();await shot('mined');
  await set({place:1,selected:2});await until('edits','gt',report.mined.vars.edits);await frames();
  report.placed=await state();await shot('placed');
  // Native resource collection and crafting: mine the accessible tree trunk.
  await set({px:5.5,py:4,pz:5.5,yaw:0,pitch:0});await frames();
  const treeStart=(await state()).vars.edits;await page.keyboard.down('f');
  try{await until('edits','gt',treeStart);}finally{await page.keyboard.up('f');}
  await frames();await set({pitch:-24});await frames();await page.keyboard.down('f');
  try{await until('edits','gt',treeStart+1);}finally{await page.keyboard.up('f');}
  await frames();await set({pitch:24});await frames();await page.keyboard.down('f');
  try{await until('edits','gt',treeStart+2);}finally{await page.keyboard.up('f');}
  await frames();await set({craft:1});await until('tool','eq',1);report.crafted=await state();
  await set({food:10,eat:1});await until('apples','lt',3);assert.ok((await state()).vars.food>14);
  // Gather one extra log from the second tree for a native lantern recipe.
  await set({px:11.5,py:5,pz:6.5,yaw:0,pitch:0});await frames();
  const lanternLog=(await state()).vars.edits;await page.keyboard.down('f');
  try{await until('edits','gt',lanternLog);}finally{await page.keyboard.up('f');}
  await frames();await key('t');await frames();report.lanternCrafted=await state();
  assert.equal(report.lanternCrafted.bag[6],4,'one log crafts four lanterns');
  // Controlled night and combat fixture; no drawing or game procedures mocked.
  await set({clock:90,torch:0,px:7.5,py:4,pz:3.5,yaw:0,pitch:-12});await frames();
  await until('enemyalive','eq',1);await shot('night');report.night=await state();
  await set({pitch:-65});await frames();await shot('night-ground');
  const beforeLamp=(await state()).vars.edits;
  await set({selected:7,place:1});await until('edits','gt',beforeLamp);await frames();await shot('lantern');
  report.lanternPlaced=await state();assert.equal(report.lanternPlaced.bag[6],3);
  // Looking into empty sky must skip the native 1..0 face traversal too.
  await set({pitch:65});await frames();report.sky=await state();assert.equal(report.sky.warnings,false);
  await set({quality:2,view:15,help:1,yaw:127,pitch:-12});await frames(3);await shot('fine-detail');
  report.fineDetail=await state();assert.equal(report.fineDetail.warnings,false);
  await set({quality:10,view:9,help:0,yaw:0});
  await set({pitch:-12});await frames();
  await set({hp:0});await frames();await shot('death');await set({respawn:1});await until('hp','eq',20);report.respawned=await state();
  assert.equal(report.errors.length,0);assert.equal(report.respawned.warnings,false);assert.ok(report.fps>0);
  report.ok=true;report.playableTargetMet=report.fps>=30;
  report.presentation=await page.evaluate(()=>window.__presentation);
  }
  if(!process.env.NEKOC_ALLOW_PARTIAL)assert.equal(report.presentation.partialSamples,0,'no browser animation frame may observe a half-painted frame');
}catch(e){report.failure=String(e);report.dom=await page.locator('body').innerText();await page.screenshot({path:path.join(out,'failure.png')});process.exitCode=1;}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,fps:report.fps,ok:report.ok,failure:report.failure,errors:report.errors},null,2));await browser.close();}
