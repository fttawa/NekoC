import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { sampleTransition, transitionKind, StageRenderer } from '../web/renderer.js';
import { partialTransition3Fixtures, recordPartialTransition3 } from '../tools/compat/k4-partial-transition-3-fixtures.mjs';
import { saveJson } from '../tools/compat/k4-oracle.mjs';

const evidence = JSON.parse(await readFile('docs/kitten4-partial-transition-3-evidence.json', 'utf8'));
const close = (a, b, context) => assert.ok(Math.abs(a - b) < 1e-9, `${context}: ${a} != ${b}`);
test('partial-transition-3 fixtures match recorded hashes and are original inline media', async () => {
  const fixtures = await partialTransition3Fixtures();
  assert.equal(Object.keys(fixtures).length, 12);
  for (const [name, project] of Object.entries(fixtures)) {
    const bytes = await readFile(`tests/fixtures/kitten4/partial-transition-3-${name}.bcm`);
    assert.deepEqual(JSON.parse(bytes), project);
    const record = evidence.cases[name];
    assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(record.observations.length, 65);
    assert.deepEqual(record.errors, []);
    assert.equal(record.externalAllowed, 0);
    for (const style of Object.values(project.theatre.styles)) assert.match(style.url, /^data:image\/svg\+xml;base64,/);
  }
});

test('slide, bounce, fade, none and invalid names match all 715 recorded container samples', () => {
  let count = 0;
  for (const [name, record] of Object.entries(evidence.cases)) {
    if (name === 'distrot-left') continue;
    const [kind, direction] = name.split('-');
    for (const observation of record.observations) {
      const state = sampleTransition({ kind, direction }, observation.ms, 960, 720);
      for (const [index, expected] of [state.outgoing, state.incoming].entries()) {
        const actual = observation.scenes[index];
        assert.equal(expected.visible, actual.visible, `${name}/${observation.frame}/visible`);
        for (const key of ['x', 'y', 'alpha']) close(expected[key], actual[key], `${name}/${observation.frame}/${index}/${key}`);
      }
      assert.equal(Boolean(observation.active), state.active && !state.stalled, `${name}/${observation.frame}/active`);
      count++;
    }
  }
  assert.equal(count, 715);
});

test('normalization, endpoint cleanup and screenshot distort are explicit', () => {
  assert.equal(transitionKind({ kind: 'slide_left', direction: 'right' }), 'slide_left');
  assert.equal(transitionKind({ kind: 'bounce', direction: 'up' }), 'bounce_up');
  assert.equal(transitionKind({ kind: 'fadeInOut' }), 'fade_in_out');
  assert.equal(transitionKind({ kind: 'distrot' }), 'distort');
  assert.equal(sampleTransition({ kind: 'slide_left' }, 500, 320, 240).active, true);
  assert.equal(sampleTransition({ kind: 'slide_left' }, 500.01, 320, 240).active, false);
  assert.equal(sampleTransition({ kind: 'bounce_left' }, 1000, 320, 240).active, true);
  assert.equal(sampleTransition({ kind: 'bounce_left' }, 1000.01, 320, 240).active, false);
  assert.equal(sampleTransition({ kind: 'distort' }, 0, 320, 240).screenshots, true);
  assert.equal(sampleTransition({ kind: 'custom' }, 100000, 320, 240).stalled, true);
});

test('container translation and inherited alpha apply per texture without mutating actor tint', () => {
  const calls = {};
  const gl = new Proxy({ drawArrays() {} }, { get: (target, key) => key in target ? target[key] :
    (...values) => { calls[key] = values; } });
  const tint = [0.5, 0.75, 1, 0.8];
  const renderer = { gl, uniform: {}, width: 960, height: 720, stats: { drawCalls: 0 },
    sceneTransform: { x: -720, y: 540, alpha: 0.25 } };
  StageRenderer.prototype.drawTexture.call(renderer, 'texture', 12, 24, 80, 40, 0, tint);
  assert.deepEqual(calls.uniform4fv.slice(1), [[0.5, 0.75, 1, 0.2]]);
  assert.deepEqual(tint, [0.5, 0.75, 1, 0.8]);
});

test('switch keeps the outgoing actor index and owns no CSS animation in K4', () => {
  let animations = 0;
  const renderer = { kitten4: true, sceneId: 'a', scenes: { a: {}, b: { currentStyleId: 'blue' } },
    sprites: [{ id: 'actor' }], spriteIndices: new Map([['actor', 0]]), actorOrder: ['actor'],
    penTexture: 'old-pen', penLayer: 2, transitionClock: () => 123,
    clearSceneTransition: StageRenderer.prototype.clearSceneTransition, usePenSurface() {},
    canvas: { animate() { animations++; } } };
  StageRenderer.prototype.switchScene.call(renderer, 'b', { kind: 'slide_left' });
  assert.equal(renderer.sceneTransition.old.spriteIndices.get('actor'), 0);
  assert.equal(renderer.spriteIndices.size, 0);
  assert.equal(renderer.sceneTransition.old.penTexture, 'old-pen');
  assert.equal(renderer.sceneTransition.start, 123);
  assert.equal(animations, 0);
  StageRenderer.prototype.clearSceneTransition.call(renderer);
  assert.equal(renderer.sceneTransition, null);
});

