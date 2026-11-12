import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deviceFixtures } from '../tools/compat/k4-device-fixtures.mjs';
import { deviceBlocks, deviceSourceFacts } from '../tools/compat/k4-device-source.mjs';
import { devicePlans, validateDeviceScript, recordDeviceEvidence } from '../tools/compat/k4-device-evidence.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';
import { archiveDeviceEvidence, compareDeviceFrames, differences, normalizeVibration } from '../tools/compat/k4-device-compare.mjs';
import { createHash } from 'node:crypto';

test('device fixture generator is byte-stable and covers all ten requested blocks', async () => {
  const fixtures = await deviceFixtures();
  for (const [name, project] of Object.entries(fixtures)) {
    assert.deepEqual(await readJson(`tests/fixtures/kitten4/device-${name}.bcm`), project);
  }
  const types = new Set(Object.values(fixtures).flatMap(p => Object.values(p.theatre.actors)
    .flatMap(x => Object.values(x.block_data_json.blocks).map(b => b.type))));
  for (const type of deviceBlocks) assert.ok(types.has(type), type);
});

test('device InputScript contract uses the outer time and rejects malformed device inputs', () => {
  const valid = { schema: 'nekoc-input-v1', events: [{ frame: 2, time_ms: 20, type: 'device_motion', x: 1, y: 2, z: 3 }] };
  assert.deepEqual(validateDeviceScript(valid, 2), valid);
  for (const event of [
    { frame: 1, time_ms: 0, type: 'device_motion', x: 1, y: NaN, z: 3 },
    { frame: 1, time_ms: 0, type: 'device_orientation', beta: 1, gamma: 2, portrait: 1 },
    { frame: 1, time_ms: 0, type: 'mobile_button', device: 'mobile_1', event: 'click', button: 1 },
    { frame: 1, time_ms: 0, type: 'unknown' },
    { frame: 1, time_ms: 0, type: 'device', kind: 'device_motion', x: 1, y: 2, z: 3 },
  ]) assert.throws(() => validateDeviceScript({ schema: 'nekoc-input-v1', events: [event] }, 1));
  assert.throws(() => validateDeviceScript({ schema: 'invalid', events: [] }));
});

test('plans use explicit frame/time and preserve duplicate events for debounce evidence', () => {
  const plans = devicePlans();
  for (const plan of Object.values(plans)) validateDeviceScript({ schema: 'nekoc-input-v1', events: plan.events }, plan.frames);
  assert.equal(plans.duplicate.events.length, 4);
  assert.equal(plans.actions.events.find(e => e.type === 'mobile_button').button, 'a');
  assert.ok(plans.actions.events.every(e => !Object.hasOwn(e, 'kind')));
});

test('device comparison keeps all actor fields/types and the fixed absolute tolerance', () => {
  const frame = { frame: 1, variables: { v: [1, 'x'] }, actors: { a: { id: 'a', x: 0, rotation: 0, visible: true } }, k4_media_output: [] };
  const compare = changed => compareDeviceFrames([frame], [changed]);
  assert.ok(compare(structuredClone(frame)).equal);
  let changed = structuredClone(frame); changed.actors.a.x = 1e-6;
  assert.ok(compare(changed).equal);
  changed.actors.a.x = 1.01e-6;
  assert.equal(compare(changed).firstDifference.field, 'actors.a.x');
  changed = structuredClone(frame); changed.actors.a.rotation = 360;
  assert.ok(!compare(changed).equal);
  changed = structuredClone(frame); changed.variables.v[0] = '1';
  assert.equal(compare(changed).firstDifference.field, 'variables.v[0]');
  changed = structuredClone(frame); delete changed.actors.a.id;
  assert.equal(compare(changed).firstDifference.field, 'actors.a.id');
  assert.equal(differences([1], [1, 2])[0].field, '.length');
  assert.equal(compareDeviceFrames([frame], []).firstDifference.field, 'frame_count');
  assert.deepEqual(normalizeVibration(-500), [-500]);
  assert.deepEqual(normalizeVibration([]), []);
  const vibration = { ...frame, k4_media_output: [{ kind: 'vibrate', pattern_ms: [123] }] };
  assert.ok(compareDeviceFrames([vibration], [{ ...vibration, k4_media_output: [{ kind: 'vibrate', pattern_ms: 123 }] }]).equal);
});

