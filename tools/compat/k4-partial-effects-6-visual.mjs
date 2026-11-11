#!/usr/bin/env node
// No build: visualWork directly uses the already-built k4-trace executable.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { partialEffects6Fixtures, fixtureHash } from './k4-partial-effects-6-fixtures.mjs';
import { visualWork } from './k4-visual.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';

const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const rendererLfDigest=async()=>createHash('sha256').update((await readFile('web/renderer.js','utf8')).replace(/\r\n/g,'\n')).digest('hex');
const names=process.argv.slice(2);
const report=names.length?await readJson('docs/kitten4-partial-effects-6-pixels.json'):{schema:'nekoc-k4-partial-effects-6-pixels-v1',
  scope:'real VM deltas; full 960x720 canvas; RGB tolerance 8; no masks; virtual VM Date, native effect renderer',
  executableSha256:await digest('target/debug/k4-trace.exe'),rendererSha256:await digest('web/renderer.js'),cases:{}};
report.rendererSha256=await digest('web/renderer.js');
report.rendererLfSha256=await rendererLfDigest();
for(const [name,spec]of Object.entries(await partialEffects6Fixtures())){
  if(names.length&&!names.includes(name))continue;
  const file=`tests/fixtures/kitten4/partial-effects-6-${name}.bcm`;
  const result=await visualWork(file,{nekoc:path.resolve('target/debug/k4-trace.exe'),audioMetadata:true,captureFrames:Array.from({length:spec.frames},(_,i)=>i+1),
    artifactsDir:'dist/partial-effects-6/visual',seed:1,pixelTolerance:8});
  // Keep errors and failures, not only successful screenshots.
  report.cases[name]={sha256:fixtureHash(spec.project),rendererSha256:await digest('web/renderer.js'),...result};
  console.log(name,result.status,result.frames.map(f=>`${f.frame}:${f.changedPixels}`).join(','),result.error||'');
  await saveJson('docs/kitten4-partial-effects-6-pixels.json',report);
  if(result.status!=='captured')process.exitCode=1;
}
