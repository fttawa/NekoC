// Original fixtures and read-only official particle observations. No replay solver.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runOracle, saveJson } from "./k4-oracle.mjs";
import { physicsSoftFixtures, actorId } from "./k4-partial-physics-9-fixtures.mjs";
import { loadPlaywright } from "../probe-kitten4.mjs";

export function pointMetrics(actual, expected) {
  if (!actual.length || !expected.length) return null;
  const directed = (a,b) => Math.max(...a.map(p => Math.min(...b.map(q => Math.hypot(p[0]-q[0],p[1]-q[1])))));
  return { actualCount:actual.length, expectedCount:expected.length,
    // This is a point-set diagnostic, NOT same-particle correspondence.
    hausdorffPx:Math.max(directed(actual,expected),directed(expected,actual)),
    indexedMaxPx:actual.length===expected.length ? Math.max(...actual.map((p,i)=>Math.hypot(p[0]-expected[i][0],p[1]-expected[i][1]))) : null };
}

async function main() {
  const executable=process.env.NEKOC_K4_TRACE || "target/debug/k4-trace.exe";
  const out="dist/k4soft";
  const specs=physicsSoftFixtures();
  const browser=await loadPlaywright().chromium.launch({channel:"msedge",headless:true});
  let metadata;
  try {
    const page=await browser.newPage();
    metadata=await page.evaluate(async url=>{
      const img=new Image();img.src=url;await img.decode();
      const c=document.createElement("canvas");c.width=Math.min(128,img.width);c.height=Math.min(128,img.height);
      const ctx=c.getContext("2d");ctx.drawImage(img,0,0,c.width,c.height);
      const rgba=ctx.getImageData(0,0,c.width,c.height).data,bytes=Array(Math.ceil(c.width*c.height/8)).fill(0);
      for(let i=0;i<c.width*c.height;i++)if(rgba[i*4+3]>0)bytes[i>>3]|=1<<(i%8);
      return [{id:"probe-style",width:img.width,height:img.height,mask_width:c.width,mask_height:c.height,mask_bytes:bytes}];
    },specs.coast.project.theatre.styles["probe-style"].url);
  } finally {await browser.close();}
  await saveJson(`${out}/costumes.json`,metadata);
  for(const [name,spec] of Object.entries(specs)) {
    const fixture=`tests/fixtures/kitten4/partial-physics-9-${name}.bcm`;
    const observations=[];
    const official=process.argv.includes("--reuse-official") ? JSON.parse(readFileSync(`${out}/${name}.official.json`)) : await runOracle(spec.project,{frames:spec.frames,virtualTime:true,wallTimeoutMs:45000,onFrame:async(page,frame)=>{
      observations.push(await page.evaluate(({frame,actorId})=>{
        const world=window.__k4OracleRequire("a1xw").a().core.physics.world_list.values().next().value;
        const adapter=world.body_list.get(actorId),body=adapter.physics_body,g=body.particle_group,s=body.particle_system;
        const points=[],velocities=[];
        if(g)for(let i=g.m_firstIndex;i<g.m_lastIndex;i++) {
          points.push([s.m_positionBuffer.data[i].x*10,-s.m_positionBuffer.data[i].y*10]);
          velocities.push([s.m_velocityBuffer.data[i].x*10,-s.m_velocityBuffer.data[i].y*10]);
        }
        return {frame,points,velocities,strength:g?.m_strength ?? null,triads:s?.GetTriadCount?.() ?? null,
          pairs:s?.GetPairCount?.() ?? null,system:s?{radius:s.GetRadius(),stride:s.GetParticleStride(),definition:s.m_def}:null};
      },{frame,actorId}));
    }});
    if(process.argv.includes("--reuse-official"))observations.push(...JSON.parse(readFileSync(`${out}/${name}.particles.json`)));
    await saveJson(`${out}/${name}.official.json`,official);
    await saveJson(`${out}/${name}.particles.json`,observations);
    if(process.argv.includes("--official-only"))continue;
    const report={schema:"nekoc-k4-soft-progress-v1",fixture,
      fixtureSha256:createHash("sha256").update(readFileSync(fixture)).digest("hex"),
      executableSha256:createHash("sha256").update(readFileSync(executable)).digest("hex"),
      assets:official.diagnostics.assets,errors:official.errors,pageErrors:official.diagnostics.pageErrors,
      certification:"partial",sameParticleCorrespondence:false,
      maskScope:"Canvas decoded 128x120 mask; local regular lattice differs from official expanded-contour/Voronoi layout",
      officialInitial:observations[0],frames:[],modes:{}};
    for(const interpreted of [false,true]) {
      const mode=interpreted?"interpreter":"default";
      const local=JSON.parse(execFileSync(executable,[fixture,"--frames",String(spec.frames),"--costumes",`${out}/costumes.json`,"--soft",...(interpreted?["--interpreter"]:[])],{encoding:"utf8",maxBuffer:64*1024*1024}));
      await saveJson(`${out}/${name}.${mode}.json`,local);
      if(local.frames.length!==spec.frames||official.frames.length!==spec.frames)throw Error(`${name}: incomplete trace`);
      const frames=local.frames.map((f,i)=>{
        const a=f.actors[actorId],e=official.frames[i].actors[actorId],p=f.soft["1"].particles?.points || [],o=observations[i];
        return {frame:i+1,centerErrorPx:Math.hypot(a.x-e.x,a.y-e.y),...pointMetrics(p,o.points),officialCount:o.points.length,localCount:p.length};
      });
      report.modes[mode]={frames:frames.length,maxCenterErrorPx:Math.max(...frames.map(f=>f.centerErrorPx)),maxHausdorffPx:Math.max(...frames.map(f=>f.hausdorffPx||0)),sameParticleMaxPx:null};
      if(!interpreted)report.frames=frames;
      console.log(name,mode,JSON.stringify(report.modes[mode]));
    }
    report.witnesses=[1,11,31,32,68,spec.frames].filter(f=>f<=spec.frames).map(frame=>({frame,points:observations[frame-1].points}));
    const json=JSON.stringify(report,null,2)+"\n";
    if(Buffer.byteLength(json)>300000)throw Error("evidence exceeds 300 KB");
    await saveJson(`docs/kitten4-soft-${name}-evidence.json`,report);
  }
}

if(process.argv[1]?.replaceAll("\\","/").endsWith("/k4-soft-compare.mjs"))await main();
