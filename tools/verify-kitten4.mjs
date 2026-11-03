#!/usr/bin/env node
// Browser integration oracle for native .bcm projects. Uses the official loader,
// Blockly deserializer, Start UI handler, keyboard events, and actual stage pixels.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPlaywright, openOfficial, loadOfficialProject, officialUrl } from "./probe-kitten4.mjs";

function parseArgs(argv) {
  const args = { timeoutMs: 120000, afterMs: 1000, channel: process.env.NEKOC_BROWSER_CHANNEL || "msedge" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--expect") args.expect = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--screenshot") args.screenshot = argv[++i];
    else if (arg === "--artifacts-dir") args.artifactsDir = argv[++i];
    else if (arg === "--channel") args.channel = argv[++i];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
    else if (arg === "--after-ms") args.afterMs = Number(argv[++i]);
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--no-run") args.noRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-") && !args.input) args.input = arg;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function compareWorkspace(expected, actual, entity) {
  const issues = [];
  for (const [id, block] of Object.entries(expected.blocks || {})) {
    const loaded = actual.blocks[id];
    if (!loaded) { issues.push(`${entity}/${id}: block missing after native deserialization`); continue; }
    if (loaded.type !== block.type) issues.push(`${entity}/${id}: type ${block.type} became ${loaded.type}`);
    if (block.mutation && normalizeMutation(block.mutation) !== normalizeMutation(loaded.mutation)) issues.push(`${entity}/${id}: native mutation changed: ${JSON.stringify(block.mutation)} -> ${JSON.stringify(loaded.mutation)}`);
    for (const [key, value] of Object.entries(block.fields || {})) {
      if (String(loaded.fields[key]) !== String(value)) issues.push(`${entity}/${id}.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(loaded.fields[key])}`);
    }
    for (const [child, edge] of Object.entries(expected.connections?.[id] || {})) {
      const connected = actual.connections[id]?.[child];
      if (!connected || Object.keys(edge).some(key => edge[key] !== connected[key])) issues.push(`${entity}/${id}->${child}: native connection missing or changed (${JSON.stringify(edge)})`);
    }
  }
  return issues;
}

