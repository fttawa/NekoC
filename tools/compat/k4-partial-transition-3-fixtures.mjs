#!/usr/bin/env node
// Original workspaces and inline artwork. Vendor code is neither copied nor saved.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';

const b = (id, type, fields = {}, inputs = {}) => ({ id, type, fields, inputs, statements: {} });
const num = n => b('', 'math_number', { NUM: String(n) });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
export async function partialTransition3Fixtures() {
  const base = (await visualFixtures()).upright;
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const sid = base.theatre.scenes_order[0], next = '10000000-0000-4000-8000-000000000002';
  const aid = Object.keys(base.theatre.actors)[0];
  const cases = {};
  for (const [transition, direction] of [
    ...['slide', 'bounce'].flatMap(kind => ['up', 'down', 'left', 'right'].map(dir => [kind, dir])),
    ['fadeInOut', 'left'], ['distrot', 'left'], ['none', 'left'], ['slide', 'invalid'],
  ]) {
    const p = structuredClone(base);
    p.project_name = `NekoC partial-transition-3 ${transition}-${direction}`;
    p.theatre.scenes_order.push(next);
    p.theatre.scenes[next] = { ...structuredClone(p.theatre.scenes[sid]), id: next,
      name: 'Transition B', screen_name: 'Transition B', actors: [], group_order: [],
      styles: ['background-b'], current_style_id: 'background-b' };
    p.theatre.styles['background-b'] = { ...p.theatre.styles.background, id: 'background-b', name: 'blue',
      url: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="960" height="720" fill="#2050c0"/></svg>').toString('base64') };
    p.theatre.actors[aid].block_data_json = workspace([chain(b('start', 'start_on_click'),
      b('transition', 'set_scene_transition', { transition, direction }),
      b('switch', 'switch_to_screen', {}, { screen: num(2) }))], schema);
    cases[`${transition}-${direction}`] = p;
  }
  return cases;
}

export async function recordPartialTransition3(project, { inspect = false, beforeStart, onSample } = {}) {
  const observations = [];
  const trace = await runOracle(project, { frames: 65, virtualTime: true, wallTimeoutMs: 60000,
    beforeStart: async page => {
      await beforeStart?.(page);
      await page.evaluate(() => {
      // Animation time is an explicit diagnostic input, not an assertion that the
      // browser's real performance clock is coupled to RuntimeManager updates.
      window.__transitionNow = 0;
      Object.defineProperty(performance, 'now', { value: () => window.__transitionNow, configurable: true });
      });
    },
    onFrame: async (page, frame) => {
      observations.push(await page.evaluate(({ frame, inspect }) => {
      const stage = window.__k4OracleRequire('a1xw').a();
      const manager = stage.core.scenes, transition = manager.transition;
      const app = transition.app.get_app();
      // Stop automatic scheduling: advance the *native* PIXI ticker at the same
      // controlled timestamp once per sample, without an extra VM update.
      app.ticker.stop();
      window.__transitionNow = (frame - 1) * 1000 / 60;
      app.ticker.update(window.__transitionNow);
      const container = transition.app.get_scene_container();
      const state = node => node ? { x: node.x, y: node.y, alpha: node.alpha, visible: node.visible } : null;
      return { frame, ms: window.__transitionNow, current: manager.get_current_scene(),
        scenes: container.children.filter(node => node.id).map(node => ({ id: node.id, ...state(node) })),
        order: container.children.filter(node => node.id).map(node => node.id),
        active: transition.tl.get_cache_size(),
        ...(transition.out_sprite ? { out: state(transition.out_sprite), incoming: state(transition.in_sprite),
          angles: [transition.out_sprite.filters[0].angle, transition.in_sprite.filters[0].angle] } : {}),
        ...(inspect && frame === 1 ? { keys: { manager: Object.keys(manager), transition: Object.keys(transition),
          ticker: { lastTime: app.ticker.lastTime, started: app.ticker.started } } } : {}) };
      }, { frame, inspect }));
      await onSample?.(page, frame);
    },
  });
  return { observations, trace };
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-transition-3-evidence-v1',
    clock: 'performance.now = (frame-1)*1000/60; native PIXI ticker.update; no extra VM update', cases: {} };
  for (const [name, project] of Object.entries(await partialTransition3Fixtures())) {
    if (process.env.K4_TRANSITION_CASE && name !== process.env.K4_TRANSITION_CASE) continue;
    await saveJson(`tests/fixtures/kitten4/partial-transition-3-${name}.bcm`, project);
    if (!process.argv.includes('--record')) continue;
    const { observations, trace } = await recordPartialTransition3(project, { inspect: process.argv.includes('--inspect') });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      observations, errors: trace.errors,
      externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length };
    console.log(name, JSON.stringify(observations.filter(o => [1, 2, 16, 31, 32, 61, 62, 65].includes(o.frame))));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-transition-3-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
