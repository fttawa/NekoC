import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=a=>a.map(x=>x/Math.hypot(...a));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

function harness(solid) {
  const vars={poly_solid:solid,poly_camera:600,poly_yaw:332,poly_pitch:20,poly_zoom:100,poly_scale:7};
  const lists={},procs={},keys={},cache=new Map(),strokes=[];
  let start,frame,position=[0,0],down=false,size=1,color='';
  const globals={
    getVar:n=>vars[n]??0,setVar:(n,v)=>vars[n]=v,changeVar:(n,v)=>vars[n]=(vars[n]??0)+v,
    deleteListItem:n=>lists[n]=[],appendList:(n,v)=>(lists[n]??=[]).push(v),
    listItem:(n,_,i)=>{assert.ok(i>=1&&i<=lists[n].length,`${n}[${i}]`);return lists[n][i-1];},
    replaceListItem:(n,_,i,v)=>{assert.ok(i>=1&&i<=lists[n].length);lists[n][i-1]=v;},
    listLength:n=>lists[n].length,mathFunc:(name,v)=>Math[name](v),floor:Math.floor,
    listContains:(n,value)=>(lists[n]??[]).includes(value),
    copyList:(from,to)=>lists[to]=[...lists[from]],
    // Match the native runtime's documented two-decimal trig, not ideal JS trig.
    trig:(name,v)=>Math.round(Math[name](v*Math.PI/180)*100)/100,
    defineProc:(name,params,body)=>procs[name]=body,callProc:name=>procs[name](),warp:body=>body(),
    onStart:body=>start=body,forever:body=>frame=body,
    onKey:(key,event,body)=>keys[key]={event:body?event:'down',body:body??event},
    penUp:()=>down=false,penDown:()=>down=true,hide:()=>{},
    setPenColor:value=>color=value,setPenSize:value=>size=value,setPenEffect:()=>{},
    moveTo:(x,y)=>{if(down)strokes.push({from:position,to:[x,y],size,color});position=[x,y];},
    clearDrawing:()=>strokes.length=0,stampText:()=>{},join:(...parts)=>parts.join(''),
    timerStart:()=>{},timerValue:()=>0,
  };
  function load(file) {
    if(cache.has(file))return cache.get(file);
    const exports={};cache.set(file,exports);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    vm.runInNewContext(code,{...globals,exports,require:n=>load(path.resolve(path.dirname(file),n+'.ts'))});
    return exports;
  }
  load(path.resolve('samples/pen_polyhedron.ts'));
  procs['poly build']();
  return {vars,lists,strokes,keys,project:()=>procs['poly project'](),start:()=>start(),frame:()=>frame()};
}

function supportingPlanes(vertices) {
  const faces=new Map();
  for(let a=0;a<vertices.length;a++)for(let b=a+1;b<vertices.length;b++)for(let c=b+1;c<vertices.length;c++){
    let n=cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));
    if(Math.hypot(...n)<1e-7)continue;
    n=normalize(n);let h=dot(n,vertices[a]);
    if(h<0){n=n.map(x=>-x);h=-h;}
    const ds=vertices.map(v=>dot(n,v)-h);
    if(ds.some(d=>d>1e-7))continue;
    const members=ds.flatMap((d,i)=>Math.abs(d)<1e-7?[i]:[]);
    faces.set(members.join(','),{n,h,members});
  }
  return [...faces.values()];
}

for(const solid of [1,2,3,4,5])test(`solid ${solid}: native face banks agree with independent hull and perspective ray occlusion`,()=>{
  const h=harness(solid),v=h.vars,l=h.lists;
  const vertices=l.poly_vx.map((x,i)=>[x,l.poly_vy[i],l.poly_vz[i]]);
  const faces=supportingPlanes(vertices);
  assert.equal(faces.length,v.poly_faces);
  const edges=l.poly_ea.map((a,i)=>[a-1,l.poly_eb[i]-1]);
  for(let i=0;i<edges.length;i++){
    const [a,b]=edges[i],ids=[l.poly_efa[i]-1,l.poly_efb[i]-1];
    assert.notEqual(...ids);
    for(const id of ids){
      const n=[l.poly_fnx[id],l.poly_fny[id],l.poly_fnz[id]],plane=l.poly_fh[id];
      near(Math.hypot(...n),1);near(dot(n,vertices[a]),plane);near(dot(n,vertices[b]),plane);
      assert.ok(vertices.every(vertex=>dot(n,vertex)<=plane+1e-7));
    }
  }
  for(const [yaw,pitch,camera] of [[332,20,600],[0,0,450],[90,0,600],[25,80,450],[205,-60,1200],[145,35,450]]){
    Object.assign(v,{poly_yaw:yaw,poly_pitch:pitch,poly_camera:camera});h.project();
    const rotate=([x,y,z])=>{
      const xx=x*v.poly_cy+z*v.poly_sy,zz=z*v.poly_cy-x*v.poly_sy;
      return [xx,y*v.poly_cp-zz*v.poly_sp,y*v.poly_sp+zz*v.poly_cp];
    };
    const projected=vertices.map(rotate),planes=faces.map(f=>({n:rotate(f.n),h:f.h}));
    projected.forEach((point,i)=>{
      near(Math.hypot(...point),160);
      const t=camera/(point[2]+camera);
      assert.ok(t>0&&Number.isFinite(t));
      assert.equal(l.poly_px[i],Math.floor((578+point[0]*t)/7));
      assert.equal(l.poly_py[i],Math.floor((300-point[1]*t)/7));
    });
    // Clip a ray from the eye to each edge midpoint against the independently
    // reconstructed convex hull. Hidden edges are reached only after entry.
    const eye=[0,0,-camera];
    for(let i=0;i<edges.length;i++){
      const [a,b]=edges[i],mid=projected[a].map((x,k)=>(x+projected[b][k])/2),direction=sub(mid,eye);
      let entry=0;
      for(const plane of planes){
        const denominator=dot(plane.n,direction);
        if(denominator< -1e-7)entry=Math.max(entry,(plane.h-dot(plane.n,eye))/denominator);
      }
      const oracleVisible=entry>=1-1e-7;
      const actual=l.poly_face_visible[l.poly_efa[i]-1]===1||l.poly_face_visible[l.poly_efb[i]-1]===1;
      assert.equal(actual,oracleVisible,`solid=${solid} yaw=${yaw} pitch=${pitch} camera=${camera} edge=${i}`);
    }
  }
});

