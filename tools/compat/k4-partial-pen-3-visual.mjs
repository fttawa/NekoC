#!/usr/bin/env node
// Compare real VM deltas. With the integrated renderer record the final result;
// on an older renderer create an isolated candidate in ignored dist/.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { visualWork } from './k4-visual.mjs';
import { saveJson } from './k4-oracle.mjs';

const dir = path.resolve('dist/partial-pen-3');
await mkdir(dir, { recursive: true });
const renderer = await readFile('web/renderer.js', 'utf8');
const pen = (await readFile('web/pen-k4.js', 'utf8')).replaceAll('export function', 'function');
// Inject on the no-import baseline only. Once integrated, run k4-visual directly.
const integrated = renderer.includes('drawK4PenLines');
const anchor = '  drawLines(start,count){';
if (!renderer.includes(anchor)) throw Error('Renderer drawLines anchor changed');
const candidate = integrated ? renderer : pen + '\n' + renderer.replace(anchor,
  anchor + '\n    if(this.kitten4)return drawK4PenLines(this,this.k4PenLines,start,count);')
  .replace('  apply(frame, lines, present = true) {', '  apply(frame, lines, present = true) {\n    this.k4PenLines=lines;');
const candidateFile = path.join(dir, 'renderer-candidate.js');
const baselineFile = path.join(dir, 'renderer-baseline.js');
await writeFile(candidateFile, candidate);
await writeFile(baselineFile, renderer);
const report = { schema: 'nekoc-k4-partial-pen-3-visual-v1', works: [] };
const names = process.argv.slice(2);
for (const name of names.length ? names : ['opaque-endpoints', 'alpha-endpoints', 'alpha-corner',
  'same-position', 'fractional-width', 'fill-pen-up', 'fill-self-intersection', 'mixed-stamps',
  'repeated-down-zero', 'repeated-down-nonzero', 'fill-restart']) {
  for (const [variant, rendererSource] of integrated ? [['integrated', path.resolve('web/renderer.js')]] : [['baseline', baselineFile], ['candidate', candidateFile]]) {
    const result = await visualWork(`tests/fixtures/kitten4/partial-pen-3-${name}.bcm`, {
      nekoc: path.resolve('target/debug/k4-trace.exe'), rendererSource, captureFrames: [1],
      artifactsDir: path.join(dir, variant), seed: 1, pixelTolerance: 8,
    });
    report.works.push({ name, variant, ...result });
    console.log(name, variant, result.status, result.frames[0]?.changedPixels, result.error || '');
    await saveJson(path.join(dir, 'visual.json'), report);
    if (result.status !== 'captured') process.exitCode = 1;
  }
}
