import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const sub = (a,b) => a.map((x,i)=>x-b[i]);
const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => Math.sqrt(dot(a,a));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);

for (const [solid,F,V,E,sides,degree] of [[1,4,4,6,3,3],[2,6,8,12,4,3],[3,8,6,12,3,4],[4,12,20,30,5,3],[5,20,12,30,3,5]]) {
  test(`Platonic solid ${F}: regular convex faces, equal edges, correct incidence`, () => {
    const vars={poly_solid:solid}, lists={}, cache=new Map();
    const globals={
      getVar:n=>vars[n], setVar:(n,v)=>{vars[n]=v;}, mathFunc:(_,v)=>Math.abs(v),
      deleteListItem:n=>{lists[n]=[];}, appendList:(n,v)=>lists[n].push(v),
      listLength:n=>lists[n].length,
      listItem:(n,_,i)=>{assert.ok(i>=1&&i<=lists[n].length);return lists[n][i-1];},
      replaceListItem:(n,_,i,v)=>{assert.ok(i>=1&&i<=lists[n].length);lists[n][i-1]=v;},
    };
    function load(file) {
      if(cache.has(file))return cache.get(file);
      const exports={}; cache.set(file,exports);
      const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
      vm.runInNewContext(code,{...globals,exports,require:n=>load(path.resolve(path.dirname(file),n+".ts"))});
      return exports;
    }
    load(path.resolve("modules/pen-display/platonic.ts")).buildPlatonic();
    assert.equal(vars.poly_faces,F); assert.equal(vars.poly_vertex_count,V); assert.equal(vars.poly_edge_count,E);
    const vertices=lists.poly_vx.map((x,i)=>[x,lists.poly_vy[i],lists.poly_vz[i]]);
    const edges=lists.poly_ea.map((a,i)=>[a-1,lists.poly_eb[i]-1]);
    const lengths=edges.map(([a,b])=>norm(sub(vertices[a],vertices[b])));
    lengths.forEach(l=>near(l,lengths[0])); vertices.forEach(v=>near(norm(v),160));
    for(let i=0;i<V;i++)assert.equal(edges.filter(e=>e.includes(i)).length,degree);
    // Recover supporting planes independently, without assuming the face count.
    const faces=new Map();
    for(let a=0;a<V;a++)for(let b=a+1;b<V;b++)for(let c=b+1;c<V;c++) {
      const n=cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));
      if(norm(n)<1e-6)continue;
      const distances=vertices.map(v=>dot(n,sub(v,vertices[a]))/norm(n));
      if(distances.some(d=>d>1e-6)&&distances.some(d=>d< -1e-6))continue;
      const indices=distances.flatMap((d,i)=>Math.abs(d)<1e-6?[i]:[]);
      faces.set(indices.join(","),indices);
    }
    assert.equal(faces.size,F);
    const incidence=edges.map(()=>0);
    for(const indices of faces.values()) {
      assert.equal(indices.length,sides);
      const center=[0,1,2].map(axis=>indices.reduce((s,i)=>s+vertices[i][axis],0)/sides);
      const radii=indices.map(i=>norm(sub(vertices[i],center)));
      radii.forEach(r=>near(r,radii[0]));
      const boundary=edges.filter(([a,b],i)=>{
        if(indices.includes(a)&&indices.includes(b)){incidence[i]++;return true;} return false;
      });
      assert.equal(boundary.length,sides);
      for(const i of indices)assert.equal(boundary.filter(e=>e.includes(i)).length,2);
    }
    incidence.forEach(count=>assert.equal(count,2));
    assert.equal(V-E+F,2);
  });
}
