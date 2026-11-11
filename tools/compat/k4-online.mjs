#!/usr/bin/env node
// Independent evidence collector: vendor downloads stay in ignored dist/k4online.
// Static comparison parses factories with TypeScript; it never evaluates them.
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const evidenceDir = path.join(root, "dist/k4online");
export const sha256 = data => createHash("sha256").update(data).digest("hex");
export function officialUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
      !["codemao.cn", "bcmcdn.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    throw new Error(`Not an anonymous official HTTPS URL: ${value}`);
  }
  return url;
}

// No redirects, credentials, cookie jar, or executable downloads. HTTP Date is
// recorded separately from collection time; neither is a product release date.
export async function download(url, label) {
  officialUrl(url);
  if (!/^[\w.-]+$/.test(label) || /\.(exe|dll|msi)$/i.test(label)) throw new Error("Invalid evidence name");
  const response = await fetch(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(60000) });
  const body = Buffer.from(await response.arrayBuffer());
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, label), body);
  const headers = {};
  for (const name of ["date", "last-modified", "etag", "content-type", "content-length", "content-encoding", "age"]) {
    headers[name] = response.headers.get(name);
  }
  return { url, status: response.status, collectedAt: new Date().toISOString(), headers,
    file: label, bytes: body.length, sha256: sha256(body) };
}

export function pageScripts(html, url) {
  // Skip inline bodies, including document.write('<script src=...>') branches.
  return [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi)]
    .map(match => match[1].match(/\bsrc=["']([^"']+)["']/i)?.[1])
    .filter(Boolean).map(src => officialUrl(new URL(src, url).href).href);
}

function parse(source, name) {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) throw new Error(`Unparseable JavaScript: ${name}`);
  return ast;
}
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}
export function factoryTable(source) {
  const ast = parse(source, "bundle.js"), tables = [];
  walk(ast, node => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) ||
        node.expression.name.text !== "push" || node.arguments.length !== 1) return;
    const chunk = node.arguments[0];
    if (!ts.isArrayLiteralExpression(chunk) || !chunk.elements[1] || !ts.isObjectLiteralExpression(chunk.elements[1])) return;
    const properties = chunk.elements[1].properties;
    if (!properties.length || !properties.every(p => ts.isPropertyAssignment(p) &&
        (ts.isFunctionExpression(p.initializer) || ts.isArrowFunction(p.initializer)))) return;
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    const table = new Map();
    for (const property of properties) {
      const name = property.name;
      if (!(ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) throw new Error("Dynamic module id");
      if (table.has(name.text)) throw new Error(`Duplicate module ${name.text}`);
      const text = printer.printNode(ts.EmitHint.Expression, property.initializer, ast);
      table.set(name.text, { text, sha256: sha256(text) });
    }
    tables.push(table);
  });
  if (tables.length !== 1) throw new Error(`Expected one webpack factory table, got ${tables.length}`);
  return tables[0];
}

// Identify changed functions/methods and registry keys without writing vendor
// excerpts to tracked paths. Formatted complete modules are local evidence only.
function functions(text) {
  const ast = parse(`(${text})`, "factory.js"), result = new Map();
  walk(ast, node => {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (!ts.isFunctionExpression(node.right) && !ts.isArrowFunction(node.right)) return;
    const name = node.left.getText(ast);
    const printer = ts.createPrinter({ removeComments: true });
    result.set(name, sha256(printer.printNode(ts.EmitHint.Expression, node.right, ast)));
  });
  return result;
}
export function compareBundles(online, offline) {
  const a = factoryTable(online), b = factoryTable(offline);
  const added = [...a.keys()].filter(id => !b.has(id)).sort();
  const removed = [...b.keys()].filter(id => !a.has(id)).sort();
  const changed = [], equal = [];
  for (const [id, value] of a) {
    if (!b.has(id)) continue;
    const other = b.get(id);
    if (value.sha256 === other.sha256) { equal.push(id); continue; }
    const af = functions(value.text), bf = functions(other.text);
    changed.push({ id, onlineSha256: value.sha256, offlineSha256: other.sha256,
      changedFunctions: [...new Set([...af.keys(), ...bf.keys()])].filter(key => af.get(key) !== bf.get(key)).sort() });
  }
  return { onlineModules: a.size, offlineModules: b.size, added, removed, changed, equal: equal.sort() };
}