test('reported cube pose draws nine front/silhouette edges; front-on cube keeps only its near square',()=>{
  const h=harness(2),v=h.vars,l=h.lists;
  const visible=()=>l.poly_efa.filter((f,i)=>l.poly_face_visible[f-1]||l.poly_face_visible[l.poly_efb[i]-1]).length;
  h.project();assert.equal(visible(),9);
  Object.assign(v,{poly_yaw:0,poly_pitch:0});h.project();assert.equal(visible(),4);
  const nearIndices=l.poly_vz.flatMap((z,i)=>z<0?[i]:[]),farIndices=l.poly_vz.flatMap((z,i)=>z>0?[i]:[]);
  const span=ids=>Math.max(...ids.map(i=>l.poly_px[i]))-Math.min(...ids.map(i=>l.poly_px[i]));
  assert.ok(span(nearIndices)>span(farIndices),'near square must be larger, not inverse perspective');
});

for(const [mode,width,height,scale] of [[1,32,20,28],[2,64,40,14],[3,128,80,7],[4,256,160,3.5],[5,448,280,2],[6,896,560,1]]){
  test(`${width}x${height}: native source rasterizes sparse, clipped pixels and uses a bounded brush`,()=>{
    const h=harness(2),v=h.vars,l=h.lists;h.start();assert.equal(v.poly_mode,4,'default should use the new 256x160 grid');
    Object.assign(v,{poly_auto:0,poly_yaw:332,poly_pitch:20});
    const key=h.keys[String(48+mode)];assert.equal(key.event,'up');key.body();h.frame();
    assert.equal(v.poly_width,width);assert.equal(v.poly_height,height);assert.equal(v.poly_scale,scale);
    near(width*scale,896);near(height*scale,560);
    assert.equal(v.poly_visible_edges,9);assert.equal(v.__pd_frames,1);
    assert.equal(v.poly_pixel_count,l.poly_active.length);
    assert.equal(new Set(l.poly_active).size,l.poly_active.length,'shared edge endpoints must not duplicate cells');
    assert.ok(!('poly_front' in l)&&!('poly_back' in l),'no dense screen-sized lists');
    assert.ok(l.poly_active.length<width*height/4,'buffers should contain only occupied line pixels');
    for(const address of l.poly_active){
      assert.ok(Number.isInteger(address)&&address>=1&&address<=width*height);
      const x=(address-1)%width,y=Math.floor((address-1)/width);
      assert.ok(x*scale>=280&&x<width-1&&y*scale>=56&&y*scale<476);
    }
    const ink=h.strokes.filter(s=>s.color==='#62e6ff');
    assert.ok(ink.length>=l.poly_active.length);
    assert.ok(ink.every(s=>s.size<=scale),'fine-grid brush must not exceed one cell');
    h.strokes.length=0;h.frame();
    assert.equal(v.poly_redraw,0);assert.equal(h.strokes.length,0,'unchanged paused frame must not repaint');
    h.keys['72'].body();h.frame();assert.equal(v.poly_visible_edges,12);
    const xrayPixels=new Set(l.poly_active);
    h.strokes.length=0;h.keys['72'].body();h.frame();assert.equal(v.poly_visible_edges,9);
    assert.ok(l.poly_active.length<xrayPixels.size);
    const erase=h.strokes.filter(s=>s.color==='#080c18');
    assert.ok(erase.length>0);assert.ok(erase.every(s=>s.size>scale*Math.SQRT2),'erase must cover old square corners');
    Object.assign(v,{poly_yaw:145,poly_pitch:80,poly_camera:450,poly_zoom:130});h.frame();
    assert.ok(l.poly_active.every(address=>address>=1&&address<=width*height),'extreme pose must stay in buffer');
  });
}
