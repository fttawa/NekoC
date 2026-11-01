#!/usr/bin/env node
// Real editor measurements: completed displayPresent calls per wall-clock second.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { columnDemo } from "./pen-display-columns.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(process.env.NEKOC_NODE_MODULES
  ? path.join(process.env.NEKOC_NODE_MODULES, "package.json") : import.meta.url);
const { chromium } = require("playwright");
const out = path.resolve(process.argv[2] ?? "artifacts/pen-display");
await mkdir(out, { recursive: true });
const temp = await mkdtemp(path.join(process.env.TEMP ?? os.tmpdir(), "nekoc-display-"));
const browser = await chromium.launch({ headless: true, channel: process.env.NEKOC_BROWSER_CHANNEL ?? "msedge" });
const compareColumns = process.argv[3] === "compare-columns";
const fastMode = process.argv[3] === "fast";
const report = { checkedAt: new Date().toISOString(), workload: fastMode
  ? "Single actor, 32x20, 896x560 stage area. Static background once; moving-square edge strips and pixel updates. Constant-color direct path with a shared native procedure; not full framebuffer scan."
  : compareColumns
  ? "Same 32x20 animation and 896x560 stage area; single actor vs 32 column actors"
  : "Demo: clear buffer, eight bands, moving 6x6 square and one pixel; 384x216 stage area", results: [] };
