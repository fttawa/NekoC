#!/usr/bin/env node
// Registry availability only, not a certification of block semantics or assets.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const manifestUrl = new URL("../../docs/compatibility/kn-share-player-blocks.json", import.meta.url);

export async function readManifest(file = manifestUrl) {
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  if (manifest.schema !== "nekoc-kn-share-player-blocks-v1" || !Array.isArray(manifest.blocks)
    || !Array.isArray(manifest.metadataBlocks) || !manifest.sources?.length
    || [...manifest.blocks, ...manifest.metadataBlocks].some(type => typeof type !== "string")) {
    throw new Error("Invalid KN share player block manifest");
  }
  return manifest;
}

function xmlBlocks(xml, owner, location) {
  const decode = value => value.replace(/&(#x[\da-f]+|#\d+|quot|apos|lt|gt|amp);/gi, (entity, name) => {
    if (name[0] !== "#") return { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" }[name] ?? entity;
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  });
  const blocks = [];
  // Skip comments/CDATA and respect quoted attributes (which can contain >).
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:shadow|block)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  for (const match of xml.matchAll(tags)) {
    if (match[0].startsWith("<!")) continue;
    const attributes = Object.fromEntries([...match[0].matchAll(/\s+([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map(attribute => [attribute[1], decode(attribute[2] ?? attribute[3])]));
    if (attributes.type) blocks.push({ type: attributes.type, id: attributes.id ?? null, owner, location: `${location}@${match.index}` });
  }
  return blocks;
}

// Only walk actual workspaces: variable types, costume types, connection types,
// etc. are not opcodes. Descendants of a block may be maps or arrays.
export function projectBlocks(project) {
  if (!project || project.toolType !== "KN" || !project.scenes?.scenesDict
    || !project.actors?.actorsDict) throw new Error("Expected a Kitten N .bcmkn project");
  const result = [];
  const pending = [];
  const walk = (value, owner, location, container = false) => pending.push({ value, owner, location, container });
  for (const [kind, dict] of [
    ["scenes", project.scenes.scenesDict],
    ["actors", project.actors.actorsDict],
    ["procedures", project.procedures?.proceduresDict ?? {}],
  ]) {
    for (const [owner, entity] of Object.entries(dict)) {
      walk(entity.nekoBlockJsonList ?? [], owner, `/${kind}/${owner}/nekoBlockJsonList`);
    }
  }
  // A normal long next-chain must not exhaust the JavaScript call stack.
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const { value, owner, location, container } = pending[cursor];
    // KN serializes fallback shadows as XML strings as well as JSON blocks.
    if (typeof value === "string" && location.includes("/shadows/")) {
      result.push(...xmlBlocks(value, owner, location));
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, owner, `${location}/${index}`));
      continue;
    }
    if (container) {
      for (const [key, child] of Object.entries(value)) walk(child, owner, `${location}/${key}`);
      continue;
    }
    if (typeof value.type === "string") result.push({ type: value.type, id: value.id ?? null, owner, location });
    // Mutations, field values and source annotations may themselves contain a
    // property named type. They are data, not nested executable blocks.
    for (const key of ["next", "inputs", "shadows", "statements", "blocks"]) {
      if (value[key]) walk(value[key], owner, `${location}/${key}`, key !== "next");
    }
    if (typeof value.type !== "string") {
      for (const [key, child] of Object.entries(value)) {
        if (!["next", "inputs", "shadows", "statements", "blocks"].includes(key)) walk(child, owner, `${location}/${key}`);
      }
    }
  }
  return result;
}

export function checkProject(project, manifest) {
  const supported = new Set(manifest.blocks);
  const metadata = new Set(manifest.metadataBlocks);
  const blocks = projectBlocks(project);
  const missing = new Map();
  for (const block of blocks) {
    if (supported.has(block.type) || metadata.has(block.type)) continue;
    if (!missing.has(block.type)) missing.set(block.type, []);
    missing.get(block.type).push(block);
  }
  const unsupported = [...missing].sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([type, occurrences]) => ({ type, count: occurrences.length, occurrences }));
  return {
    ok: unsupported.length === 0,
    scope: "static block availability; includes disabled blocks and shadows; not semantic equivalence",
    blockCount: blocks.length,
    types: [...new Set(blocks.map(block => block.type))].sort(),
    metadataBlockCount: blocks.filter(block => metadata.has(block.type)).length,
    unsupported,
    manifest: { retrievedAt: manifest.retrievedAt, entryUrl: manifest.entryUrl, sources: manifest.sources },
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] === "--help") {
    console.log(JSON.stringify({ usage: "node tools/compat/kn-share-player-check.mjs <project.bcmkn>" }));
    return argv[0] === "--help" ? 0 : 2;
  }
  try {
    const manifest = await readManifest();
    const project = JSON.parse(await fs.readFile(argv[0], "utf8"));
    const result = checkProject(project, manifest);
    console.log(JSON.stringify({ input: path.resolve(argv[0]), ...result }, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
