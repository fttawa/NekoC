#!/usr/bin/env node
// Exercise the shipped project in the official editor, including real key events.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(process.env.NEKOC_NODE_MODULES ? path.join(process.env.NEKOC_NODE_MODULES, "package.json") : import.meta.url);
const { chromium } = require("playwright");
const out = path.resolve(process.argv[2] ?? "modules/pen-display/verification/platonic");
await mkdir(out, { recursive: true });
const report = { checkedAt: new Date().toISOString(), cases: [], controls: [], pageErrors: [], consoleErrors: [] };
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", e => report.pageErrors.push(e.message));
page.on("console", m => { if (m.type() === "error") report.consoleErrors.push(m.text()); });
await page.addInitScript(() => {
  window.__polyRaf = 0;
  const tick = () => { window.__polyRaf++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const state = () => page.evaluate(() => {
  const text = document.body.innerText, vars = {};
  for (const m of text.matchAll(/((?:poly_|__pd_)\w+)\n：\n([^\n]+)/g)) vars[m[1]] = Number(m[2]);
  return { vars, time: performance.now(), raf: window.__polyRaf, warnings: /找不到列表指定项|已忽略执行/.test(text) };
});
async function expectVar(name, value) {
  await page.waitForFunction(({name,value}) => document.body.innerText.includes(`${name}\n：\n${value}\n`), {name,value}, {timeout:20000});
}
async function key(key, variable, value) {
  await page.keyboard.press(key);
  await expectVar(variable, value);
  report.controls.push({ key, variable, value });
}
async function measure(name) {
  const first = await state();
  await page.waitForFunction(frame => {
    const m = document.body.innerText.match(/__pd_frames\n：\n([^\n]+)/);
    return m && Number(m[1]) > frame + 2;
  }, first.vars.__pd_frames, {timeout:30000});
  const before = await state();
  await page.waitForTimeout(3000);
  const after = await state();
  assert.ok(after.vars.__pd_frames > before.vars.__pd_frames, `${name}: frames must complete`);
  assert.equal(after.warnings, false, `${name}: runtime warning`);
  const expected = {4:[4,6],6:[8,12],8:[6,12],12:[20,30],20:[12,30]}[after.vars.poly_faces];
  assert.ok(expected, "Only Platonic face counts are valid");
  assert.equal(after.vars.poly_vertex_count, expected[0]);
  assert.equal(after.vars.poly_edge_count, expected[1]);
  const seconds = (after.time - before.time) / 1000;
  report.cases.push({ name, state: after.vars, completedFps: (after.vars.__pd_frames-before.vars.__pd_frames)/seconds, rafHz: (after.raf-before.raf)/seconds });
  await page.screenshot({path:path.join(out, `${name}.png`)});
  console.log(JSON.stringify(report.cases.at(-1)));
}
try {
  await page.route("**/nekoc-polyhedron.bcmkn", async route => route.fulfill({contentType:"application/json",body:await readFile("samples/pen_polyhedron.bcmkn","utf8")}));
  await page.goto("https://kn.codemao.cn/editor?previewUrl="+encodeURIComponent("https://kn.codemao.cn/nekoc-polyhedron.bcmkn"), {waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForFunction(() => document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"),null,{timeout:60000});
  await page.addStyleTag({content:"#DialogContainer {display:none !important}"});
  await page.waitForFunction(() => document.body.innerText.includes("poly_solid"),null,{timeout:60000});
  const done = page.getByText(/^完成$/).last();
  if (await done.isVisible()) await done.dispatchEvent("click");
  await page.getByText(/^开始$/).last().dispatchEvent("click");
  await expectVar("poly_width",64);
  await measure("default-64x40");
  await key("Space","poly_auto",0);
  await key("q","poly_faces",4);
  await key("q","poly_faces",4);
  await key("1","poly_width",32);
  await measure("four-faces-32x20");
  await key("e","poly_faces",6);
  const yaw = (await state()).vars.poly_yaw;
  await key("ArrowRight","poly_yaw",yaw+10);
  await key("ArrowLeft","poly_yaw",yaw);
  await key("ArrowUp","poly_pitch",30);
  await key("ArrowDown","poly_pitch",20);
  await key("w","poly_zoom",110);
  await key("s","poly_zoom",100);
  await key("a","poly_speed",20);
  await key("d","poly_speed",25);
  await key("z","poly_camera",550);
  await key("x","poly_camera",600);
  await key("2","poly_width",64);
  await key("e","poly_faces",8);
  await measure("octahedron-64x40");
  await key("e","poly_faces",12);
  await measure("dodecahedron-64x40");
  await key("e","poly_faces",20);
  await key("e","poly_faces",20);
  await key("3","poly_width",128);
  await measure("twenty-faces-128x80");
  await key("Space","poly_auto",1);
  await measure("twenty-faces-128x80-rotating");
  await key("Space","poly_auto",0);
  for (const zoom of [110,120,130]) await key("w","poly_zoom",zoom);
  for (const camera of [550,500,450]) await key("z","poly_camera",camera);
  for (const pitch of [30,40,50,60,70,80]) await key("ArrowUp","poly_pitch",pitch);
  await measure("high-zoom-clipping");
  await key("r","poly_faces",6);
  await expectVar("poly_width",64);
  await expectVar("poly_auto",1);
  await key("3","poly_width",128);
  await measure("six-faces-128x80");
  await key("2","poly_width",64);
  await measure("reset-64x40");
  assert.deepEqual(report.pageErrors, []);
  assert.ok(!report.consoleErrors.some(e=>/lint error/i.test(e)));
  report.ok = true;
} catch (error) {
  report.error = String(error);
  report.state = await state();
  await page.screenshot({path:path.join(out,"failure.png")});
  throw error;
} finally {
  await writeFile(path.join(out,"report.json"),JSON.stringify(report,null,2));
  await browser.close();
}
