#!/usr/bin/env node
// Reads jit-corpus diagnostics only. Never opens or copies corpus projects.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COUNTERS = ["native_ops", "interpreted_ops", "delegated_ops", "node_calls", "regions"];
const REASONS = ["fallback_reasons", "helper_reasons", "fallback_inputs"];
const USAGE = "node tools/compat/jit-report.mjs before.json after.json --out dist/jit3/comparison.md [--timing-before a.json,b.json] [--timing-after c.json]";
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const text = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll("|", "&#124;").replaceAll("`", "&#96;").replace(/[\r\n]+/g, " ");
const fmt = value => value == null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1);
const percent = (part, total) => part == null || total == null || total === 0 ? "—" : `${(part / total * 100).toFixed(2)}%`;
const signed = value => value == null ? "—" : `${value > 0 ? "+" : ""}${fmt(value)}`;

export function median(values) {
  if (!values.length || values.some(value => number(value) == null)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function parseArgs(args) {
  const result = { inputs: [], timingBefore: [], timingAfter: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--out", "--timing-before", "--timing-after"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`缺少 ${arg} 参数。\n${USAGE}`);
      if (arg === "--out") {
        if (result.out) throw new Error("--out 只能指定一次");
        result.out = value;
      } else {
        const files = value.split(",").map(file => file.trim());
        if (files.some(file => !file)) throw new Error(`${arg} 含空文件名`);
        result[arg === "--timing-before" ? "timingBefore" : "timingAfter"].push(...files);
      }
    } else if (arg.startsWith("--")) throw new Error(`未知参数 ${arg}`);
    else result.inputs.push(arg);
  }
  if (result.inputs.length !== 2 || !result.out) throw new Error(USAGE);
  return result;
}

// Resolve existing ancestors too: a symlink/junction must not escape dist.
export function outputPath(output, root = ROOT) {
  const dist = path.join(fs.realpathSync(root), "dist");
  const destination = path.resolve(root, output);
  const inside = candidate => {
    const relative = path.relative(dist, candidate);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!inside(destination)) throw new Error("输出必须位于当前 worktree 的 dist/ 内");
  let ancestor = destination;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = path.join(fs.realpathSync(ancestor), path.relative(ancestor, destination));
  if (!inside(resolved)) throw new Error("输出的链接目标不能离开当前 worktree 的 dist/");
  return destination;
}

function corpus(data, label) {
  if (!data || !Array.isArray(data.works)) throw new Error(`${label}: 不是 jit-corpus JSON（缺少 works）`);
  const works = new Map();
  for (const work of data.works) {
    if (work?.id == null || !work.report || typeof work.report !== "object") throw new Error(`${label}: 无效作品记录`);
    const id = String(work.id);
    if (works.has(id)) throw new Error(`${label}: 重复作品 ID ${id}`);
    works.set(id, work.report);
  }
  return { data, works };
}

function sameSettings(a, b, label) {
  for (const key of ["frames", "seed", "instructions", "build", "arch", "os"]) {
    if (a[key] != null && b[key] != null && a[key] !== b[key]) throw new Error(`${label}: ${key} 不一致`);
  }
}

function timingSamples(base, inputs, label) {
  return inputs.map((input, index) => {
    const sample = corpus(input, `${label} timing ${index + 1}`);
    sameSettings(base.data, sample.data, label);
    if (sample.works.size !== base.works.size) throw new Error(`${label}: timing 作品集合不一致`);
    for (const [id, report] of base.works) {
      const measured = sample.works.get(id);
      if (!measured) throw new Error(`${label}: timing 缺少作品 ${id}`);
      if (measured.profile != null) throw new Error(`${label}: timing 必须是无 profile 的 timing_only 输出 (${id})`);
      for (const key of ["completed", "error", "difference", "load_compile_error"]) {
        if ((report[key] ?? null) !== (measured[key] ?? null)) throw new Error(`${label}: timing ${id} 的 ${key} 与 profile 不一致`);
      }
    }
    return sample;
  });
}

function times(report, samples, id) {
  const reports = samples.length ? samples.map(sample => sample.works.get(id)) : [report];
  return Object.fromEntries(["jit_us", "interpreter_us"].map(key => [key, median(reports.map(r => r?.[key]))]));
}

function metrics(profile) {
  const values = Object.fromEntries(COUNTERS.map(key => [key, number(profile?.[key])]));
  const { native_ops: native, interpreted_ops: interpreted, delegated_ops: delegated } = values;
  const total = native == null || interpreted == null ? null : native + interpreted;
  const direct = native == null || delegated == null || delegated > native ? null : native - delegated;
  return { ...values, total, direct, coverage: percent(native, total), directShare: percent(direct, total) };
}

function topReasons(profile, key, limit) {
  const reasons = profile?.[key];
  if (reasons == null) return "未采集";
  const entries = Object.entries(reasons).filter(([, count]) => number(count) != null && count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  if (!entries.length) return "无";
  const top = entries.slice(0, limit).map(([reason, count]) => `${text(reason)}: ${fmt(count)}`).join("；");
  return `${top}${entries.length > limit ? `；另 ${entries.length - limit} 类` : ""}`;
}

function aggregate(base, samples) {
  const reports = [...base.works.values()];
  const profile = {};
  for (const key of COUNTERS) {
    const values = reports.map(report => number(report.profile?.[key]));
    profile[key] = values.some(value => value == null) ? null : values.reduce((a, b) => a + b, 0);
  }
  for (const key of REASONS) {
    const collected = reports.filter(report => report.profile?.[key] != null);
    profile[key] = collected.length ? {} : null;
    for (const report of collected) {
      for (const [reason, count] of Object.entries(report.profile[key])) {
        if (number(count) != null) profile[key][reason] = (profile[key][reason] ?? 0) + count;
      }
    }
  }
  const timing = {};
  for (const key of ["jit_us", "interpreter_us"]) {
    const values = [...base.works].map(([id, report]) => times(report, samples, id)[key]);
    timing[key] = values.some(value => value == null) ? null : values.reduce((a, b) => a + b, 0);
  }
  return { profile, timing, size: reports.length,
    completed: reports.every(report => number(report.completed) != null)
      ? reports.reduce((sum, report) => sum + report.completed, 0) : null,
    complete: reports.filter(report => base.data.frames != null && report.completed === base.data.frames &&
      report.error == null && report.difference == null && report.load_compile_error == null).length,
    errors: reports.filter(report => report.error != null).length,
    differences: reports.filter(report => report.difference != null).length,
    loadErrors: reports.filter(report => report.load_compile_error != null).length,
    profiles: reports.filter(report => report.profile != null).length,
    inputs: reports.filter(report => report.profile?.fallback_inputs != null).length };
}

function status(report, other) {
  if (!report) return "缺失";
  if (report.load_compile_error != null) return "加载/编译错误";
  if (report.error == null) return "无";
  return other?.error != null ? report.error === other.error ? "有（前后相同）" : "有（前后不同）" : "有";
}

function difference(report) {
  if (!report) return "—";
  if (report.difference == null) return "无";
  const frame = String(report.difference).match(/\bframe\s+(\d+)\b/);
  return frame ? `有（第 ${frame[1]} 帧）` : "有";
}

function timingDelta(before, after) {
  const delta = before == null || after == null ? null : after - before;
  return [signed(delta), delta == null || before === 0 ? "—" : `${delta > 0 ? "+" : ""}${(delta / before * 100).toFixed(2)}%`];
}

export function renderComparison(before, after, options = {}) {
  const a = corpus(before, "before"), b = corpus(after, "after");
  sameSettings(before, after, "before/after");
  const ta = timingSamples(a, options.timingBefore ?? [], "before");
  const tb = timingSamples(b, options.timingAfter ?? [], "after");
  const ga = aggregate(a, ta), gb = aggregate(b, tb);
  const ids = [...new Set([...a.works.keys(), ...b.works.keys()])].sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
  const lines = ["# JIT corpus 前后对比", "",
    `- 运行口径：构建 before/after = ${text(before.build ?? "未记录（须调用方确认）")}/${text(after.build ?? "未记录（须调用方确认）")}；平台 before/after = ${text(before.arch ?? "未记录")}-${text(before.os ?? "未记录")}/${text(after.arch ?? "未记录")}-${text(after.os ?? "未记录")}；帧数 before/after = ${fmt(number(before.frames))}/${fmt(number(after.frames))}，seed before/after = ${fmt(number(before.seed))}/${fmt(number(after.seed))}；逐帧指令预算 before/after = ${fmt(number(before.instructions))}/${fmt(number(after.instructions))}。`,
    "- 仅比较本引擎解释器与 JIT 的逐帧结果/快照；**不是官方运行时一致性验证**，也不代表作品在任意输入/更长运行中均正确。",
    `- 耗时来源：before ${ta.length ? `无 profile timing_only，${ta.length} 轮逐作品中位数` : "profile JSON（含统计开销）"}；after ${tb.length ? `无 profile timing_only，${tb.length} 轮逐作品中位数` : "profile JSON（含统计开销）"}。统计计数始终来自 before/after profile JSON。`,
    "- 统计开销（包括 fallback 输入归因）、JIT 编译、构建模式和系统调度噪声均会影响耗时；计时仅包括 advance，不含作品加载/程序编译与结果比较。单轮或不同统计模式不能作为可靠加速结论；建议同环境 release、无 profile、前后交替多轮中位数。",
    "- region 覆盖率 = native_ops / (native_ops + interpreted_ops)。非通用委托比例 = (native_ops - delegated_ops) / 同一分母；native_ops 已含 delegated_ops，不能重复相加。该比例不是纯机器码比例，仍可能调用专用 reporter helper。node_calls 是 reporter 求值次数，不计入指令分母；regions 是已编译 region 数，不是执行次数。",
    "- 分母仅统计调度器层指令，不包含 call_reporter 同步解释的过程本体内部指令。reentrant gateway 的外层指令进入 region 不代表 reporter 本体已经 native；native/reentrant-* 也是对应 native/* 的子集，不重复相加。",
    "- Δ = after − before（负耗时差表示更快）。总耗时为逐作品所选耗时/中位数之和，不是整轮总耗时的中位数。缺失字段、零分母记为 —；fallback_inputs 旧版未提供时记为未采集，绝不视作零。",
    "- 只输出作品 ID、计数与内部原因名；error 仅显示是否存在及前后是否相同，不输出可能含作品文本的原始错误。", "", "## 全局总计", "",
    "| 指标 | before | after |", "| --- | ---: | ---: |",
    `| 作品数 | ${ga.size} | ${gb.size} |`,
    `| 完整完成且无 error/difference | ${ga.complete} | ${gb.complete} |`,
    `| 已完成帧合计 | ${fmt(ga.completed)} | ${fmt(gb.completed)} |`,
    `| error 作品数 | ${ga.errors} | ${gb.errors} |`,
    `| difference 作品数 | ${ga.differences} | ${gb.differences} |`,
    `| 加载/编译错误作品数 | ${ga.loadErrors} | ${gb.loadErrors} |`,
    `| 有 profile 的作品数 | ${ga.profiles} | ${gb.profiles} |`,
    `| 采集 fallback_inputs 的作品数 | ${ga.inputs} | ${gb.inputs} |`];
  for (const key of COUNTERS) lines.push(`| ${key} | ${fmt(ga.profile[key])} | ${fmt(gb.profile[key])} |`);
  for (const [label, key] of [["region 覆盖率（按指令加权）", "coverage"], ["非通用委托比例（按指令加权）", "directShare"]]) {
    lines.push(`| ${label} | ${metrics(ga.profile)[key]} | ${metrics(gb.profile)[key]} |`);
  }
  for (const key of ["interpreter_us", "jit_us"]) lines.push(`| ${key} 合计（μs） | ${fmt(ga.timing[key])} | ${fmt(gb.timing[key])} |`);
  const [delta, change] = timingDelta(ga.timing.jit_us, gb.timing.jit_us);
  lines.push("", `全局 jit_us 耗时差：**${delta} μs（${change}）**。`);
  const existing = [...a.works].filter(([id, report]) => report.error != null && report.error === b.works.get(id)?.error &&
    report.difference == null && b.works.get(id)?.difference == null);
  lines.push("", `观测摘要：before ${ga.complete} 完整、${ga.errors} error；after ${gb.complete} 完整、${gb.errors} error；其中 ${existing.length} 个前后相同的原有 error。`);
  if (ga.size === 53 && gb.size === 53 && ga.complete === 52 && gb.complete === 52 && existing.length === 1) {
    lines.push("本轮为 **52 完整 + 1 原有 error**，不是“53 作品全部成功”，更不是官方一致性结论。");
  }
  lines.push("", "## 逐作品覆盖率与耗时", "",
    "| 作品 ID | regions 前→后 | region 覆盖率 前→后 | 非通用委托比例 前→后 | jit_us 前（μs） | jit_us 后（μs） | 耗时差（μs） | 耗时变化 | interpreter_us 前→后（μs） |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const id of ids) {
    const ra = a.works.get(id), rb = b.works.get(id);
    const ma = metrics(ra?.profile), mb = metrics(rb?.profile);
    const xa = times(ra, ta, id), xb = times(rb, tb, id);
    const [d, p] = timingDelta(xa.jit_us, xb.jit_us);
    lines.push(`| ${text(id)} | ${fmt(ma.regions)} → ${fmt(mb.regions)} | ${ma.coverage} → ${mb.coverage} | ${ma.directShare} → ${mb.directShare} | ${fmt(xa.jit_us)} | ${fmt(xb.jit_us)} | ${d} | ${p} | ${fmt(xa.interpreter_us)} → ${fmt(xb.interpreter_us)} |`);
  }
  lines.push("", "## 完成帧、error 与 difference（profile 运行）", "",
    "| 作品 ID | 完成帧 前→后 | error 前 | error 后 | difference 前 | difference 后 |",
    "| --- | ---: | --- | --- | --- | --- |");
  for (const id of ids) {
    const ra = a.works.get(id), rb = b.works.get(id);
    lines.push(`| ${text(id)} | ${fmt(number(ra?.completed))} → ${fmt(number(rb?.completed))} | ${status(ra, rb)} | ${status(rb, ra)} | ${difference(ra)} | ${difference(rb)} |`);
  }
  lines.push("", "## 全局 top 原因", "", "仅汇总已采集记录；fallback_inputs 是回退指令内静态输入候选归因（可重叠），不是独立执行次数，不与指令数相加。", "",
    "| 类别（top 10） | before | after |", "| --- | --- | --- |");
  for (const key of REASONS) lines.push(`| ${key} | ${topReasons(ga.profile, key, 10)} | ${topReasons(gb.profile, key, 10)} |`);
  lines.push("", "## 逐作品 top fallback/helper 原因", "", "每类最多列 5 项，按次数降序；同次数按原因名排序。", "",
    "| 作品 ID | 类别 | before | after |", "| --- | --- | --- | --- |");
  for (const id of ids) {
    for (const key of REASONS) lines.push(`| ${text(id)} | ${key} | ${topReasons(a.works.get(id)?.profile, key, 5)} | ${topReasons(b.works.get(id)?.profile, key, 5)} |`);
  }
  return lines.join("\n") + "\n";
}

export function main(args) {
  const options = parseArgs(args);
  const output = outputPath(options.out);
  const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const inputPaths = [...options.inputs, ...options.timingBefore, ...options.timingAfter];
  if (inputPaths.some(file => fs.realpathSync(file) === (fs.existsSync(output) ? fs.realpathSync(output) : output))) {
    throw new Error("输出不能覆盖输入 JSON");
  }
  const report = renderComparison(...options.inputs.map(read), {
    timingBefore: options.timingBefore.map(read), timingAfter: options.timingAfter.map(read),
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, report, "utf8");
  process.stdout.write(`已生成 ${path.relative(ROOT, output)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
