#!/usr/bin/env node
// No builds: compare the supplied VM executable with actual offline-player canvases.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { command } from './k4-diff.mjs';
import { pixelDifference } from './k4-visual.mjs';
import { saveJson, runOracle } from './k4-oracle.mjs';
import { property6Fixtures } from './k4-partial-properties-6-fixtures.mjs';

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

const report = { schema: 'nekoc-k4-partial-properties-6-pixels-v1', pixelTolerance: 8, clockOriginMs: 1024, works: [] };
for (const [name, project] of Object.entries(await property6Fixtures())) {
  const dir = path.resolve(`dist/partial-properties-6/visual/${name}`); await mkdir(dir, { recursive: true });
  const fixture = path.resolve(`tests/fixtures/kitten4/partial-properties-6-${name}.bcm`);
  const exe = path.resolve(process.env.K4_PROPERTIES_EXE || 'target/debug/k4-trace.exe');
  const args = [fixture, '--render', '--frames', '24', '--seed', '1'];
  const result = { name, status: 'unverified',
    fixtureSha256: createHash('sha256').update(await readFile(fixture)).digest('hex'), frames: [] };
  try {
    let rendered = JSON.parse(await command(exe, args)), neko;
    const trace = await runOracle(project, { frames: 24, seed: 1, wallTimeoutMs: 90000,
      beforeStart: async page => {
        await page.evaluate(() => { window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now = () => 1024; });
        neko = await page.context().newPage();
        await neko.setViewportSize(rendered.project.stageSize);
        await neko.route('**/properties-stage', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
        for (const file of ['renderer.js', 'pen-k4.js']) await neko.route(`**/${file}`, async route => route.fulfill({
          contentType: 'application/javascript', body: await readFile(`web/${file}`, 'utf8') }));
        await neko.goto(new URL('/properties-stage', page.url()).href);
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
        await neko.evaluate(({ frame, lines }) => window.renderer.apply(frame, new Float32Array(lines)), rendered.frames[frame - 1]);
        const [a, b] = await Promise.all([capture(neko, false), capture(page, true)]);
        if (a.width !== b.width || a.height !== b.height) throw Error('Canvas dimensions differ');
        const metrics = pixelDifference(Buffer.from(a.rgba, 'base64'), Buffer.from(b.rgba, 'base64'), 8);
        for (const [side, image] of [['nekoc', a], ['official', b]]) await writeFile(path.join(dir, `${frame}-${side}.png`), Buffer.from(image.png, 'base64'));
        result.frames.push({ frame, width: a.width, height: a.height, ...metrics });
      } });
    result.assets = trace.diagnostics.assets;
    result.errors = trace.errors; result.pageErrors = trace.diagnostics.pageErrors;
    result.externalAllowed = trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length;
    result.status = result.frames.length === 24 ? 'compared' : 'unverified';
  } catch (error) { result.error = error.message; }
  report.works.push(result);
  await saveJson('dist/partial-properties-6/pixels-progress.json', report);
  console.log(name, result.status, result.error || '', result.frames.map(f => f.changedPixels).join(','));
  if (result.status !== 'compared' || result.frames.some(f => f.changedPixels !== 0)) process.exitCode = 1;
}
if (report.works.length === 8 && report.works.every(w => w.status === 'compared')) {
  await saveJson('docs/kitten4-partial-properties-6-pixels.json', report);
}