export async function collect(url = "https://player.codemao.cn/new/186831447") {
  const page = await download(url, "player.html");
  if (page.status !== 200) throw new Error(`Player page HTTP ${page.status}`);
  const html = await readFile(path.join(evidenceDir, page.file), "utf8");
  const scripts = [];
  for (const script of pageScripts(html, url)) {
    const name = path.basename(new URL(script).pathname);
    scripts.push(await download(script, name));
  }
  const report = { page, scripts, scope: "HTML-discovered scripts; browser request evidence is separate" };
  await writeFile(path.join(evidenceDir, "http.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

export async function compare(playerDir, browserEvidence) {
  const app = await realpath(playerDir);
  const report = JSON.parse(await readFile(path.join(evidenceDir, "http.json"), "utf8"));
  if (browserEvidence) {
    const pair = JSON.parse(await readFile(browserEvidence, "utf8"));
    if (!pair.onlineDiagnostics?.assets?.length) throw new Error("Missing successful browser script evidence");
    for (const asset of pair.onlineDiagnostics.assets) {
      if (!asset.http || asset.sha256 !== asset.http.sha256) throw new Error("Missing/mismatched browser and HTTP hashes");
      if (!report.scripts.some(script => script.url === asset.url)) report.scripts.push(asset.http);
    }
  }
  const comparisons = [];
  for (const script of report.scripts) {
    const online = await readFile(path.join(evidenceDir, script.file));
    if (script.status !== 200 || sha256(online) !== script.sha256) throw new Error(`Invalid download evidence: ${script.file}`);
    const offlineFile = path.join(app, "src/player/build", script.file + (/^player_v2.*\.js$/.test(script.file) ? ".orig" : ""));
    const offline = await readFile(offlineFile);
    const entry = { url: script.url, onlineSha256: sha256(online), offlineFile, offlineSha256: sha256(offline),
      byteEqual: online.equals(offline) };
    if (/^player_v2.*\.js$/.test(script.file)) {
      const exposure = "window.__k4c=e,window.__k4b=o.BINDING,";
      const text = offline.toString();
      entry.onlyKnownDiInsertion = text.split(exposure).length === 2 && text.replace(exposure, "") === online.toString();
    }
    if (!entry.byteEqual) {
      try {
        entry.structure = compareBundles(online.toString(), offline.toString());
        const a = factoryTable(online.toString()), b = factoryTable(offline.toString());
        for (const { id } of entry.structure.changed) {
          const safeId = Buffer.from(id).toString("hex");
          await writeFile(path.join(evidenceDir, `${script.file}.${safeId}.online.txt`), a.get(id).text);
          await writeFile(path.join(evidenceDir, `${script.file}.${safeId}.offline.txt`), b.get(id).text);
        }
      } catch (error) {
        entry.structureError = error.message;
        const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
        const a = printer.printFile(parse(online.toString(), "online.js"));
        const b = printer.printFile(parse(offline.toString(), "offline.js"));
        entry.formatted = { onlineSha256: sha256(a), offlineSha256: sha256(b), equal: a === b };
        await writeFile(path.join(evidenceDir, `${script.file}.online.txt`), a);
        await writeFile(path.join(evidenceDir, `${script.file}.offline.txt`), b);
      }
    }
    comparisons.push(entry);
  }
  await writeFile(path.join(evidenceDir, "comparison.json"), JSON.stringify(comparisons, null, 2) + "\n");
  return comparisons;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, value, browserEvidence] = process.argv.slice(2);
  if (command === "collect") console.log(JSON.stringify(await collect(value), null, 2));
  else if (command === "compare") console.log(JSON.stringify(await compare(value || process.env.K4_PLAYER_DIR, browserEvidence), null, 2));
  else throw new Error("Usage: node tools/compat/k4-online.mjs collect [official-player-url] | compare [K4_PLAYER_DIR] [dist/k4online/ID.pair.json]");
}
