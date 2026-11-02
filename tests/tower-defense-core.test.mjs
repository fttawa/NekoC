import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(root,'modules/tower-defense/core.ts'),'utf8');
const compiled=ts.transpile(source.replaceAll('export function','function'));
const enemyNames='eAlive eType eHP eMax eX eY eProgress eSlow eFlash'.split(' ');
const towerNames='tType tLevel tCooldown tShot tTargetX tTargetY tSpent'.split(' ');
// Shared production bank supplied by the parent builder.
const padX=[-330,-320,-310,-160,-160,15,15,180,180,245,-405,250];
const padY=[165,25,-175,-35,175,55,-175,55,-175,165,-50,-25];

function harness({milestone=3,level=1}={}) {
  const vars={milestone,level,quality:1,shakeEnabled:1},lists={padX:[...padX],padY:[...padY]},procs={};
  const procedureStack=[],money=[],spawns=[],leaks=[];
  let warpDepth=0,operations=0;
  function index(name,i) {
    assert.ok(Number.isInteger(i)&&i>=1&&i<=lists[name]?.length,`${name}[${i}] outside pool`);
    return i-1;
  }
  const ctx=vm.createContext({
    getVar:n=>{operations++;return vars[n]??0;},
    setVar:(n,x)=>{
      operations++;if(typeof x==='number')assert.ok(Number.isFinite(x),`${n} must be finite`);
      if(n==='gold')money.push({op:'set',amount:x,procedure:procedureStack.at(-1)});
      vars[n]=x;
    },
    changeVar:(n,x)=>{
      operations++;vars[n]=(vars[n]??0)+x;
      if(n==='gold')money.push({op:'change',amount:x,procedure:procedureStack.at(-1)});
      if(n==='alive'&&x===1)spawns.push({wave:vars.wave,type:lists.eType[vars.tdFree-1]});
      if(n==='lives'&&x<0)leaks.push({wave:vars.wave,type:vars.tdKind,damage:-x});
    },
    listItem:(n,m,i)=>{operations++;assert.equal(m,'any');return lists[n][index(n,i)];},
    listLength:n=>lists[n]?.length??0,
    appendList:(n,x)=>{operations++;(lists[n]??=[]).push(x);},
    replaceListItem:(n,m,i,x)=>{operations++;assert.equal(m,'any');assert.ok(Number.isFinite(x));lists[n][index(n,i)]=x;},
    deleteListItem:(n,m)=>{assert.equal(m,'all');lists[n]=[];},
    defineProc:(n,params,body)=>{
      assert.equal(params.length,0);assert.ok(!procs[n]);
      procs[n]=()=>{procedureStack.push(n);try{body();}finally{procedureStack.pop();}};
    },
    callProc:n=>{assert.ok(warpDepth>0,`${n} called outside warp`);procs[n]();},
    warp:body=>{warpDepth++;try{body();}finally{warpDepth--;}},
    floor:Math.floor,ceil:Math.ceil
  });
  vm.runInContext(compiled,ctx);
  const h={vars,lists,procs,money,spawns,leaks,call:n=>procs[n](),
    tick(dt=0.1){vars.dt=dt;operations=0;procs['td tick']();return operations;},
    build(pad,type=1){vars.buildRequest=pad;vars.selectedTower=type;procs['td build']();},
    enemy(slot,{type=1,hp=100,max=hp,x=-400,y=100,progress=0,slow=0}={}) {
      const data={eAlive:1,eType:type,eHP:hp,eMax:max,eX:x,eY:y,eProgress:progress,eSlow:slow,eFlash:0};
      for(const [name,value] of Object.entries(data))lists[name][slot-1]=value;
      vars.alive=lists.eAlive.filter(Boolean).length;
    }};
  h.call('td reset');
  return h;
}

