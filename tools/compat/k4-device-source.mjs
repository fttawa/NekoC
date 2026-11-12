#!/usr/bin/env node
// Records hashes/offsets only. Never writes vendor source into the repository.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveJson } from './k4-oracle.mjs';

export const deviceBlocks = ['on_mobile_click_btn', 'on_mobile_shake', 'on_mobile_slide', 'on_mobile_slope',
  'on_shake', 'on_tilt', 'set_gravity_by_orientation', 'shock_duration', 'shock_for_n_times', 'self_shake'];
export async function deviceSourceFacts(app = process.env.K4_PLAYER_DIR) {
  if (!app) throw new Error('Set K4_PLAYER_DIR to the read-only official app directory');
  const build = path.join(app, 'src/player/build');
  const names = (await readdir(build)).filter(name => /\.js(?:\.orig)?$/.test(name)).sort();
  const files = [];
  for (const name of names) {
    const data = await readFile(path.join(build, name)), text = data.toString('utf8');
    const terms = Object.fromEntries([...deviceBlocks, 'devicemotion', 'DeviceMotion', 'accelerationIncludingGravity',
      'deviceorientation', 'send_action=function', 'create_dynamic_responder_interpreters=function',
      'perform_automatic_state_transitions=function', 'U=10', 'Dt=.05', 'Lt=window.matchMedia'].map(term => {
      const offsets = []; let at = -1;
      while ((at = text.indexOf(term, at + 1)) >= 0) offsets.push(at);
      return [term, offsets];
    }));
    files.push({ path: `src/player/build/${name}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), terms });
  }
  return { schema: 'nekoc-k4-device-source-v1', offsetUnit: 'zero-based UTF-16 code units; line 1 for minified bundles', files };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const facts = await deviceSourceFacts();
  await saveJson('dist/k4device/source.json', facts);
  console.log(JSON.stringify(facts.files.map(f => ({ path: f.path, sha256: f.sha256, blocks: deviceBlocks.filter(b => f.terms[b].length) })), null, 2));
}