// Optional real WebGL comparison, but no Rust build and no corpus assets. The
// canonical scene/frame input below is owned fixture data, not oracle positions.
test('partial-transition-3 native ticker pixels vs renderer at fixed clock samples', {
  skip: !process.env.K4_TRANSITION_3_INTEGRATION, timeout: 240000,
}, async () => {
  const source = await readFile('web/renderer.js', 'utf8');
  const penSource = await readFile('web/pen-k4.js', 'utf8');
  const fixtures = await partialTransition3Fixtures(), results = [];
  for (const name of ['slide-left', 'slide-up', 'bounce-down', 'fadeInOut-left', 'slide-invalid']) {
    const project = structuredClone(fixtures[name]), sampled = [];
    // Isolate backdrop/container compositing from actor render-texture upload
    // timing (independent of the transition clock and outside this regression).
    Object.values(project.theatre.actors).forEach(actor => { actor.visible = false; });
    await recordPartialTransition3(project, {
      beforeStart: async page => {
        await page.route('**/partial-transition-3-renderer.js', route => route.fulfill({ contentType: 'application/javascript', body: source }));
        await page.route('**/pen-k4.js', route => route.fulfill({ contentType: 'application/javascript', body: penSource }));
        await page.evaluate(async p => {
          const { StageRenderer } = await import('/partial-transition-3-renderer.js');
          const canvas = document.createElement('canvas');
          const r = new StageRenderer(canvas); r.resolutionScale = 1; r.transitionClock = () => window.__transitionNow;
          const [a, b] = p.theatre.scenes_order, aid = Object.keys(p.theatre.actors)[0];
          const actor = p.theatre.actors[aid];
          const stylesDict = Object.fromEntries(Object.entries(p.theatre.styles).map(([id, s]) => [id, { ...s, centerPoint: s.rotate_center }]));
          await r.load({ _nekocKitten4: {}, stageSize: p.size,
            scenes: { currentSceneId: a, scenesDict: { [a]: { currentStyleId: 'background', actorIds: [aid] }, [b]: { currentStyleId: 'background-b', actorIds: [] } } },
            actors: { actorsDict: { [aid]: { ...actor, currentStyleId: 'costume-a', position: { x: actor.x, y: actor.y }, rotationType: actor.rotation_type } } },
            styles: { stylesDict } });
          window.__partialTransitionRenderer = r;
          window.__partialTransitionProject = p;
        }, project);
      },
      onSample: async (page, frame) => {
        if (![1, 2, 8, 16, 24, 31, 32, 46, 61, 62].includes(frame)) return;
        sampled.push(await page.evaluate(({ frame, name }) => {
          const r = window.__partialTransitionRenderer, p = window.__partialTransitionProject;
          const [kind, direction] = name.split('-');
          if (frame === 1) r.apply({ scene: p.theatre.scenes_order[1], transition: { kind, direction }, sprites: [], order: [] }, new Float32Array());
          else r.render();
          const stage = window.__k4OracleRequire('a1xw').a();
          for (const id of p.theatre.scenes_order) stage.get_scene_by_id(id).on_tick();
          const transition = stage.core.scenes.transition;
          const app = transition.app.get_app(); app.renderer.render(app.stage);
          const read = canvas => {
            const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
            const ctx = c.getContext('2d'); ctx.drawImage(canvas, 0, 0);
            return ctx.getImageData(0, 0, c.width, c.height).data;
          };
          const official = read(app.view), local = read(r.canvas);
          let changed = 0, total = 0; const differences = [];
          // Fixed sparse grid excludes texture and shape boundaries; this tests
          // scene motion/compositing, not unrelated raster edge tolerances.
          for (let y = 17; y < 720; y += 31) for (let x = 19; x < 960; x += 37) {
            const offset = (y * 960 + x) * 4;
            if ([0, 1, 2].some(c => Math.abs(official[offset + c] - local[offset + c]) > 8)) {
              changed++; if (differences.length < 8) differences.push({ x, y, official: Array.from(official.slice(offset, offset + 3)), local: Array.from(local.slice(offset, offset + 3)) });
            }
            total++;
          }
          return { frame, name, changed, total, differences };
        }, { frame, name }));
      },
    });
    assert.equal(sampled.length, 10);
    for (const sample of sampled) assert.ok(sample.changed <= 2, JSON.stringify(sample));
    results.push(...sampled);
  }
  await saveJson('dist/partial-transition-3/pixel-samples.json', {
    schema: 'nekoc-k4-partial-transition-3-pixel-samples-v1', assets: evidence.assets,
    scope: 'owned fixture variants with hidden actor; fixed 598-pixel grid, RGB tolerance 8; not full-frame equality or VM scheduling',
    results,
  });
});
