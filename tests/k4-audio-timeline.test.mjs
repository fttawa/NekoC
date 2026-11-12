import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {audioTimelineFixtures} from '../tools/compat/k4-audio-timeline.mjs';

test('audio timelines bind original fixtures, official identity and all sampled updates',async()=>{
  const evidence=JSON.parse(await readFile('docs/kitten4-audio-timeline-evidence.json','utf8'));
  const fixtures=await audioTimelineFixtures();
  assert.deepEqual(Object.keys(evidence.cases),Object.keys(fixtures));
  assert.equal(evidence.fps,60);
  assert.match(evidence.scope,/diagnostic.*not native wall-clock\/acoustic parity/);
  assert.ok(evidence.assets.some(a=>a.source==='player_v2.2d180c468559fbd29528.js.orig'&&a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
  for(const [name,project]of Object.entries(fixtures)){
    const recorded=evidence.cases[name];
    const bytes=await readFile(`tests/fixtures/kitten4/audio-timeline-${name}.bcm`);
    assert.equal(bytes.toString(),JSON.stringify(project,null,2)+'\n',name);
    assert.equal(recorded.sha256,createHash('sha256').update(bytes).digest('hex'),name);
    assert.equal(recorded.officialVariables.length,18,name);
    assert.deepEqual(recorded.vmVariables,recorded.officialVariables,name);
    assert.equal(recorded.variablesEqual,true,name);
    assert.deepEqual(recorded.errors,[],name);
    assert.deepEqual(recorded.pageErrors,[],name);
    assert.equal(recorded.externalAllowed,0,name);
  }
  assert.deepEqual(evidence.cases.properties.events.filter(e=>e.action.startsWith('set_')).map(e=>e.args[1]),[0,1,.7,.05,4,1.5]);
  assert.equal(evidence.cases.overlap.events.filter(e=>e.action==='play').length,3);
  for(const name of ['stop-waits','stop-overlap'])assert.ok(evidence.cases[name].events.some(e=>e.action==='stop'),name);
});
