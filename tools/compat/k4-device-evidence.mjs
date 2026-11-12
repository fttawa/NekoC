#!/usr/bin/env node
// Synthetic device inputs use the proposed public InputScript contract. Native
// DOM orientation and native send_action are distinct evidence levels.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runOracle, openKernel, saveJson } from './k4-oracle.mjs';
import { writeDeviceFixtures } from './k4-device-fixtures.mjs';
import { deviceSourceFacts } from './k4-device-source.mjs';

export function validateDeviceScript(script, frames = Infinity) {
  if (script?.schema !== 'nekoc-input-v1' || !Array.isArray(script.events)) throw new Error('Expected nekoc-input-v1');
  let frame = 1, time = 0;
  for (const e of script.events) {
    if (!Number.isSafeInteger(e.frame) || e.frame < frame || e.frame > frames ||
      !Number.isFinite(e.time_ms) || e.time_ms < time) throw new Error('Invalid device frame/time/type');
    if (e.type === 'device_motion') {
      if (![e.x, e.y, e.z].every(Number.isFinite)) throw new Error('Invalid motion');
    } else if (e.type === 'device_orientation') {
      if (![e.beta, e.gamma].every(Number.isFinite) || typeof e.portrait !== 'boolean') throw new Error('Invalid orientation');
    } else if (e.type === 'device_event') {
      if (typeof e.action !== 'string' || (e.device !== undefined && typeof e.device !== 'string') ||
        (e.value !== undefined && typeof e.value !== 'string')) throw new Error('Invalid device event');
    } else if (e.type === 'mobile_button') {
      if (![e.device, e.event, e.button].every(v => typeof v === 'string')) throw new Error('Invalid button');
    } else throw new Error(`Unknown device type: ${e.type}`);
    frame = e.frame; time = e.time_ms;
  }
  return script;
}

// Serialized by Playwright, so deliberately self-contained. No responder/domain
// function replacement, no inferred raw-sensor thresholds.
export function installDeviceReplay(script) {
  const req = window.__k4OracleRequire, heart = req('KmiX').b();
  const runtime = window.__k4OracleContainer.get(window.__k4OracleBinding.RuntimeManager);
  const observations = window.__k4DeviceObservations = [];
  const physics = req('a1xw').a().core.physics;
  const getWorld = physics.get_world;
  const seen = new WeakSet();
  physics.get_world = function (...args) {
    const world = getWorld.apply(this, args);
    if (world && !seen.has(world)) {
      seen.add(world); const set = world.set_gravity;
      world.set_gravity = function (x, y) {
        observations.push({ type: 'gravity', frame: runtime.frames + 1, scene: args[0], x, y });
        return set.call(this, x, y);
      };
    }
    return world;
  };
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: pattern => {
    observations.push({ type: 'vibrate', frame: runtime.frames + 1, pattern: structuredClone(pattern) });
    return true;
  } });
  let at = 0;
  const update = runtime.update;
  runtime.update = function (...args) {
    const frame = runtime.frames + 1;
    while (at < script.events.length && script.events[at].frame === frame) {
      const e = script.events[at++];
      observations.push({ type: 'input', input: e });
      if (e.type === 'device_orientation') {
        const actualPortrait = window.matchMedia('(orientation: portrait)').matches;
        if (actualPortrait !== e.portrait) throw new Error('portrait must match boot viewport (official caches it at module load)');
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: e.beta, gamma: e.gamma, alpha: 0 }));
      } else if (e.type === 'device_motion') {
        window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: e.x, y: e.y, z: e.z }, interval: 16 }));
      } else {
        const action = e.type === 'mobile_button' ? { namespace: '', id: 'on_mobile_click_btn', value: JSON.stringify({
          device: e.device, mobile_btn_event_type: e.event, mobile_type: e.button }) } :
          { namespace: '', id: e.action, ...(e.value !== undefined ? { value: e.value } : {}),
            ...(e.device !== undefined ? { parameters: { device: e.device, type: e.value } } : {}) };
        heart.get_runtime_manager().send_action(action);
        observations.push({ type: 'send_action', frame, action });
      }
    }
    return update.apply(this, args);
  };
}

