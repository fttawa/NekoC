// Expand the strict-threshold clock-origin counterexample, without changing the
// native task, scheduler or block implementation. Native clock input only.
import { createHash } from 'node:crypto';
import { shake8Fixtures } from './k4-shake-8-fixtures.mjs';
import { runOracle, saveJson } from './k4-oracle.mjs';
const fixtures=await shake8Fixtures();
const evidence={schema:'nekoc-k4-shake-9-v1',fps:60,seed:1,frames:40,originsMs:[0,.1,1024,1000000],cases:{}};
for(const name of ['single-0.14','single-0.23','single-0.4','sequential']){
 const project=fixtures[name],entry=evidence.cases[name]={fixture:`tests/fixtures/kitten4/shake-8-${name}.bcm`,sha256:createHash('sha256').update(JSON.stringify(project,null,2)+'\n').digest('hex'),origins:{}};
 for(const origin of evidence.originsMs){
  const trace=await runOracle(project,{frames:evidence.frames,seed:1,beforeStart:page=>page.evaluate(ms=>{window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now=()=>ms;},origin)});
  evidence.assets=trace.diagnostics.assets;
  entry.origins[origin]={variables:trace.frames.map(f=>f.variables),actors:trace.frames.map(f=>Object.fromEntries(Object.entries(f.actors).map(([id,a])=>[id,{x:a.x,y:a.y}]))),errors:trace.errors,pageErrors:trace.diagnostics.pageErrors,externalAllowed:trace.diagnostics.externalRequests.filter(r=>r.action!=='blocked').length};
  await saveJson(`dist/shake-9/${name}-${origin}-official.json`,trace);
  console.log(name,origin,trace.frames.map(f=>Object.values(f.actors)[0].x).join(','));
 }
 await saveJson('docs/kitten4-shake-9-evidence.json',evidence);
}
