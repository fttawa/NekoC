import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { median, outputPath, parseArgs, renderComparison } from "../tools/compat/jit-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function fixture(overrides = {}) {
  return { frames: 60, seed: 1, works: [{ id: "1", report: {
    completed: 60, error: null, difference: null, interpreter_us: 200, jit_us: 100,
    profile: { native_ops: 80, interpreted_ops: 20, delegated_ops: 30, node_calls: 999,
      regions: 2, fallback_reasons: { "cold/Branch": 20 }, helper_reasons: { "op/Turn": 30 } },
    ...overrides,
  } }] };
}

test("JIT report uses exact coverage denominators and tolerates old fallback_inputs", () => {
  const report = renderComparison(fixture(), fixture({ jit_us: 70 }));
  assert.match(report, /80\.00% → 80\.00%/);
  assert.match(report, /50\.00% → 50\.00%/);
  assert.match(report, /\| 100 \| 70 \| -30 \| -30\.00%/);
  assert.match(report, /\| fallback_inputs \| 未采集 \| 未采集 \|/);
  assert.match(report, /debug \/ 60 帧 \/ seed 1/);
  assert.match(report, /不是官方运行时一致性验证/);
  assert.match(report, /统计开销/);
  assert.match(report, /\| 已完成帧合计 \| 60 \| 60 \|/);
});

test("timing-only medians replace times but never counters", () => {
  const before = fixture(), after = fixture({ jit_us: 80 });
  const timing = value => fixture({ profile: null, jit_us: value, interpreter_us: value * 2 });
  const report = renderComparison(before, after, {
    timingBefore: [timing(30), timing(10), timing(200)], timingAfter: [timing(8), timing(12)],
  });
  assert.match(report, /\| 30 \| 10 \| -20 \| -66\.67% \| 60 → 20 \|/);
  assert.match(report, /\| native_ops \| 80 \| 80 \|/);
  assert.match(report, /无 profile timing_only，3 轮逐作品中位数/);
  assert.match(report, /\| jit_us 合计（μs） \| 30 \| 10 \|/);
});

test("invalid timing sources fail instead of silently mixing data", () => {
  assert.throws(() => renderComparison(fixture(), fixture(), { timingBefore: [fixture()] }), /无 profile/);
  assert.throws(() => renderComparison(fixture(), fixture(), {
    timingBefore: [fixture({ profile: null, completed: 59 })],
  }), /completed/);
  assert.throws(() => renderComparison(fixture(), { ...fixture(), seed: 2 }), /seed/);
  assert.throws(() => renderComparison(fixture(), fixture(), {
    timingAfter: [{ frames: 60, seed: 1, works: [] }],
  }), /作品集合/);
});

test("null fields, zero ops, missing works and missing profiles stay unknown", () => {
  const after = fixture({ profile: { native_ops: 0, interpreted_ops: 0, delegated_ops: 0, regions: 0 }, jit_us: null });
  after.works.push({ id: "2", report: { load_compile_error: "private work text" } });
  const report = renderComparison(fixture({ jit_us: 0 }), after);
  assert.match(report, /80\.00% → —/);
  assert.match(report, /\| 2 \| — → — \| 缺失 \| 加载\/编译错误/);
  assert.match(report, /\| native_ops \| 80 \| — \|/);
  assert.doesNotMatch(report, /NaN|Infinity|private work text/);
});

test("existing errors and differences are counted without copying original diagnostics", () => {
  const before = fixture();
  for (let id = 2; id <= 52; id++) before.works.push({ id: String(id), report: structuredClone(before.works[0].report) });
  before.works.push({ id: "53", report: { ...before.works[0].report, completed: 0, error: "private source text" } });
  const report = renderComparison(before, structuredClone(before));
  assert.match(report, /52 完整 \+ 1 原有 error/);
  assert.match(report, /有（前后相同）/);
  assert.doesNotMatch(report, /private source text/);
  const changed = fixture({ difference: "error frame 7: private source text" });
  assert.match(renderComparison(fixture(), changed), /有（第 7 帧）/);
  assert.doesNotMatch(renderComparison(fixture(), changed), /private source text/);
});

test("top reasons are aggregated, ordered and escaped; input attribution is not an op count", () => {
  const a = fixture();
  a.works[0].report.profile.fallback_inputs = { list: 4 };
  a.works[0].report.profile.helper_reasons = { "x|<y>\n": 4, first: 10, second: 10 };
  const b = structuredClone(a);
  b.works.push({ id: "2", report: structuredClone(b.works[0].report) });
  const report = renderComparison(a, b);
  assert.match(report, /first: 20；second: 20；x&#124;&lt;y&gt; : 8/);
  assert.match(report, /\| fallback_inputs \| list: 4 \| list: 8 \|/);
  assert.match(report, /\| native_ops \| 80 \| 160 \|/);
});

test("CLI accepts comma-separated and repeated timing flags", () => {
  const parsed = parseArgs(["a.json", "b.json", "--out", "dist/report.md",
    "--timing-before", "a1.json,a2.json", "--timing-before", "a3.json", "--timing-after", "b1.json"]);
  assert.deepEqual(parsed.timingBefore, ["a1.json", "a2.json", "a3.json"]);
  assert.deepEqual(parsed.timingAfter, ["b1.json"]);
  assert.throws(() => parseArgs(["a", "b", "--out"]), /缺少/);
  assert.throws(() => parseArgs(["a", "b", "--out", "dist/r.md", "--bad"]), /未知参数/);
});

test("outputs are confined to this worktree dist directory", () => {
  assert.equal(outputPath("dist/jit2/comparison.md"), path.join(root, "dist/jit2/comparison.md"));
  for (const output of ["comparison.md", "dist/../outside.md", "dist-other/report.md", "dist"]) {
    assert.throws(() => outputPath(output), /dist/);
  }
});

test("median handles even counts, invalid/null values and does not mutate inputs", () => {
  const values = [3, 1, 9, 5];
  assert.equal(median(values), 4);
  assert.deepEqual(values, [3, 1, 9, 5]);
  assert.equal(median([]), null);
  assert.equal(median([null, 2]), null);
  assert.equal(median([NaN]), null);
});
