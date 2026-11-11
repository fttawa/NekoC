#!/usr/bin/env node
// Never builds: use the executable supplied by the coordinating session.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { partialEffects7Fixtures } from './k4-partial-effects-7-fixtures.mjs';
import { visualWork } from './k4-visual.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseline=process.argv.includes('--baseline'),names=process.argv.slice(2).filter(n=>n!=='--baseline');
const dir='dist/partial-effects-7';await mkdir(dir,{recursive:true});
const source=baseline?execFileSync('git',['show','HEAD:web/renderer.js'],{encoding:'utf8'}):await readFile('web/renderer.js','utf8');
const rendererSource=baseline?path.resolve(dir,'baseline-renderer.js'):path.resolve('web/renderer.js');
if(baseline)await writeFile(rendererSource,source);
const reportFile=`docs/kitten4-partial-effects-7-${baseline?'baseline':'pixels'}.json`;
let report;
try{report=names.length?await readJson(reportFile):null;}catch{ /* First selective run. */ }
report??={schema:'nekoc-k4-partial-effects-7-pixels-v1',scope:'real NekoC VM deltas vs official VM; full 960x720 canvas, no masks, RGB tolerance 8',cases:{}};
report.executableSha256=hash(await readFile('target/debug/k4-trace.exe'));
report.rendererLfSha256=hash(source.replace(/\r\n/g,'\n'));
if(baseline)report.baselineCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
for(const [name,spec]of Object.entries(await partialEffects7Fixtures())){
  if(names.length&&!names.includes(name))continue;
  const file=`tests/fixtures/kitten4/partial-effects-7-${name}.bcm`;
  await saveJson(file,spec.project);
  const result=await visualWork(file,{nekoc:path.resolve('target/debug/k4-trace.exe'),rendererSource,audioMetadata:true,captureFrames:Array.from({length:spec.frames},(_,i)=>i+1),artifactsDir:`${dir}/${baseline?'baseline':'visual'}`,seed:1,pixelTolerance:8});
  report.cases[name]={sha256:hash(JSON.stringify(spec.project,null,2)+'\n'),rendererLfSha256:report.rendererLfSha256,...result};
  console.log(name,result.status,result.frames.map(f=>`${f.frame}:${f.changedPixels}`).join(','),result.error||'');
  await saveJson(reportFile,report);
  if(result.status!=='captured')process.exitCode=1;
}
