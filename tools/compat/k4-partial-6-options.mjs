// Read-only option histograms. Never emit IDs, titles, resources or executable ASTs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baseline } from "./k4-partial-6-scope.mjs";

export function optionFrequency(directory) {
  const fields = new Set(["scope", "attribute", "property", "physics_body_type", "texture_type", "physics_bound_type", "is_enable", "is_allow", "allow", "is_bump"]);
  const counts = {};
  let files = 0;
  const record = (type, params) => {
    if (!Object.hasOwn(baseline, type)) return;
    for (const [key, value] of Object.entries(params ?? {})) {
      if (!fields.has(key) || typeof value !== "string") continue;
      // UUID attributes are data, not enum labels. Aggregate without retaining keys.
      const label = value.length > 32 || /^[a-f0-9]{8}-/i.test(value) ? "<dynamic-or-uuid>" : value;
      const options = (counts[type] ??= {})[key] ??= {};
      options[label] = (options[label] ?? 0) + 1;
    }
  };
  for (const file of fs.readdirSync(directory).filter(file => file.endsWith(".bcm")).sort()) {
    files++;
    const project = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8").replace(/^\uFEFF/, ""));
    const withWorkspace = new Set();
    for (const [ownerKey, owner] of [...Object.entries(project.theatre?.actors ?? {}), ...Object.entries(project.theatre?.scenes ?? {})]) {
      let graph = owner.block_data_json;
      if (typeof graph === "string") graph = JSON.parse(graph);
      if (!graph?.blocks || typeof graph.blocks !== "object") continue;
      withWorkspace.add(ownerKey); withWorkspace.add(owner.id ?? ownerKey);
      for (const block of Object.values(graph.blocks)) record(block?.type, block?.fields);
    }
    for (const owner of project.compile_result ?? []) {
      if (withWorkspace.has(owner.id)) continue;
      const seen = new Set(), pending = [owner];
      while (pending.length) {
        const block = pending.pop();
        if (!block || typeof block !== "object") continue;
        if (typeof block.type === "string" && typeof block.id === "string" && !seen.has(block.id)) {
          seen.add(block.id); record(block.type, block.params);
        }
        for (const [key, value] of Object.entries(block)) if (key !== "mutation" && key !== "shadows") pending.push(value);
      }
    }
  }
  return { schema: "nekoc-k4-partial-options-6-v1", files, scope: "只读静态选项频率，不证明节点实际执行；UUID聚合，不保留作品内容", counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = optionFrequency(process.argv[2] ?? "E:/nekoc/dist/kitten4-corpus");
  fs.writeFileSync("docs/kitten4-partial-6-options.json", JSON.stringify(result, null, 2) + "\n");
}
