#!/usr/bin/env node
// Read official code as evidence; never store its implementation in tracked paths.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const names = ["script_variables_set", "change_script_variables", "controls_while", "__break__", "_break_statement", "_continue_statement", "_return_statement", "_execute", "_array_literal", "calculate", "get_timer", "reset_timer", "microbit_math_map"];

export function excerpts(source, url) {
  return names.map(name => {
    const offset = source.indexOf(`${name}:function`);
    return { name, url, offset, excerpt: offset < 0 ? null : source.slice(offset, offset + 1000) };
  });
}

if (process.argv[1]?.endsWith("kncat-evidence.mjs")) {
  const url = "https://kn.codemao.cn/editor";
  const html = await (await fetch(url)).text();
  const scripts = [...html.matchAll(/(?:src|href)=["']([^"']*\/main\.[^"']+\.js)["']/g)];
  const sourceUrl = new URL(scripts[0]?.[1] ?? "", url).href;
  if (!scripts.length) throw new Error("Official main bundle not discovered");
  const source = await (await fetch(sourceUrl)).text();
  const result = { sourceUrl, sha256: createHash("sha256").update(source).digest("hex"), entries: excerpts(source, sourceUrl) };
  await mkdir("dist/kncat", { recursive: true });
  await writeFile("dist/kncat/official-source.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
