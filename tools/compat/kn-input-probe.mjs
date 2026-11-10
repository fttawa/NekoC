#!/usr/bin/env node
// Self-authored fixture and browser input oracle. Official source bytes stay in dist.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../probe-kitten4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = "tests/fixtures/input-kn.bcmkn";
const out = path.join(root, "dist/kn-input-probe");
const sha256 = value => createHash("sha256").update(value).digest("hex");
await mkdir(out, { recursive: true });
if (process.argv[2] === "generate") {
  const project = JSON.parse(await readFile(path.join(root, "samples/kitten-n-0.27.4.bcmkn"), "utf8"));
  project.projectName = "NekoC KN input oracle";
  let serial = 0;
  const block = (type, fields = {}, inputs = {}) => ({ type, id: `kn-input-${++serial}`, fields, inputs });
  const number = n => block("math_number", { NUM: String(n) });
  const increment = name => block("change_variables", { variable: name, method: "increase" }, { value: number(1) });
  const hat = (type, fields, body) => ({ ...block(type, fields), next: body });
  const names = ["ready", "a-down", "a-up", "any-down", "any-up", "sprite-down", "sprite-up", "sprite-click"];
  project.variables.variablesDict = Object.fromEntries(names.map((id, index) => [id, {
    id, name: id, value: 0, type: "any", isGlobal: true, currentEntityId: "nekoc-default-actor",
    visible: true, position: { x: -430, y: 250 - index * 30 },
  }]));
  project.actors.actorsDict["nekoc-default-actor"].nekoBlockJsonList = [
    hat("on_running_group_activated", {}, block("variables_set", { variable: "ready" }, { value: number(1) })),
    ...[["down", "65", "a-down"], ["up", "65", "a-up"], ["down", "any", "any-down"], ["up", "any", "any-up"]]
      .map(([type, key, name]) => hat("on_keydown", { type, key }, increment(name))),
    ...["down", "up", "click"].map(type => hat("sprite_on_tap", { type: `mouse_${type}`, sprite: "--self" }, increment(`sprite-${type}`))),
  ];
  await writeFile(path.join(root, fixture), JSON.stringify(project, null, 2) + "\n");
  console.log(fixture);
} else {
  const source = await readFile(path.join(root, fixture), "utf8");
  const report = {
    schema: "nekoc-kn-input-official-v1", checkedAt: new Date().toISOString(), editorUrl: "https://kn.codemao.cn/editor",
    fixture, fixtureSha256: sha256(source), method: "Load self-authored project through previewUrl, click official Start, send browser keyboard/mouse events, read official runtime variables. Only webpack require reference and passive event logging added.",
    sources: [], samples: [], mouseSamples: [], pageErrors: [], consoleErrors: [], failures: [],
    okMeaning: "Keyboard held-state assertion and fixture editor-compat passed, with no uncaught page errors. Optional mouse result is separate; console/resource errors are retained and are not a claim of a clean network session.",
    limitations: ["Headless desktop Edge only; no physical keyboard, touch device, blur or IME testing.", "No comparison against NekoC runtime; this is an official editor oracle only.", "Observed counts depend on scheduling; monotonic growth/stability is tested, not a fixed FPS or exact frame count."],
  };
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  report.browser = browser.version();
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => report.pageErrors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
    await page.route(/\/static\/js\/(main|crc_libs|main-vendors|base)\.[\w-]+\.js(?:\?.*)?$/, async route => {
      const response = await route.fetch();
      const bytes = await response.body();
      const url = route.request().url();
      const name = new URL(url).pathname.split("/").pop();
      await writeFile(path.join(out, name), bytes);
      report.sources.push({ url, sha256: sha256(bytes), bytes: bytes.length });
      let body = bytes.toString("utf8");
      if (/\/main\./.test(url)) {
        const marker = "var __webpack_exports__=";
        if (!body.includes(marker)) throw new Error("Unknown official webpack bootstrap");
        body = body.replace(marker, "window.__nekocRequire=__webpack_require__;" + marker);
      }
      await route.fulfill({ response, body });
    });
    const projectUrl = "https://kn.codemao.cn/__nekoc_kn_input_oracle__.bcmkn";
    await page.route(projectUrl, route => route.fulfill({ contentType: "application/json", body: source }));
    await page.goto(report.editorUrl + "?previewUrl=" + encodeURIComponent(projectUrl), { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.__nekocRequire && window.__nekocRequire(91107).BcmInstance.getBcm().projectName === "NekoC KN input oracle" && document.body.innerText.includes("a-down"), null, { timeout: 120000 });
    await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
    const done = page.getByText(/^完成$/).last();
    if (await done.isVisible()) await done.dispatchEvent("click");
    await page.getByText(/^开始$/).last().dispatchEvent("click");
    await page.waitForFunction(() => {
      const core = window.__nekocRequire(26921).cG.get_instance().getHeart().core;
      return core.get_runtime_data().is_running() && core.get_runtime_manager().get_variable("ready") === 1;
    }, null, { timeout: 30000 });
    await page.evaluate(() => {
      window.__knInputEvents = [];
      for (const type of ["keydown", "keyup"]) document.body.addEventListener(type, event => {
        window.__knInputEvents.push({ type, keyCode: event.keyCode, key: event.key, repeat: event.repeat, isTrusted: event.isTrusted, at: performance.now() });
      }, { capture: true });
    });
    const snapshot = async (label, group = "samples") => {
      const value = await page.evaluate(label => {
        const req = window.__nekocRequire;
        const runtime = req(26921).cG.get_instance();
        const core = runtime.getHeart().core;
        const manager = core.get_runtime_manager(), data = core.get_runtime_data();
        const variables = Object.fromEntries(Object.keys(req(91107).BcmInstance.variablesDict).map(id => [id, manager.get_variable(id)]));
        return { label, at: performance.now(), running: data.is_running(), variables,
          aState: data.get_action_state_value({ action_id: "on_keydown", action_namespace: "", sub_type: "65" }),
          anyState: data.get_action_state_value({ action_id: "on_keydown", action_namespace: "", sub_type: "any" }),
          keyboardEvents: structuredClone(window.__knInputEvents) };
      }, label);
      report[group].push(value);
      console.log(label, JSON.stringify(value.variables));
      return value;
    };
    await page.locator("body").click({ position: { x: 4, y: 4 } });
    await snapshot("before-down");
    await page.keyboard.down("a");
    await page.waitForTimeout(180);
    await snapshot("held-180ms");
    await page.waitForTimeout(600);
    await snapshot("held-780ms");
    await page.waitForTimeout(600);
    await snapshot("held-1380ms");
    await page.keyboard.up("a");
    await page.waitForTimeout(250);
    await snapshot("released-250ms");
    await page.waitForTimeout(600);
    await snapshot("released-850ms");
    const [baseline, early, middle, late, released, stable] = report.samples;
    const finalEvents = stable.keyboardEvents;
    const exactlyOnePair = finalEvents.length === 2 && finalEvents[0].type === "keydown" && finalEvents[1].type === "keyup" && finalEvents.every(event => event.keyCode === 65 && event.repeat === false);
    report.keyboardConclusion = {
      verified: early.running && stable.running && late.variables["a-down"] > middle.variables["a-down"] && middle.variables["a-down"] > early.variables["a-down"] && stable.variables["a-down"] === released.variables["a-down"] && stable.variables["a-up"] > baseline.variables["a-up"] && late.keyboardEvents.length === 1 && late.keyboardEvents[0].type === "keydown" && late.keyboardEvents[0].repeat === false && exactlyOnePair,
      exactlyOneKeydownAndKeyup: exactlyOnePair,
      interpretation: "A short synchronous on_keydown/down script is restarted while the key state remains down after one browser keydown; releasing the key stops further down count growth. Not an OS autorepeat test.",
      holdGrowth: late.variables["a-down"] - early.variables["a-down"], afterReleaseGrowth: stable.variables["a-down"] - released.variables["a-down"],
    };
    // Optional mouse test uses the rendered actor's actual stage projection.
    try {
      report.mouseTarget = await page.evaluate(() => {
        const stage = window.__nekocRequire(54174).V;
        const result = stage.core.actors.get_actor("nekoc-default-actor");
        if (result.is_error(result.value)) throw new Error("Fixture actor absent");
        const actor = result.value;
        const bounds = actor.getBounds();
        const canvas = stage.core.get_view();
        const rect = canvas.getBoundingClientRect();
        const local = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        return { x: rect.x + local.x * rect.width / canvas.width, y: rect.y + local.y * rect.height / canvas.height,
          canvas: { width: canvas.width, height: canvas.height }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
      });
      await snapshot("before-mouse", "mouseSamples");
      await page.mouse.move(report.mouseTarget.x, report.mouseTarget.y);
      await page.mouse.down();
      await page.waitForTimeout(160);
      await snapshot("short-held", "mouseSamples");
      await page.mouse.up();
      await page.waitForTimeout(200);
      await snapshot("short-released", "mouseSamples");
      await page.mouse.down();
      await page.waitForTimeout(1200);
      await snapshot("long-held-1200ms", "mouseSamples");
      await page.mouse.up();
      await page.waitForTimeout(250);
      await snapshot("long-released", "mouseSamples");
      const [before, shortHeld, shortReleased, longHeld, longReleased] = report.mouseSamples;
      report.mouseConclusion = {
        verified: shortReleased.variables["sprite-click"] > before.variables["sprite-click"] && shortHeld.variables["sprite-down"] > before.variables["sprite-down"] && longHeld.variables["sprite-down"] > shortReleased.variables["sprite-down"] && longReleased.variables["sprite-click"] === shortReleased.variables["sprite-click"] && longReleased.variables["sprite-up"] > shortReleased.variables["sprite-up"],
        interpretation: "Actor down repeats during hold; a short release clicks; a >1s hold still releases but adds no click. No drag/outside/transparent pixel cases covered.",
      };
    } catch (error) { report.failures.push({ phase: "optional-mouse", error: String(error.stack || error) }); }
    report.finalKeyboardEvents = await page.evaluate(() => window.__knInputEvents);
    await page.screenshot({ path: path.join(out, "final.png") });
  } catch (error) {
    report.failures.push({ phase: "keyboard-probe", error: String(error.stack || error) });
    if (page) await writeFile(path.join(out, "failure-page.txt"), await page.locator("body").innerText().catch(() => "Unavailable"));
  } finally { await browser.close(); }
  try {
    const compatibility = JSON.parse(await readFile(path.join(out, "editor-compat.json"), "utf8"));
    for (const project of compatibility.projects) project.input = fixture;
    compatibility.fixtureSha256 = sha256(source);
    compatibility.hashAttribution = "Validation was run immediately before the probe on the same generated fixture; re-run editor-compat after regenerating it.";
    report.editorCompat = compatibility;
  } catch { report.editorCompat = { ok: false, limitation: "No editor-compat report found; run validator first." }; }
  report.ok = report.keyboardConclusion?.verified === true && report.editorCompat.ok === true && report.pageErrors.length === 0;
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(root, "docs/input-kn-evidence.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: report.ok, keyboard: report.keyboardConclusion, mouse: report.mouseConclusion, failures: report.failures }, null, 2));
  if (!report.ok) process.exitCode = 1;
}
