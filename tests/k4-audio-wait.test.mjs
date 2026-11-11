import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {audioWaitFixture} from '../tools/compat/k4-audio-wait-fixtures.mjs';
import {runOracle} from '../tools/compat/k4-oracle.mjs';
import {visualWork} from '../tools/compat/k4-visual.mjs';

test('audio wait restart fixture is original, deterministic and has browser-decodable unknown CLI duration',async()=>{
  const project=await audioWaitFixture();
  assert.deepEqual(JSON.parse(await readFile('tests/fixtures/kitten4/audio-wait-restart.bcm','utf8')),project);
  const audio=project.audio['audio-wait-tone'];
  assert.equal(audio.duration,undefined);
  assert(audio.url.startsWith('data:audio/x-wav;base64,'));
  const wav=Buffer.from(audio.url.split(',')[1],'base64');
  assert.equal(wav.toString('ascii',0,4),'RIFF');
  assert.equal(wav.readUInt32LE(40)/wav.readUInt32LE(28),2);
});

test('official audio stays locked while timer-driven original costume advances',{
  skip:process.env.K4_ORACLE_INTEGRATION!=='1',timeout:60000,
},async()=>{
  const project=await audioWaitFixture();
  let metadata;
  const trace=await runOracle(project,{frames:60,seed:1,virtualTime:true,blocks:true,
    beforeStart:async page=>{
      metadata=await page.evaluate(()=>{
        const req=window.__k4OracleRequire;
        const howl=req('xQfl').a.AudioPlayer.get_howl('audio-wait-tone');
        return {loaded:howl?.state()==='loaded',duration:howl?.duration()};
      });
    },
  });
  assert.deepEqual(metadata,{loaded:true,duration:2});
  assert.deepEqual(trace.errors,[]);
  assert.equal(trace.traceTruncated,false);
  assert(!trace.events.some(e=>e.block==='audio-wait-restart'));
  for(let i=0;i<60;i++){
    const actors=Object.values(trace.frames[i].actors);
    assert.equal(actors.length,1);
    assert.equal(actors[0].current_style_id,i<6?'audio-before':'audio-after',`frame ${i+1}`);
  }
});

test('measured official audio duration preserves restart wait in paired pixels',{
  skip:process.env.K4_VISUAL_INTEGRATION!=='1',timeout:120000,
},async()=>{
  // Explicit binary avoids visualWork's implicit/default build paths. The main
  // session builds once; this test itself never invokes Cargo.
  const exe=path.resolve(process.env.K4_TRACE_BIN||'target/debug/k4-trace.exe');
  const dir=await mkdtemp(path.resolve('dist/audio-wait-pixels-'));
  try{
    const result=await visualWork('tests/fixtures/kitten4/audio-wait-restart.bcm',{
      nekoc:exe,audioMetadata:true,captureFrames:[1,30,60],seed:1,pixelTolerance:8,artifactsDir:dir,wallTimeoutMs:90000,
    });
    assert.equal(result.status,'captured',JSON.stringify(result));
    assert.deepEqual(result.frames.map(f=>f.changedPercent),[0,0,0]);
    const metadata=JSON.parse(await readFile(path.join(result.artifacts,'audio-metadata.json'),'utf8'));
    assert.equal(metadata.find(a=>a.id==='audio-wait-tone').duration,2);
    // Frame.sprites contains deltas, so an unchanged green sprite need not
    // appear in frame 30's payload. Full state is asserted by the trace tests;
    // paired pixels here must actually cover the changed green costume.
    assert.equal(result.frames.length,3);
  }finally{
    if(process.env.K4_KEEP_ARTIFACTS!=='1')await rm(dir,{recursive:true,force:true});
  }
});
