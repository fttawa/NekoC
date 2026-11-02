import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');
const modulePath=path.join(root,'modules/tower-defense/cloud.ts');
const source=fs.readFileSync(modulePath,'utf8');
const compiled=ts.transpile(source);
const presets=['加油','冰塔很有用','守住核心','这关有点难','祝你好运','谢谢帮助'];

function harness() {
  const vars={mode:0,level:1,now:0,runId:0,score:0},lists={},procs={},stamps=[],draw=[];
  let x=0,y=0,operations=0,warpDepth=0;
  const index=(name,i)=>{
    assert.ok(Number.isInteger(i)&&i>=1&&i<=lists[name]?.length,`${name}[${i}] outside list`);
    return i-1;
  };
  const context=vm.createContext({
    getVar:n=>{operations++;return vars[n]??0;},
    setVar:(n,value)=>{operations++;vars[n]=value;},
    changeVar:(n,delta)=>{operations++;vars[n]=(vars[n]??0)+delta;},
    listItem:(n,mode,i)=>{operations++;assert.equal(mode,'any');return lists[n][index(n,i)];},
    listLength:n=>{operations++;return lists[n]?.length??0;},
    appendList:(n,value)=>{operations++;(lists[n]??=[]).push(value);},
    replaceListItem:(n,mode,i,value)=>{operations++;assert.equal(mode,'any');lists[n][index(n,i)]=value;},
    deleteListItem:(n,mode,i)=>{operations++;if(mode==='all')lists[n]=[];else{assert.equal(mode,'any');lists[n].splice(index(n,i),1);}},
    defineProc:(n,params,body)=>{assert.equal(params.length,0);assert.ok(!procs[n]);procs[n]=body;},
    callProc:n=>{assert.ok(warpDepth>0);assert.ok(procs[n],`missing ${n}`);procs[n]();},
    warp:body=>{warpDepth++;try{body();}finally{warpDepth--; }},
    randInt:(lo,hi)=>{assert.ok(hi>=lo);return lo+123;},floor:Math.floor,ceil:Math.ceil,
    join:(...parts)=>parts.join(''),length:value=>String(value).length,
    penUp:()=>draw.push('penUp'),moveTo:(nx,ny)=>{assert.ok(Number.isFinite(nx)&&Number.isFinite(ny));x=nx;y=ny;},
    setPenColor:c=>draw.push(c),stampText:(text,size,align)=>{assert.equal(align,'left');stamps.push({text:String(text),x,y,size});}
    // Intentionally no fetch, timers, sockets, filesystem, identity or login APIs.
  });
  vm.runInContext(compiled,context,{timeout:1000});
  const h={vars,lists,procs,stamps,draw,call:n=>procs[n](),
    tick(){operations=0;procs['td social tick']();assert.ok(operations<20000,'bounded controller work');return operations;},
    begin(level=1){vars.mode=2;vars.runId++;vars.level=level;h.tick();},
    win(score){vars.score=score;vars.mode=3;h.tick();},
    send(choice,advance=0){vars.mode=8;vars.now+=advance;vars.messageChoice=choice;h.tick();},
    receive(text,overrides={}){
      Object.assign(vars,{mode:8,inboundText:text,inboundSender:vars.socialId,inboundSession:vars.socialSession,
        inboundSequence:vars.chatSequence+1,chatInbound:1},overrides);h.tick();
    },
    hud(){stamps.length=0;procs['td social hud']();return stamps.map(s=>s.text);}
  };
  h.call('td social init');return h;
}

