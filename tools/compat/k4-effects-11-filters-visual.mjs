#!/usr/bin/env node
// Real NekoC VM versus official VM. Never builds, synthesizes deltas or masks pixels.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partialEffects11Fixtures, selectEffects11Cases } from './k4-effects-11-fixtures.mjs';
import { visualWork } from './k4-visual.mjs';
import { saveJson } from './k4-oracle.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maxEvidenceBytes = 300000;

async function main() {
  if (process.argv.includes('--help')) {
    console.log('node tools/compat/k4-effects-11-filters-visual.mjs [case ... | --case name[,name] | --case=name]');
    console.log('Requires an existing target/debug/k4-trace.exe; never invokes Cargo. Writes one JSON per case.');
    return;
  }
  const cases = selectEffects11Cases(await partialEffects11Fixtures());
  const executable = path.resolve('target/debug/k4-trace.exe');
  const rendererSource = path.resolve('web/renderer.js');
  const rendererLfSha256 = hash((await readFile(rendererSource, 'utf8')).replaceAll('\r\n', '\n'));
  const executableSha256 = hash(await readFile(executable));
  for (const [name, spec] of cases) {
    const input = `tests/fixtures/kitten4/partial-effects-11-${name}.bcm`;
    await saveJson(input, spec.project);
    const fixtureSha256 = hash(await readFile(input));
    const captureFrames = Array.from({ length: spec.frames }, (_, i) => i + 1);
    const result = await visualWork(input, {
      // Supplying nekoc is essential: visualWork otherwise requests render-only.
      nekoc: executable, rendererSource, audioMetadata: true,
      captureFrames, seed: 1, pixelTolerance: 8,
      artifactsDir: 'dist/k4effects11/filters',
    });
    // visualWork normally builds video masks; these owned SVG-only inputs must
    // compare every pixel. Fail closed if a future harness/input introduces one.
    const complete = result.status === 'captured' && result.frames.length === spec.frames
      && result.frames.every((frame, i) => frame.frame === i + 1 && frame.tolerance === 8
        && frame.maskedPixels === 0 && frame.scope === 'canvas'
        && frame.width > 0 && frame.height > 0 && frame.pixels === frame.width * frame.height);
    const pixelsAgree = complete && result.frames.every(frame => frame.changedPixels === 0);
    // Detect edits during capture rather than binding evidence to a stale hash.
    const identitiesStable = rendererLfSha256 === hash((await readFile(rendererSource, 'utf8')).replaceAll('\r\n', '\n'))
      && executableSha256 === hash(await readFile(executable)) && fixtureSha256 === hash(await readFile(input));
    const evidence = {
      schema: 'nekoc-k4-partial-effects-11-filters-v1',
      scope: 'Real NekoC VM vs official VM; every consecutive frame, full canvas, white composite, RGB tolerance 8, no masks',
      name, type: spec.type, target: spec.target, mode: spec.mode, scopes: spec.scopes,
      artwork: spec.artwork, limitations: spec.limitations, coverageStatus: 'partial',
      executable: 'target/debug/k4-trace.exe', executableSha256, rendererLfSha256,
      fixtureSha256, sha256: fixtureSha256, captureFrames, pixelTolerance: 8,
      operations: spec.operations, ...result,
      status: complete && identitiesStable ? 'captured' : 'unverified',
      ...(!identitiesStable ? { error: 'Executable, renderer or fixture changed during capture' }
        : !complete && !result.error ? { error: 'Incomplete capture or non-full-canvas comparison' } : {}),
      fullCanvasCaptureComplete: complete, identitiesStable, pixelsAgree: pixelsAgree && identitiesStable,
      summary: {
        comparedFrames: result.frames.length,
        differentFrames: result.frames.filter(frame => frame.changedPixels > 0).length,
        maxChangedPixels: result.frames.length ? Math.max(...result.frames.map(frame => frame.changedPixels)) : null,
        maxMae: result.frames.length ? Math.max(...result.frames.map(frame => frame.mae)) : null,
      },
    };
    const bytes = Buffer.byteLength(JSON.stringify(evidence, null, 2) + '\n');
    if (bytes >= maxEvidenceBytes) throw Error(`${name}: evidence ${bytes} bytes exceeds the <300KB limit; raw diagnostics remain in dist`);
    const output = `docs/kitten4-partial-effects-11-${name}.json`;
    await saveJson(output, evidence);
    console.log(name, evidence.status, JSON.stringify({ ...evidence.summary, pixelsAgree: evidence.pixelsAgree, bytes, error: evidence.error }));
    if (!evidence.pixelsAgree) process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
