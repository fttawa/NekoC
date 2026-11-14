#!/usr/bin/env node
// Task-baseline static frequency, deliberately independent of current VM status.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { catalogSha256, catalogTypes } from "./kn-catalog-manifest.mjs";

export const baselineCommit = "e63147f259abb65bfca69887d12324b1b09e1c95";
export const baselineDocument = "docs/kn-block-coverage.md";
const groups = ["projects", "samples", "fixtures", "other"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const git = (root, args) => execFileSync("git", args, {
  cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
});

export function parseBaseline(markdown) {
  const rows = markdown.split(/\r?\n/).filter(line => /^\| \d+ \|/.test(line)).map(line => {
    const cells = line.split("|").map(s => s.trim());
    return { type: cells[2].replaceAll("`", ""), status: cells[3],
      officialCategory: cells[4], baselineVm: cells[5], baselineRisk: cells[7] };
  });
  const partial = rows.filter(row => row.status === "部分语义").map(row => ({
    ...row, hardware: row.officialCategory === "官方硬件扩展定义／未安装",
  })).sort((a, b) => compare(a.type, b.type));
  if (rows.length !== 300 || new Set(rows.map(r => r.type)).size !== 300 ||
      JSON.stringify(rows.map(r => r.type).sort(compare)) !== JSON.stringify(catalogTypes) ||
      partial.length !== 117 || partial.filter(r => r.hardware).length !== 60) {
    throw new Error("Expected baseline partition: 300 catalog names, 117 partial (60 hardware / 57 non-hardware)");
  }
  return partial;
}

// Freeze corpus membership as well as partial status: newly tracked round-specific
// probes must not manufacture demand. Contents are current worktree bytes, hashed.
export function selectCorpus(tracked, baselineFiles) {
  const baseline = new Set(baselineFiles);
  const bcmkn = [...new Set(tracked)].filter(f => f.endsWith(".bcmkn")).sort(compare);
  return { included: bcmkn.filter(f => baseline.has(f)),
    excluded: bcmkn.filter(f => !baseline.has(f)).map(file => ({ file, reason: "not-in-task-baseline-corpus" })) };
}

export function blockNodes(document) {
  const nodes = [];
  function block(b, location, rootType, rootLocation) {
    if (!b || typeof b !== "object" || Array.isArray(b)) return;
    if (typeof b.type !== "string") return;
    nodes.push({ type: b.type, id: b.id ?? null, location, rootType, rootLocation,
      rootNode: location === rootLocation });
    block(b.next, `${location}.next`, rootType, rootLocation);
    for (const key of ["inputs", "statements"]) {
      for (const [name, child] of Object.entries(b[key] ?? {})) {
        block(child, `${location}.${key}[${JSON.stringify(name)}]`, rootType, rootLocation);
      }
    }
  }
  function find(v, location) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v.nekoBlockJsonList)) v.nekoBlockJsonList.forEach((b, i) => {
      const at = `${location}.nekoBlockJsonList[${i}]`;
      block(b, at, b?.type ?? null, at);
    });
    for (const [key, child] of Object.entries(v)) {
      // Never discover fake workspaces hidden in fields/inputs or variable values.
      if (key === "nekoBlockJsonList") continue;
      if (location === "$" && ["actors", "scenes", "procedures"].includes(key) ||
          location !== "$" && ["actorsDict", "scenesDict", "proceduresDict"].includes(key)) {
        find(child, `${location}.${key}`);
      } else if (location.endsWith("Dict")) {
        find(child, `${location}[${JSON.stringify(key)}]`);
      }
    }
  }
  find(document, "$");
  return nodes;
}

export function validateReferenceCatalog(bytes) {
  if (sha256(bytes) !== catalogSha256) throw new Error("External HateNeko catalog SHA-256 mismatch");
  if (JSON.stringify(Object.keys(JSON.parse(bytes)).sort(compare)) !== JSON.stringify(catalogTypes)) {
    throw new Error("External HateNeko catalog name set mismatch");
  }
  return { catalogSha256, catalogCount: catalogTypes.length };
}

