// Real VM evidence. Never invokes Cargo; --nekoc must point at an existing exe.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { partialEffects9Fixtures } from './k4-partial-effects-9-fixtures.mjs';
import { partialEffects10Fixtures } from './k4-partial-effects-10-fixtures.mjs';
import { visualWork } from './k4-visual.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const exeArg=process.argv.find(a=>a.startsWith('--nekoc=')),exe=path.resolve(exeArg?exeArg.slice(8):'target/debug/k4-trace.exe');
const names=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const round=process.argv.includes('--round10')?10:9;
const source=await readFile('web/renderer.js','utf8'),rendererLfSha256=hash(source.replaceAll('\r\n','\n'));
const report={schema:`nekoc-k4-partial-effects-${round}-pixels-v1`,scope:'real NekoC VM vs official VM; full canvas, no masks; RGB tolerances 0,1,8',executableSha256:hash(await readFile(exe)),rendererLfSha256,cases:{}};
for(const [name,spec]of Object.entries(await (round===10?partialEffects10Fixtures():partialEffects9Fixtures()))){
 if(names.length&&!names.includes(name))continue;
 const file=`tests/fixtures/kitten4/partial-effects-9-${name}.bcm`;
  const result=await visualWork(file,{nekoc:exe,rendererSource:path.resolve('web/renderer.js'),audioMetadata:true,captureFrames:Array.from({length:spec.frames},(_,i)=>i+1),artifactsDir:`dist/partial-effects-${round}/visual`,seed:1,pixelTolerance:0,additionalPixelTolerances:[1,8]});
 report.cases[name]={sha256:hash(JSON.stringify(spec.project,null,2)+'\n'),rendererLfSha256,...result};
 console.log(name,result.status,result.frames?.map(f=>`${f.frame}:${f.additionalTolerances[8].changedPixels}`).join(','),result.error||'');
  await saveJson(`docs/kitten4-partial-effects-${round}-pixels.json`,report);
 if(result.status!=='captured')process.exitCode=1;
}