test('standalone DSL emits bounded native procedures and no network or cloud opcodes',()=>{
  const ast=ts.createSourceFile(modulePath,source,ts.ScriptTarget.Latest,true);
  const definitions=ast.statements.filter(s=>ts.isExpressionStatement(s)&&ts.isCallExpression(s.expression)&&s.expression.expression.getText(ast)==='defineProc');
  assert.equal(definitions.length,7);
  for(const statement of definitions) {
    assert.equal(statement.expression.arguments[1].elements.length,0);
    const body=statement.expression.arguments[2].body.statements;
    assert.equal(body.length,1);assert.equal(body[0].expression.expression.getText(ast),'warp');
  }
  const allowedCalls=new Set(['getVar','setVar','changeVar','listItem','listLength','appendList','replaceListItem','deleteListItem',
    'defineProc','callProc','warp','floor','ceil','randInt','join','length','penUp','moveTo','setPenColor','stampText',
    'socialV','socialS','socialN','socialText']);
  function visit(node) {
    if(ts.isCallExpression(node))assert.ok(allowedCalls.has(node.expression.getText(ast)),`unexpected API ${node.expression.getText(ast)}`);
    ts.forEachChild(node,visit);
  }
  visit(ast);
  const temp=fs.mkdtempSync(path.join('D:/AppData/Local/Temp/opencode','td-social-test-'));
  try {
    const output=path.join(temp,'workspace.json');
    execFileSync(process.execPath,[path.join(root,'ts/compile-ts.mjs'),modulePath,output],{cwd:root});
    const workspace=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(workspace.summary.procedures,definitions.length);
    assert.equal(workspace.summary.scripts,0,'parent owns all controller/event wiring');
    const blocks=workspace.procedures.flatMap(p=>Object.values(p.workspaceData.blocks));
    assert.ok(blocks.length>100&&blocks.length<6000,`unexpected expansion: ${blocks.length}`);
    assert.ok(blocks.some(b=>b.type==='random_num'),'pseudonyms use native random reporter');
    assert.ok(blocks.some(b=>b.type==='text_length'),'message length uses native UTF-16 length');
    for(const b of blocks) {
      assert.ok(!/cloud|ranking|username|user_id|http|socket|bcm_translator|clear_drawing|self_pen_down/i.test(b.type),b.type);
      if(['variables_get','variables_set','change_variables'].includes(b.type))assert.ok(Object.hasOwn(b.fields,'variable'));
    }
    // Reachable procedure calls use known local procedures only.
    for(const p of workspace.procedures)assert.ok(Object.keys(p.workspaceData.blocks).length>1);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('initialization allocates six ten-slot tables, is idempotent and preserves parent state',()=>{
  const h=harness(),v=h.vars;
  assert.equal(h.lists.scoreBank.length,60);assert.deepEqual(h.lists.scoreBank,Array(60).fill(-1));
  assert.deepEqual(h.lists.scoreNameBank,Array(60).fill(0));assert.deepEqual(h.lists.chatTextBank,[]);
  assert.equal(v.cloudEnabled,0);assert.equal(v.cloudStatus,'云端未配置 / 本地会话');
  const identity=[v.socialId,v.socialSession];h.begin();h.win(123);h.send(1);
  Object.assign(v,{frames:800,dt:.05,clock:44,lives:18,gold:190,cloudEnabled:1,cloudStatus:'ONLINE'});
  h.call('td social init');assert.deepEqual([v.socialId,v.socialSession],identity);
  assert.equal(h.lists.scoreBank[0],123);assert.equal(h.lists.chatTextBank.length,1);assert.equal(v.socialCooldown,30);
  assert.deepEqual([v.frames,v.dt,v.clock,v.lives,v.gold],[800,.05,44,18,190]);
  assert.equal(v.cloudEnabled,0);assert.equal(v.cloudStatus,'云端未配置 / 本地会话');
});

test('settlement records once per observed run and same-session best replaces its existing entry',()=>{
  const h=harness(),v=h.vars;v.mode=3;v.score=900;h.tick();assert.equal(v.socialRecordCount,0,'orphan settlement ignored');
  h.begin(1);h.win(120);assert.equal(v.socialRecordCount,1);assert.equal(v.socialRecordedRun,1);
  v.score=999;for(let i=0;i<10;i++)h.tick();assert.equal(h.lists.scoreBank[0],120);
  v.mode=7;h.tick();v.mode=3;h.tick();assert.equal(v.socialRecordCount,1,'reopening settlement does not count again');
  h.begin(1);h.win(100);assert.equal(h.lists.scoreBank[0],120);
  h.begin(1);h.win(240);assert.equal(h.lists.scoreBank[0],240);assert.equal(h.lists.scoreBank[1],-1);
  h.begin(6);h.win(600);assert.equal(h.lists.scoreBank[50],600);assert.equal(h.lists.scoreBank[0],240);
  h.begin(2);v.mode=4;h.tick();v.mode=3;h.tick();assert.equal(h.lists.scoreBank[10],-1,'defeat consumes run');
  const recorded=v.socialRecordCount;v.runId=1;v.mode=2;h.tick();v.mode=3;h.tick();assert.equal(v.socialRecordCount,recorded,'old markers cannot rearm');
});

test('all six levels retain ten deterministic best records without cross-level writes',()=>{
  const h=harness(),v=h.vars;
  // Controlled local fixtures emulate stored pseudonyms; production never
  // rotates identity to invent competitors and normally has one populated row.
  for(let level=1;level<=6;level++) {
    for(let i=0;i<14;i++){v.socialId=100000+i;h.begin(level);h.win(1000+level*100+i);}
    assert.deepEqual(h.lists.scoreBank.slice((level-1)*10,level*10),Array.from({length:10},(_,i)=>1000+level*100+13-i));
    assert.deepEqual(h.lists.scoreNameBank.slice((level-1)*10,level*10),Array.from({length:10},(_,i)=>100013-i));
  }
  v.socialId=100009;h.begin(3);h.win(999999);
  assert.equal(h.lists.scoreBank[20],999999);assert.equal(h.lists.scoreNameBank.slice(20,30).filter(x=>x===100009).length,1);
  v.socialId=100001;h.begin(3);h.win(999999);
  assert.deepEqual(h.lists.scoreNameBank.slice(20,22),[100001,100009],'tie sorted by pseudonym ascending');
  assert.equal(h.lists.scoreBank.length,60);assert.equal(h.lists.scoreNameBank.length,60);
});

test('invalid score, level, identity and run markers fail closed without invalid indices',()=>{
  for(const score of [-1,1000000,NaN,Infinity,-Infinity,4.5]) {
    const h=harness();h.begin();h.win(score);assert.equal(h.vars.socialRecordCount,0);assert.equal(h.lists.scoreBank[0],-1);
    h.vars.score=100;h.tick();assert.equal(h.lists.scoreBank[0],-1,'invalid settlement was already consumed');
  }
  for(const level of [0,7,-1,1.5,NaN,Infinity]) {
    const h=harness();h.begin(level);h.win(100);assert.ok(h.lists.scoreBank.every(x=>x===-1));
  }
  for(const id of [0,99999,1000000,NaN,Infinity,100001.5]) {
    const h=harness();h.vars.socialId=id;h.begin();h.win(100);assert.ok(h.lists.scoreBank.every(x=>x===-1));
  }
  for(const runId of [0,-1,1.5,NaN,Infinity,1000000000]) {
    const h=harness();Object.assign(h.vars,{runId,mode:2});h.tick();h.win(100);assert.equal(h.vars.socialRecordCount,0);
  }
  const h=harness();h.begin(2);h.vars.level=3;h.win(100);assert.equal(h.vars.socialRecordCount,0,'latched level cannot change during a run');
  const zero=harness();zero.begin();zero.win(0);assert.equal(zero.lists.scoreBank[0],0,'zero score is distinct from empty');
});

test('six exact preset sends consume requests and retain exactly the last twelve local messages',()=>{
  const h=harness(),v=h.vars;
  for(let i=0;i<18;i++)h.send(i%6+1,i?30:0);
  assert.deepEqual(h.lists.chatTextBank,Array.from({length:12},(_,i)=>presets[i%6]));
  assert.deepEqual(h.lists.chatSequenceBank,Array.from({length:12},(_,i)=>i+7));
  assert.deepEqual(h.lists.chatSenderBank,Array(12).fill(v.socialId));
  assert.equal(v.messageChoice,0);assert.equal(v.chatSend,0);assert.equal(v.chatSequence,18);
  assert.ok(h.lists.chatTextBank.every(s=>s.length<=16&&presets.includes(s)));
  assert.equal(v.socialNotice,'已加入本地留言（未发送）');
  v.now+=30;v.chatPreset=6;v.chatSend=1;h.tick();assert.equal(h.lists.chatTextBank.at(-1),presets[5]);
  assert.equal(v.chatSend,0);assert.equal(v.inboundText,'');
});

test('cooldown is thirty unpaused timer seconds, no menu/request/init/frame bypass or replay',()=>{
  const h=harness(),v=h.vars;h.send(1);h.send(2,29.99);
  assert.equal(h.lists.chatTextBank.length,1);assert.equal(v.socialCooldown,1);assert.equal(v.messageChoice,0);
  v.now=30;h.tick();assert.equal(h.lists.chatTextBank.length,1,'rejected request not queued');
  h.send(2);assert.equal(h.lists.chatTextBank.length,2);
  v.frames=999999;v.clock=999999;v.dt=100000;h.tick();h.call('td social init');h.send(3);
  assert.equal(h.lists.chatTextBank.length,2);assert.equal(v.socialCooldown,30);
  v.mode=0;v.messageChoice=4;v.now=60;h.tick();assert.equal(v.messageChoice,0);
  v.mode=8;h.tick();assert.equal(h.lists.chatTextBank.length,2,'menu request not replayed');
  h.send(4);assert.equal(h.lists.chatTextBank.length,3);
  v.now=10;h.send(5);assert.equal(v.socialCooldown,30,'timer reset gives no cooldown credit');
  v.now=39.99;h.send(5);assert.equal(h.lists.chatTextBank.length,3);
  v.now=40;h.send(5);assert.equal(h.lists.chatTextBank.length,4);
});

test('invalid timer/request values and sequence exhaustion never allow sends',()=>{
  for(const now of [NaN,Infinity,-Infinity,-1,1000000001]) {
    const h=harness();h.vars.now=now;h.send(1);assert.equal(h.lists.chatTextBank.length,0);
  }
  for(const choice of [-1,7,1.5,NaN,Infinity,'https://example.invalid','加油']) {
    const h=harness();h.send(choice);assert.equal(h.lists.chatTextBank.length,0);assert.equal(h.vars.messageChoice,0);
  }
  const h=harness();h.vars.chatSequence=999999;h.send(1);assert.equal(h.lists.chatTextBank.length,0,'no sequence wrap');
});

test('inbound validation rejects overlength, links, foreign text, whitespace and hidden suffixes',()=>{
  const bad=['','加油加油加油加油加油加油加油加油加','加油 https://example.invalid','https://x.invalid','www.x.invalid',
    '加油\n',' 加油','加油 ','加油\u200b','加油\0','加油😀','<a>加油</a>','QQ123456','你好','ＧＯＯＤ',1,null,{},['加油']];
  for(const text of bad) {
    const h=harness();h.receive(text);assert.equal(h.lists.chatTextBank.length,0,JSON.stringify(text));
    assert.equal(h.vars.chatInbound,0);assert.equal(h.vars.inboundText,'');assert.equal(h.vars.socialRejected,1);
    assert.equal(h.vars.socialCooldown,0,'invalid message cannot consume the send allowance');
  }
  const h=harness();h.receive(presets[1]);assert.deepEqual(h.lists.chatTextBank,[presets[1]]);
  h.receive(presets[2]);assert.equal(h.lists.chatTextBank.length,1,'mailbox obeys the same cooldown');
});

test('foreign session/sender and replayed/out-of-order ingress are rejected',()=>{
  for(const overrides of [{inboundSender:999999},{inboundSession:999999999},{inboundSequence:0},
    {inboundSequence:2},{inboundSequence:1.5},{inboundSequence:NaN},{inboundSequence:Infinity}]) {
    const h=harness();h.receive(presets[0],overrides);assert.equal(h.lists.chatTextBank.length,0);
  }
  const h=harness();h.receive(presets[0]);h.vars.now=30;h.receive(presets[0],{inboundSequence:1});
  assert.equal(h.lists.chatTextBank.length,1);assert.equal(h.vars.chatSequence,1);
  h.receive(presets[2]);assert.equal(h.lists.chatTextBank.length,2,'next valid sequence accepted');
});

test('stamps show all ten ranks and twelve chat slots; corrupt rows and links are never displayed',()=>{
  const h=harness(),v=h.vars;h.begin(6);h.win(600);v.mode=7;
  let text=h.hud();assert.equal(text.filter(s=>/^\d+\.\s/.test(s)).length,10);
  assert.ok(text.some(s=>s.includes('600')));assert.ok(text.includes('云端未配置 / 本地会话'));
   for(const level of [1,2,3,4,5,6]){v.level=level;assert.ok(h.hud().includes(`关卡 ${level}`));}
  h.lists.scoreNameBank[0]='https://example.invalid';h.lists.scoreBank[0]=900;v.level=1;
  assert.ok(!h.hud().some(s=>s.includes('https:')));
  h.send(1);h.send(2,30);h.send(3,30);h.send(4,30);
  h.lists.chatTextBank[0]='加油 https://example.invalid';h.lists.chatSenderBank[1]=999999;
  h.lists.chatSequenceBank[2]=NaN;v.mode=8;text=h.hud();
  assert.equal(text.filter(s=>/^\d+\.\s/.test(s)).length,12);
  assert.ok(!text.some(s=>/https:|P999999|NaN/.test(s)));assert.ok(text.some(s=>s.includes(presets[3])));
   assert.ok(text.includes('预设留言（不发送）'));assert.ok(text.includes('1  加油'));
  assert.ok(h.stamps.every(s=>s.x>=-450&&s.x<=450&&s.y>=-281&&s.y<=281));
  v.mode=2;assert.deepEqual(h.hud(),[],'gameplay HUD remains parent-owned');
});

test('structurally corrupt lists fail closed instead of indexing or accepting extra storage',()=>{
  const h=harness();h.lists.chatTextBank.push('加油');h.send(1);assert.equal(h.vars.chatSequence,0);
  h.vars.mode=8;assert.ok(h.hud().filter(s=>/^\d+\.\s/.test(s)).every(s=>s.endsWith('—')));
  h.lists.scoreBank.pop();h.begin();h.win(100);assert.equal(h.vars.socialRecordCount,0);
  h.vars.mode=7;assert.equal(h.hud().filter(s=>/^\d+\.\s/.test(s)).length,10);
});
