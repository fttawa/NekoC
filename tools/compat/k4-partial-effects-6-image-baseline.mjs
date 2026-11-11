#!/usr/bin/env node
// Isolated baseline from this worktree's starting commit. Never edits renderer.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { command } from './k4-diff.mjs';
import { saveJson } from './k4-oracle.mjs';
import { visualWork } from './k4-visual.mjs';
import { partialEffects6Fixtures, fixtureHash } from './k4-partial-effects-6-fixtures.mjs';

const commit=(await command('git',['rev-parse',process.argv[2]||'d2d277bc62f7536d77797e0a8660ef73055465dd'])).trim();
const source=await command('git',['show',`${commit}:web/renderer.js`]);
await mkdir('dist/partial-effects-6/baseline',{recursive:true});
const rendererSource=path.resolve('dist/partial-effects-6/baseline/renderer.js');await writeFile(rendererSource,source);
const report={schema:'nekoc-k4-partial-effects-6-image-baseline-v1',commit,
  rendererSha256:createHash('sha256').update(source).digest('hex'),cases:{}};
const fixtures=await partialEffects6Fixtures();
for(const name of ['image-alpha','image-pivot-rotate']){
  report.cases[name]=await visualWork(`tests/fixtures/kitten4/partial-effects-6-${name}.bcm`,{
    nekoc:path.resolve('target/debug/k4-trace.exe'),audioMetadata:true,rendererSource,
    captureFrames:[1,3,5,12],pixelTolerance:8,artifactsDir:'dist/partial-effects-6/baseline',
  });
  report.cases[name].sha256=fixtureHash(fixtures[name].project);
  console.log(name,report.cases[name].status,report.cases[name].frames.map(f=>`${f.frame}:${f.changedPixels}`));
}
await saveJson('docs/kitten4-partial-effects-6-image-baseline.json',report);
