#!/usr/bin/env node
// Original missing-slot probe; official sources/assets are never archived.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixtures, probe, officialUrl } from "./semantics-kitten-n.mjs";
import { loadPlaywright } from "./probe-kitten4.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function missingInputsProject() {
  const p = fixtures().scheduling;
  p.projectName = "NekoC KN semantics missing-inputs";
  const actor = Object.values(p.actors.actorsDict)[0];
  let id = 0;
  const block = (type, fields = {}, inputs = {}) => ({ id: `missing-${++id}`, type, fields, inputs });
  const number = n => block("math_number", { NUM: String(n) });
  const roots = [block("on_running_group_activated")];
  const values = { done: 0 };
  for (const op of ["add", "minus", "multiply", "divide", "power"]) {
    for (const slot of ["A", "B", "both"]) {
      const name = `${op}_${slot}`;
      const inputs = slot === "both" ? {} : { [slot === "A" ? "B" : "A"]: number(7) };
      roots.push(block("variables_set", { variable: name }, { value: block("math_arithmetic", { type: op }, inputs) }));
      values[name] = "not-run";
    }
  }
  roots.push(block("variables_set", { variable: "done" }, { value: number(1) }));
  roots.forEach((b, i) => { if (i + 1 < roots.length) b.next = roots[i + 1]; });
  actor.nekoBlockJsonList = [roots[0]];
  const template = Object.values(p.variables.variablesDict)[0];
  p.variables.variablesDict = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { ...template, id, name: id, value }]));
  return p;
}

async function main() {
  const dir = "dist/kncompat/missing-inputs";
  await mkdir(dir, { recursive: true });
  const source = JSON.stringify(missingInputsProject(), null, 2) + "\n";
  const fixture = `${dir}/probe.bcmkn`;
  if (process.argv.includes("--archive")) {
    const result = JSON.parse(await readFile(`${dir}/official.json`, "utf8"));
    const editor = result.editorCompat;
    if (!result.ok || result.sha256 !== createHash("sha256").update(source).digest("hex") ||
        result.pageErrors.length || !editor.ok || editor.projects.length !== 1 ||
        !editor.projects[0].ok || editor.projects[0].sha256 !== result.sha256 ||
        !result.mainBundle?.sha256 || !result.runtimeBundle?.sha256 ||
        result.variables.done !== 1 || Object.keys(result.variables).length !== 16 ||
        Object.entries(result.variables).some(([key, value]) => key !== "done" && JSON.stringify(value) !== '{"$number":"NaN"}')) {
      throw new Error("Refuse incomplete or stale missing-slot evidence");
    }
    editor.projects[0].input = fixture;
    delete result.normalizedArithmetic;
    delete result.scripts;
    await writeFile("docs/kn-missing-inputs-official.json", JSON.stringify(result, null, 2) + "\n");
    return;
  }
  await writeFile(fixture, source);
  if (process.argv.includes("--generate")) return;
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const result = { officialUrl, verifiedAt: new Date().toISOString(), browserVersion: browser.version(), fixture, sha256: createHash("sha256").update(source).digest("hex"), pageErrors: [] };
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => result.pageErrors.push(String(e)));
    await probe(page, source, result);
    result.normalizedArithmetic = await page.evaluate(() => {
      const found = [];
      function walk(b) {
        if (!b || typeof b !== "object") return;
        if (b.type === "math_arithmetic") found.push(b);
        Object.values(b).forEach(walk);
      }
      walk(window.__nekocRequire(91107).BcmInstance.getBcm());
      return found;
    });
    const editor = JSON.parse(await readFile(`${dir}/editor.json`, "utf8"));
    result.editorCompat = editor;
    result.ok = result.variables.done === 1 && !result.pageErrors.length && editor.ok;
  } catch (error) { result.error = String(error); result.ok = false; }
  finally { await browser.close(); }
  await writeFile(`${dir}/official.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
