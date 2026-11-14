#!/usr/bin/env node
// Downloaded official source stays in ignored dist/. Only names, hashes and
// source locations are written to docs; never vendor official implementations.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function exposeNativeHandles(source) {
  const marker = "function yu(e){";
  if (source.split(marker).length !== 2
    || !source.includes("function yu(e){var t=new mu;yn.cG.initRuntime(t,e),(0,su.f)()")
    || !source.includes("function vu(){")
    || !source.includes("function au(){return ou.apply(this,arguments)}")) {
    throw new Error("Share native entry initializer changed; audit before refreshing");
  }
  return {
    source: source.replace(marker,
      "window.__knShareNative={initRuntime:yu,initStage:vu,loadPlatform:au,canvasId:_t._W};" + marker),
    locations: {
      nativeInitCharOffset: source.indexOf(marker), stageInitCharOffset: source.indexOf("function vu(){"),
      platformInitCharOffset: source.indexOf("function au(){return ou.apply(this,arguments)}"),
    },
  };
}

export function instrumentBundle(source) {
  const loader = "var __webpack_exports__=";
  const registration = /([A-Za-z_$][\w$]*)\.prototype\.register=function\(([A-Za-z_$][\w$]*)\)\{var ([A-Za-z_$][\w$]*)=\2\.id,([A-Za-z_$][\w$]*)=\2\.namespace/;
  const match = registration.exec(source);
  if (source.indexOf(loader) < 0 || !match || source.indexOf(loader) !== source.lastIndexOf(loader)
    || registration.test(source.slice(match.index + match[0].length))) {
    throw new Error("Official loader/RegistryImpl changed; audit before refreshing");
  }
  const arg = match[2];
  return {
    source: source.replace(loader, `window.__knShareRequire=__webpack_require__;${loader}`)
      .replace(registration, prefix => prefix.replace("{var ", `{(window.__knShareRegistrations ||= []).push({id:${arg}.id,namespace:${arg}.namespace,domain:typeof ${arg}.domain_function,respond:typeof ${arg}.respond,lifetime:typeof ${arg}.lifetime_respond,metadata:${arg}.metadata});var `)),
    locations: { loaderCharOffset: source.indexOf(loader), registryRegisterCharOffset: match.index },
  };
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  return process.env.NEKOC_NODE_MODULES
    ? createRequire(path.join(process.env.NEKOC_NODE_MODULES, "package.json"))("playwright")
    : require("playwright");
}

// Retrieval is intentionally anonymous and limited to public HTTPS GETs.
export function publicUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password
    || !/(^|\.)(codemao\.cn|bcmcdn\.com)$/.test(url.hostname)) throw new Error(`Not a public KN URL: ${input}`);
  return url;
}

