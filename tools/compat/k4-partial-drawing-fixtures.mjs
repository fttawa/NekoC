#!/usr/bin/env node
// Original fixtures; observe calls to the official brush's real Canvas context.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b = (id, type, fields = {}, inputs = {}) => ({ id, type, fields, inputs, statements: {} });
const num = n => b('', 'math_number', { NUM: String(n) });
const text = s => b('', 'text', { TEXT: s });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const ratio = (a, c) => b('', 'math_arithmetic', { OP: 'DIVIDE' }, { A: num(a), B: num(c) });
const stamp = (id, size, align = 'center', value = text('NekoC')) => b(id, 'stamp', { align }, { text: value, size });

export async function partialDrawingFixtures() {
  const base = (await visualFixtures()).stamp;
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const aid = Object.keys(base.theatre.actors)[0], sid = base.theatre.scenes_order[0];
  const cases = {};
  const make = (name, nodes, scene = false) => {
    const p = structuredClone(base);
    p.project_name = `NekoC partial drawing ${name}`;
    p.variables = { tail: { id: 'tail', name: 'tail', value: 0, type: 'number', is_global: true,
      current_entity: aid, visible: false, position: { x: 0, y: 0 } } };
    p.variable_order = ['tail'];
    p.theatre.actors[aid].block_data_json = workspace([], schema);
    p.theatre.scenes[sid].block_data_json = workspace([], schema);
    const owner = scene ? p.theatre.scenes[sid] : p.theatre.actors[aid];
    owner.block_data_json = workspace([chain(b('start', 'start_on_click'), ...nodes,
      b('tail', 'variables_set', { VAR: 'tail' }, { VALUE: num(1) }))], schema);
    cases[name] = p;
    return p;
  };
  make('text-sizes', [0, 0.5, 1, 24.5, 1001, 10001].map((v, i) => stamp(`stamp-${i}`, num(v))));
  make('text-types', [stamp('string-size', text('24')), stamp('nan', ratio(0, 0)),
    stamp('positive-infinity', ratio(1, 0)), stamp('negative-infinity', ratio(-1, 0)),
    stamp('number-text', num(20), 'left', num(123)), stamp('empty-text', num(20), 'right', text(''))]);
  make('text-align', ['left', 'center', 'right', 'unknown', ''].map((v, i) => stamp(`align-${i}`, num(25), v)));
  const img = make('image-state', [b('opacity', 'self_set_effect_2', { scope: '1' }, { val: num(75) }),
    b('brightness', 'self_set_effect_2', { scope: '2' }, { val: num(150) }), b('image', 'image_stamp')]);
  Object.assign(img.theatre.actors[aid], { x: 12.25, y: -15.75, scale: 123.4, rotation_type: 2,
    horizontal_flipped: true });
  img.theatre.styles['costume-a'].rotate_center = { x: 13, y: -7 };
  for (const type of ['stamp', 'image_stamp', 'self_set_pen_size', 'self_pen_down', 'clear_drawing']) {
    make(`scene-${type}`, [type === 'stamp' ? stamp('scene-command', num(20)) :
      b('scene-command', type, {}, type === 'self_set_pen_size' ? { size: num(5) } : {})], true);
  }
  make('pen-sizes', [b('size', 'self_set_pen_size', {}, { size: num(5000) }),
    b('increase', 'self_change_pen_size_2', { increase: 'increase' }, { steps: num(10000) }),
    b('decrease', 'self_change_pen_size_2', { increase: 'decrease' }, { steps: num(20000) }),
    b('string', 'self_set_pen_size', {}, { size: text('250') }),
    b('infinity', 'self_set_pen_size', {}, { size: ratio(1, 0) })].flatMap((node, i) =>
      [node, b(`pen-wait-${i}`, 'wait', {}, { time: num(0) })]));
  for (const [transition, direction] of [['distrot', 'left'], ['fadeInOut', 'right'], ['bounce', 'up'],
    ['slide', 'down'], ['slide', 'invalid'], ['none', 'invalid'], ['', ''], ['custom', 'diagonal']]) {
    make(`transition-${transition || 'empty'}-${direction || 'empty'}`, [
      b('transition', 'set_scene_transition', { transition, direction })]);
  }
  return cases;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-drawing-evidence-v1', cases: {} };
  for (const [name, project] of Object.entries(await partialDrawingFixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-drawing-${name}.bcm`, project);
    if (!process.argv.includes('--record')) continue;
    const observations = [];
    const options = { frames: name === 'pen-sizes' ? 18 : 3, seed: 1, wallTimeoutMs: 60000,
      beforeStart: async page => page.evaluate(() => {
        const req = window.__k4OracleRequire, stage = req('a1xw').a();
        window.__drawingCalls = [];
        const ids = Object.keys(req('ALsR').a.get_state().theatre_states.actors);
        const proto = Object.getPrototypeOf(stage.get_actor_by_id(ids[0]).get_brush());
        for (const method of ['draw_text_stamp', 'draw_image_stamp']) {
          const original = proto[method];
          proto[method] = function (...args) {
            window.__drawingActive = true;
            try { return original.apply(this, args); }
            finally { window.__drawingActive = false; }
          };
        }
        {
          const ctx = CanvasRenderingContext2D.prototype;
          for (const method of ['fillText', 'drawImage']) {
            const original = ctx[method];
            ctx[method] = function (...args) {
              const m = this.getTransform();
              if (window.__drawingActive) window.__drawingCalls.push({ method, args: method === 'drawImage' ? args.slice(1) : args,
                font: this.font, align: this.textAlign, color: this.fillStyle, alpha: this.globalAlpha,
                matrix: [m.a, m.b, m.c, m.d, m.e, m.f] });
              return original.apply(this, args);
            };
          }
        }
      }),
      onFrame: async (page, frame) => observations.push(await page.evaluate(frame => {
        const req = window.__k4OracleRequire, stage = req('a1xw').a();
        const ids = Object.keys(req('ALsR').a.get_state().theatre_states.actors);
        return { frame, calls: window.__drawingCalls, transition: stage.core.scenes.transition_type ?? null,
          sizes: ids.map(id => stage.get_actor_by_id(id).get_brush().get_size()) };
      }, frame)),
    };
    let trace, diagnostics;
    try { trace = await runOracle(project, options); diagnostics = trace.diagnostics; }
    catch (error) {
      if (!name.startsWith('scene-') || !error.diagnostics?.partialTrace?.errors?.length) throw error;
      trace = error.diagnostics.partialTrace; diagnostics = error.diagnostics;
    }
    evidence.assets = diagnostics.assets;
    evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      observations, variables: trace.frames.map(f => f.variables), errors: trace.errors,
      externalAllowed: diagnostics.externalRequests.filter(r => r.action !== 'blocked').length };
    console.log(name, JSON.stringify(evidence.cases[name]));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-drawing-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
