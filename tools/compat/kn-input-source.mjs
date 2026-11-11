#!/usr/bin/env node
// Read-only inspection of public official KN bundles. Vendor bytes stay in dist.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../probe-kitten4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "dist/kn-input-source");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const symbols = ["on_swipe", "onSwipe", "swipe", "keydown", "keyup", "keyCode", "touchstart", "touchmove", "touchend", "mousedown", "mouseup", "mousemove", "mouse_click", "hit_test", "hitTest", "containsPoint", "get_mouse", "is_key_pressed", "is_mouse_down", "global_tap", "get_action_state_value", "automatic_transitions"];
await mkdir(out, { recursive: true });
if (process.argv[2] === "search") {
  const needle = process.argv[3];
  if (!needle) throw new Error("Usage: kn-input-source.mjs search <literal> [context=600]");
  const context = Number(process.argv[4] || 600);
  const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
  for (const { file: name } of manifest.modules) {
    const source = await readFile(path.join(out, name), "utf8");
    let at = -1, count = 0;
    while ((at = source.indexOf(needle, at + 1)) >= 0 && count++ < 60)
      console.log(JSON.stringify({ file: name, offset: at, text: source.slice(Math.max(0, at - context), at + needle.length + context) }));
  }
} else {
  const response = await fetch("https://kn.codemao.cn/editor");
  if (!response.ok) throw new Error(`Editor HTTP ${response.status}`);
  const html = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(out, "editor.html"), html);
  const urls = [...html.toString().matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => new URL(m[1], response.url).href);
  const manifest = { fetchedAt: new Date().toISOString(), requestedUrl: "https://kn.codemao.cn/editor", finalUrl: response.url,
    htmlSha256: hash(html), method: "Public script downloads; in-memory main bootstrap addition exposes existing webpack require; inspect factory strings only; no project or input events executed.", assets: [], modules: [], pageErrors: [] };
  const downloaded = new Map();
  for (const url of urls) {
    const asset = await fetch(url);
    if (!asset.ok) throw new Error(`${url}: HTTP ${asset.status}`);
    const bytes = Buffer.from(await asset.arrayBuffer());
    const name = new URL(url).pathname.split("/").pop();
    await writeFile(path.join(out, name), bytes);
    downloaded.set(url, bytes.toString());
    manifest.assets.push({ url, file: name, bytes: bytes.length, sha256: hash(bytes) });
  }
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  try {
    manifest.browser = browser.version();
    const page = await browser.newPage();
    page.on("pageerror", error => manifest.pageErrors.push(String(error)));
    await page.route(/\/static\/js\//, async route => {
      const url = route.request().url();
      let body = downloaded.get(url);
      if (body === undefined) return route.continue();
      if (/\/main\./.test(url)) {
        const marker = "var __webpack_exports__=";
        if (!body.includes(marker)) throw new Error("Unknown bootstrap; refusing to guess require exposure");
        body = body.replace(marker, "window.__nekocRequire=__webpack_require__;" + marker);
      }
      await route.fulfill({ status: 200, contentType: "application/javascript", body });
    });
    await page.goto(manifest.finalUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.__nekocRequire?.m, null, { timeout: 120000 });
    const modules = await page.evaluate(symbols => Object.entries(window.__nekocRequire.m).flatMap(([id, factory]) => {
      const source = factory.toString();
      const matches = symbols.filter(s => source.includes(s));
      return matches.length || ["1753", "11937", "8541"].includes(id) ? [{ id, source, matches }] : [];
    }), symbols);
    for (const module of modules) {
      const file = `module-${module.id}.js`;
      await writeFile(path.join(out, file), module.source);
      const locations = [...downloaded].flatMap(([url, source]) => {
        const factoryOffset = source.indexOf(module.source);
        return factoryOffset >= 0 ? [{ url, factoryOffset }] : [];
      });
      manifest.modules.push({ id: module.id, file, chars: module.source.length, sha256: hash(Buffer.from(module.source)), locations, symbols: module.matches });
    }
  } catch (error) {
    manifest.failure = String(error.stack || error);
    process.exitCode = 1;
  } finally { await browser.close(); }
  await writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest, null, 2));
}