function referenceSources(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name)).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? referenceSources(file) : entry.name.endsWith(".lua") ? [file] : [];
  });
}

export function frequency(root, { reference } = {}) {
  const baselineBytes = git(root, ["show", `${baselineCommit}:${baselineDocument}`]);
  const partial = parseBaseline(baselineBytes);
  // projects/ is a separate checkout of NekoX-Lab/nekoc-works; its tracked
  // works count as they did when they lived in this repository.
  const works = fs.existsSync(path.join(root, "projects/.git"))
    ? git(path.join(root, "projects"), ["ls-files", "-z", "--", "*.bcmkn"]).split("\0").filter(Boolean).map(file => `projects/${file}`)
    : [];
  const selection = selectCorpus(
    [...git(root, ["ls-files", "-z", "--", "*.bcmkn"]).split("\0").filter(Boolean), ...works],
    git(root, ["ls-tree", "-r", "-z", "--name-only", baselineCommit]).split("\0").filter(Boolean),
  );
  const files = selection.included.map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    const nodes = blockNodes(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")));
    const group = file.startsWith("tests/fixtures/") ? "fixtures" : groups.includes(file.split("/")[0]) ? file.split("/")[0] : "other";
    return { file, group, sha256: sha256(bytes), blockCount: nodes.length, nodes };
  });
  let referenceCheck = null;
  let lua = [];
  if (reference) {
    const catalog = reference.endsWith(".json") ? reference : path.join(reference, "kn_spec/block_catalog.json");
    referenceCheck = validateReferenceCatalog(fs.readFileSync(catalog));
    if (!reference.endsWith(".json")) lua = referenceSources(path.join(reference, "rt/impl")).map(file => ({
      file: path.relative(reference, file).replaceAll("\\", "/"), source: fs.readFileSync(file, "utf8"),
    }));
  }
  const rows = partial.map(row => {
    const hits = files.flatMap(f => f.nodes.filter(n => n.type === row.type).map(n => ({ file: f.file, group: f.group, ...n })));
    const counts = Object.fromEntries(groups.map(group => {
      const matches = hits.filter(h => h.group === group);
      return [group, { occurrences: matches.length, files: new Set(matches.map(h => h.file)).size }];
    }));
    return { ...row, counts, occurrences: hits.length, files: new Set(hits.map(h => h.file)).size,
      referenceFunctions: lua.filter(f => new RegExp(`\\bM\\.${row.type}\\b`).test(f.source)).map(f => f.file), hits };
  });
  const summarize = predicate => {
    const selected = rows.filter(predicate);
    return { types: selected.length, occurrences: selected.reduce((n, r) => n + r.occurrences, 0),
      zeroTypes: selected.filter(r => !r.occurrences).length };
  };
  return { schemaVersion: 1, scope: "static block-node frequency, not execution frequency or semantic certification",
    baseline: { commit: baselineCommit, document: baselineDocument, documentSha256: sha256(baselineBytes),
      partialCount: 117, hardwareCount: 60, nonHardwareCount: 57 },
    corpusPolicy: "current git ls-files *.bcmkn intersect baseline git ls-tree; current file bytes; all post-baseline additions excluded, including this round's partial fixtures",
    traversal: "actors/scenes/procedures nekoBlockJsonList roots; next/inputs/statements only; fields, shadows XML, variable declarations excluded; dormant roots and callback inputs retained",
    referenceCheck,
    summary: { ...summarize(() => true), hardware: summarize(r => r.hardware), nonHardware: summarize(r => !r.hardware),
      groups: Object.fromEntries(groups.map(group => [group, {
        files: files.filter(f => f.group === group).length,
        blocks: files.filter(f => f.group === group).reduce((n, f) => n + f.blockCount, 0),
        partialTypes: rows.filter(r => r.counts[group].occurrences).length,
        partialOccurrences: rows.reduce((n, r) => n + r.counts[group].occurrences, 0),
      }])) },
    excludedFiles: selection.excluded,
    files: files.map(({ nodes, ...file }) => file), rows };
}