try {
  await cp(path.join(root, "modules"), path.join(temp, "modules"), { recursive: true });
  if (process.env.NEKOC_BORDER_PROBE === "one" || process.env.NEKOC_BORDER_PROBE === "none") {
    const raster = path.join(temp, "modules/pen-display/raster28.ts");
    let text = (await readFile(raster,"utf8")).replaceAll("  pfBorder(8, 4);\n", "");
    if (process.env.NEKOC_BORDER_PROBE === "none") text=text.replaceAll("  pfBorder(2, 1);\n", "");
    await writeFile(raster,text);
    report.geometryProbe=process.env.NEKOC_BORDER_PROBE;
  }
  await mkdir(path.join(temp, "samples"));
  const demo = await readFile(path.join(root, "samples/pen_display.ts"), "utf8");
  const cases = fastMode ? [[32,20,28,"fast"]] : compareColumns ? [[32,20,28,"single"],[32,20,28,"columns"]]
    : [[32,18,12,"single"],[64,36,6,"single"],[128,72,3,"single"]];
  for (const [width, height, scale, renderer] of cases) {
    const source = path.join(temp, "samples/demo.ts");
    const projectFile = path.join(temp, "demo.bcmkn");
    let code = demo.replace("displayInit(32, 18, 12,", `displayInit(${width}, ${height}, ${scale},`);
    if (fastMode) code = await readFile(path.join(root, "samples/pen_display_fast.ts"), "utf8");
    if (compareColumns) {
      code = columnDemo(width, height, scale);
      if (renderer === "single") {
        code = code.slice(0, code.indexOf('sprite("Column 0"'))
          .replace('import { displayPresentColumns, displayRenderColumn } from "../modules/pen-display/columns";',
            'import { displayPresent } from "../modules/pen-display/display";')
          .replace("displayPresentColumns();", "displayPresent();");
      }
    }
    await writeFile(source, code);
    execFileSync(path.join(root, "target/debug", process.platform === "win32" ? "nekoc.exe" : "nekoc"),
      ["compile-ts-bcmkn", source, "--template", path.join(root, "samples/kitten-n-0.27.4.bcmkn"), "--out", projectFile]);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [], resourceErrors = [], consoleErrors = [];
    page.on("console", async message => {
      if(message.type()==="error") {
        consoleErrors.push({text:message.text(),args:await Promise.all(message.args().map(a=>a.evaluate(v=>{
          if(v && typeof v==="object")return Object.fromEntries(Object.getOwnPropertyNames(v).map(k=>[k,String(v[k])]));
          return String(v);
        }).catch(()=>null)))});
      }
    });
    page.on("pageerror", e => pageErrors.push(e.message));
    page.on("requestfailed", request => resourceErrors.push({url:request.url(), error:request.failure()?.errorText}));
    if (process.env.NEKOC_LINT_PROBE) await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/,async route=>{
      const response=await route.fetch();
      const body=(await response.text()).replace('console.error("Unknown lint error detected: ".concat(e))','console.error("Unknown lint error detected:",e.error,e.error.annotation)');
      await route.fulfill({response,body});
    });
    await page.addInitScript(() => {
      window.__displayRejections = [];
      window.__displayRaf = 0;
      const countRaf = () => { window.__displayRaf++; requestAnimationFrame(countRaf); };
      requestAnimationFrame(countRaf);
      window.addEventListener("unhandledrejection", e => window.__displayRejections.push({
        message: String(e.reason), source: e.reason?.target?.src, type: e.reason?.type,
      }));
    });
    await page.route("**/nekoc-display.bcmkn", async route => route.fulfill({contentType:"application/json", body:await readFile(projectFile,"utf8")}));
    await page.goto("https://kn.codemao.cn/editor?previewUrl=" + encodeURIComponent("https://kn.codemao.cn/nekoc-display.bcmkn"), {waitUntil:"domcontentloaded",timeout:60000});
    await page.waitForFunction(() => document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, {timeout:60000});
    // Hide the editor's release-notes overlay in this isolated probe browser.
    await page.addStyleTag({ content: "#DialogContainer { display: none !important; }" });
    // Projects with custom procedures may open in the procedure workspace.
    await page.waitForFunction(() => document.body.innerText.includes("__pd_frames"), null, {timeout:60000});
    const done = page.getByText(/^完成$/).last();
    if (await done.isVisible()) await done.dispatchEvent("click");
    await page.getByText(/^开始$/).last().dispatchEvent("click");
    const readState = () => page.evaluate(() => {
      const text = document.body.innerText;
      const state = {};
      for (const match of text.matchAll(/(__p[fd]_\w+)\n：\n([^\n]+)/g)) state[match[1]] = Number(match[2]);
      return { time:performance.now(), raf:window.__displayRaf, state, warnings: text.includes("找不到列表指定项") || text.includes("已忽略执行") };
    });
    try {
      await page.waitForFunction(() => /__pd_frames\n：\n[1-9]/.test(document.body.innerText), null, {timeout:30000});
    } catch (error) {
      await page.screenshot({path:path.join(out,"startup-failure.png")});
      await writeFile(path.join(out,"startup-failure.json"),JSON.stringify({text:await page.locator("body").innerText(),pageErrors,consoleErrors,rejections:await page.evaluate(()=>window.__displayRejections)},null,2));
      await cp(projectFile,path.join(out,"startup-failure.bcmkn"));
      throw error;
    }
    for (const [key, targetHz] of [["1",15],["2",30],["3",60]]) {
      await page.keyboard.press(key);
      await page.waitForFunction(hz => document.body.innerText.includes(`__pd_fps\n：\n${hz}\n`), targetHz, {timeout:10000});
      const before = await readState();
      await page.waitForTimeout(8000);
      const after = await readState();
      const frames = after.state.__pd_frames - before.state.__pd_frames;
      const elapsedSeconds = (after.time - before.time) / 1000;
      const result = {width,height,scale,renderer,targetHz,frames,elapsedSeconds,completedFps:frames/elapsedSeconds,warnings:after.warnings};
      result.rafHz = (after.raf-before.raf)/elapsedSeconds;
      result.displayedAverageFps = after.state.__pd_actual_fps;
      if (fastMode) result.lastFrameTiming = {
        updateSeconds: after.state.__pf_update_seconds,
        totalSeconds: after.state.__pf_total_seconds,
        note: "Last observed timer sample, not an average; native timer precision is limited."
      };
      report.results.push(result);
      console.log(JSON.stringify(result));
    }
    await page.screenshot({path:path.join(out, `${width}x${height}-${renderer}.png`)});
    report.results.at(-1).pageErrors = pageErrors;
    report.results.at(-1).resourceErrors = resourceErrors;
    report.results.at(-1).rejections = await page.evaluate(() => window.__displayRejections);
    await page.close();
    await writeFile(path.join(out,"benchmark.json"),JSON.stringify(report,null,2));
  }
} finally {
  await browser.close();
  await rm(temp,{recursive:true,force:true});
}
