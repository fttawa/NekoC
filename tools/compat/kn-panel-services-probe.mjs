#!/usr/bin/env node
// Original probe. Official source bytes and function bodies remain in ignored dist.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPlaywright } from "../probe-kitten4.mjs";

const out = "dist/kn-panel5";
const url = "https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const source = await fs.readFile(`${out}/main.js`, "utf8");
const anchors = {
  global_animation: "globalAnimation,function(){var e=(0,y.Z)",
  global_animation_cleanup: "function Re(e){var t=e.lock,n=e.svgaContainer",
  global_animation_options: '61823:function(e,t,n){"use strict";',
  translate: "(0,r.Z)(t,h.U4.translate,function()",
  translate_result: "(0,r.Z)(t,h.U4.translateResult,function()",
  translate_transport: 'case 0:return"/kitten/work/translate",n=t.text,r=t.language',
  show_hide_ranking: "(0,c.Z)(t,u.vk.showHideRanking,function()",
  update_ranking: "(0,c.Z)(t,u.vk.updateRanking,function()",
  user_ranking_info: "(0,c.Z)(t,u.vk.userRankingInfo,function()",
  user_info_of_th: "(0,c.Z)(t,u.vk.userInfoOfTh,function()",
  ai_text_shadows: '{type:"multiline_text",message0:"%1",args0:',
  ai_text_shadow_reader: '(0,c.Z)(t,"limit_length_text",(function(e){return e.TEXT}))',
  camera_alpha_shadow: 'camera_alpha_slider',
};
const evidence = { schema: "nekoc-kn-panel-services-v1", checkedAt: new Date().toISOString(),
  officialUrl: "https://kn.codemao.cn/editor", bundle: { url, sha256: sha(source) },
  sourceLocations: Object.entries(anchors).map(([symbol, anchor]) => {
    const index = source.indexOf(anchor);
    if (index < 0) throw new Error(`Missing anchor ${symbol}`);
    return { symbol, byteOffset: Buffer.byteLength(source.slice(0, index)), anchor,
      excerptCharacters: 800, excerptSha256: sha(source.slice(index, index + 800)) };
  }), pageErrors: [], calls: [], blockedRequests: [],
};
const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage();
  page.on("pageerror", error => evidence.pageErrors.push(String(error)));
  await page.route("**/kitten/work/translate", route => {
    evidence.blockedRequests.push({ method: route.request().method(), url: route.request().url() });
    return route.abort("internetdisconnected");
  });
  await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), body = await response.text();
    if (sha(body) !== evidence.bundle.sha256) throw new Error("Official main bundle changed");
    await route.fulfill({ response, body: body.replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") });
  });
  await page.goto(evidence.officialUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") &&
    (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  Object.assign(evidence, await page.evaluate(async () => {
    const req = window.__nekocRequire;
    const core = req(26921).cG.get_instance().getHeart().core, registry = core.get_registry();
    const calls = [];
    const call = async (name, args) => {
      const fn = registry.domain_function_list[registry.get_domain_function_index(name)];
      const value = fn(args, "panel-services", "missing-actor", "missing-actor", "probe", {});
      const promise = !!value?.then;
      const result = await value;
      calls.push({ name, args, promise, result: result === undefined ? { type: "undefined" } :
        { type: typeof result, value: typeof result === "number" && Number.isNaN(result) ? "NaN" : result } });
    };
    for (const text of ["", " \t\n", "猫", 123]) {
      await call("translate_result", { text, language: "en" });
      await call("translate", { text, language: "en" });
    }
    for (const ranking of ["?", "missing-ranking"]) {
      await call("user_ranking_info", { ranking, type: "rank" });
      await call("user_info_of_th", { ranking, type: "username", order: 1 });
      await call("show_hide_ranking", { ranking, show_hide: "show" });
      await call("show_hide_ranking", { ranking, show_hide: "hide" });
      await call("update_ranking", { ranking, variable: "missing-variable" });
    }
    // Source-backed negative target branch only; this is not a visual effect test.
    await call("global_animation", { animation: "animation_salvo" });
    return { calls, version: req(91107).BcmInstance.getBcm().version };
  }));
} finally { await browser.close(); }
evidence.ok = !evidence.pageErrors.length && evidence.calls.length === 19 &&
  evidence.calls.every(call => call.result.type === (call.name === "translate_result" ? "string" :
    ["user_ranking_info", "user_info_of_th"].includes(call.name) ? "number" : "undefined")) &&
  evidence.blockedRequests.length === 4;
await fs.writeFile(`${out}/services-report.json`, JSON.stringify(evidence, null, 2) + "\n");
if (process.argv.includes("--record") && evidence.ok) await fs.writeFile("docs/kn-panel-services-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.ok) process.exitCode = 1;