export function priorityMarkdown(result) {
  const observed = result.rows.filter(r => r.occurrences).sort((a, b) =>
    b.counts.projects.occurrences + b.counts.samples.occurrences - a.counts.projects.occurrences - a.counts.samples.occurrences ||
    b.occurrences - a.occurrences || compare(a.type, b.type));
  const zero = result.rows.filter(r => !r.hardware && !r.occurrences);
  return [
    "# KN partial 静态频率与非硬件优先级", "",
    "> static, not execution：这是静态积木节点频率，不是执行频率、作品通过率或完整语义认证。", "",
    "## 固定任务基线与语料", "",
    `- partial 身份和历史限制来自提交 \`${baselineCommit}\` 的 \`${baselineDocument}\`，固定 **117 类型（57 非硬件、60 硬件）**，不跟随当前覆盖升级。历史 VM 行号/限制不是当前缺陷断言。`,
    "- 文件由当前 `git ls-files -z -- '*.bcmkn'` 与基线 `git ls-tree` 交集确定；读取当前工作区文件，JSON 保存各文件 SHA-256。排除所有基线后新加作品（包括本轮 partial 新夹具），避免回归探针反向制造需求。未跟踪作品永不计入。",
    "- 只统计 actors/scenes/procedures 的 `nekoBlockJsonList`，沿 `next / inputs / statements` 递归；不把 `fields.type`、变量声明、XML shadow 文本当积木。保留游离根和 callback 输入；不是可达性分析。",
    "- HateNeko 仅是可选名称核对/实现函数检索参考，不是官方语义证据；默认无需外部文件。JSON 保留 117 个逐类型行和逐节点位置。", "",
    "| 分组 | 文件数 | 全部积木节点 | partial 类型 | partial 节点 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...groups.map(g => { const s = result.summary.groups[g]; return `| ${g} | ${s.files} | ${s.blocks} | ${s.partialTypes} | ${s.partialOccurrences} |`; }), "",
    `全部 partial **${result.summary.occurrences} 次**；非硬件零频率 **${zero.length} 类型**；硬件 ${result.summary.hardware.types} 类型共 **${result.summary.hardware.occurrences} 次**。`, "",
    "## 非零类型：样例与夹具分开", "",
    "| 类型 | projects 次/文件 | samples 次/文件 | fixtures 次/文件 | 总次数 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...observed.map(r => `| \`${r.type}\` | ${["projects", "samples", "fixtures"].map(g => `${r.counts[g].occurrences}/${r.counts[g].files}`).join(" | ")} | ${r.occurrences} |`), "",
    "### 重复版本、游离与字段误计", "",
    "- PENCRAFT 三个版本的 convert_type 各 1 次，是相同 b29 转换逻辑，不是三个独立需求。样例/项目共 6 次转换，但只有两个作品系列来源。",
    "- `samples/我的作品-原生.bcmkn` 的 3 次转换：1 个在 self_listen 事件树内，1 个是游离 reporter，1 个在游离 variables_set 根栈下。不能把全部 3 次当运行需求；定义树中的节点也未必被调用。",
    "- Fangjie 的 mouse_down 仅 1 次，down、空目标（屏幕）；不能把此频率推广成命名角色/克隆拾取需求。",
    "- 克隆属性夹具 7 次集中于私有变量 UUID，不是数字特效码/宽高属性的频率证据。timer 的两次注册只来自专门夹具，callback 节点即使静态计入也不表示执行。",
    "- input-kn.bcmkn 有 sprite_on_tap 的 fields.type=mouse_down；这不是 mouse_down 积木。对所有 JSON 对象泛型递归会多计 1 次，本工具夹具 mouse_down 正确为 0。",
    "- 空模板也在文件分母中；未按作品家族自动去重。逐文件频率和节点根类型可在 JSON 中复核。", "",
    "## 非硬件可修建议（历史候选，不自动认定当前仍有缺陷）", "",
    "第二轮主路径分类与逐项服务跳过清单见 [kn-partial2.md](kn-partial2.md)；本页固定历史117项的频率，不随覆盖升级重写分母。", "",
    "1. **convert_type**：优先完整原生工程差分、数组/对象字符串化及 UTF-16 边界；已有 63 条官方带类型观测，不重复声称缺失基础转换。候选 `src/engine/kn_conversion.rs::convert`、`src/engine/value.rs`、`tests/kn_conversion.rs`、`tools/compat/kn-conversion-probe.mjs`；见 `docs/kn-conversion.md`。本轮并行修复后先核对新证据。",
    "2. **mouse_down**：局部验证非法目标的错误时机（历史编译拒绝 vs 官方诊断后 false）、拖出抬起/场景切换/克隆删除。候选 `src/engine.rs` 的 mouse_down 分派、`src/engine/input.rs::kn_pointer_state`/`pointer_target_matches`、`tests/kn_pointer.rs`；见 `docs/kn-pointer.md`。",
    "3. **get_clone_index_property**：补属性码、严格索引类型与失效目标矩阵；不要按私有变量频率推导所有属性需求。候选 `src/engine/kn_appearance.rs::kn_clone_property`/`eval_kn_clone_property`/`kn_property`、`tests/kn_appearance_dialog.rs`；本轮已修复的数字码和索引缺口见 `docs/kn-partial.md`，剩余边界按新证据记录。",
    "4. **timer 生命周期**：取消、stop/restart、scene/clone 生命周期的局部差分；不是实现通用闭包。官方当前原生 callback statement 被丢弃，不能据 JS 常识改成执行。候选 `src/engine/kn_async.rs`、`tests/kn_async.rs`；见 `docs/kn-timers.md`。",
    "5. **零频率局部项**：气泡并发取消、文本 costume 缩放可后续小范围取证，候选 `src/engine/kn_appearance.rs::kn_dialog`/`kn_property` 及 engine 对白 lowering；不因零频率而宣称无用户价值。",
    "6. **暂后**：AI、账户、榜单、翻译成功路径、摄像、全局动画宿主和真实硬件后端在本语料无频率依据，成本/外部依赖高；不把离线 fallback 升级为真实支持。", "",
    "## 非硬件零频率全量名单", "",
    zero.map(r => `\`${r.type}\``).join("、"), "",
    "## 硬件逐类型（保留零计数）", "",
    "| 类型 | 静态次数 |", "| --- | ---: |",
    ...result.rows.filter(r => r.hardware).map(r => `| \`${r.type}\` | ${r.occurrences} |`), "",
    "## 复现", "", "```powershell",
    "# 默认只输出 JSON，不写文件；需要本地 Git 历史中的固定基线提交",
    "node tools/compat/kn-partial-frequency.mjs",
    "# 生成当前 worktree 的两份报告",
    "node tools/compat/kn-partial-frequency.mjs --write",
    "# 可选：校验外部清单并检索 rt/impl/*.lua 的 M.<type> 引用",
    "node tools/compat/kn-partial-frequency.mjs --reference E:/nekoc-wt/_ref/hateneko/player",
    "node --test tests/kn-partial-frequency.test.mjs", "```", "",
    "`--reference` 也接受 block_catalog.json 文件；只校验清单，不扫描函数。缺少基线 Git 对象时明确失败，不回退到实时覆盖表。报告无时间戳；相同跟踪集合和文件字节可确定性重生成。", "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let reference, write = false;
    while (args.length) {
      const arg = args.shift();
      if (arg === "--write") write = true;
      else if (arg === "--reference" && args[0] && !args[0].startsWith("--")) reference = args.shift();
      else throw new Error(`Unknown or incomplete option: ${arg}`);
    }
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const result = frequency(root, { reference });
    const json = JSON.stringify(result, null, 2) + "\n";
    if (write) {
      fs.writeFileSync(path.join(root, "docs/kn-partial-frequency.json"), json);
      fs.writeFileSync(path.join(root, "docs/kn-partial-priority.md"), priorityMarkdown(result));
      console.log("Wrote docs/kn-partial-frequency.json and docs/kn-partial-priority.md");
    } else process.stdout.write(json);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
