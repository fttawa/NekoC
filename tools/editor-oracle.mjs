#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const crateRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(crateRoot, "..");
const harnessRoot = path.join(workspaceRoot, "research", "kn-editor-local");
const serverPath = path.join(harnessRoot, "server.mjs");
const bundledNodeModules =
  process.env.NEKOC_NODE_MODULES ||
  "C:\\Users\\fttawa\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";

function usage() {
  console.error(`Usage:
  node tools/editor-oracle.mjs --input <file.bcmkn> [--out report.json]

Options:
  --input <path>       .bcmkn JSON project to open in the local editor.
  --out <path>         Optional JSON report path.
  --port <number>      Local harness port. Default: 4177.
  --timeout-ms <ms>    Load timeout. Default: 45000.
  --after-ms <ms>      Wait after clicking start before snapshot. Default: 1000.
  --no-click-start     Only load and inspect; do not press the start button.
  --keep-open          Leave Chromium open for manual inspection.
  --no-start-server    Require an already-running harness server.
`);
}

function parseArgs(argv) {
  const args = {
    port: 4177,
    timeoutMs: 45000,
    afterMs: 1000,
    clickStart: true,
    keepOpen: false,
    startServer: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--port") args.port = Number(argv[++i]);
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
    else if (arg === "--after-ms") args.afterMs = Number(argv[++i]);
    else if (arg === "--no-click-start") args.clickStart = false;
    else if (arg === "--keep-open") args.keepOpen = true;
    else if (arg === "--no-start-server") args.startServer = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function fetchOk(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchOk(`${baseUrl}/__neko_debug__/health`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function ensureServer(baseUrl, port, startServer) {
  if (await fetchOk(`${baseUrl}/__neko_debug__/health`)) {
    return { started: false };
  }
  if (!startServer) {
    throw new Error(`Local harness is not reachable at ${baseUrl}`);
  }
  if (!existsSync(serverPath)) {
    throw new Error(`Missing local editor harness server: ${serverPath}`);
  }
  const child = spawn(process.execPath, [serverPath, `--port=${port}`], {
    cwd: workspaceRoot,
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  if (!(await waitForHealth(baseUrl, 10000))) {
    throw new Error(`Started harness server, but health check did not pass at ${baseUrl}`);
  }
  return { started: true };
}

async function uploadProject(baseUrl, inputPath) {
  const text = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected .bcmkn root JSON object");
  }
  const response = await fetch(`${baseUrl}/__neko_debug__/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: text,
  });
  if (!response.ok) {
    throw new Error(`Upload failed ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    try {
      return createRequire(path.join(harnessRoot, "package.json"))("playwright");
    } catch {
      // Fall through to the bundled Codex runtime path.
    }
    if (!existsSync(bundledNodeModules)) throw new Error("Playwright is not installed");
    return createRequire(path.join(bundledNodeModules, "noop.js"))("playwright");
  }
}

async function clickStartIfRequested(page, timeoutMs) {
  const candidates = [
    page.getByText(/^开始$/).last(),
    page.getByText(/开始/).last(),
    page.locator("text=开始").last(),
  ];
  for (const candidate of candidates) {
    try {
      await candidate.click({ timeout: Math.min(timeoutMs, 5000) });
      return { clicked: true, method: "text=开始" };
    } catch {
      // Try the next locator; editor DOM varies across builds.
    }
  }
  return { clicked: false, method: null };
}

async function runOracle({ baseUrl, inputPath, timeoutMs, afterMs, clickStart, keepOpen }) {
  const upload = await uploadProject(baseUrl, inputPath);
  const openUrl = new URL(upload.openUrl, baseUrl).toString();
  const logs = [];
  const failedRequests = [];
  const pageErrors = [];
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: !keepOpen });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("console", (message) => {
      logs.push({
        level: message.type(),
        text: message.text(),
        location: message.location(),
      });
    });
    page.on("requestfailed", (request) => {
      failedRequests.push({
        url: request.url(),
        failure: request.failure()?.errorText || "",
      });
    });
    page.on("pageerror", (error) => {
      pageErrors.push({ name: error.name, message: error.message, stack: error.stack });
    });

    await page.goto(openUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        const loading = document.querySelector("#init-loading");
        const loadingHidden = !loading || getComputedStyle(loading).display === "none";
        return loadingHidden && /添加角色|控制台|观测/.test(text) && document.querySelectorAll("canvas").length > 0;
      },
      { timeout: timeoutMs },
    );
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      if (window.NekoDebug) return;
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/__neko_debug__/neko-debug.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load /__neko_debug__/neko-debug.js"));
        document.head.appendChild(script);
      });
    });

    const start = clickStart ? await clickStartIfRequested(page, timeoutMs) : { clicked: false, method: "disabled" };
    if (clickStart) await page.waitForTimeout(afterMs);

    const state = await page.evaluate(() => {
      function scalarProps(value) {
        const out = {};
        for (const key of Object.keys(value || {}).slice(0, 80)) {
          try {
            const item = value[key];
            if (item == null || ["string", "number", "boolean"].includes(typeof item)) {
              out[key] = item;
            }
          } catch {
            out[key] = "[unreadable]";
          }
        }
        return out;
      }

      function probeGlobals() {
        return Object.getOwnPropertyNames(window)
          .filter((name) => /neko|blink|bcm|codemao|runtime|vm|stage|store|workspace|pixi/i.test(name))
          .sort()
          .slice(0, 120)
          .map((name) => {
            try {
              const value = window[name];
              return {
                name,
                type: typeof value,
                constructor: value && value.constructor && value.constructor.name,
                keys: value && typeof value === "object" ? Object.keys(value).slice(0, 50) : [],
                scalarProps: value && typeof value === "object" ? scalarProps(value) : {},
              };
            } catch (error) {
              return { name, error: error && error.message };
            }
          });
      }

      const text = document.body?.innerText || "";
      const debugSnapshot = window.NekoDebug && typeof window.NekoDebug.snapshot === "function"
        ? window.NekoDebug.snapshot()
        : null;
      return {
        href: location.href,
        title: document.title,
        textExcerpt: text.slice(0, 2000),
        canvasCount: document.querySelectorAll("canvas").length,
        debugSnapshot,
        globalProbes: probeGlobals(),
      };
    });

    return {
      ok: state.canvasCount > 0 && pageErrors.length === 0,
      input: inputPath,
      openUrl,
      upload,
      start,
      state,
      failures: {
        failedRequests,
        pageErrors,
      },
      consoleTail: logs.slice(-120),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    if (!keepOpen) await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    usage();
    process.exit(args.help ? 0 : 2);
  }
  const inputPath = path.resolve(args.input);
  if (!existsSync(inputPath)) throw new Error(`Input does not exist: ${inputPath}`);
  const baseUrl = `http://127.0.0.1:${args.port}`;
  const server = await ensureServer(baseUrl, args.port, args.startServer);
  const report = await runOracle({
    baseUrl,
    inputPath,
    timeoutMs: args.timeoutMs,
    afterMs: args.afterMs,
    clickStart: args.clickStart,
    keepOpen: args.keepOpen,
  });
  report.serverStarted = server.started;

  const output = JSON.stringify(report, null, 2);
  if (args.out) {
    await writeFile(path.resolve(args.out), output, "utf8");
  }
  console.log(output);
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