function normalizeMutation(xml) {
  return (xml || "").replace(/\s+xmlns=(['"]).*?\1/g, "").replace(/\s+(?:elseif|else)=(['"])0\1/g, "")
    .replace(/<([\w:-]+)([^>]*?)\s*\/>/g, "<$1$2></$1>").replace(/>\s+</g, "><").trim();
}

async function captureCheckpoint(page, directory, name) {
  if (!directory) return undefined;
  const images = await page.evaluate(async () => {
    const stage = window.__nekocKitten4Require("HP1x").a();
    return { stage: await stage.screenshot(), brush: stage.get_scene_by_id(stage.get_current_scene_id()).get_brush_ctx().canvas.toDataURL("image/png") };
  });
  await mkdir(directory, { recursive: true });
  const paths = {};
  for (const [kind, dataUrl] of Object.entries(images)) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) throw new Error(`Native ${kind} screenshot did not return an image`);
    const extension = dataUrl.startsWith("data:image/jpeg") ? "jpg" : "png";
    const filename = path.join(directory, `${name}-${kind}.${extension}`);
    await writeFile(filename, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    paths[kind] = filename.replaceAll("\\", "/");
  }
  return paths;
}

async function inspectWorkspaces(page) {
  return page.evaluate(() => {
    const req = window.__nekocKitten4Require;
    const doc = req("TzHo").e.getDoc();
    const manager = req("Fye/").B;
    const original = manager.get_current_workspace_data().get_entity_id();
    const workspaces = {};
    for (const id of [...Object.keys(doc.theatre.scenes), ...Object.keys(doc.theatre.actors)]) {
      manager.select_workspace_by_id(id);
      workspaces[id] = Blockly.json.workspace_to_json(Blockly.mainWorkspace);
    }
    manager.select_workspace_by_id(original);
    const view = req("HP1x").a().core.get_view();
    return { workspaces, exported: req("3PHN").d(), runtimeSize: { width: view.width, height: view.height }, scripts: [...document.scripts].map(script => script.src).filter(Boolean) };
  });
}

async function snapshot(page, expected = {}) {
  return page.evaluate(expected => {
    const req = window.__nekocKitten4Require;
    const doc = req("TzHo").e.getDoc();
    const stage = req("HP1x").a();
    const heart = req("JnWR").b();
    const manager = heart.get_runtime_manager();
    const actors = {};
    for (const [id, entity] of Object.entries(doc.theatre.actors)) {
      const actor = stage.get_actor_by_id(id);
      if (!actor) continue;
      const brush = actor.get_brush();
      actors[id] = { name: entity.name, ...actor.get_position(), rotation: actor.get_rotation() * 180 / Math.PI,
        visible: actor.get_visible(), scale: actor.get_scale(), brush: { size: brush.get_size(), color: `#${brush.get_color()}`, alpha: brush.get_alpha(), down: brush.origin_x !== undefined && brush.origin_y !== undefined } };
    }
    const variables = {};
    for (const [id, variable] of Object.entries(doc.variables)) {
      try { variables[id] = { name: variable.name, value: manager.get_variable(id, undefined, variable.current_entity) }; }
      catch (error) { variables[id] = { name: variable.name, error: String(error) }; }
    }
    const scene = stage.get_scene_by_id(stage.get_current_scene_id());
    const ctx = scene.get_brush_ctx();
    const canvas = ctx.canvas;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nontransparentPixels = 0, minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    const colors = {};
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) {
      nontransparentPixels++;
      const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (pixels[i + 3] >= 240) {
        const color = "#" + Array.from(pixels.slice(i, i + 3), value => value.toString(16).padStart(2, "0")).join("");
        colors[color] = (colors[color] || 0) + 1;
      }
    }
    const samples = (expected.brush?.samples || []).map(point => {
      const x = Math.round(canvas.width / 2 + point.x), y = Math.round(canvas.height / 2 - point.y);
      return { x: point.x, y: point.y, rgba: x >= 0 && y >= 0 && x < canvas.width && y < canvas.height ? Array.from(ctx.getImageData(x, y, 1, 1).data) : null };
    });
    return { actors, variables, brush: { width: canvas.width, height: canvas.height, nontransparentPixels,
      bounds: nontransparentPixels ? { minX, minY, maxX, maxY } : null,
      colors: Object.fromEntries(Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 24)), samples },
      running: heart.get_runtime_data().is_running(), statistics: heart.get_statistics(), error: req("ALsR").a.get_state().error_state };
  }, expected);
}