export async function download(url) {
  publicUrl(url);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    console.log("Usage: node tools/compat/kn-share-player-refresh.mjs [--channel msedge]");
    return;
  }
  if (argv.length && (argv.length !== 2 || argv[0] !== "--channel")) throw new Error("Expected --channel <browser-channel>");
  const cache = path.join(root, "dist/knshare/refresh");
  await fs.mkdir(cache, { recursive: true });
  const entryUrl = "https://kn.codemao.cn/player?workId=0";
  const html = await download(entryUrl);
  await fs.writeFile(path.join(cache, "player.html"), html);
  const mainUrl = [...html.toString("utf8").matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)]
    .map(match => new URL(match[1], entryUrl).href).find(url => /\/main\.[\w-]+\.js$/.test(url));
  if (!mainUrl) throw new Error("No official main bundle in player entry");
  const body = await download(mainUrl);
  const original = body.toString("utf8");
  const originalLocations = instrumentBundle(original).locations;
  const native = exposeNativeHandles(original);
  const instrumented = instrumentBundle(native.source);
  const auditedAnchors = {
    structuralConstants: "79224:function",
    compileDomainFunctions: "e.prototype.compile_domain_functions=function",
    compileEvent: "e.prototype.compile_event=function",
    jsonProcedureDefinition: "e.prototype.json_procedure_2_definition_to_json=function",
    jsonParseKind: "e.prototype.parse_kind=function",
  };
  const sourceLocations = Object.fromEntries(Object.entries(auditedAnchors).map(([name, anchor]) => {
    const charOffset = original.indexOf(anchor);
    if (charOffset < 0) throw new Error(`Official source anchor changed: ${name}`);
    return [name, { charOffset, byteOffset: Buffer.byteLength(original.slice(0, charOffset)) }];
  }));
  const sources = [{ url: mainUrl, sha256: sha256(body), bytes: body.length, ...originalLocations, ...native.locations, sourceLocations }];
  await fs.writeFile(path.join(cache, path.basename(new URL(mainUrl).pathname)), body);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, ...(argv[1] ? { channel: argv[1] } : {}) });
  try {
    const page = await browser.newPage();
    const scriptErrors = [];
    await page.route("**/*", async route => {
      const request = route.request();
      if (!["GET", "HEAD"].includes(request.method())) return route.abort();
      try { publicUrl(request.url()); } catch { return route.abort(); }
      // Runtime inventory needs no account/work APIs. Do not ask for profiles,
      // device-auth or third-party work JSON, even anonymously.
      const hostname = new URL(request.url()).hostname;
      if (hostname !== "kn.codemao.cn" && !/(^|\.)bcmcdn\.com$/.test(hostname)) return route.abort();
      if (request.url() === mainUrl) return route.fulfill({ contentType: "application/javascript", body: instrumented.source });
      // Unknown/mutable main bundles must never silently supply a new registry.
      if (/\/main\.[\w-]+\.js(?:\?|$)/.test(request.url())) {
        scriptErrors.push("Player main URL changed during refresh");
        return route.abort();
      }
      try {
        const bytes = await download(request.url());
        if (/\.js(?:\?|$)/.test(request.url())) {
          const item = { url: request.url(), sha256: sha256(bytes), bytes: bytes.length };
          if (!sources.some(source => source.url === item.url)) sources.push(item);
          await fs.writeFile(path.join(cache, path.basename(new URL(item.url).pathname)), bytes);
        }
        const pathname = new URL(request.url()).pathname;
        const contentType = /\.js$/.test(pathname) ? "application/javascript" : /\.css$/.test(pathname) ? "text/css"
          : /\.html$/.test(pathname) || request.isNavigationRequest() ? "text/html" : "application/octet-stream";
        await route.fulfill({ body: bytes, contentType });
      } catch (error) {
        if (/\.js(?:\?|$)/.test(request.url())) scriptErrors.push(error.message);
        await route.abort().catch(() => {});
      }
    });
    await page.goto(entryUrl, { waitUntil: "networkidle", timeout: 120000 });
    // An invalid public workId is deliberate: no third-party work is needed.
    // Initialize the native stage/Heart below, then inspect its real registry.
    const inventory = await initializeAndInventory(page);
    await page.unrouteAll({ behavior: "wait" });
    if (scriptErrors.length) throw new Error(scriptErrors.join("; "));
    const manifest = {
      schema: "nekoc-kn-share-player-blocks-v1", retrievedAt: new Date().toISOString(), entryUrl,
      scope: "native default player registry + Heart structural opcodes; not semantic equivalence or optional hardware extensions",
      sources: sources.sort((a, b) => a.url.localeCompare(b.url, "en")),
      evidence: inventory.evidence,
      blocks: inventory.blocks,
      metadataBlocks: inventory.metadataBlocks,
    };
    if (manifest.blocks.length < 200 || !manifest.blocks.includes("variables_set")) throw new Error("Incomplete runtime registry");
    const output = path.join(root, "docs/compatibility/kn-share-player-blocks.json");
    await fs.writeFile(output, JSON.stringify(manifest, null, 2) + "\n");
    await fs.writeFile(path.join(cache, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
    console.log(JSON.stringify({ output, blockCount: manifest.blocks.length, sources: manifest.sources }, null, 2));
  } finally { await browser.close(); }
}

export async function initializeAndInventory(page) {
  await page.waitForFunction(() => window.__knShareRequire && window.__knShareNative, null, { timeout: 60000 });
  return page.evaluate(async () => {
    const req = window.__knShareRequire;
    let bcm, singleton;
    for (const [id, factory] of Object.entries(req.m)) {
      const source = factory.toString();
      if (source.includes("BcmInstance:function")) bcm = req(id).BcmInstance;
      if (source.includes('key:"getHeart"') && source.includes('key:"initRuntime"')) {
        singleton = Object.values(req(id)).find(value => typeof value?.get_instance === "function"
          && typeof value?.initRuntime === "function");
      }
    }
    if (!bcm || !singleton) throw new Error("Native BCM/runtime export unavailable");
    const native = window.__knShareNative;
    if (!document.getElementById(native.canvasId)) {
      const canvas = document.createElement("canvas");
      canvas.id = native.canvasId;
      document.body.append(canvas);
    }
    if (!bcm.getBcm().stageSize?.width) throw new Error("Default BCM stage size unavailable");
    await native.loadPlatform();
    native.initRuntime(native.initStage());
    const registry = singleton.get_instance()?.getHeart()?.core?.get_registry();
    if (!registry) throw new Error("Native registry unavailable");
    // Inspect the final live instance, not a union of hooks from partially
    // initialized/failed instances on the invalid-work page.
    const domains = registry.get_domain_function_types().slice().sort();
    const responders = Object.keys(registry.respond).sort();
    const lifetimeResponders = Object.keys(registry.lifetime_respond).sort();
    const ifDropdown = Object.keys(registry.meta_is_if_dropdown).sort();
    const ifVariable = Object.keys(registry.meta_if_variable_map).sort();
    if (domains.length < 200 || !domains.includes("variables_set")
      || !domains.includes("math_arithmetic") || !responders.includes("on_running_group_activated")) {
      throw new Error("Incomplete native plugin initialization");
    }
    const constantModule = Object.entries(req.m).find(([, factory]) => {
      const source = factory.toString();
      return source.includes("t.ATOMIC_BLOCKS=") && source.includes("t.PROCEDURE_BLOCKS=");
    });
    if (!constantModule) throw new Error("Heart structural constants changed");
    const constants = req(constantModule[0]);
    // These tables have direct compiler paths. EVENT_BLOCKS is deliberately
    // excluded: compile_event calls compile_domain_functions and still needs a
    // registered handler. MIDI_BLOCKS likewise is not structural dispatch.
    const structuralTables = ["LOOP_BLOCKS", "IF_BLOCKS", "PROCEDURE_BLOCKS", "HAT_BLOCKS", "ATOMIC_BLOCKS", "SPECIAL_BLOCKS"];
    const structural = [...new Set(structuralTables.flatMap(table => {
      if (!constants[table]) throw new Error(`Missing structural table: ${table}`);
      return Object.keys(constants[table]).filter(key => !/^\d+$/.test(key));
    }))].sort();
    if (!structural.includes("math_number") || !structural.includes("procedures_2_defnoreturn")) throw new Error("Incomplete structural opcodes");
    const metadataBlocks = ["procedures_2_stable_parameter"];
    return {
      blocks: [...new Set([...domains, ...responders, ...lifetimeResponders, ...ifDropdown, ...ifVariable, ...structural])].sort(),
      metadataBlocks,
      evidence: {
        controlledExperiment: true,
        initialization: "native loadPlatform(); initRuntime(initStage()); inserted canvas; invalid workId=0; no work published or handler added",
        registry: "runtime.getHeart().core.get_registry(); final instance maps, not all source strings or hook unions",
        domains, responders, lifetimeResponders, ifDropdown, ifVariable,
        structuralConstantModule: constantModule[0], structuralTables, structural,
        metadata: "procedures_2_stable_parameter consumed by JSONEntityCompilerImpl.json_procedure_2_definition_to_json, not executed",
      },
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
