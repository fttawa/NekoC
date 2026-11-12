#!/usr/bin/env node
// Live page adapter; does not replace official scripts, project, or client config.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../probe-kitten4.mjs";
import { runOracle, readJson } from "./k4-oracle.mjs";
import { evidenceDir, officialUrl, sha256, download } from "./k4-online.mjs";

export function allowedRead(url, method) {
  try { officialUrl(url); return ["GET", "HEAD"].includes(method); } catch { return false; }
}

export function publicRequestHeaders(headers) {
  // Preserve public CORS negotiation, never Cookie/Authorization/Referer.
  return headers.origin ? { Origin: headers.origin } : {};
}

export async function openOnlineKernel(options, input) {
  const url = officialUrl(options.onlineUrl).href;
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: options.channel || "msedge" });
  const diagnostics = { assets: [], externalRequests: [], failedRequests: [], pageErrors: [], console: [], adaptations: [], onlineUrl: url };
  const context = await browser.newContext({ serviceWorkers: "block" });
  const bootWatchdog = setTimeout(() => { void browser.close().catch(() => {}); }, options.wallTimeoutMs || 120000);
  let projectHash;
  const pending = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request();
      let allowed = allowedRead(request.url(), request.method());
      if (request.url().startsWith("data:") || request.url().startsWith("blob:")) allowed = true;
      diagnostics.externalRequests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType(), action: allowed ? "anonymous-read" : "blocked" });
      if (allowed) {
        if (request.url().startsWith("data:") || request.url().startsWith("blob:")) return route.continue();
        // Node GET/HEAD has no cookie jar and forwards no browser credentials.
        // Cookie cannot reliably be overridden by route.continue in Chromium.
        // Strip Set-Cookie on fulfillment too; fail closed on redirects.
        try {
          const response = await fetch(request.url(), { method: request.method(), redirect: "error",
            headers: publicRequestHeaders(request.headers()), credentials: "omit", signal: AbortSignal.timeout(30000) });
          const headers = Object.fromEntries(response.headers);
          for (const name of ["set-cookie", "content-encoding", "content-length", "transfer-encoding"]) delete headers[name];
          return route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
        } catch (error) {
          diagnostics.failedRequests.push({ url: request.url(), error: error.message });
          return route.abort("failed");
        }
      }
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket(/.*/, socket => {
      diagnostics.externalRequests.push({ url: socket.url(), resourceType: "websocket", action: "blocked" });
      socket.close();
    });
    const page = await context.newPage();
    page.on("pageerror", error => diagnostics.pageErrors.push(error.message));
    page.on("requestfailed", request => diagnostics.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on("console", message => { if (diagnostics.console.length < 100) diagnostics.console.push({ type: message.type(), text: message.text() }); });
    page.on("response", response => {
      const type = response.request().resourceType();
      if (type === "script" || type === "xhr" || type === "fetch") pending.push((async () => {
        try {
          const body = await response.body();
          if (type === "script") diagnostics.assets.push({ url: response.url(), status: response.status(), sha256: sha256(body) });
          else if (body.includes(Buffer.from('"compile_result"'))) {
            const project = JSON.parse(body.toString());
            projectHash = sha256(JSON.stringify(project));
            diagnostics.project = { url: response.url(), sha256: sha256(body), canonicalSha256: projectHash };
          }
        } catch { /* Aborted telemetry and HEAD responses have no body. */ }
      })());
    });
    await page.addInitScript(() => {
      const callbacks = new Map(); let serial = 0;
      window.requestAnimationFrame = callback => { callbacks.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = id => callbacks.delete(id);
      window.__k4OracleFrame = timestamp => {
        const batch = [...callbacks.values()]; callbacks.clear();
        for (const callback of batch) callback(timestamp);
      };
    });
    const timeout = options.timeoutMs || 60000;
    await page.goto(url, { waitUntil: "networkidle", timeout });
    await page.evaluate(() => {
      if (!window.webpackJsonp?.push) throw new Error("Unsupported online webpack interface");
      window.webpackJsonp.push([["nekoc-online"], { "nekoc-online": (m, e, req) => { window.__k4OracleRequire = req; } }, [["nekoc-online"]]]);
    });
    await page.evaluate(async () => {
      const req = window.__k4OracleRequire;
      await new Promise(resolve => req("WFO7").c(resolve));
      window.__k4OracleContainer = req("KmiX").b().container;
      window.__k4OracleBinding = req("dET1").BINDING;
    });
    await Promise.all(pending);
    if (projectHash !== sha256(JSON.stringify(input))) throw new Error("Live published project differs from corpus input (or was not observed); refusing mismatched comparison");
    clearTimeout(bootWatchdog);
    return { page, diagnostics, close: () => browser.close(),
      load: async () => { throw new Error("Live adapter only supports published compile_result; never inject a replacement work"); },
      instrumentation: ["live anonymous official page: original scripts/config/project, read-only GET/HEAD, telemetry/WebSocket blocked",
        "webpack require exposed by an independent inspection chunk; no vendor factory replacement",
        "input corpus canonical JSON SHA-256 matches project actually downloaded by live page"] };
  } catch (error) {
    clearTimeout(bootWatchdog);
    error.diagnostics = diagnostics;
    await browser.close();
    throw error;
  }
}

export async function tracePair(id, corpus) {
  if (!/^\d+$/.test(id)) throw new Error("Expected public numeric work id");
  const input = await readJson(path.join(corpus, `${id}.bcm`));
  const options = { frames: 60, seed: 1, virtualTime: true, allowAssets: true, wallTimeoutMs: 120000, timeoutMs: 60000 };
  await mkdir(evidenceDir, { recursive: true });
  const result = { id, frames: options.frames, seed: options.seed, status: "unverified" };
  try {
    const online = await runOracle(input, { ...options, onlineUrl: `https://player.codemao.cn/new/${id}`, openKernel: openOnlineKernel });
    await writeFile(path.join(evidenceDir, `${id}.online.json`), JSON.stringify(online));
    // Capture dynamic script HTTP metadata/bytes as well as browser response hashes.
    for (const asset of online.diagnostics.assets) {
      const name = path.basename(new URL(asset.url).pathname);
      const metadata = await download(asset.url, name);
      asset.http = metadata;
      if (asset.sha256 !== metadata.sha256) throw new Error(`Browser/download hash mismatch: ${name}`);
    }
    const offline = await runOracle(input, options);
    await writeFile(path.join(evidenceDir, `${id}.offline.json`), JSON.stringify(offline));
    // Same runtime, deterministic inputs, and JSON contract: require exact frames,
    // including clone ids, types, local variables and all exported actor fields.
    result.equal = JSON.stringify(online.frames) === JSON.stringify(offline.frames);
    result.status = result.equal ? "equal" : "different";
    result.onlineFrames = online.frames.length;
    result.offlineFrames = offline.frames.length;
    result.firstDifferentFrame = online.frames.findIndex((frame, index) => JSON.stringify(frame) !== JSON.stringify(offline.frames[index])) + 1 || null;
    result.onlineDiagnostics = online.diagnostics;
    result.offlineAssets = offline.diagnostics.assets;
  } catch (error) { result.error = error.message; result.diagnostics = error.diagnostics; }
  await writeFile(path.join(evidenceDir, `${id}.pair.json`), JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , id, corpus] = process.argv;
  const result = await tracePair(id, corpus);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "equal") process.exitCode = 1;
}
