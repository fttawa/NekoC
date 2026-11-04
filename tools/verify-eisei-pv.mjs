#!/usr/bin/env node
// Real editor playback probe. Browser instrumentation observes native audio;
// none of it is injected into the exported project.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(process.env.NEKOC_NODE_MODULES ? path.join(process.env.NEKOC_NODE_MODULES, "package.json") : import.meta.url);
const { chromium } = require("playwright");
const input = path.resolve(process.argv[2] ?? "projects/eisei/eisei_pv.bcmkn");
const out = path.resolve(process.argv[3] ?? "projects/eisei/eisei-verification");
await mkdir(out, { recursive: true });
const report = { input, checkedAt: new Date().toISOString(), pageErrors: [], consoleErrors: [], states: [] };
const browser = await chromium.launch({ headless: true, channel: "msedge", args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const profiler = process.env.NEKOC_PROFILE ? await page.context().newCDPSession(page) : null;
page.on("pageerror", e => report.pageErrors.push(e.message));
page.on("console", m => { if (m.type() === "error") report.consoleErrors.push(m.text().slice(0,500)); });
await page.addInitScript(() => {
  window.__audioEvents = [];
  window.__audioElements = [];
  const original = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    window.__audioEvents.push({ event: "start", at: performance.now(), contextTime: this.context.currentTime, duration: this.buffer?.duration, args });
    return original.apply(this,args);
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function(...args) {
    if (!window.__audioElements.includes(this)) window.__audioElements.push(this);
    window.__audioEvents.push({event:"media-play",at:performance.now(),src:this.currentSrc.slice(0,80)});
    this.addEventListener("playing",()=>window.__audioEvents.push({event:"playing",at:performance.now(),duration:this.duration,currentTime:this.currentTime}),{once:true});
    this.addEventListener("error",()=>window.__audioEvents.push({event:"error",code:this.error?.code}),{once:true});
    return play.apply(this,args);
  };
});
await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/, async route => {
  const response = await route.fetch();
  const source = await response.text();
  await route.fulfill({ response, body: source.replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") });
});
async function state() {
  return page.evaluate(() => {
    const vars = {}, text = document.body.innerText;
    for (const v of Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable)) {
      if (v.type !== 'list' && /^(pv_|ep_)/.test(v.name)) vars[v.name] = v.value;
    }
    const media = window.__audioElements.map(e=>({time:e.currentTime,duration:e.duration,paused:e.paused,ended:e.ended,readyState:e.readyState}));
    return { vars, at: performance.now(), audio: window.__audioEvents, media, warnings: /找不到|已忽略执行/.test(text) };
  });
}
async function expectVar(name,value,timeout=120000) {
  await page.waitForFunction(({name,value}) => Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable).some(v=>v.type!=='list' && v.name===name && v.value===value), {name,value}, {timeout});
}
async function key(name) {
  await page.keyboard.down(name);
  await page.waitForTimeout(120);
  await page.keyboard.up(name);
}
try {
  const start = Date.now();
  await page.route("**/nekoc-eisei.bcmkn", async route => route.fulfill({ contentType: "application/json", body: await readFile(input) }));
  await page.goto("https://kn.codemao.cn/editor?previewUrl="+encodeURIComponent("https://kn.codemao.cn/nekoc-eisei.bcmkn"), {waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForFunction(() => document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, {timeout:180000});
  await page.addStyleTag({content:"#DialogContainer {display:none !important}"});
  await page.waitForFunction(() => document.body.innerText.includes("pv_state"),null,{timeout:180000});
  report.loadMs = Date.now()-start;
  const done = page.getByText(/^完成$/).last();
  if (await done.isVisible()) await done.dispatchEvent("click");
  // Equivalent to closing the native console. Its observer deep-clones every
  // large list on variable updates, even when the lists are not expanded.
  await page.evaluate(()=>window.__nekocRequire(69138).default.ComponentsStore.ConsolePanelStore.closeAll());
  await page.getByText(/^开始$/).last().dispatchEvent("click");
  await expectVar("pv_state",1);
  report.states.push(await state());
  report.stage = await page.evaluate(()=>{
    const req=window.__nekocRequire; const bcm=req(91107).BcmInstance;
    const runtime=req(26921).cG.get_instance();
    return {size:bcm.getBcm().stageSize,actor:Object.values(bcm.actorsDict).map(a=>({position:a.position,scale:a.scale})),core:Object.getOwnPropertyNames(Object.getPrototypeOf(runtime.stage.core.actors))};
  });
  await page.screenshot({path:path.join(out,"ready.png")});
  await page.locator("canvas:visible").first().click({force:true});
  await page.evaluate(() => { document.activeElement?.blur(); });
  await page.waitForTimeout(500);
  report.beforeKey = await page.evaluate(()=>{
    const r=window.__nekocRequire(26921).cG.get_instance();
    const s=r.getStageEvent(); const orig=s.onKeyDown;
    window.__keyLog=[];
    document.body.addEventListener("keydown", e=>window.__keyLog.push({key:e.key,keyCode:e.keyCode}),true);
    return {running:s.getRunningState(),scene:!!s.stage.core.scenes.get_current_scene(),runtimeKeys:Object.keys(r),heartKeys:Object.keys(r.getHeart())};
  });
  await key("Enter");
  if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Profiler.start"); }
  await expectVar("pv_state",2,10000);
  await page.waitForFunction(() => Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable).some(v=>v.name==='pv_frame' && v.value>0),null,{timeout:15000});
  report.states.push(await state());
  await page.waitForTimeout(3500);
  report.states.push(await state());
  await page.screenshot({path:path.join(out,"playing.png")});
  const last = report.states.at(-1);
  assert.ok(last.vars.pv_frame > 10, "Native frame selection advances");
  assert.ok(last.audio.filter(e=>e.event==="playing" && e.duration>3).length >= 2, "Warmup and playback each start native audio");
  assert.equal(last.warnings,false,"No execution warnings");
  const active=last.media.find(m=>!m.paused && m.duration>3);
  assert.ok(active,"Music is playing");
  assert.ok(Math.abs(last.vars.pv_time-(active.time-3))<0.25,"Audio/visual clocks within 250 ms");
  if (last.vars.pv_duration <= 10) {
    await expectVar("pv_state",3,20000);
    await page.screenshot({path:path.join(out,"ended.png")});
  } else {
    for (const t of [30,60,90,120,143.5]) {
      await page.waitForFunction(t => {
        const v = Object.values(window.__nekocRequire(69138).default.ComponentsStore.TheatreStore.stageVariable).find(v=>v.name==='pv_time');
        return v && Number(v.value) >= t;
      },t,{timeout:60000});
      const sample = await state();
      report.states.push(sample);
      assert.equal(sample.warnings,false,"No execution warnings during playback");
      await page.screenshot({path:path.join(out,`time-${t}.png`)});
    }
    await expectVar("pv_state",3);
  }
  await key("Enter");
  await expectVar("pv_state",2);
  await page.waitForTimeout(4000);
  await key("q");
  await expectVar("pv_state",1);
  report.states.push(await state());
  if (last.vars.ep_drawn !== undefined) {
    const playing = report.states.filter(s=>s.vars.pv_state===2 && s.vars.ep_drawn!==undefined);
    report.penPerformance = playing.slice(1).map((s,i)=>({
      time:s.vars.pv_time,
      completedFps:(s.vars.ep_drawn-playing[i].vars.ep_drawn)/((s.at-playing[i].at)/1000),
      completedFrame:s.vars.pv_frame,
      audioMinusCompletedFrameSeconds:s.media.some(m=>!m.paused && m.duration>3)
        ? s.media.find(m=>!m.paused && m.duration>3).time-3-(s.vars.pv_frame-1)/s.vars.pv_fps
        : null,
    }));
  }
  report.ok = true;
} catch(e) {
  report.failure = String(e);
  report.dom = await page.evaluate(()=>({focus:document.activeElement?.tagName, text:document.body.innerText.slice(-12000), overlays:[...document.querySelectorAll('[class*="loading"],[class*="Loading"]')].map(e=>e.outerHTML.slice(0,1500))})).catch(()=>null);
  report.runtime = await page.evaluate(()=>{
    const req=window.__nekocRequire;
    const exports=req(26921);
    const r=exports.cG.get_instance();
    return {keyLog:window.__keyLog,running:r.getStageEvent().getRunningState(),store:window.__nekocRequire(69138).default.runtimeStore.running};
  }).catch(()=>null);
  report.states.push(await state().catch(()=>null));
  await page.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});
  process.exitCode=1;
} finally {
  if (profiler) {
    const {profile} = await profiler.send("Profiler.stop");
    await writeFile(path.join(out,"cpu.cpuprofile"),JSON.stringify(profile));
  }
  await writeFile(path.join(out,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
}