function near(actual,expected,epsilon=1e-8){assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} != ${expected}`);}

// Campaign policies use only these player inputs. Their read view is copied and
// frozen; neither the policy nor runCampaign receives writable combat arrays.
function campaignController(level) {
  const h=harness({milestone:3,level});
  const inputs=new Set(['dt','selectedPad','selectedTower','buildRequest','upgradeRequest','startWave']);
  return {
    read:()=>Object.freeze({
      level:h.vars.level,mode:h.vars.mode,wave:h.vars.wave,waves:h.vars.waves,ready:h.vars.ready,
      gold:h.vars.gold,lives:h.vars.lives,stars:h.vars.stars,score:h.vars.score,clock:h.vars.clock,
      kills:h.vars.kills,alive:h.vars.alive,spawnLeft:h.vars.spawnLeft,sold:h.vars.sold,
      tType:Object.freeze([...h.lists.tType]),tLevel:Object.freeze([...h.lists.tLevel]),tSpent:Object.freeze([...h.lists.tSpent]),
      bestScore:Object.freeze([...h.lists.bestScore]),bestStars:Object.freeze([...h.lists.bestStars])
    }),
    tick:(dt,requests={})=>{
      for(const [name,value] of Object.entries({...requests,dt})) {
        assert.ok(inputs.has(name),`campaign attempted non-player mutation: ${name}`);
        h.vars[name]=value;
      }
      h.call('td tick');
    },
    audit:()=>structuredClone({money:h.money,spawns:h.spawns,leaks:h.leaks,padX:h.lists.padX,padY:h.lists.padY})
  };
}

const maxTower=(pad,type)=>[[pad,type],[pad,0],[pad,0]];
const supportPlan=[...maxTower(6,4),...maxTower(5,2),...maxTower(8,4),...maxTower(7,3),
  ...maxTower(1,1),...maxTower(9,4),...maxTower(3,3),...maxTower(10,4)];
const campaignPlans={
  pulseFirst:[...maxTower(4,1),...maxTower(2,3),...supportPlan],
  prismFirst:[...maxTower(4,4),...maxTower(2,3),...supportPlan],
  novaPulse:[[2,3],[4,1],[2,0],[2,0],[4,0],[4,0],...supportPlan],
  mixedFirst:[[4,4],[2,3],[4,0],[4,0],[2,0],[2,0],...supportPlan]
};

function runCampaign(level,{dt=.05,plan=campaignPlans.pulseFirst}={}) {
  const c=campaignController(level),initial=c.read(),actions=[],waveResults=[];
  const prices=[[0,0,0],[55,45,70],[70,55,85],[100,75,110],[125,90,135]];
  let next=0,ticks=0,waveStart=0;
  while(c.read().mode===2&&ticks<Math.ceil(1200/dt)) {
    if(c.read().ready) {
      while(next<plan.length) {
        const before=c.read(),[pad,type]=plan[next],tower=before.tType[pad-1],tier=before.tLevel[pad-1];
        const price=type?prices[type][0]:prices[tower][tier];
        assert.ok(price>0,`invalid policy step ${next}`);
        if(before.gold<price)break; // Save for this planned purchase; no fallback spending.
        assert.equal(before.alive,0,'strategy only buys between waves');
        if(type) {
          assert.equal(tower,0);
          c.tick(0,{selectedPad:pad,selectedTower:type,buildRequest:pad});
        } else c.tick(0,{selectedPad:pad,upgradeRequest:1});
        const after=c.read();assert.equal(after.gold,before.gold-price);assert.equal(after.clock,before.clock);
        assert.equal(after.tLevel[pad-1],type?1:tier+1);
        actions.push({beforeWave:before.wave+1,pad,type:type||tower,tier:after.tLevel[pad-1],price,goldAfter:after.gold});
        next++;
      }
      waveStart=c.read().clock;c.tick(0,{startWave:1});
    }
    c.tick(dt);ticks++;
    const current=c.read();assert.ok(current.gold>=0,'economy never overdraws');
    if(current.ready||current.mode!==2)waveResults.push({wave:current.wave,seconds:+(current.clock-waveStart).toFixed(3),
      lives:current.lives,gold:current.gold,kills:current.kills});
  }
  const final=c.read(),audit=c.audit();
  assert.notEqual(final.mode,2,'campaign exceeded 1200 simulated seconds');
  assert.deepEqual(audit.padX,padX);assert.deepEqual(audit.padY,padY);
  const startingAssignments=audit.money.filter(e=>e.op==='set');
  assert.ok(startingAssignments.length>=1&&startingAssignments.every(e=>e.procedure==='td reset'),
    'only the real reset initializes gold; no campaign stat override');
  assert.equal(startingAssignments.at(-1).amount,initial.gold);
  let killGold=0,waveGold=0,spent=0;
  for(const event of audit.money.filter(e=>e.op==='change')) {
    if(event.amount>0) {
      assert.ok(['td damage','td end wave'].includes(event.procedure),'income must come from actual combat');
      if(event.procedure==='td damage')killGold+=event.amount;else waveGold+=event.amount;
    } else {
      assert.ok(['td build','td upgrade'].includes(event.procedure),'campaign only buys/upgrades');
      spent-=event.amount;
    }
  }
  assert.equal(final.gold,initial.gold+killGold+waveGold-spent);
  assert.equal(spent,actions.reduce((sum,a)=>sum+a.price,0));
  assert.equal(spent,final.tSpent.reduce((sum,x)=>sum+x,0));assert.equal(final.sold,0);
  return {
    level,dt,mode:final.mode,wave:final.wave,waves:final.waves,seconds:+final.clock.toFixed(3),lives:final.lives,
    stars:final.stars,score:final.score,gold:final.gold,kills:final.kills,alive:final.alive,spawnLeft:final.spawnLeft,
    bestScore:final.bestScore[level-1],bestStars:final.bestStars[level-1],
    towers:final.tType.flatMap((type,i)=>type?[{pad:i+1,type,tier:final.tLevel[i]}]:[]),
    economy:{starting:initial.gold,killGold,waveGold,spent},actions,waveResults,spawns:audit.spawns,leaks:audit.leaks
  };
}

test('all procedures compile as zero-argument native definitions with explicit warp bodies',()=>{
  const parsed=ts.createSourceFile('core.ts',source,ts.ScriptTarget.Latest,true);
  const definitions=parsed.statements.filter(s=>ts.isExpressionStatement(s)&&ts.isCallExpression(s.expression)&&s.expression.expression.getText(parsed)==='defineProc');
  assert.ok(definitions.length>=6);
  for(const statement of definitions) {
    const call=statement.expression;
    assert.equal(call.arguments[1].elements.length,0);
    assert.equal(call.arguments[2].body.statements.length,1);
    assert.equal(call.arguments[2].body.statements[0].expression.expression.getText(parsed),'warp');
  }
  const tempRoot='D:/AppData/Local/Temp/opencode';
  const temp=fs.mkdtempSync(path.join(fs.existsSync(tempRoot)?tempRoot:root,'td-core-test-'));
  try {
    const output=path.join(temp,'workspace.json');
    execFileSync(process.execPath,[path.join(root,'ts/compile-ts.mjs'),path.join(root,'modules/tower-defense/core.ts'),output],{cwd:root});
    const workspace=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(workspace.summary.procedures,definitions.length);
    const blockCounts=workspace.procedures.map(proc=>Object.keys(proc.workspaceData.blocks).length);
    assert.ok(blockCounts.every(count=>count>1),'each native procedure has an emitted body');
    const totalBlocks=blockCounts.reduce((a,b)=>a+b,0);
    assert.ok(totalBlocks<10000,`unexpected code expansion: ${totalBlocks} blocks`);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('reset applies all six level settings, preserves pad banks and session records',()=>{
  const h=harness(),v=h.vars;
  h.lists.bestScore[2]=12345;h.lists.bestStars[2]=2;
  for(const [i,[waves,gold,scale]] of [[4,180,.85],[5,190,1],[6,210,1.15],[7,230,1.3],[8,250,1.48],[10,280,1.7]].entries()) {
    Object.assign(v,{level:i+1,paused:1,mode:4});h.call('td reset');
    assert.deepEqual([v.level,v.waves,v.gold,v.tdHealthScale,v.lives,v.wave,v.ready,v.mode,v.paused],[i+1,waves,gold,scale,20,0,1,2,0]);
    for(const n of enemyNames)assert.equal(h.lists[n].length,24);
    for(const n of towerNames)assert.equal(h.lists[n].length,12);
    assert.equal(h.lists.bestScore[2],12345);assert.equal(h.lists.bestStars[2],2);
    assert.deepEqual(h.lists.padX,padX);assert.deepEqual(h.lists.padY,padY);
  }
  v.level=99;h.call('td reset');assert.equal(v.level,1);
});

test('build, two upgrades, max-level rejection and 60% cumulative sale follow all four price tables',()=>{
  for(const [i,prices] of [[55,45,70],[70,55,85],[100,75,110],[125,90,135]].entries()) {
    const h=harness(),v=h.vars;v.gold=1000;h.build(1,i+1);
    assert.equal(v.buildRequest,0);assert.equal(h.lists.tLevel[0],1);assert.equal(v.gold,1000-prices[0]);
    h.call('td upgrade');assert.equal(h.lists.tLevel[0],2);
    h.call('td upgrade');assert.equal(h.lists.tLevel[0],3);
    const spent=prices.reduce((a,b)=>a+b,0);assert.equal(h.lists.tSpent[0],spent);assert.equal(v.gold,1000-spent);
    h.call('td upgrade');h.build(1,4);assert.equal(v.gold,1000-spent,'occupied or maxed pad cannot spend again');
    h.call('td sell');assert.equal(v.gold,1000-spent+Math.floor(spent*.6));assert.equal(v.sold,1);
    for(const n of towerNames)assert.equal(h.lists[n][0],0);
    h.call('td sell');assert.equal(v.sold,1,'an empty pad cannot refund twice');
  }
});

test('invalid requests, insufficient gold, pause and completed games cannot mutate economy',()=>{
  const h=harness(),v=h.vars;v.gold=54;h.build(1);assert.equal(h.lists.tType[0],0);
  v.gold=1000;
  for(const pad of [0,13,-1,1.5])h.build(pad);
  for(const type of [0,5,1.5])h.build(1,type);
  assert.equal(v.gold,1000);v.paused=1;h.build(1);h.call('td next wave');assert.equal(v.wave,0);
  v.paused=0;h.build(1);const gold=v.gold;v.gold=44;h.call('td upgrade');assert.equal(h.lists.tLevel[0],1);v.gold=gold;
  v.mode=3;h.call('td upgrade');h.call('td sell');h.build(2);h.call('td next wave');
  assert.equal(v.gold,gold);assert.equal(h.lists.tType[0],1);assert.equal(v.wave,0);
});

test('tick clamps dt and freezes combat during pause and zero-time calls',()=>{
  const h=harness(),v=h.vars;v.frames=120;h.enemy(1);h.tick(1);
  near(h.lists.eProgress[0],3.8);assert.equal(v.dt,.1);
  const progress=h.lists.eProgress[0],clock=v.clock;v.paused=1;h.tick(.1);assert.equal(h.lists.eProgress[0],progress);assert.equal(v.clock,clock);
  v.paused=0;h.tick(-1);h.tick(0);assert.equal(h.lists.eProgress[0],progress);assert.equal(v.simFrames,1);
  assert.equal(v.frames,120,'controller FPS counter has a single owner');
  h.call('td reset');assert.equal(v.frames,120);assert.equal(v.simFrames,0);
});

test('tick dispatches and consumes UI action flags even at dt=0 without double spending',()=>{
  const h=harness(),v=h.vars;v.gold=1000;v.buildRequest=1;h.tick(0);
  assert.equal(h.lists.tType[0],1);assert.equal(v.buildRequest,0);assert.equal(v.gold,945);
  v.upgradeRequest=1;h.tick(0);assert.equal(h.lists.tLevel[0],2);assert.equal(v.upgradeRequest,0);assert.equal(v.gold,900);
  v.sellRequest=1;h.tick(0);assert.equal(h.lists.tType[0],0);assert.equal(v.sellRequest,0);assert.equal(v.gold,960);
  v.startWave=1;h.tick(0);assert.equal(v.wave,1);assert.equal(v.startWave,0);assert.equal(v.alive,0);
  h.tick(0);assert.equal(v.gold,960);assert.equal(v.wave,1);assert.equal(v.simFrames,0);
  h.tick();assert.equal(v.alive,1);
});

test('path reaches all seven corners exactly and leaks at 1340, with guard and boss penalties',()=>{
  const h=harness();
  for(const [progress,x,y] of [[160,-240,100],[370,-240,-110],[540,-70,-110],[780,-70,130],[950,100,130],[1190,100,-110]]) {
    h.enemy(1,{progress:progress-3.8});h.tick();near(h.lists.eProgress[0],progress);near(h.lists.eX[0],x);near(h.lists.eY[0],y);
  }
  for(const [type,damage,speed] of [[1,1,38],[5,2,32],[6,5,21]]) {
    const lives=h.vars.lives;h.enemy(1,{type,progress:1340-speed*.1});h.tick();
    assert.equal(h.vars.lives,lives-damage);assert.equal(h.lists.eAlive[0],0);assert.equal(h.vars.alive,0);
    assert.equal(h.lists.eX[0],250);assert.equal(h.lists.eY[0],-110);assert.equal(h.lists.eProgress[0],1340);
  }
});

test('nearest-to-exit targeting is range-limited and deterministic, with cooldown carry',()=>{
  const h=harness();h.lists.padX[0]=0;h.lists.padY[0]=0;h.build(1);
  h.enemy(1,{x:20,y:0,progress:100});h.enemy(2,{x:100,y:0,progress:200});h.enemy(3,{x:136,y:0,progress:300});
  h.vars.dt=.1;h.call('td towers');assert.deepEqual(h.lists.eHP.slice(0,3),[100,92,100]);near(h.lists.tCooldown[0],.6);
  for(let i=0;i<5;i++)h.call('td towers');assert.equal(h.lists.eHP[1],92);
  h.vars.dt=.100001;h.call('td towers');assert.equal(h.lists.eHP[1],84);
  assert.equal(h.lists.tTargetX[0],100);assert.ok(h.lists.tShot[0]>0);
});

test('all tower levels have specified damage, range and interval; prism ignores heavy armor',()=>{
  const rows=[
    [[8,135,.60],[14,150,.50],[23,165,.42]],
    [[4,120,.85],[7,135,.75],[12,150,.65]],
    [[18,145,1.45],[30,155,1.25],[48,165,1.10]],
    [[32,185,1.65],[52,205,1.40],[82,225,1.20]]
  ];
  for(const [ti,levels] of rows.entries())for(const [li,[damage,range,interval]] of levels.entries()) {
    const h=harness();h.vars.gold=1000;h.lists.padX[0]=0;h.lists.padY[0]=0;h.build(1,ti+1);
    for(let i=0;i<li;i++)h.call('td upgrade');
    h.enemy(1,{type:3,hp:500,x:range,y:0,progress:200});h.enemy(2,{hp:500,x:range+50,y:0,progress:300});
    h.vars.dt=.05;h.call('td towers');near(h.lists.eHP[0],500-damage*(ti===3?1:.65));assert.equal(h.lists.eHP[1],500);
    near(h.lists.tCooldown[0],interval);assert.equal(h.lists.eSlow[0],ti===1?1.2:0);
  }
});

test('splash includes radius 48, excludes 49, applies armor independently and rewards kills once',()=>{
  const h=harness();h.vars.gold=1000;h.lists.padX[0]=0;h.lists.padY[0]=0;h.build(1,3);
  h.enemy(1,{type:3,hp:100,x:100,y:0,progress:400});
  h.enemy(2,{hp:18,x:100,y:48,progress:300});h.enemy(3,{hp:100,x:100,y:49,progress:200});
  h.enemy(4,{hp:100,x:52,y:0,progress:100});h.vars.dt=.1;h.call('td towers');
  near(h.lists.eHP[0],88.3);assert.equal(h.lists.eAlive[1],0);assert.equal(h.lists.eHP[2],100);assert.equal(h.lists.eHP[3],82);
  assert.equal(h.vars.gold,909);assert.equal(h.vars.score,90);assert.equal(h.vars.kills,1);assert.equal(h.vars.alive,3);
  h.vars.tdVictim=2;h.call('td damage');assert.equal(h.vars.gold,909);assert.equal(h.vars.kills,1);
});

test('ice slows by 45%, suppresses regeneration while frozen, and handles expiry within a timestep',()=>{
  const h=harness();h.vars.gold=1000;h.lists.padX[0]=-400;h.lists.padY[0]=100;h.build(1,2);
  h.enemy(1,{type:4,hp:60,max:72});h.vars.dt=.1;h.call('td towers');assert.equal(h.lists.eHP[0],56);assert.equal(h.lists.eSlow[0],1.2);
  h.call('td sell');h.tick();near(h.lists.eProgress[0],1.98);near(h.lists.eHP[0],56);near(h.lists.eSlow[0],1.1);
  h.lists.eSlow[0]=.04;const p=h.lists.eProgress[0];h.tick();near(h.lists.eProgress[0]-p,36*(.1-.45*.04));near(h.lists.eHP[0],56.18);assert.equal(h.lists.eSlow[0],0);
  h.lists.eHP[0]=71.9;h.tick();assert.equal(h.lists.eHP[0],72,'regeneration is capped at maximum health');
});

test('a saturated pool defers spawning without dropping enemies or accumulating catch-up debt',()=>{
  const h=harness();h.call('td next wave');
  for(let i=1;i<=24;i++)h.enemy(i,{progress:0});
  const left=h.vars.spawnLeft;for(let i=0;i<30;i++)h.tick();
  assert.equal(h.vars.spawnLeft,left);assert.equal(h.vars.spawnIndex,0);assert.equal(h.vars.alive,24);assert.equal(h.vars.spawnTimer,0);
  h.lists.eProgress[5]=1339;h.tick();assert.equal(h.vars.spawnLeft,left-1);assert.equal(h.vars.spawnIndex,1);assert.equal(h.vars.alive,24);
  assert.equal(h.lists.eProgress[5],0);assert.equal(h.lists.eAlive[5],1);assert.ok(h.vars.spawnTimer>0);
});

test('milestone gates, wave health scaling and boss composition are deterministic',()=>{
  function collect(milestone,level,wave) {
    const h=harness({milestone,level});h.vars.wave=wave-1;h.call('td next wave');const spawned=[];
    for(let i=0;i<h.vars.waveSize;i++) {
      h.vars.spawnTimer=0;h.call('td spawn');spawned.push([h.lists.eType[0],h.lists.eMax[0]]);
      h.lists.eAlive[0]=0;h.vars.alive=0;
    }
    return {h,spawned};
  }
  const m1=collect(1,6,4);assert.equal(m1.h.vars.level,1);assert.equal(m1.h.vars.waves,4);assert.ok(m1.spawned.every(([type,hp])=>type===1&&hp===Math.ceil(36*.85*1.54)));
  m1.h.vars.gold=1000;m1.h.build(1,2);assert.equal(m1.h.lists.tType[0],0);
  const m2=collect(2,6,4);assert.deepEqual([...new Set(m2.spawned.map(([type])=>type))].sort(),[1,2,3,4,5,6]);
  for(const [level,wave,bosses] of [[1,4,0],[2,5,0],[3,6,1],[4,7,0],[5,8,1],[6,10,2]]) {
    const {h,spawned}=collect(3,level,wave);assert.equal(spawned.filter(([type])=>type===6).length,bosses);
    if(bosses)assert.equal(h.vars.bossAlert,2.4);
  }
});

test('lethal leakage loses before a wave-clear reward; defeat freezes subsequent simulation',()=>{
  const h=harness();h.vars.lives=1;h.vars.wave=4;h.vars.waveActive=1;h.vars.spawnLeft=0;
  h.enemy(1,{progress:1339});const gold=h.vars.gold;h.tick();
  assert.equal(h.vars.mode,4);assert.equal(h.vars.lives,0);assert.equal(h.vars.stars,0);assert.equal(h.vars.ready,0);assert.equal(h.vars.gold,gold);
  const frame=h.vars.simFrames;h.tick();assert.equal(h.vars.simFrames,frame);assert.deepEqual(h.lists.bestStars,[0,0,0,0,0,0]);
});

test('a real undefended campaign loses through ordinary spawning and path movement',()=>{
  const h=harness({milestone:1});let ticks=0;
  while(h.vars.mode===2&&ticks<5000) {
    if(h.vars.ready)h.vars.startWave=1;
    h.tick();ticks++;
  }
  assert.equal(h.vars.mode,4);assert.equal(h.vars.lives,0);assert.equal(h.vars.wave,3);assert.equal(h.vars.kills,0);
  assert.equal(h.vars.stars,0);assert.equal(h.vars.spawnLeft,0);
});

test('complete real four-wave combat wins with towers and persists records across reset',()=>{
  const h=harness({milestone:1});h.build(1);h.build(2);h.build(3);
  let ticks=0;
  while(h.vars.mode===2&&ticks<10000) {
    if(h.vars.ready) {
      // Spend wave/kill earnings on a deterministic legal strategy.
      for(let pad=1;pad<=6;pad++) {
        if(!h.lists.tType[pad-1])h.build(pad);
        h.vars.selectedPad=pad;h.call('td upgrade');h.call('td upgrade');
      }
      h.call('td next wave');
    }
    h.tick();ticks++;
  }
  assert.equal(h.vars.mode,3,`battle did not win after ${ticks} ticks: lives=${h.vars.lives}, wave=${h.vars.wave}`);
  assert.equal(h.vars.wave,4);assert.ok(h.vars.kills>0);assert.equal(h.vars.spawnLeft,0);assert.equal(h.vars.alive,0);
  assert.ok(h.vars.score>2000);assert.equal(h.lists.bestScore[0],h.vars.score);assert.equal(h.lists.bestStars[0],h.vars.stars);
  const record=h.vars.score;h.call('td reset');assert.equal(h.lists.bestScore[0],record);assert.equal(h.vars.score,0);
});

test('stars use lives and sales; records never regress and settlement cannot repeat on ticks',()=>{
  for(const [lives,sold,stars] of [[20,0,3],[18,0,3],[18,1,2],[12,0,2],[11,0,1]]) {
    const h=harness({level:3});Object.assign(h.vars,{wave:6,waveActive:1,spawnLeft:0,lives,sold});
    h.lists.bestScore[2]=99999;h.lists.bestStars[2]=3;h.tick();assert.equal(h.vars.mode,3);assert.equal(h.vars.stars,stars);
    assert.equal(h.lists.bestScore[2],99999);assert.equal(h.lists.bestStars[2],3);
    const score=h.vars.score,gold=h.vars.gold;h.tick();assert.equal(h.vars.score,score);assert.equal(h.vars.gold,gold);
  }
});

for(let level=1;level<=6;level++)test(`campaign balance: sector ${level} wins with legal economy at 25/50/100 ms`,t=>{
  for(const dt of [.025,.05,.1]) {
    const result=runCampaign(level,{dt});
    assert.equal(result.mode,3,`sector ${level}, dt=${dt} lost on wave ${result.wave}`);
    assert.equal(result.wave,result.waves);assert.equal(result.waveResults.length,result.waves);
    assert.equal(result.alive,0);assert.equal(result.spawnLeft,0);assert.equal(result.stars,3);
    assert.equal(result.bestStars,result.stars);assert.equal(result.bestScore,result.score);
    let count=0,waveGold=0,waveScore=0;
    for(let wave=1;wave<=result.waves;wave++) {
      count+=6+wave*2+Math.floor((level-1)*1.5);
      waveGold+=18+wave*5+level*2;waveScore+=wave*100+level*50;
    }
    assert.equal(result.spawns.length,count,'every planned enemy actually spawned');
    assert.equal(result.kills+result.leaks.length,count,'every spawn was killed or leaked through the real path');
    assert.equal(result.spawns.filter(s=>s.type===6).length,[0,0,1,0,1,3][level-1]);
    assert.equal(result.economy.waveGold,waveGold);
    assert.equal(result.score,result.economy.killGold*10+waveScore+result.lives*100+level*500);
    if(process.env.STARHOLD_BALANCE_REPORT==='1') {
      const {spawns,actions,waveResults,...summary}=result;
      t.diagnostic(JSON.stringify(summary));
      if(dt===.05)t.diagnostic(JSON.stringify({level,actions,waveResults}));
    }
  }
});

test('campaign balance: alternative legal openings expose survivable and losing strategies',t=>{
  for(const strategy of ['prismFirst','novaPulse','mixedFirst']) {
    const results=[];
    for(let level=1;level<=6;level++) {
      const r=runCampaign(level,{plan:campaignPlans[strategy]});
      assert.equal(r.mode,strategy==='mixedFirst'&&level===6?4:3,`${strategy} sector ${level}`);
      results.push({level,mode:r.mode,wave:r.wave,seconds:r.seconds,lives:r.lives,stars:r.stars});
    }
    if(process.env.STARHOLD_BALANCE_REPORT==='1')t.diagnostic(JSON.stringify({strategy,results}));
  }
});
