import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {loadPlaywright} from '../tools/probe-kitten4.mjs';
import {tone} from '../tools/compat/audio-fixtures.mjs';
import {audioFixtures} from '../tools/compat/audio-fixtures.mjs';

test('audio fixtures are reproducible and contain only the owned inline tone',async()=>{
  const {kn,k4}=await audioFixtures();
  assert.deepEqual(JSON.parse(await readFile('tests/fixtures/audio.bcmkn','utf8')),kn);
  assert.deepEqual(JSON.parse(await readFile('tests/fixtures/kitten4/audio.bcm','utf8')),k4);
  assert.equal(kn.audios.audiosDict['nekoc-tone'].url,tone());
});

// Explicit opt-in: installed Edge + Playwright, no vendor media or binary fixtures.
test('real HTMLAudio: PCM output, clock, ended waits, pause/resume and failed-play recovery',{
  skip:process.env.NEKOC_AUDIO_BROWSER!=='1',timeout:45000,
},async t=>{
  const source=await readFile(new URL('../web/audio.js',import.meta.url),'utf8');
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/audio.js'?'application/javascript':'text/html');
    // Static page script, not evaluate(): CDP Runtime.evaluate carries userGesture.
    if(req.url==='/autoplay.html'){
      res.end(`<!doctype html><button id="start">Enable audio</button><script type="module">
        import {ProjectAudio} from '/audio.js';
        const done=[],errors=[],audio=new ProjectAudio(e=>errors.push(e),id=>done.push(id));
        audio.load({audios:{sortList:['tone'],audiosDict:{tone:{id:'tone',url:${JSON.stringify(tone())}}}}});
        window.probe={audio,done,errors};audio.resume();audio.apply({audio_commands:[{audio:'tone',play:true,wait:'unlocked'}]});
        document.querySelector('button').onclick=()=>audio.unlock();
      </script>`);return;
    }
    res.end(req.url==='/audio.js'?source:'<!doctype html><button id="start">Enable audio</button>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge',args:['--autoplay-policy=user-gesture-required']});
    const origin=`http://127.0.0.1:${server.address().port}`;
    await t.test('owned inline WAV produces nonzero decoded PCM and completes only after resumed end',async()=>{
      const page=await browser.newPage();
      try {
        await page.goto(origin);
        await page.evaluate(async url=>{
          const {ProjectAudio}=await import('/audio.js');
          const done=[],errors=[],audio=new ProjectAudio(e=>errors.push(e),id=>done.push(id));
          audio.load({audios:{sortList:['tone','bad'],audiosDict:{
            tone:{id:'tone',url,volume:.6,playback_rate:.1},bad:{id:'bad',url:'data:audio/wav;base64,bm90IGEgd2F2'},
          }}});
          audio.apply({audio_commands:[{audio:'tone',play:true,wait:'first'}]});
          const element=[...audio.voices.values()][0].element;
          const context=new AudioContext(),analyser=context.createAnalyser();analyser.fftSize=2048;
          context.createMediaElementSource(element).connect(analyser);analyser.connect(context.destination);
          const samples=new Float32Array(analyser.fftSize);
          window.probe={audio,element,context,done,errors,peak:0};
          const sample=()=>{analyser.getFloatTimeDomainData(samples);for(const value of samples)probe.peak=Math.max(probe.peak,Math.abs(value));probe.raf=requestAnimationFrame(sample);};sample();
          document.querySelector('button').onclick=()=>{void context.resume();audio.resume();audio.unlock();};
        },tone());
        await page.click('#start');
        await page.waitForFunction(()=>probe.element.currentTime>.015&&probe.peak>.0001,null,{timeout:8000});
        const paused=await page.evaluate(()=>{probe.audio.pause();return {time:probe.element.currentTime,done:[...probe.done],paused:probe.element.paused,peak:probe.peak};});
        assert.equal(paused.paused,true);assert.deepEqual(paused.done,[]);assert.ok(paused.peak>.0001);
        await page.waitForTimeout(180);
        const frozen=await page.evaluate(()=>({time:probe.element.currentTime,done:[...probe.done]}));
        assert.ok(Math.abs(frozen.time-paused.time)<.01,JSON.stringify({paused,frozen}));assert.deepEqual(frozen.done,[]);
        await page.click('#start');
        await page.waitForFunction(()=>probe.done.includes('first'),null,{timeout:8000});
        const ended=await page.evaluate(()=>({time:probe.element.currentTime,duration:probe.element.duration,ended:probe.element.ended,done:probe.done,errors:probe.errors}));
        assert.equal(ended.ended,true);assert.ok(ended.time>=ended.duration-.01);assert.deepEqual(ended.done,['first']);assert.deepEqual(ended.errors,[]);
        await page.evaluate(()=>probe.audio.apply({audio_commands:[{audio:'bad',play:true,wait:'bad'}]}));
        await page.waitForFunction(()=>probe.done.includes('bad'),null,{timeout:8000});
        const failed=await page.evaluate(()=>({done:[...probe.done],errors:[...probe.errors]}));
        assert.deepEqual(failed.done,['first','bad']);assert.ok(failed.errors.some(e=>/失败/.test(e)));
        await page.evaluate(()=>probe.audio.apply({audio_commands:[{audio:'tone',play:true,wait:'recovered'}]}));
        await page.waitForFunction(()=>probe.done.includes('recovered'),null,{timeout:8000});
        assert.deepEqual(await page.evaluate(()=>probe.done),['first','bad','recovered']);
      }finally{
        await page.evaluate(async()=>{if(window.probe){cancelAnimationFrame(probe.raf);probe.audio.stop();await probe.context.close();}}).catch(()=>{});
        await page.close();
      }
    });
    await t.test('real autoplay denial keeps wait alive and user gesture unlock retries it',async()=>{
      // Separate browser context: prior clicks must not unlock this document.
      const context=await browser.newContext();const page=await context.newPage();
      try {
        await page.goto(`${origin}/autoplay.html`);
        await page.waitForFunction(()=>probe.errors.length>0,null,{timeout:8000});
        const blocked=await page.evaluate(()=>({done:probe.done,errors:probe.errors,wanted:[...probe.audio.voices.values()][0].wanted}));
        assert.deepEqual(blocked.done,[]);assert.equal(blocked.wanted,true);assert.match(blocked.errors[0],/启用声音/);
        await page.click('#start');await page.waitForFunction(()=>probe.done.includes('unlocked'),null,{timeout:8000});
        assert.deepEqual(await page.evaluate(()=>probe.done),['unlocked']);
      }finally{await page.evaluate(()=>window.probe?.audio.stop()).catch(()=>{});await context.close();}
    });
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
