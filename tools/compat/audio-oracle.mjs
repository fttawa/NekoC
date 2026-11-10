#!/usr/bin/env node
// Optional real-media check, using only our owned inline-wave K4 fixture.
import {readJson,runOracle,saveJson} from './k4-oracle.mjs';

const samples=[];
const result=await runOracle(await readJson('tests/fixtures/kitten4/audio.bcm'),{
  frames:3,wallTimeoutMs:60000,
  beforeStart:async page=>{
    await page.evaluate(()=>{
      const module=window.__k4OracleRequire('xQfl');
      const audio=Object.values(module).map(v=>v?.AudioPlayer).find(Boolean);
      if(!audio)throw Error('Official AudioPlayer export not found');
      window.__audioProbe=audio;
      // DOM activation is explicit; do not mistake autoplay denial for VM wait.
      const button=document.createElement('button');button.id='nekoc-audio-unlock';button.textContent='unlock';
      button.style.cssText='position:fixed;top:0;left:0;z-index:2147483647;width:120px;height:40px';
      button.onclick=()=>{void audio.get_howl('nekoc-tone')?._sounds[0]?._node?.context?.resume();};
      document.body.append(button);
    });
    await page.click('#nekoc-audio-unlock');
  },
  onFrame:async(page,frame)=>{
    const state=await page.evaluate(()=>{
      const audio=window.__audioProbe,howl=audio.get_howl('nekoc-tone');
      return {volume:audio.get_volume('nekoc-tone'),rate:audio.get_rate('nekoc-tone'),
        duration:howl.duration(),playing:!!audio.is_playing('nekoc-tone'),
        sounds:howl._sounds.map(s=>({ended:s._ended,paused:s._paused}))};
    });
    samples.push({frame,...state});
    // Audio uses the actual media clock. This is intentionally not a claim
    // that a fixed scheduler frame equals an audio clock interval.
    if(frame===1)await page.waitForTimeout(300);
  },
});
const evidence={schema:'nekoc-audio-runtime-evidence-v1',scope:'owned K4 inline WAV; real media clock between update 1 and 2',
  checkedAt:new Date().toISOString(),samples,frames:result.frames,errors:result.errors,assets:result.diagnostics.assets};
await saveJson('dist/audio-official.json',evidence);
if(samples[0]?.volume!==.25||samples[0]?.rate!==2||Math.abs(samples[0]?.duration-.1)>1e-6||
    result.frames[0]?.variables['audio-after']!==0||result.frames[1]?.variables['audio-after']!==1) {
  throw Error('Official audio observation differs; see dist/audio-official.json');
}
console.log(JSON.stringify(evidence,null,2));
