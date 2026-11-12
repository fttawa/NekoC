#!/usr/bin/env node
// Offline, read-only official sampling. Screenshots stay ignored; JSON holds observations only.
import { k4cloudFixtures } from './k4cloud-fixtures.mjs';
import { runOracle, saveJson } from './k4-oracle.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const evidence = { schema: 'nekoc-k4cloud-evidence-v1', scope: 'anonymous offline; all external requests blocked; not online or pixel parity', cases: {} };
for (const [name, { project, labels, frames }] of Object.entries(await k4cloudFixtures())) {
  const samples = [];
  const directory = `dist/k4cloud/official/${name}`;
  await mkdir(directory, { recursive: true });
  let previousStep;
  const trace = await runOracle(project, { frames, blocks: true, wallTimeoutMs: 90000,
    onFrame: async (page, frame) => {
      const sample = await page.evaluate(() => {
        const state = window.__k4OracleRequire('ALsR').a.get_state();
        const stage = window.__k4OracleRequire('a1xw').a();
        const app = stage.core.app.get_app();
        app.renderer.render(app.stage);
        const texts = [], widgets = [];
        function visit(node, path = '', visible = true) {
          visible = visible && node.visible !== false && node.renderable !== false && node.alpha !== 0;
          if (node.text !== undefined && visible) texts.push({ text: node.text, path, x: node.x, y: node.y });
          if (['shared', 'personal', 'items'].includes(node.id)) {
            const { x, y, width, height } = node.getBounds();
            widgets.push({ id: node.id, visible, x: node.x, y: node.y, bounds: { x, y, width, height } });
          }
          for (const [i, child] of (node.children || []).entries()) visit(child, `${path}/${child.name || i}`, visible);
        }
        visit(app.stage);
        const monitors = Object.fromEntries(Object.entries(window.CmCloud.db.get_variables()).map(([id, v]) => [id, { visible: v.visible, position: v.position, scale: v.scale, offset: v.offset }]));
        return { ranking: state.ranking_state, monitors, stageTexts: texts, stageWidgets: widgets,
          domText: document.body.innerText, rankingDomCount: document.querySelectorAll('[class*="ranking"], [class*="Ranking"]').length };
      });
      samples.push({ frame, ...sample });
      const step = await page.evaluate(() => window.__k4Oracle.heart.get_runtime_manager().get_variable('step'));
      if (step !== previousStep && ['monitors', 'ranking'].includes(name)) {
        const png = await page.screenshot({ animations: 'disabled' });
        await writeFile(`${directory}/step-${step}.png`, png);
        samples.at(-1).screenshot = { path: `${directory}/step-${step}.png`, sha256: createHash('sha256').update(png).digest('hex') };
      }
      previousStep = step;
    } });
  await saveJson(`tests/fixtures/kitten4/k4cloud-${name}.bcm`, project);
  evidence.assets = trace.diagnostics.assets;
  evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'), labels,
    frames: trace.frames.map((f, index) => ({ frame: f.frame, variables: f.variables,
      ...(['monitors', 'ranking'].includes(name) ? samples[index] : {}) })),
    executedBlocks: [...new Set(trace.events.filter(e => e.event === 'block').map(e => e.block))],
    errors: trace.errors, pageErrors: trace.diagnostics.pageErrors, externalRequests: trace.diagnostics.externalRequests };
  console.log(`${name}: ${trace.frames.length} frames, ${trace.errors.length} errors`);
}
await saveJson('docs/k4cloud-evidence.json', evidence);
