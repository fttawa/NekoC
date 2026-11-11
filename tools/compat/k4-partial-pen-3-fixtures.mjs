#!/usr/bin/env node
// Original offline brush probes. No vendor implementation or corpus assets.
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
const move = (id, x, y) => b(id, 'self_move_to', {}, { x: num(x), y: num(y) });
const size = n => b('size', 'self_set_pen_size', {}, { size: num(n) });
const alpha = n => b('alpha', 'self_set_pen_color_property', { scope: 'alpha' }, { val: num(n) });
const color = c => b('color', 'self_set_pen_color', { color: c });
const down = () => b('down', 'self_pen_down');
const up = () => b('up', 'self_pen_up');
const begin = id => b(id, 'set_pen_path', { point: 'start_point' });
const close = id => b(id, 'set_pen_path', { point: 'end_point' });

export async function partialPen3Fixtures() {
  const base = (await visualFixtures()).pen;
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const aid = Object.keys(base.theatre.actors)[0];
  const cases = {};
  const make = (name, nodes, x = -120, y = 30) => {
    const p = structuredClone(base);
    p.project_name = `NekoC partial pen 3 ${name}`;
    Object.assign(p.theatre.actors[aid], { x, y });
    p.theatre.actors[aid].block_data_json = workspace([chain(b('start', 'start_on_click'), ...nodes)], schema);
    cases[name] = p;
  };
  make('opaque-endpoints', [color('#204060'), size(20), down(), move('move', -20, 30), up()]);
  make('alpha-endpoints', [color('#204060'), size(20), alpha(50), down(), move('move', -20, 30), up()]);
  make('alpha-corner', [color('#204060'), size(20), alpha(50), down(), move('east', -20, 30), move('north', -20, 130), up()]);
  make('same-position', [size(20), alpha(50), down(), move('same', -120, 30), up()]);
  make('repeated-down-zero', [size(20), alpha(50), down(), b('again', 'self_pen_down'), up()], 0, 0);
  make('repeated-down-nonzero', [size(20), alpha(50), down(), b('again', 'self_pen_down'), up()]);
  make('fractional-width', [color('#204060'), size(1.5), down(), move('move', -20.25, 30.5), up()], -120.25, 30.5);
  make('fill-pen-up', [color('#204060'), alpha(75), begin('begin'), move('east', -20, 30),
    move('north', -20, 130), close('close'), close('second-close')]);
  make('fill-restart', [begin('begin'), move('discarded', -60, 30), begin('restart'),
    move('east', 40, 30), move('north', 40, 130), color('#305070'), close('close')]);
  make('fill-self-intersection', [b('fill', 'set_fill_style', { color: '#60a020' }), begin('begin'),
    move('a', -20, 130), move('b', -120, 130), move('c', -20, 30), close('close')]);
  make('mixed-stamps', [color('#204060'), size(10), down(), move('east', -20, 30),
    b('text', 'stamp', { align: 'left' }, { text: text('NekoC'), size: num(18) }),
    begin('begin'), move('north', -20, 130), b('image', 'image_stamp'), move('west', -120, 130), close('close'), up()]);
  return cases;
}

export async function recordPen3(project) {
  const observations = [];
  const trace = await runOracle(project, { frames: 3, seed: 1, wallTimeoutMs: 60000,
    beforeStart: async page => page.evaluate(() => {
      const req = window.__k4OracleRequire, stage = req('a1xw').a();
      const aid = Object.keys(req('ALsR').a.get_state().theatre_states.actors)[0];
      const proto = Object.getPrototypeOf(stage.get_actor_by_id(aid).get_brush());
      window.__pen3Calls = [];
      for (const method of ['draw_line', 'draw_fill_pattern', 'draw_text_stamp', 'draw_image_stamp']) {
        const original = proto[method];
        proto[method] = function (...args) {
          const previous = window.__pen3Active;
          window.__pen3Active = method;
          try { return original.apply(this, args); }
          finally { window.__pen3Active = previous; }
        };
      }
      for (const method of ['beginPath', 'arc', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillText', 'drawImage']) {
        const original = CanvasRenderingContext2D.prototype[method];
        CanvasRenderingContext2D.prototype[method] = function (...args) {
          if (window.__pen3Active) {
            const m = this.getTransform();
            window.__pen3Calls.push({ brush: window.__pen3Active, method,
              args: method === 'drawImage' ? args.slice(1) : args, width: this.lineWidth,
              cap: this.lineCap, join: this.lineJoin, alpha: this.globalAlpha, color: this.fillStyle,
              matrix: [m.a, m.b, m.c, m.d, m.e, m.f] });
          }
          return original.apply(this, args);
        };
      }
    }),
    onFrame: async (page, frame) => observations.push(await page.evaluate(frame => {
      const req = window.__k4OracleRequire, stage = req('a1xw').a();
      const aid = Object.keys(req('ALsR').a.get_state().theatre_states.actors)[0];
      const brush = stage.get_actor_by_id(aid).get_brush();
      const points = [[-120,30],[-129,30],[-70,30],[-20,30],[-11,30],[-70,60],[-20,80],[0,0],[0,30]];
      const samples = points.map(([x,y]) => ({ x, y, rgba: [...brush.ctx.getImageData(480+x,360-y,1,1).data] }));
      return { frame, calls: window.__pen3Calls, samples, size: brush.get_size() };
    }, frame)),
  });
  return { observations, assets: trace.diagnostics.assets, errors: trace.errors,
    externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length };
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-pen-3-v1', cases: {} };
  for (const [name, project] of Object.entries(await partialPen3Fixtures())) {
    const file = `tests/fixtures/kitten4/partial-pen-3-${name}.bcm`;
    await saveJson(file, project);
    if (!process.argv.includes('--record')) continue;
    const result = await recordPen3(project);
    evidence.assets = result.assets;
    delete result.assets;
    evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'), ...result };
    console.log(name, 'calls', result.observations[0].calls.length, 'samples', JSON.stringify(result.observations[0].samples));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-pen-3-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
