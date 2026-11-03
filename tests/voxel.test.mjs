import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';

function harness(deferred=false){
  const project=JSON.parse(fs.readFileSync('samples/pencraft.bcmkn','utf8'));
  const vars={},lists={},procs={},keys=new Set(),strokes=[],paint=[];
  let pen=false,moved=false,x=0,y=0;
  for(const x of Object.values(project.variables.variablesDict))if(x.type==='list')lists[x.name]=structuredClone(x.value);
  const g={getVar:n=>vars[n]??0,setVar:(n,x)=>vars[n]=x,changeVar:(n,x)=>vars[n]=(vars[n]??0)+x,
    listItem:(n,m,i)=>lists[n]?.[i-1]??0,listLength:n=>lists[n]?.length??0,listContains:(n,x)=>lists[n]?.includes(x)??false,
    appendList:(n,x)=>(lists[n]??=[]).push(x),insertList:(n,i,x)=>(lists[n]??=[]).splice(i-1,0,x),
    replaceListItem:(n,m,i,x)=>{assert.ok(i>=1&&i<=lists[n].length,`${n}[${i}]`);lists[n][i-1]=x;},
    deleteListItem:(n,m,i)=>{if(m==='all')lists[n]=[];else lists[n].splice(i-1,1);},
    defineProc:(n,p,f)=>procs[n]=f,callProc:n=>procs[n](),warp:f=>f(),wait:()=>{},floor:Math.floor,ceil:Math.ceil,
    mathFunc:(n,x)=>Math[n](x),trig:(n,x)=>Math[n](x*Math.PI/180),keyPressed:k=>keys.has(k),join:(...x)=>x.join(''),
    selectText:(s,a,b)=>String(s).slice(a-1,b),toNumber:Number,
    clearDrawing:()=>{if(deferred)assert.equal(vars.presenting,1);paint.push(['clear']);},
    penUp:()=>{if(pen&&!moved)paint.push(['line',x,y,x,y]);pen=false;},penDown:()=>{pen=true;moved=false;},
    setPenColor:()=>{},setPenEffect:()=>{},setPenSize:size=>paint.push(['size',size]),stampText:(s,size,align)=>paint.push(['text',x,y,s,size,align]),
    moveTo:(nx,ny)=>{assert.ok(Number.isFinite(nx)&&Number.isFinite(ny));if(pen){paint.push(['line',x,y,nx,ny]);moved=true;}x=nx;y=ny;strokes.push([x,y]);}};
  const context=vm.createContext(g);
  let source=['state','world','game','render'].map(n=>fs.readFileSync(`modules/voxel/${n}.ts`,'utf8').replace(/^import .*?;\s*/gm,'').replaceAll('export function','function')).join('\n');
  if(deferred)source=execFileSync('python',['-c','import sys,importlib; m=importlib.import_module("tools.build-pencraft"); print(m.deferred_source(sys.stdin.read()))'],{input:source,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
  vm.runInContext(ts.transpile(source),context);
  return {vars,lists,keys,strokes,paint,procs,call:n=>procs[n]()};
}
test('spawn collision, jump and wall collision',()=>{
  const h=harness(),v=h.vars;h.call('mc respawn');v.dt=0.05;
  for(let i=0;i<20;i++)h.call('mc physics');
  assert.ok(v.grounded===1);assert.ok(v.py>=3.9&&v.py<=4.1);
  h.keys.add('32');h.call('mc physics');h.keys.clear();assert.ok(v.py>4);
  for(let i=0;i<60;i++)h.call('mc physics');assert.ok(v.grounded===1);
  v.testx=5.5;v.testy=4;v.testz=7.5;h.call('mc collision');assert.equal(v.blocked,1);
});

test('near-plane clipped ground and rotated geometry produce finite strokes',()=>{
  const h=harness(),v=h.vars;h.call('mc respawn');Object.assign(v,{dt:0.016,quality:6,view:11,daylight:100,selected:2});
  h.call('mc physics');h.call('mc render');
  assert.ok(v.faces>10);assert.ok(v.strokes>50);
  assert.ok(h.strokes.some(([x,y])=>Math.abs(x)<300&&y< -100),'ground reaches lower viewport');
  v.yaw=127;v.pitch=-65;h.call('mc physics');h.call('mc render');assert.ok(v.faces>0);
});

test('affine face corners match independent world-to-camera projection',()=>{
  const h=harness(),v=h.vars;h.call('mc respawn');
  Object.assign(v,{view:9,daylight:100,oi:1});h.lists.order=[1];h.lists.depth=[5];
  h.procs['mc polygon']=()=>{};
  for(const [yaw,pitch] of [[0,-12],[127,-65],[-89,42]]) {
    const rad=Math.PI/180;Object.assign(v,{sy:Math.sin(yaw*rad),cy:Math.cos(yaw*rad),sp:Math.sin(pitch*rad),cp:Math.cos(pitch*rad)});
    Object.assign(v,{cysp:v.cy*v.sp,cycp:v.cy*v.cp,sysp:v.sy*v.sp,sycp:v.sy*v.cp});
    for(let d=0;d<6;d++) {
      Object.assign(h.lists,{mx:[4],my:[3],mz:[7],md:[d],mu:[3],mv:[2],mt:[1],ma:[1]});
      h.call('mc face');
      for(const [i,[u,w]] of [[0,0],[3,0],[3,2],[0,2]].entries()) {
        let x=4,y=3,z=7;
        if(d<2){x+=d===0?1:0;z+=u;y+=w;}
        else if(d<4){y+=d===2?1:0;x+=u;z+=w;}
        else{z+=d===4?1:0;x+=u;y+=w;}
        const dx=x-v.px,dy=y-v.py-1.55,dz=z-v.pz,f=dx*v.sy+dz*v.cy;
        const expected=[dx*v.cy-dz*v.sy,dy*v.cp-f*v.sp,dy*v.sp+f*v.cp];
        ['vx','vy','vz'].forEach((n,a)=>assert.ok(Math.abs(h.lists[n][i]-expected[a])<1e-10,`direction ${d}, corner ${i}, ${n}`));
      }
    }
  }
});

test('deferred presentation preserves strokes and text, rejects overflow before clearing',()=>{
  const direct=harness(),deferred=harness(true);
  for(const h of [direct,deferred]) {
    h.call('mc respawn');Object.assign(h.vars,{dt:0.016,quality:10,view:9,daylight:100,selected:2,help:1});
    h.call('mc physics');h.call('mc render');
  }
  assert.deepEqual(deferred.paint,direct.paint);
  assert.equal(deferred.vars.presenting,0);assert.equal(deferred.vars.frames,1);
  assert.equal(deferred.vars.paintindex,deferred.vars.paintcount+1);
  deferred.paint.length=0;deferred.lists.paintop=new Array(8193).fill(1);deferred.call('mc present');
  assert.equal(deferred.paint.length,0,'keep last complete frame if command limit exceeded');
  assert.equal(deferred.vars.frames,1);
});
test('editing rebuilds exposed surfaces and inventory/crafting consume items',()=>{
  const h=harness(),v=h.vars;
  v.ex=7;v.ey=3;v.ez=4;v.newblock=0;h.call('mc edit');
  assert.equal(h.lists.world[4+16*3][7],'0');
  assert.ok(h.lists.mx.some((x,i)=>x===7&&h.lists.my[i]===2&&h.lists.mz[i]===4&&h.lists.md[i]===2),'hole exposes underlying stone');
  const count=h.lists.mx.length;v.newblock=1;h.call('mc edit');assert.ok(h.lists.mx.length<=count);
  h.call('mc respawn');v.sy=0;v.cy=1;v.sp=0;v.cp=1;v.tool=0;v.craft=1;h.lists.bag[3]=3;
  h.call('mc interact');assert.equal(v.tool,1);assert.equal(h.lists.bag[3],0);
  v.craft=1;h.call('mc interact');assert.equal(v.tool,1,'cannot craft without resources');
  v.food=10;v.apples=1;v.eat=1;h.call('mc interact');assert.equal(v.food,15);assert.equal(v.apples,0);
});

test('incremental surface cuts preserve the exact exposed voxel boundary',()=>{
  const h=harness(),v=h.vars;
  const block=(x,y,z)=>x<0||x>=16||z<0||z>=16||y<0?3:y>=12?0:Number(h.lists.world[z+16*y][x]);
  const check=()=>{
    const actual=new Set(),expected=new Set();
    for(let i=0;i<h.lists.mx.length;i++)for(let u=0;u<h.lists.mu[i];u++)for(let w=0;w<h.lists.mv[i];w++){
      let x=h.lists.mx[i],y=h.lists.my[i],z=h.lists.mz[i];const d=h.lists.md[i];
      if(d<2){z+=u;y+=w;}else if(d<4){x+=u;z+=w;}else{x+=u;y+=w;}
      const key=[x,y,z,d,h.lists.mt[i]].join(',');assert.ok(!actual.has(key),`duplicate ${key}`);actual.add(key);
    }
    for(let y=0;y<12;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++){
      const material=block(x,y,z);if(!material)continue;
      for(let d=0;d<6;d++)if(!block(x+h.lists.nx[d],y+h.lists.ny[d],z+h.lists.nz[d]))expected.add([x,y,z,d,material].join(','));
    }
    assert.deepEqual(actual,expected);
  };
  check();
  for(const [x,y,z,m] of [[7,3,4,0],[8,3,4,0],[7,3,4,1],[5,4,7,0],[3,4,3,0],[4,4,3,4],[4,4,3,0],[8,3,4,2]]){
    Object.assign(v,{ex:x,ey:y,ez:z,newblock:m});h.call('mc edit');check();
  }
});

test('lantern registration, hostile occlusion, damage, attack, and respawn',()=>{
  const h=harness(),v=h.vars;h.call('mc respawn');
  Object.assign(v,{ex:7,ey:4,ez:6,newblock:7});h.call('mc edit');assert.equal(h.lists.lampx.length,1);
  v.newblock=0;h.call('mc edit');assert.equal(h.lists.lampx.length,0);
  Object.assign(v,{enemyx:7.5,enemyy:4,enemyz:4.5});h.call('mc enemy visibility');assert.equal(v.enemyvisible,1);
  Object.assign(v,{px:5.5,pz:5.5,enemyx:5.5,enemyz:8.5});h.call('mc enemy visibility');assert.equal(v.enemyvisible,0,'tree blocks line of sight');
  h.call('mc respawn');Object.assign(v,{enemyx:7.5,enemyy:4,enemyz:4.5,enemyalive:1,enemyhp:6,clock:90,dt:0.05,food:10,nextdamage:0,tool:1});
  h.call('mc survival');assert.equal(v.hp,18);v.attack=1;h.call('mc survival');assert.equal(v.enemyhp,3);
  v.attack=1;h.call('mc survival');assert.equal(v.enemyalive,0);
  v.hp=0;h.call('mc respawn');assert.equal(v.hp,20);assert.equal(v.food,20);
});
