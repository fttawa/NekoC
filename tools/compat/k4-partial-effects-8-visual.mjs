// Real VM pixel evidence; deliberately never starts a Cargo build.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { partialEffects8Fixtures } from './k4-partial-effects-8-fixtures.mjs';
import { visualWork } from './k4-visual.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseline=process.argv.includes('--baseline'),names=process.argv.slice(2).filter(n=>n!=='--baseline');
const dir='dist/partial-effects-8';await mkdir(dir,{recursive:true});
const source=baseline?execFileSync('git',['show','6aaa205:web/renderer.js'],{encoding:'utf8'}):await readFile('web/renderer.js','utf8');
const rendererSource=baseline?path.resolve(dir,'baseline-renderer.js'):path.resolve('web/renderer.js');
if(baseline)await writeFile(rendererSource,source);
const reportFile=`docs/kitten4-partial-effects-8-${baseline?'baseline':'pixels'}.json`;
let report;try{report=names.length?await readJson(reportFile):null;}catch{/* first run */}
report??={schema:'nekoc-k4-partial-effects-8-pixels-v1',scope:'real NekoC VM vs official VM; full canvas, no masks; tolerance 0 AND 8 measured separately',cases:{}};
report.executableSha256=hash(await readFile('target/debug/k4-trace.exe'));
report.rendererLfSha256=hash(source.replace(/\r\n/g,'\n'));
if(baseline)report.baselineCommit=execFileSync('git',['rev-parse','6aaa205'],{encoding:'utf8'}).trim();
for(const [name,spec]of Object.entries(await partialEffects8Fixtures())){
  if(names.length&&!names.includes(name))continue;
  const file=`tests/fixtures/kitten4/partial-effects-8-${name}.bcm`;
  const result=await visualWork(file,{nekoc:path.resolve('target/debug/k4-trace.exe'),rendererSource,audioMetadata:true,captureFrames:Array.from({length:spec.frames},(_,i)=>i+1),artifactsDir:`${dir}/${baseline?'baseline':'visual'}`,seed:1,pixelTolerance:0,additionalPixelTolerances:[1,8]});
  report.cases[name]={sha256:hash(JSON.stringify(spec.project,null,2)+'\n'),rendererLfSha256:report.rendererLfSha256,...result};
  console.log(name,result.status,result.frames?.map(f=>`${f.frame}:${f.changedPixels}/${f.mae}`).join(','),result.error||'');
  await saveJson(reportFile,report);
  if(result.status!=='captured')process.exitCode=1;
}
