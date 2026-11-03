#!/usr/bin/env node
// Extract block defaults from the live, unmodified official Kitten 4 editor.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const officialUrl = "https://kitten4.codemao.cn/";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadPlaywright() {
  const roots = [import.meta.url];
  if (process.env.NEKOC_NODE_MODULES) roots.push(path.join(process.env.NEKOC_NODE_MODULES, "package.json"));
  roots.push("D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules/package.json");
  for (const candidate of roots) {
    try { return createRequire(candidate)("playwright"); } catch {}
  }
  throw new Error("Install playwright or set NEKOC_NODE_MODULES to its node_modules directory");
}

export async function openOfficial(page, timeoutMs = 120000) {
  await page.goto(officialUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => window.__KITTEN_TEST__?.load_bcm_by_url && window.webpackJsonp, null, { timeout: timeoutMs });
  // Expose the existing module registry for read-only inspection. No vendor module is replaced.
  await page.evaluate(() => window.webpackJsonp.push([
    ["nekoc-inspect"],
    { "nekoc-inspect": (module, exports, require) => { window.__nekocKitten4Require = require; } },
    [["nekoc-inspect"]],
  ]));
  // The test hook exists before the editor finishes its initial default-project load.
  // Importing during that load races it and can silently restore the default project.
  await page.waitForFunction(() => {
    const req = window.__nekocKitten4Require;
    const doc = req("TzHo").e.getDoc();
    const state = req("ALsR").a.get_state();
    return doc?.theatre && window.Blockly?.mainWorkspace && !state.loader_state.is_show &&
      Object.keys(doc.theatre.actors).every(id => req("HP1x").a().get_actor_by_id(id)) &&
      req("Fye/").B?.get_workspaces_by_id(state.theatre_state.current_entity);
  }, null, { timeout: timeoutMs });
}

export async function loadOfficialProject(page, project, timeoutMs = 120000) {
  const editorType = await page.evaluate(() => window.__nekocKitten4Require("WFO7").a().type);
  if (project.type && project.type !== editorType) throw new Error(`Official editor expects root type ${editorType}, got ${project.type}. Root type identifies the product; stage aspect ratio is determined by size.`);
  const url = `${officialUrl}__nekoc_verify__/input.bcm`;
  await page.route(url, route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(project) }));
  await page.evaluate(url => window.__KITTEN_TEST__.load_bcm_by_url(url), url);
  await page.waitForFunction(name => {
    const req = window.__nekocKitten4Require;
    const doc = req("TzHo").e.getDoc();
    const state = req("ALsR").a.get_state();
    return doc?.project_name === name && window.Blockly?.mainWorkspace && !state.loader_state.is_show &&
      Object.keys(doc.theatre.actors).every(id => state.theatre_state.actors[id] && req("HP1x").a().get_actor_by_id(id));
  }, project.project_name, { timeout: timeoutMs });
}

export async function extractSchema(page) {
  return page.evaluate(() => {
    const B = window.Blockly;
    const schemas = {};
    const connection = c => c ? { check: c.check_ ?? c.check ?? null } : null;
    for (const type of Object.keys(B.Blocks).sort()) {
      let block;
      try {
        block = B.mainWorkspace.new_block(type);
        const json = B.json.block_to_json(block);
        const main = json.blocks[block.id];
        const { id, parent_id, location, ...defaults } = main;
        schemas[type] = {
          defaults,
          inputs: block.inputList.map(input => ({
            name: input.name,
            kind: input.type === 1 ? "value" : input.type === 3 ? "statement" : "dummy",
            ...(input.connection ? { check: input.connection.check_ ?? null } : {}),
            fields: input.fieldRow.filter(field => field.name).map(field => ({
              name: field.name,
              value: field.get_value?.(),
              ...(field.get_options ? { options: field.get_options().map(option => Array.isArray(option) ? option.slice(0, 2) : option) } : {}),
            })),
          })),
          previous: connection(block.previous_connection),
          next: connection(block.next_connection),
          output: connection(block.output_connection),
        };
      } catch (error) {
        schemas[type] = { error: String(error) };
      } finally {
        try { block?.dispose(); } catch {}
      }
    }
    const mutationExamples = {};
    const variants = {
      controls_if: ['<mutation elseif="0" else="1"></mutation>', '<mutation elseif="1" else="1"></mutation>'],
      text_join: ['<mutation items="2"></mutation>'],
      text_select_changeable: ['<mutation items="2"></mutation>'],
      procedures_2_return_value: ['<mutation items="0"></mutation>', '<mutation items="1"></mutation>'],
    };
    for (const [type, mutations] of Object.entries(variants)) {
      mutationExamples[type] = [];
      for (const mutation of mutations) {
        let block;
        try {
          block = B.mainWorkspace.new_block(type);
          block.string_to_mutation(mutation);
          const json = B.json.block_to_json(block).blocks[block.id];
          mutationExamples[type].push({ inputMutation: mutation, serializedMutation: json.mutation,
            inputs: block.inputList.filter(input => input.connection).map(input => ({ name: input.name, kind: input.type === 3 ? "statement" : "value", check: input.connection.check_ ?? null })), fields: json.fields });
        } catch (error) { mutationExamples[type].push({ inputMutation: mutation, error: String(error) }); }
        finally { try { block?.dispose(); } catch {} }
      }
    }
    return {
      source: location.origin,
      application_version: window.__nekocKitten4Require("3PHN").d().application_version,
      bcm_version: 25,
      notes: [
        "Observed defaults from Blockly.mainWorkspace.new_block(type), serialized with Blockly.json.block_to_json.",
        "Unconnected new blocks usually have empty shadows. Toolbox templates add numeric/text shadow blocks.",
        "connections[parentId][childId] is {type:'next'} or {type:'input',input_type:'value'|'statement',input_name:...}.",
        "Dynamic procedure and conditional inputs require their native mutation XML.",
        "Errors identify legacy or context-dependent block constructors, not supported defaults.",
      ],
      blocks: schemas,
      mutation_examples: mutationExamples,
    };
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    console.log("Usage: node tools/probe-kitten4.mjs [--out docs/kitten4-block-schema.json] [--channel msedge]");
    return;
  }
  const option = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
  const out = path.resolve(option("--out", path.join(root, "docs/kitten4-block-schema.json")));
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: option("--channel", process.env.NEKOC_BROWSER_CHANNEL || "msedge") });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await openOfficial(page);
    const project = await page.evaluate(() => {
      const project = window.__nekocKitten4Require("pNGB").a();
      project.project_name = "nekoc schema probe";
      for (const entity of [...Object.values(project.theatre.scenes), ...Object.values(project.theatre.actors)]) entity.block_data_json = { blocks: {}, connections: {}, comments: {} };
      return project;
    });
    await loadOfficialProject(page, project);
    const schema = await extractSchema(page);
    await mkdir(path.dirname(out), { recursive: true });
    // One block per line keeps the complete fixture compact and diffs localized.
    const { blocks, ...metadata } = schema;
    const prefix = JSON.stringify(metadata, null, 2).replace(/\n}$/, ",\n  \"blocks\": {\n");
    await writeFile(out, prefix + Object.entries(blocks).map(([type, value]) => `    ${JSON.stringify(type)}: ${JSON.stringify(value)}`).join(",\n") + "\n  }\n}\n");
    console.log(JSON.stringify({ out, blocks: Object.keys(schema.blocks).length, errors: Object.entries(schema.blocks).filter(([, value]) => value.error).map(([type]) => type) }, null, 2));
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
