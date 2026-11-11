#!/usr/bin/env node
// Inspect live official implementations; generated evidence stays in ignored dist/.
import { mkdir, writeFile } from "node:fs/promises";
import { loadPlaywright, openOfficial } from "./probe-kitten4.mjs";

const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
await mkdir("dist/nonfinite", { recursive: true });
try {
  for (const product of ["kitten4", "kn"]) {
    const page = await browser.newPage();
    if (product === "kitten4") await openOfficial(page);
    else {
      await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/, async route => {
        const response = await route.fetch();
        const source = await response.text();
        await route.fulfill({ response, body: source.replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") });
      });
      await page.goto("https://kn.codemao.cn/editor", { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas"), null, { timeout: 120000 });
    }
    const result = await page.evaluate(product => {
      const req = product === "kitten4" ? window.__nekocKitten4Require : window.__nekocRequire;
      return { url: location.href, scripts: [...document.scripts].map(s => s.src).filter(Boolean),
        modules: Object.entries(req.m).filter(([id, fn]) => id === "75337" || /math_arithmetic|set_position|set_rotation|set_scale|pure_list_item|math_modulo|self_move_to|self_set_x|math_compute|selfMoveTo|selfSetScale|mathArithmetic|setScale\(/.test(String(fn))).map(([id, fn]) => ({ id, source: String(fn) })) };
    }, product);
    await writeFile(`dist/nonfinite/${product}-sources.json`, JSON.stringify(result, null, 2));
    console.log(product, result.modules.map(m => [m.id, m.source.length]));
    await page.close();
  }
} finally { await browser.close(); }