function checkSnapshot(state, expected, label) {
  const issues = [];
  const equal = (actual, wanted, name) => {
    if (typeof wanted === "number" ? typeof actual !== "number" || Math.abs(actual - wanted) > 1e-6 : JSON.stringify(actual) !== JSON.stringify(wanted)) issues.push(`${label}: ${name}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
  };
  for (const [key, wanted] of Object.entries(expected.variables || {})) {
    const actual = state.variables[key] || Object.values(state.variables).find(variable => variable.name === key);
    equal(actual?.value, wanted, `variable ${key}`);
  }
  for (const [key, wanted] of Object.entries(expected.actors || {})) {
    const actual = state.actors[key] || Object.values(state.actors).find(actor => actor.name === key);
    for (const [field, value] of Object.entries(wanted)) {
      if (field === "brush") for (const [prop, val] of Object.entries(value)) equal(actual?.brush?.[prop], val, `actor ${key}.brush.${prop}`);
      else equal(actual?.[field], value, `actor ${key}.${field}`);
    }
  }
  const brush = expected.brush || {};
  if (brush.width !== undefined) equal(state.brush.width, brush.width, "brush canvas width");
  if (brush.height !== undefined) equal(state.brush.height, brush.height, "brush canvas height");
  if (brush.minNontransparentPixels !== undefined && state.brush.nontransparentPixels < brush.minNontransparentPixels) issues.push(`${label}: brush has only ${state.brush.nontransparentPixels} painted pixels`);
  if (brush.maxNontransparentPixels !== undefined && state.brush.nontransparentPixels > brush.maxNontransparentPixels) issues.push(`${label}: brush has ${state.brush.nontransparentPixels} painted pixels, expected at most ${brush.maxNontransparentPixels}`);
  for (const [color, minimum] of Object.entries(brush.colors || {})) if ((state.brush.colors[color] || 0) < minimum) issues.push(`${label}: brush color ${color} has ${state.brush.colors[color] || 0} pixels, expected at least ${minimum}`);
  for (let i = 0; i < (brush.samples || []).length; i++) {
    const wanted = brush.samples[i], actual = state.brush.samples[i].rgba;
    const rgb = wanted.color.replace(/^#/, "").match(/../g).map(value => parseInt(value, 16));
    if (!actual || actual[3] < (wanted.minAlpha ?? 240) || rgb.some((value, channel) => Math.abs(value - actual[channel]) > (wanted.tolerance ?? 4))) issues.push(`${label}: brush at (${wanted.x},${wanted.y}) expected ${wanted.color}, got ${JSON.stringify(actual)}`);
  }
  if (state.error.show_error) issues.push(`${label}: native error: ${state.error.error_string}`);
  return issues;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log("Usage: node tools/verify-kitten4.mjs --input project.bcm [--expect expectations.json] [--out report.json] [--screenshot editor.png] [--artifacts-dir directory] [--after-ms 1000] [--timeout-ms 120000] [--channel msedge] [--headed] [--no-run]\nExpectations: {startup:{variables:{name:value},actors:{id:{x,y}},brush:{minNontransparentPixels,colors,samples}},steps:[{keys:[\"ArrowRight\"],releaseOnVariable:\"keyCount\",expect:{...}}]}\nreleaseOnVariable releases the DOM key on its first native variable-update notification; K4 key-down hats otherwise repeat while held.");
    if (!args.help) process.exitCode = 1;
    return;
  }
  const text = await readFile(args.input, "utf8");
  const project = JSON.parse(text);
  if (project.work_type !== "KITTEN" || !project.theatre?.scenes || !project.theatre?.actors) throw new Error("Expected native Kitten 4 .bcm project with work_type KITTEN and theatre maps");
  const expected = args.expect ? JSON.parse(await readFile(args.expect, "utf8")) : {};
  const report = { input: path.resolve(args.input), sha256: createHash("sha256").update(text).digest("hex"), verifiedAt: new Date().toISOString(), officialUrl, browserChannel: args.channel, imported: false, started: false, issues: [], checkpoints: [], consoleErrors: [], pageErrors: [] };
  const browser = await loadPlaywright().chromium.launch({ headless: !args.headed, channel: args.channel });
  report.browserVersion = browser.version();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
    page.on("pageerror", error => report.pageErrors.push(String(error)));
    report.phase = "opening official editor";
    await openOfficial(page, args.timeoutMs);
    report.phase = "loading routed bcm";
    await loadOfficialProject(page, project, args.timeoutMs);
    report.phase = "native workspace roundtrip";
    const inspected = await inspectWorkspaces(page);
    report.applicationVersion = inspected.exported.application_version;
    report.bcmVersion = inspected.exported.version;
    report.vendorScripts = inspected.scripts;
    report.dimensions = { input: { type: project.type, size: project.size }, nativeExport: { type: inspected.exported.type, size: inspected.exported.size }, runtimeCanvas: inspected.runtimeSize };
    report.workspaces = {};
    for (const [id, entity] of Object.entries({ ...project.theatre.scenes, ...project.theatre.actors })) {
      const actual = inspected.workspaces[id];
      report.issues.push(...compareWorkspace(entity.block_data_json || { blocks: {} }, actual, id));
      report.workspaces[id] = { blocks: Object.keys(actual.blocks).length, connections: Object.values(actual.connections).reduce((sum, edges) => sum + Object.keys(edges).length, 0) };
    }
    report.imported = report.issues.length === 0;
    if (!args.noRun) {
      report.phase = "native runtime";
      // Dispatch the actual editor Start element's click event. Promotional overlays
      // sometimes intercept pointer input; this still invokes its native React handler.
      await page.locator("#btn_trigger").dispatchEvent("click");
      report.started = true;
      await page.waitForTimeout(args.afterMs);
      const startup = expected.startup || expected;
      const state = await snapshot(page, startup);
      if (expected.requireInputStageSize && (state.brush.width !== project.size.width || state.brush.height !== project.size.height)) report.issues.push(`runtime stage size ${state.brush.width}x${state.brush.height} differs from input ${project.size.width}x${project.size.height}`);
      report.checkpoints.push({ label: "startup", state, screenshots: await captureCheckpoint(page, args.artifactsDir, "00-startup") });
      report.issues.push(...checkSnapshot(state, startup, "startup"));
      for (let i = 0; i < (expected.steps || []).length; i++) {
        const step = expected.steps[i];
        for (const key of step.keys || []) {
          if (step.releaseOnVariable) {
            // K4's key-down hat repeats while held. Observe its native variable
            // notification and release the DOM key after one script completes.
            await page.evaluate(({ key, variable }) => {
              const req = window.__nekocKitten4Require;
              const variables = req("TzHo").e.getDoc().variables;
              const id = variables[variable] ? variable : Object.keys(variables).find(id => variables[id].name === variable);
              if (!id) throw new Error(`Unknown releaseOnVariable ${variable}`);
              const codes = { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, Space: 32, Enter: 13 };
              const keyCode = codes[key] || key.toUpperCase().charCodeAt(0);
              window.__nekocKeyReleased = false;
              let done = false;
              req("JnWR").b().get_event_bus().runtime_data.variable_update.immediate.sub(event => {
                if (done || event.var_id !== id) return;
                done = true;
                document.body.dispatchEvent(new KeyboardEvent("keyup", { key, code: key, keyCode, which: keyCode, bubbles: true }));
                window.__nekocKeyReleased = true;
              });
            }, { key, variable: step.releaseOnVariable });
            await page.keyboard.down(key);
            try { await page.waitForFunction(() => window.__nekocKeyReleased, null, { timeout: args.timeoutMs }); }
            finally { await page.keyboard.up(key); }
          } else {
            await page.keyboard.press(key, { delay: step.holdMs ?? 30 });
          }
          await page.waitForTimeout(step.keyDelayMs ?? 100);
        }
        await page.waitForTimeout(step.afterMs ?? 200);
        const label = step.label || `step ${i + 1}`;
        const state = await snapshot(page, step.expect || {});
        report.checkpoints.push({ label, keys: step.keys, releaseOnVariable: step.releaseOnVariable, state, screenshots: await captureCheckpoint(page, args.artifactsDir, `${String(i + 1).padStart(2, "0")}-step`) });
        report.issues.push(...checkSnapshot(state, step.expect || {}, label));
      }
    }
    if (args.screenshot) { await mkdir(path.dirname(path.resolve(args.screenshot)), { recursive: true }); await page.screenshot({ path: args.screenshot }); }
    report.issues.push(...report.pageErrors.map(error => `browser exception: ${error}`));
    report.phase = "completed";
  } catch (error) { report.issues.push(String(error)); }
  finally { await browser.close(); }
  report.ok = report.imported && report.issues.length === 0;
  report.runtimeVerified = report.ok && report.started && Boolean(args.expect) && report.checkpoints.length > 0;
  if (args.out) { await mkdir(path.dirname(path.resolve(args.out)), { recursive: true }); await writeFile(args.out, JSON.stringify(report, null, 2) + "\n"); }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
