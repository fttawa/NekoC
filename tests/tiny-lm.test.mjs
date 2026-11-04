import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const model=JSON.parse(fs.readFileSync('assets/tiny-lm/model.json','utf8'));
const reference=JSON.parse(fs.readFileSync('assets/tiny-lm/reference.json','utf8'));
const sourcePath=process.env.NEKOC_TINY_LM_SOURCE||'samples/tiny_lm.ts';
const artifactPath=process.env.NEKOC_TINY_LM_PROJECT||'samples/tiny_lm.bcmkn';

function harness(){
  const vars={lm_position:0},lists={},procs={},keys={};let start,frame;
  lists.lm_weights=Object.values(model.weights).flatMap(w=>w.values);
  lists.lm_vocabulary=model.vocabulary;
  lists.lm_keys=Array(4096).fill(0);lists.lm_values=Array(4096).fill(0);
  const globals={
    getVar:n=>vars[n]??0,setVar:(n,v)=>vars[n]=v,changeVar:(n,v)=>vars[n]=(vars[n]??0)+v,
    deleteListItem:n=>lists[n]=[],appendList:(n,v)=>(lists[n]??=[]).push(v),
    listItem:(n,_,i)=>{assert.ok(i>=1&&i<=lists[n].length&&Number.isInteger(i),`${n}[${i}]`);return lists[n][i-1];},
    replaceListItem:(n,_,i,v)=>{assert.ok(i>=1&&i<=lists[n].length);lists[n][i-1]=v;},
    listLength:n=>lists[n]?.length??0,listContains:(n,v)=>lists[n]?.includes(v)??false,
    listIndexOf:(n,v)=>(lists[n]?.indexOf(v)??-1)+1,
    mathFunc:(name,v)=>Math[name](v),floor:Math.floor,
    // Numerical tests deliberately omit pen rendering; UI geometry has separate tests.
    defineProc:(n,_,body)=>procs[n]=n==='lm HUD'?()=>{}:body,callProc:n=>procs[n](),warp:body=>body(),
    onStart:body=>start=body,forever:body=>frame=body,onKey:(n,event,body)=>keys[n]=body,
    penUp:()=>{},penDown:()=>{},hide:()=>{},timerStart:()=>{},timerValue:()=>0,
    clearDrawing:()=>{},setPenColor:()=>{},setPenSize:()=>{},moveTo:()=>{},stampText:()=>{},
    selectText:(text,a,b)=>String(text).slice(a-1,b),join:(...parts)=>parts.join(''),wait:()=>{},
  };
  const code=ts.transpileModule(fs.readFileSync(sourcePath,'utf8'),{compilerOptions:{module:ts.ModuleKind.None}}).outputText;
  vm.runInNewContext(code,globals);
  return {vars,lists,procs,keys,start:()=>start(),frame:()=>frame(),step:token=>{vars.lm_input_token=token;procs['lm step']();return [...lists.lm_logits];}};
}

test('architecture is an actual 29,312-parameter two-layer Transformer with tied output',()=>{
  assert.equal(model.parameterCount,29312);assert.equal(Object.values(model.weights).reduce((n,w)=>n+w.values.length,0),29312);
  assert.equal(model.architecture.layers,2);assert.equal(model.architecture.vocab,79);assert.equal(model.architecture.tiedOutput,true);
  assert.ok(reference.validation.crossEntropyNats<.6);assert.ok(reference.kvCacheVsFullMaxAbsError<1e-10);
});

for(const probe of reference.probes)test(`native-source cached logits match independent NumPy, prompt=${probe.prompt||'<BOS>'}`,()=>{
  const h=harness();
  for(let p=0;p<probe.tokens.length;p++){
    const logits=h.step(probe.tokens[p]);assert.equal(logits.length,79);
    const error=Math.max(...logits.map((x,i)=>Math.abs(x-probe.logits[p][i])));
    assert.ok(error<1e-9,`position ${p} max error ${error}`);assert.ok(logits.every(Number.isFinite));
  }
});

test('generation actually follows successive model logits and stops at EOS',()=>{
  const h=harness();h.start();h.vars.lm_temperature=0;
  for(let i=0;i<50&&(i===0||h.vars.lm_running);i++)h.frame();
  const expected=reference.probes.find(p=>p.prompt==='小猫').greedy;
  assert.equal(h.vars.lm_prompt+h.vars.lm_output,expected);
  assert.match(h.vars.lm_status,/^(DONE \/ EOS|完成 · 句子结束)$/);assert.ok(h.vars.lm_generated>6);
  assert.equal(h.vars.lm_weight_count,29312);assert.equal(h.vars.lm_vocab_size,79);
});

test('seeded sampling is deterministic but differs from greedy; invalid prompt is rejected',()=>{
  const run=()=>{const h=harness();h.start();h.vars.lm_temperature=.7;for(let i=0;i<50&&(i===0||h.vars.lm_running);i++)h.frame();return h;};
  const a=run(),b=run();assert.equal(a.vars.lm_output,b.vars.lm_output);
  assert.notEqual(a.vars.lm_prompt+a.vars.lm_output,reference.probes.find(p=>p.prompt==='小猫').greedy);
  a.vars.lm_prompt='🚀';a.procs['lm begin']();assert.equal(a.vars.lm_running,0);assert.match(a.vars.lm_status,/Unsupported character|词表外的字/);
});

test('native-source KV cache handles position 63 and ignores stale values after reset',()=>{
  const h=harness();let logits;
  for(const token of reference.capacityProbe.tokens)logits=h.step(token);
  assert.equal(h.vars.lm_position,64);
  assert.ok(Math.max(...logits.map((x,i)=>Math.abs(x-reference.capacityProbe.lastLogits[i])))<1e-9);
  h.vars.lm_position=0;
  logits=h.step(0);
  assert.ok(Math.max(...logits.map((x,i)=>Math.abs(x-reference.probes[0].logits[0][i])))<1e-9,'old KV rows must not leak into new prompt');
});

test('length and output limits fail safely rather than overflowing the cache',()=>{
  const h=harness();h.start();h.vars.lm_prompt='小'.repeat(49);h.procs['lm begin']();
  assert.equal(h.vars.lm_running,0);assert.match(h.vars.lm_status,/too long|提示词太长/);
  h.vars.lm_prompt='小猫';h.vars.lm_max_new_tokens=2;h.vars.lm_request=1;
  for(let i=0;i<10;i++)h.frame();
  assert.equal(h.vars.lm_generated,2);assert.match(h.vars.lm_status,/^(DONE \/ LIMIT|完成 · 达到长度上限)$/);
});

test('compiled artifact contains all trained weights and only public native blocks',()=>{
  const project=JSON.parse(fs.readFileSync(artifactPath,'utf8'));
  const defs=Object.values(project.variables.variablesDict);
  assert.deepEqual(defs.find(v=>v.name==='lm_weights').value,Object.values(model.weights).flatMap(w=>w.values));
  const types=new Set(),lengths=[];const walk=x=>{if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object'){if(x.id&&x.type)types.add(x.type);if(x.type==='text_length')lengths.push(x);Object.values(x).forEach(walk);}};walk(project);
  for(const forbidden of ['javascript','execute_js','http_request','fetch','run_code'])assert.ok(!types.has(forbidden));
  assert.ok(types.has('script_variables'));assert.ok(types.has('temporary_list'));assert.ok(types.has('math_function'));
  assert.ok(lengths.length>0);assert.ok(lengths.every(b=>b.inputs?.text?.type==='variables_get'),'prompt length reporters must keep their text input');
});