const input = (frame, type, fields) => ({ frame, time_ms: (frame - 1) * 1000 / 60, type, ...fields });
export function devicePlans() {
  const ev = (frame, action, device, value) => input(frame, 'device_event', { action, ...(device ? { device } : {}), ...(value ? { value } : {}) });
  return {
    raw: { fixture: 'events', frames: 8, events: [input(2, 'device_motion', { x: 0, y: 0, z: 9.8 }),
      input(3, 'device_motion', { x: 1000, y: -1000, z: 0 }), input(4, 'device_orientation', { beta: 80, gamma: 80, portrait: false })] },
    actions: { fixture: 'events', frames: 16, events: [ev(2, 'on_shake'), ev(3, 'on_shake'),
      ev(4, 'on_tilt', undefined, 'up'), ev(5, 'on_tilt', undefined, 'left'), ev(6, 'on_mobile_shake', 'mobile_1'),
      ev(7, 'on_mobile_slide', 'mobile_1', 'up'), ev(8, 'on_mobile_slope', 'mobile_2', 'right'),
      input(9, 'mobile_button', { device: 'mobile_1', event: 'click', button: 'a' }),
      input(10, 'mobile_button', { device: 'mobile_1', event: 'keydown', button: 'A' }),
      input(11, 'mobile_button', { device: 'mobile_1', event: 'keyup', button: 'A' }),
      input(12, 'mobile_button', { device: 'mobile_2', event: 'click', button: 'B' }),
      ev(13, 'on_mobile_slide', 'mobile_1', 'UP'), ev(14, 'on_mobile_slide', 'unknown', 'up')] },
    duplicate: { fixture: 'events', frames: 5, events: [ev(2, 'on_shake'), ev(2, 'on_shake'),
      ev(2, 'on_mobile_shake', 'mobile_1'), ev(2, 'on_mobile_shake', 'mobile_1')] },
    mixed: { fixture: 'events', frames: 6, events: [ev(2, 'on_mobile_slide', 'mobile_1', 'up'),
      ev(2, 'on_mobile_slope', 'mobile_2', 'right'), ev(3, 'on_mobile_shake', 'mobile_1'),
      ev(3, 'on_mobile_slide', 'mobile_2', 'down'),
      input(4, 'mobile_button', { device: 'mobile_1', event: 'click', button: 'A' }),
      input(4, 'mobile_button', { device: 'mobile_2', event: 'click', button: 'B' })] },
    busy: { fixture: 'busy', frames: 12, events: Array.from({ length: 9 }, (_, n) => [ev(n + 2, 'on_shake'), ev(n + 2, 'on_mobile_shake', 'mobile_1')]).flat() },
    gravity: { fixture: 'gravity', frames: 8, events: [input(2, 'device_orientation', { beta: 10, gamma: 20, portrait: false }),
      input(3, 'device_orientation', { beta: 0, gamma: 0, portrait: false }), input(4, 'device_orientation', { beta: -10, gamma: 0, portrait: false }),
      input(5, 'device_orientation', { beta: 0, gamma: -20, portrait: false })] },
    'gravity-portrait': { fixture: 'gravity', frames: 8, portrait: true, events: [input(2, 'device_orientation', { beta: 10, gamma: 20, portrait: true }),
      input(3, 'device_orientation', { beta: 0, gamma: 0, portrait: true }), input(4, 'device_orientation', { beta: -10, gamma: 0, portrait: true }),
      input(5, 'device_orientation', { beta: 0, gamma: -20, portrait: true })] },
    vibration: { fixture: 'vibration', frames: 3, events: [] },
    'self-shake': { fixture: 'self-shake', frames: 16, events: [], origin: 0 },
    'self-shake-offset': { fixture: 'self-shake', frames: 16, events: [], origin: 1024 },
  };
}

export async function recordDeviceEvidence(options = {}) {
  const fixtures = await writeDeviceFixtures();
  const summary = { schema: 'nekoc-k4-device-evidence-v1', source: await deviceSourceFacts(options.playerDir), cases: {} };
  await saveJson('dist/k4device/source.json', summary.source);
  for (const [name, plan] of Object.entries(devicePlans())) {
    const script = validateDeviceScript({ schema: 'nekoc-input-v1', events: plan.events }, plan.frames);
    await saveJson(`dist/k4device/${name}-input.json`, script);
    let observations;
    const project = fixtures[plan.fixture];
    const trace = await runOracle(project, { ...options, frames: plan.frames, blocks: true,
      ...(plan.portrait ? { openKernel: async (opts, bootstrap) => {
        const kernel = await openKernel(opts, bootstrap);
        // Editable fixtures are compiled and reloaded after this hook, so the
        // official module captures matchMedia at the desired boot viewport.
        await kernel.page.setViewportSize({ width: 720, height: 1280 });
        return kernel;
      } } : {}),
      beforeStart: async page => {
        if (plan.origin !== undefined) await page.evaluate(origin => {
          window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now = () => origin;
        }, plan.origin);
        await page.evaluate(installDeviceReplay, script);
      },
      onFrame: async (page, frame) => {
        if (frame === plan.frames) observations = await page.evaluate(() => window.__k4DeviceObservations);
      },
    });
    const entry = { fixture: `tests/fixtures/kitten4/device-${plan.fixture}.bcm`,
      fixtureSha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'), inputScript: script,
      evidenceLevel: name === 'raw' ? 'raw DOM events (negative; no registered conversion in supplied player)' :
        name.startsWith('gravity') ? 'native DOM orientation -> native physics gravity' : name.includes('shake') || name === 'vibration' ?
          'native domain block + observed browser output' : 'native RuntimeManager.send_action -> native responders',
      observations, variables: trace.frames.map(f => f.variables),
      actors: trace.frames.map(f => f.actors), errors: trace.errors,
      pageErrors: trace.diagnostics.pageErrors, assets: trace.diagnostics.assets };
    summary.cases[name] = entry;
    await saveJson(`dist/k4device/${name}-official.json`, { ...trace, deviceObservations: observations, inputScript: script });
    await saveJson('dist/k4device/evidence.json', summary);
    console.log(name, JSON.stringify(entry.variables.at(-1)), observations.filter(o => o.type === 'gravity' || o.type === 'vibrate'));
  }
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await recordDeviceEvidence();
