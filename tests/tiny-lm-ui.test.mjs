import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
import {repairUi} from '../tools/tiny-lm/repair-ui.mjs';

const fixture=`
defineProc("lm card",["x1","y1","x2","y2"],()=>{
  setPenSize(32);
  penUp();moveTo(param("x1")+16,param("y1")-16);penDown();moveTo(param("x1")+16,param("y2")+16);penUp();
  moveTo(param("x2")-16,param("y1")-16);penDown();moveTo(param("x2")-16,param("y2")+16);penUp();
  setVar("lm_ui_y",param("y1")-16);
  repeatUntil(getVar("lm_ui_y")<param("y2")+16,()=>{
    moveTo(param("x1")+16,getVar("lm_ui_y"));penDown();moveTo(param("x2")-16,getVar("lm_ui_y"));penUp();
    changeVar("lm_ui_y",-32);
  });
  moveTo(param("x1")+16,param("y2")+16);penDown();moveTo(param("x2")-16,param("y2")+16);penUp();
});
defineProc("lm key",["x","y","w","key"],()=>{
  setPenColor("#24344a");setPenSize(28);
  penUp();moveTo(param("x")+14,param("y"));penDown();moveTo(param("x")+14+param("w"),param("y"));penUp();
  setPenColor("#6ee7c8");moveTo(param("x")+14+param("w")/2,param("y"));stampText(param("key"),15,"center");
});
onStart(()=>{
  callProc("lm card",-420,180,150,-114);callProc("lm card",170,180,420,-114);callProc("lm card",-420,-134,420,-232);
  callProc("lm key",-396,-162,8,"1");callProc("lm key",-196,-162,8,"2");callProc("lm key",4,-162,8,"3");
  callProc("lm key",204,-162,18,"回车");callProc("lm key",-396,-202,8,"R");callProc("lm key",-196,-202,8,"T");
  callProc("lm key",64,-202,18,"空格");
});`;

function strokes(source,state={}){
  // Lower the DSL condition to a real while so JS re-evaluates it on each iteration.
  const lower=context=>root=>ts.visitNode(root,function visit(node){
    if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText()==='repeatUntil'){
      const [condition,callback]=node.expression.arguments;
      return ts.factory.createWhileStatement(ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken,ts.factory.createParenthesizedExpression(condition)),callback.body);
    }
    return ts.visitEachChild(node,visit,context);
  });
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.None},transformers:{before:[lower]}}).outputText;
  const vars={...state},procedures={},events=[];let params={},start;
  vm.runInNewContext(code,{
    defineProc:(name,names,body)=>procedures[name]={names,body},
    callProc:(name,...values)=>{const old=params;params=Object.fromEntries(procedures[name].names.map((n,i)=>[n,values[i]]));procedures[name].body();params=old;},
    param:n=>params[n],setVar:(n,v)=>vars[n]=v,getVar:n=>vars[n]??0,changeVar:(n,v)=>vars[n]+=v,
    warp:body=>body(),onKey:()=>{},floor:Math.floor,join:(...v)=>v.join(''),selectText:(v,a,b)=>String(v).slice(a-1,b),
    onStart:body=>start=body,
    ...Object.fromEntries(['clearDrawing','penUp','penDown','setPenSize','setPenColor','moveTo','stampText'].map(n=>[n,(...args)=>events.push([n,...args])])),
  });
  start();return events;
}

test('UI compatibility rewrite preserves every card stroke, keycap and Chinese text',()=>{
  const repaired=repairUi(fixture);
  assert.deepEqual(strokes(repaired),strokes(fixture));
  assert.ok(!repaired.includes('param('));assert.ok(!repaired.includes('callProc("lm card"'));
  assert.ok(repaired.includes('"回车"')&&repaired.includes('"空格"'));
});

if(process.env.NEKOC_TINY_LM_UI_ORIGINAL)test('complete modified HUD is unchanged by the compatibility rewrite',()=>{
  const original=fs.readFileSync(process.env.NEKOC_TINY_LM_UI_ORIGINAL,'utf8');
  const repaired=repairUi(original);
  const invoke='\nonStart(()=>{callProc("lm HUD");});';
  for(const state of [
    {lm_prompt:'小猫',lm_output:'',lm_running:1,lm_status:'读入提示词',lm_phase:'分词'},
    {lm_prompt:'小猫',lm_output:'走到山上，看见了云。它很开心。',lm_running:0,lm_status:'完成 · 句子结束',lm_phase:'就绪',lm_generated:15,lm_position:18,lm_last_seconds:4.44,lm_seed:7,lm_temperature:0},
    {lm_prompt:'夜晚，',lm_output:'家里很安',lm_running:1,lm_status:'生成中',lm_phase:'第 2 / 2 层',lm_temperature:.7},
  ])assert.deepEqual(strokes(repaired+invoke,state),strokes(original+invoke,state));
});

test('repaired UI compiles without parameterized native procedures',()=>{
  const dir=fs.mkdtempSync('D:/AppData/Local/Temp/opencode/nekoc-tiny-ui-');
  try{
    fs.writeFileSync(path.join(dir,'ui.ts'),repairUi(fixture));
    execFileSync(process.execPath,[path.resolve('ts/compile-ts.mjs'),path.join(dir,'ui.ts'),path.join(dir,'ui.json')]);
    const data=JSON.parse(fs.readFileSync(path.join(dir,'ui.json'),'utf8'));
    const types=Object.values(data.workspaceData.blocks).map(b=>b.type);
    assert.ok(!types.some(t=>t==='procedures_2_parameter'||t==='procedures_2_stable_parameter'));
    assert.ok(types.includes('stamp')&&types.includes('repeat_forever_until'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
