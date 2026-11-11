#!/usr/bin/env node
// Original focused runner; compares actual k4-trace deltas, including input replay.
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { command } from './k4-diff.mjs';
import { pixelDifference } from './k4-visual.mjs';
import { saveJson, runOracle } from './k4-oracle.mjs';
import { visibility5Fixtures } from './k4-partial-visibility-5-fixtures.mjs';

async function capture(page, official) {
  return page.evaluate(official => {
    let source;
    if (official) {
      const stage = window.__k4OracleRequire('a1xw').a();
      stage.get_scene_by_id(stage.core.scenes.get_current_scene()).on_tick();
      const app = stage.core.app.get_app(); app.renderer.render(app.stage); source = app.view;
    } else { window.renderer.dirty = true; window.renderer.render(); source = window.renderer.canvas; }
    const c = document.createElement('canvas'); c.width = source.width; c.height = source.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(source, 0, 0);
    const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
    let bytes = ''; for (let i = 0; i < rgba.length; i += 8192) bytes += String.fromCharCode(...rgba.subarray(i, i + 8192));
    return { width: c.width, height: c.height, rgba: btoa(bytes), png: c.toDataURL('image/png').split(',')[1] };
  }, official);
}

const selected = process.argv.slice(2);
const fixtures = await visibility5Fixtures();
const report = { schema: 'nekoc-k4-partial-visibility-5-pixels-v1', pixelTolerance: 8,
  clock: 'Native deterministic Clock wall origin pinned to 1024 ms; actual task algorithm unchanged.', works: [] };
for (const [name, item] of Object.entries(fixtures)) {
  if (selected.length && !selected.includes(name)) continue;
  const dir = path.resolve(`dist/partial-visibility-5/visual/${name}`); await mkdir(dir, { recursive: true });
  const fixture = path.resolve(`tests/fixtures/kitten4/partial-visibility-5-${name}.bcm`);
  const exe = path.resolve(process.env.K4_VISIBILITY_EXE || 'target/debug/k4-trace.exe');
  const args = [fixture, '--render', '--frames', String(item.frames), '--seed', '1',
    ...(item.inputScript ? ['--input-script', fixture.replace('.bcm', '-input.json')] : [])];
  const result = { name, status: 'unverified',
    fixtureSha256: createHash('sha256').update(await readFile(fixture)).digest('hex'),
    inputSha256: item.inputScript ? createHash('sha256').update(await readFile(fixture.replace('.bcm', '-input.json'))).digest('hex') : null,
    frames: [] };
  try {
    let rendered = JSON.parse(await command(exe, args)), neko;
    const trace = await runOracle(item.project, { frames: item.frames, seed: 1, inputScript: item.inputScript,
      wallTimeoutMs: 90000, beforeStart: async page => {
        await page.evaluate(() => { window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now = () => 1024; });
        neko = await page.context().newPage();
        await neko.setViewportSize(rendered.project.stageSize);
        await neko.route('**/visibility-stage', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
        for (const file of ['renderer.js', 'pen-k4.js']) await neko.route(`**/${file}`, async route => route.fulfill({
          contentType: 'application/javascript', body: await readFile(`web/${file}`, 'utf8') }));
        await neko.goto(new URL('/visibility-stage', page.url()).href);
        await neko.evaluate(async project => {
          const { StageRenderer } = await import('/renderer.js');
          window.renderer = new StageRenderer(document.querySelector('canvas'));
          window.renderer.resolutionScale = 1; window.renderer.skipVideos = true;
          window.assetErrors = []; window.renderer.onError = e => window.assetErrors.push(e);
          await window.renderer.load(project);
          if (window.assetErrors.length) throw Error(window.assetErrors.join('\n'));
        }, rendered.project);
        const costumes = await neko.evaluate(() => window.renderer.costumeInfo(true).map(c => ({ ...c,
          mask_bytes: [...atob(c.mask)].map(x => x.charCodeAt(0)), rgb_bytes: [...atob(c.rgb)].map(x => x.charCodeAt(0)) })));
        const file = path.join(dir, 'costumes.json'); await saveJson(file, costumes);
        rendered = JSON.parse(await command(exe, [...args, '--costumes', file]));
      }, onFrame: async (page, frame) => {
        const delta = rendered.frames[frame - 1];
        await neko.evaluate(({ frame, lines }) => window.renderer.apply(frame, new Float32Array(lines)), delta);
        const [a, b] = await Promise.all([capture(neko, false), capture(page, true)]);
        if (a.width !== b.width || a.height !== b.height) throw Error(`Canvas dimensions differ: NekoC ${a.width}x${a.height}, official ${b.width}x${b.height}`);
        const metrics = pixelDifference(Buffer.from(a.rgba, 'base64'), Buffer.from(b.rgba, 'base64'), 8);
        for (const [side, image] of [['nekoc', a], ['official', b]]) await writeFile(path.join(dir, `${frame}-${side}.png`), Buffer.from(image.png, 'base64'));
        result.frames.push({ frame, width: a.width, height: a.height, ...metrics });
      } });
    result.assets = trace.diagnostics.assets;
    result.errors = trace.errors; result.pageErrors = trace.diagnostics.pageErrors;
    result.status = result.frames.length === item.frames ? 'compared' : 'unverified';
  } catch (error) { result.error = error.message; }
  report.works.push(result);
  await saveJson('dist/partial-visibility-5/pixels-progress.json', report);
  console.log(name, result.status, result.error || '', result.frames.map(f => f.changedPixels).join(','));
  if (result.status !== 'compared' || result.frames.some(f => f.changedPixels !== 0)) process.exitCode = 1;
}
// A filtered run or failed capture must never replace the complete tracked evidence.
// Nonzero pixel differences are valid observations, not failed captures.
if (!selected.length && report.works.length === Object.keys(fixtures).length &&
    report.works.every(work => work.status === 'compared' && work.frames.length === fixtures[work.name].frames)) {
  const staged = 'dist/partial-visibility-5/pixels-complete.json';
  await saveJson(staged, report);
  await rename(staged, 'docs/kitten4-partial-visibility-5-pixels.json');
}