test('committed offline archive binds original fixture bytes, origins, and per-frame official outputs', async () => {
  const archive = await readJson('docs/kitten4-device-evidence.json');
  assert.equal(archive.schema, 'nekoc-k4-device-regression-v1');
  assert.equal(archive.tolerance, 1e-6);
  for (const [name, entry] of Object.entries(archive.cases)) {
    assert.equal(createHash('sha256').update(await readFile(entry.fixture)).digest('hex'), entry.fixtureSha256);
    validateDeviceScript(entry.inputScript, entry.frames.length);
    assert.ok(entry.frames.every((f, i) => f.frame === i + 1 && f.variables && f.actors && Array.isArray(f.k4_media_output)), name);
  }
  assert.equal(archive.cases['self-shake'].shakeClockOriginMs, 0);
  assert.equal(archive.cases['self-shake-offset'].shakeClockOriginMs, 1024);
  assert.equal(archive.cases.gravity.physicsNegativeCase, true);
  assert.deepEqual(archive.cases.vibration.frames[0].k4_media_output.map(o => o.pattern_ms),
    [[123], [100, 100, 100, 100, 100, 100], [], [-500]]);
  assert.ok(archive.sourceHashes.some(source => source.sha256 === '0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
  const text = JSON.stringify(archive);
  for (const forbidden of ['compile_result', 'compiled_block_map', 'webpackJsonp', 'deviceObservations']) assert.ok(!text.includes(forbidden));
});

test('archiving existing dist evidence does not require official replay', { skip: !process.env.K4_DEVICE_ARCHIVE }, async () => {
  assert.deepEqual(await archiveDeviceEvidence(), await readJson('docs/kitten4-device-evidence.json'));
});

test('source inventory identifies the official player hash and all ten anchors without copying source', {
  skip: !process.env.K4_DEVICE_INTEGRATION,
}, async () => {
  const facts = await deviceSourceFacts();
  const official = facts.files.find(file => file.path.endsWith('player_v2.2d180c468559fbd29528.js.orig'));
  assert.ok(official);
  assert.match(official.sha256, /^[a-f0-9]{64}$/);
  for (const block of deviceBlocks) assert.ok(official.terms[block].length, block);
  assert.deepEqual(official.terms.devicemotion, []);
  assert.deepEqual(official.terms.DeviceMotion, []);
  assert.deepEqual(official.terms.accelerationIncludingGravity, []);
  assert.ok(official.terms.deviceorientation.length);
  assert.equal(await readFile('tools/compat/k4-device-source.mjs', 'utf8').then(s => s.includes('player_v2.2d180c468559fbd29528')), false);
});

test('official native queue, gravity, vibration, and blocking shake evidence', {
  skip: !process.env.K4_DEVICE_REPLAY,
}, async () => {
  const { cases } = await recordDeviceEvidence();
  for (const c of Object.values(cases)) {
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.pageErrors, []);
    assert.ok(c.assets.some(asset => asset.source.endsWith('.orig')));
  }
  assert.ok(Object.values(cases.raw.variables.at(-1)).every(v => v === 0));
  const actions = cases.actions.variables.at(-1);
  assert.equal(actions.shake, 2);
  for (const key of ['tilt_up', 'tilt_left', 'mobile_1_shake', 'mobile_1_slide_up', 'mobile_2_slope_right',
    'mobile_1_click_A', 'mobile_1_keydown_A', 'mobile_1_keyup_A', 'mobile_2_click_B']) assert.equal(actions[key], 1, key);
  assert.equal(cases.duplicate.variables.at(-1).shake, 1);
  assert.equal(cases.duplicate.variables.at(-1).mobile_1_shake, 1);
  const mixed = cases.mixed.variables.at(-1);
  for (const key of ['mobile_1_slide_up', 'mobile_1_slope_up', 'mobile_2_slide_right', 'mobile_2_slope_right',
    'mobile_1_shake', 'mobile_2_shake', 'mobile_2_slide_down', 'mobile_2_click_B']) assert.equal(mixed[key], 1, key);
  assert.equal(mixed.mobile_1_click_A, 0);
  assert.deepEqual(cases.busy.variables.at(-1), { shake: 2, shakeDone: 2, mobile: 2, mobileDone: 2 });
  const gravity = name => cases[name].observations.filter(o => o.type === 'gravity').map(o =>
    [o.frame, o.x || 0, o.y || 0]);
  assert.deepEqual(gravity('gravity'), [[1, 0, 0], [2, -10, -20], [4, 10, 0], [5, 0, 20]]);
  assert.deepEqual(gravity('gravity-portrait'), [[1, 0, 0], [2, 20, -10], [4, 0, 10], [5, -20, 0]]);
  assert.deepEqual(cases.vibration.observations.filter(o => o.type === 'vibrate').map(o => [o.frame, o.pattern]),
    [[1, 123], [1, [100, 100, 100, 100, 100, 100]], [1, []], [1, -500]]);
  assert.equal(cases.vibration.variables[0].phase, 2);
  for (const name of ['self-shake', 'self-shake-offset']) {
    assert.equal(cases[name].variables.findIndex(v => v.phase === 2) + 1, 11);
    assert.deepEqual(Object.values(cases[name].actors[9]).map(a => [a.x, a.y]), [[0, 0]]);
  }
});
