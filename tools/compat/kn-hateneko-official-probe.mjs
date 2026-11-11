#!/usr/bin/env node
// Exact input bytes, live official KN, passive snapshots; never a frame-parity oracle.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../probe-kitten4.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rawDirectory = path.join(root, 'dist/hncompat2-official');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
export const excluded = file => /projects\/(fangjie|tiny-lm)\//.test(file.replaceAll('\\', '/'));

export async function observe(page, source, result) {
  const project = JSON.parse(source);
  page.on('pageerror', error => result.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
    if (message.text().includes('audio finished')) result.audioConsole.push({ text: message.text(), at: Date.now() });
  });
  await page.route(/\/static\/js\/(main|crc_libs|main-vendors)\.[\w-]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const url = route.request().url(), name = path.basename(new URL(url).pathname);
    result.bundles.push({ url, sha256: hash(bytes), bytes: bytes.length });
    await writeFile(path.join(rawDirectory, name), bytes);
    let body = bytes;
    if (name.startsWith('main.')) {
      const original = bytes.toString('utf8'), marker = 'var __webpack_exports__=';
      if (!original.includes(marker)) throw new Error('Official webpack bootstrap changed');
      body = original.replace(marker, `window.__nekocRequire=__webpack_require__;${marker}`);
    }
    await route.fulfill({ response, body });
  });
  const projectUrl = 'https://kn.codemao.cn/__nekoc_hncompat2_official__.bcmkn';
  await page.route(projectUrl, route => route.fulfill({ contentType: 'application/json', body: source }));
  await page.goto('https://kn.codemao.cn/editor?previewUrl=' + encodeURIComponent(projectUrl), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(name => window.__nekocRequire && document.querySelector('canvas') &&
    window.__nekocRequire(91107).BcmInstance.getBcm().projectName === name &&
    (!document.querySelector('#init-loading') || getComputedStyle(document.querySelector('#init-loading')).display === 'none'), project.projectName, { timeout: 120000 });
  await page.addStyleTag({ content: '#DialogContainer{display:none!important}' });
  const done = page.getByText(/^完成$/).last();
  if (await done.isVisible()) await done.dispatchEvent('click');
  result.inspection = await page.evaluate(() => {
    const req = window.__nekocRequire, manager = req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(manager));
    return { ownKeys: Object.keys(manager), methods,
      getterSource: String(manager.get_variable), relevantMethods: Object.fromEntries(methods.filter(k => /clone|entity|timer|variable/.test(k) && typeof manager[k] === 'function').map(k => [k, String(manager[k])])) };
  });
  const snapshot = async label => {
    result.samples.push(await page.evaluate(label => {
      const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core;
      const manager = core.get_runtime_manager(), bcm = req(91107).BcmInstance;
      const encode = (value, seen = new Set()) => {
        if (value === undefined) return { $undefined: true };
        if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
        if (!value || typeof value !== 'object') return value;
        if (seen.has(value)) return { $cycle: true };
        seen.add(value);
        const result = Array.isArray(value) ? value.map(v => encode(v, seen)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v, seen)]));
        seen.delete(value);
        return result;
      };
      const compact = value => Array.isArray(value) && value.length > 32
        ? { kind: 'list-sample', length: value.length, head: value.slice(0, 3).map(v => encode(v)), tail: value.slice(-3).map(v => encode(v)) }
        : encode(value);
      const globals = {}, privateVariables = {}, unscopedPrivateReads = {}, definitions = {};
      for (const [id, v] of Object.entries(bcm.variablesDict)) {
        const global = v.isGlobal ?? v.is_global;
        const owner = v.currentEntityId ?? v.current_entity;
        definitions[id] = { isGlobal: global, ...(owner ? { owner } : {}) };
        if (global) globals[id] = compact(manager.get_variable(id));
        else {
          (privateVariables[owner] ??= {})[id] = compact(manager.get_variable(id, undefined, owner));
          try { unscopedPrivateReads[id] = compact(manager.get_variable(id)); }
          catch (error) { unscopedPrivateReads[id] = { $thrown: String(error), details: encode(error) }; }
        }
      }
      const actors = Object.keys(bcm.getBcm().actors.actorsDict).map(id => {
        const found = req(54174).V.core.actors.get_actor(id);
        if (found.is_error(found.value)) return { id, unavailable: true };
        const actor = found.value;
        return { id, position: encode(actor.get_position()), visible: actor.visible };
      });
      const internals = Object.fromEntries(Object.keys(manager).filter(k => /entity.*variable|variable.*entity|clone/.test(k)).map(k => [k, compact(manager[k])]));
      const stageVariable = req(69138).default.ComponentsStore.TheatreStore.stageVariable;
      return { label, at: performance.now(), running: core.get_runtime_data().is_running(), elapsedFrames: manager.get_elapsed_frames(),
        globals, privateVariables, unscopedPrivateReads, definitions, actors, internals,
        monitorVariables: Object.fromEntries(Object.values(stageVariable).map(v => [v.name, compact(v.value)])),
        pageTail: document.body.innerText.slice(-500) };
    }, label));
  };
  await page.getByText(/^开始$/).last().dispatchEvent('click');
  await snapshot('after-start');
  await page.waitForTimeout(400);
  await snapshot('after-extra-400ms');
  await page.waitForTimeout(1200);
  await snapshot('after-extra-1200ms');
  if (result.fixture.includes('input-kn')) {
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await page.keyboard.down('a');
    await page.waitForTimeout(350);
    await snapshot('a-held-350ms');
    await page.keyboard.up('a');
    await page.waitForTimeout(200);
    await snapshot('a-released-200ms');
  }
  result.editorVersion = await page.evaluate(() => window.__nekocRequire(91107).BcmInstance.getBcm().version);
}

async function main() {
  if (option('--archive')) return archive(option('--archive'));
  const baseline = JSON.parse(await readFile(path.join(root, 'docs/kncompat-hateneko-evidence.json'), 'utf8'));
  const selected = option('--files')?.split(',');
  const files = baseline.works.map(w => w.file.replaceAll('\\', '/')).filter(file => !excluded(file) && (!selected || selected.includes(file)));
  await mkdir(rawDirectory, { recursive: true });
  const out = path.resolve(root, option('--out') ?? 'dist/hncompat2-official/observations.json');
  const browser = await loadPlaywright().chromium.launch({ channel: 'msedge', headless: true });
  const report = { schema: 'nekoc-hncompat2-official-observations-v1', officialUrl: 'https://kn.codemao.cn/editor', checkedAt: new Date().toISOString(),
    browserVersion: browser.version(), baselineSha256: hash(await readFile(path.join(root, 'docs/kncompat-hateneko-evidence.json'))),
    method: 'Exact original project bytes through previewUrl; official UI Start; only webpack loader reference exposed. Read-only runtime-manager and stage snapshots. No registry/domain/timer/random overrides.',
    limitations: ['Wall-clock delays are not fixed frame counts; snapshots are not aligned to the benchmark.', 'No original file changes; no claim about unobserved gameplay, pixels, audio waveform, task equality or full-run correctness.', 'Only input-kn receives one synthetic a press/release after passive snapshots; all other projects receive no synthesized gameplay input.', 'Fresh unauthenticated headless desktop Edge; no physical devices or native host.', 'Long lists retain only length/head/tail; not full list equality.'], cases: {} };
  try {
    for (const fixture of files) {
      const source = await readFile(path.join(root, fixture), 'utf8');
      const result = report.cases[fixture] = { fixture, sha256: hash(source), exactOriginal: true, pageErrors: [], consoleErrors: [], audioConsole: [], bundles: [], samples: [] };
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      try { await observe(page, source, result); }
      catch (error) { result.failure = String(error.stack || error); }
      finally { await page.close(); }
      await writeFile(out, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ fixture, failure: result.failure, pageErrors: result.pageErrors, samples: result.samples.length,
        lastGlobals: /actor-variables|starhold|timers/.test(fixture) ? result.samples.at(-1)?.globals : undefined }));
    }
  } finally { await browser.close(); }
  report.ok = Object.values(report.cases).every(r => !r.failure && !r.pageErrors.length && r.samples.length >= 3);
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  if (!report.ok) process.exitCode = 1;
}

export function recommendation(file) {
  if (excluded(file)) return { status: 'delegated', adjudicated: '本代理排除；由其他代理取证。', unresolved: '本报告不裁定。' };
  if (/actor-variables/.test(file)) return { status: 'scope-and-value', adjudicated: '两个 UUID 是 actor 私有变量，不应出现在全局表；原体私有值 41/other-value，克隆继承 41 后独立写 99；全局 cloneChanged 官方为 99，而不是 0。', unresolved: '12 tick 开场尚未 done；官方较晚样本仅裁定语义/完成结果，不能冒充逐帧时间点一致。deleted 还须区分删除前后、数值 NaN 与字符串 NaN。' };
  if (/starhold/.test(file)) return { status: 'clock-and-rng-unmatched', adjudicated: '原作 reset/start timer，now 读 timer，dt=now-lastTime 并夹到 [0,.1]；socialId 随机整数区间 [100000,999999]，socialSession 区间 [100000000,999999999]。', unresolved: '墙钟输入和随机流未同源；三个时钟字段及两个 RNG 字段均保留差异，不能凭不同数值裁定任一实现全错，也不能自动忽略。未进入 gameplay。' };
  if (/pencraft-before-present-fix/.test(file)) return { status: 'partially-adjudicated', adjudicated: 'world 数字文本、前导零和长数字必须保留文本，支持 NekoC 的类型方向。', unresolved: 'actor x/y 也有差异，列表类型证据不能裁定坐标。没有 benchmark 相同 tick/输入逐帧坐标证据，整项不能判正确。' };
  if (/projects\/(eisei|pencraft)\//.test(file) && !/eisei_pv/.test(file)) return { status: 'typed-list-subset', adjudicated: '初始列表数字文本保持字符串；长文本/前导零不数值化。官方实际原作采样和旧精确夹具支持 NekoC 的类型方向。', unresolved: '大列表仅 head/tail 样本；未对每个差异索引和完整多帧绘画/坐标/像素做相同 tick 比较，不将类型方向判定提升为整作正确。' };
  if (/kn-async-services\/timers/.test(file)) return { status: 'official-final-value', adjudicated: '精确夹具官方 ready=1,after=1,fired=0；旧官方证据显示 callback 语句未进入 runtime 参数。H fired=2 与该原生项目官方行为不符。', unresolved: '不推广为一般 JS 回调/真实函数、任意 timer 竞态或停止重启支持。' };
  if (/audio\.bcmkn/.test(file)) return { status: 'opening-state-only', adjudicated: '全局变量表为空，旧 equal 是 {} 对 {}；音频完成 console 可单列观察。', unresolved: '不能据空表证明发声、等待完成、波形、重叠、停止、加载竞态或音色一致。K4 音频执行证据不替代 KN。' };
  if (/input-kn/.test(file)) return { status: 'opening-plus-input-oracle', adjudicated: '旧比较仅 ready=1、事件计数全零；官方键盘按住后 down 计数增长、释放后 up 计数改变另有观察。', unresolved: '旧 HateNeko 开场无合成输入，不覆盖键盘/点击分支；此次仅官方一个 a 按放，不是双边事件/帧对齐。' };
  if (/kn-semantics\/(conversion|objects|object-json)\.bcmkn|kn-value-types\/(initial-lists|nested-conversion|missing-object|nullish-list-item)\.bcmkn/.test(file)) return { status: 'official-typed-final-values', adjudicated: '精确官方夹具最终变量已归档：保留嵌套列表和字符串；列表转文本为逗号串；缺失属性赋全局为0；列表保存 Undefined，读取 Undefined 为数值NaN；显式null读取赋全局为0。object-json 官方支持并完成。', unresolved: '旧比较将非有限数/Undefined/null 混成 JSON null，有伪同值/伪差异风险；必须使用带类型标签比较。H unsupported 不能当作官方不支持。只裁定该夹具最终变量，不证明所有中间状态。' };
  return { status: 'observed-subset-only', adjudicated: '原有 equal 只代表所列开场变量/actor 快照；精确原作官方观测可补充有限状态或完成结果。', unresolved: '没有同 tick 全轨迹比较，不证明整个作品、像素、任务状态、后续输入或服务正确；稳定最终变量相等也不证明调度全过程。' };
}

export function adjudicateDifference(file, difference, observation) {
  if (excluded(file)) return { status: 'delegated', direction: 'not-adjudicated' };
  const key = difference.key;
  if (/actor-variables/.test(file) && /state\.variables\.30000000-/.test(key)) return {
    status: 'invalid-global-namespace', direction: 'do-not-add-private-variable-to-globals',
    reason: 'Definition is actor-private; official unscoped read throws. Compare the owner slot separately, not null versus an initial-value global copy.',
  };
  if (/starhold/.test(file)) return { status: /socialId|socialSession/.test(key) ? 'unmatched-rng-input' : 'unmatched-clock-input', direction: 'unresolved', reason: 'No shared input stream or benchmark-frame alignment; preserve difference without automatic exclusion.' };
  if (key.startsWith('state.actors.')) return { status: 'unmatched-frame', direction: 'unresolved', reason: 'Official actor snapshot is not aligned to the benchmark tick.' };
  const last = observation?.samples.at(-1);
  if (!key.startsWith('state.variables.') || !last) return { status: 'no-official-value', direction: 'unresolved' };
  const [id, component] = key.slice('state.variables.'.length).split('.');
  const actual = last.globals[id];
  const completed = last.globals.done === 1 || /kn-async-services\/timers/.test(file);
  if (actual === undefined) return { status: 'not-a-global-value', direction: 'unresolved' };
  let value = actual, scope = completed ? 'completed-fixture-final' : 'unmatched-wall-time-snapshot';
  if (component !== undefined) {
    if (component === 'length') value = Array.isArray(actual) ? actual.length : actual.length;
    else if (/^\d+$/.test(component)) {
      const index = Number(component);
      if (Array.isArray(actual)) value = actual[index];
      else if (actual?.kind === 'list-sample') {
        if (index < actual.head.length) value = actual.head[index];
        else if (index >= actual.length - actual.tail.length) value = actual.tail[index - actual.length + actual.tail.length];
        else return { status: 'list-index-not-sampled', direction: 'unresolved', reason: 'Official long list has length/head/tail only; do not extrapolate every index from one observed string.' };
      } else return { status: 'not-an-observed-list', direction: 'unresolved' };
      scope = completed ? scope : 'observed-list-element-type-only';
    }
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const n = same(difference.nekoc, value), h = same(difference.hateneko, value);
  let direction = n && !h ? 'supports-nekoc-value' : h && !n ? 'supports-hateneko-value' : n && h ? 'both-match-value' : 'neither-directly-comparable';
  if (value === undefined || value === null || value?.$undefined || value?.$number) direction = 'typed-recheck-required';
  if (Array.isArray(value) && difference.nekoc?.kind === 'list' && typeof difference.hateneko === 'string') direction = 'supports-nekoc-list-type-not-full-value';
  if (/actor-variables/.test(file) && id === 'cloneChanged') scope = 'completed-semantics-not-benchmark-tick';
  return { status: scope, officialValue: value ?? (value === null ? null : { $undefined: true }), direction,
    reason: completed ? 'Exact fixture completed in official KN; this is a final-value/typed-value ruling, not intermediate-frame equality.' : 'Only the actually observed value/type is covered; no same-tick/full-project correctness ruling.' };
}

export function summarizeRuntimeValue(value) {
  if (typeof value === 'string' && value.length > 128) return {
    kind: 'string-summary', length: value.length, sha256: hash(value), head: value.slice(0, 40),
  };
  if (Array.isArray(value)) return value.map(summarizeRuntimeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarizeRuntimeValue(v)]));
  return value;
}

async function archive(input) {
  const inputBytes = await readFile(path.resolve(root, input));
  const report = JSON.parse(inputBytes);
  const rawReports = [{ file: path.relative(root, path.resolve(root, input)).replaceAll('\\', '/'), sha256: hash(inputBytes), bytes: inputBytes.length }];
  if (option('--supplement')) {
    const supplementBytes = await readFile(path.resolve(root, option('--supplement')));
    const supplement = JSON.parse(supplementBytes);
    rawReports.push({ file: path.relative(root, path.resolve(root, option('--supplement'))).replaceAll('\\', '/'), sha256: hash(supplementBytes), bytes: supplementBytes.length });
    if (!supplement.ok || supplement.baselineSha256 !== report.baselineSha256) throw new Error('Invalid supplement');
    for (const [file, result] of Object.entries(supplement.cases)) {
      result.observationBatchAt = supplement.checkedAt;
      if (report.cases[file]) result.previousAttemptFailure = report.cases[file].failure ?? null;
      report.cases[file] = result;
    }
    report.ok = Object.values(report.cases).every(r => !r.failure && !r.pageErrors.length && r.samples.length >= 3);
  }
  const baselineFile = 'docs/kncompat-hateneko-evidence.json';
  const baselineBytes = await readFile(path.join(root, baselineFile));
  const baseline = JSON.parse(baselineBytes);
  if (!report.ok || report.baselineSha256 !== hash(baselineBytes)) throw new Error('Incomplete observations or stale baseline');
  const existing = [];
  for (const file of ['docs/kn-value-types-official.json', 'docs/kn-semantics-official.json', 'docs/kn-objects-official.json', 'docs/actor-variables-official.json', 'docs/kn-async-services-evidence.json', 'docs/input-kn-evidence.json', 'docs/audio-evidence.json', 'docs/audio-runtime-evidence.json', 'docs/nonfinite-verification.json']) {
    existing.push({ file, sha256: hash(await readFile(path.join(root, file))) });
  }
  const observations = {};
  for (const [file, result] of Object.entries(report.cases)) {
    if (excluded(file) || result.failure || result.pageErrors.length || result.samples.length < 3 ||
      hash(await readFile(path.join(root, file))) !== result.sha256) throw new Error(`Invalid original observation: ${file}`);
    const { inspection, ...compact } = result;
    const definitions = compact.samples[0].definitions;
    const samples = compact.samples.map(sample => {
      const { definitions: _definitions, monitorVariables, pageTail, ...runtime } = sample;
      // Monitor copies are not the oracle; only actor fixtures need their scope contrast.
      return summarizeRuntimeValue({ ...runtime, ...(/actor-variables/.test(file) ? { monitorVariables } : {}) });
    });
    // Do not check official function/source bodies into the repository.
    observations[file] = { ...compact, definitions, samples, observationBatchAt: compact.observationBatchAt ?? report.checkedAt, inspection: { ownKeys: inspection.ownKeys, methods: inspection.methods,
      getterSourceSha256: hash(inspection.getterSource), relevantMethodHashes: Object.fromEntries(Object.entries(inspection.relevantMethods).map(([k, v]) => [k, hash(v)])) } };
  }
  const entries = baseline.works.map((work, i) => {
    const file = work.file.replaceAll('\\', '/');
    const decision = recommendation(file);
    return { index: i + 1, file, sha256: work.sha256, baselineEqual: work.equal_observed_state,
      baselineDifferences: work.runs[0].comparison?.differences ?? [], baselineReason: work.runs[0].comparison?.reason ?? null,
      differenceRulings: (work.runs[0].comparison?.differences ?? []).map(d => ({ key: d.key, ...adjudicateDifference(file, d, report.cases[file]) })),
      ...decision, observed: !!observations[file], fullRunCorrectnessClaimed: false };
  });
  if (Object.keys(observations).length !== entries.filter(e => !excluded(e.file)).length) throw new Error('Missing in-scope original');
  const runtimeBytes = await readFile(path.join(rawDirectory, 'crc_libs.8196dbd1.js'));
  const runtimeText = runtimeBytes.toString('utf8');
  const clockAnchor = 't.prototype.get_timer_elapsed_s=function(){return((new Date).valueOf()-this.timer_block_date)/1e3}';
  const clockOffset = runtimeText.indexOf(clockAnchor);
  if (clockOffset < 0) throw new Error('Official clock anchor changed');
  const sourceFacts = [{ fact: 'Runtime manager elapsed timer reads wall-clock Date difference in seconds, not elapsed frame count.',
    bundle: 'crc_libs.8196dbd1.js', sha256: hash(runtimeBytes), utf16Offset: clockOffset,
    excerptCharacters: clockAnchor.length, excerptSha256: hash(clockAnchor) }];
  const archive = { schema: 'nekoc-hncompat2-official-v1', officialUrl: report.officialUrl, checkedAt: report.checkedAt,
    browserVersion: report.browserVersion, baseline: { file: baselineFile, sha256: hash(baselineBytes), entries: 41 },
    method: report.method, limitations: [...report.limitations, 'Console/resource errors (including unauthenticated HTTP 401/403 and one 422) are retained; no-uncaught-page-errors does not mean a clean network/service session.'],
    rawReports, archiveCompaction: 'Runtime strings >128 UTF-16 code units become kind/length/UTF-8 SHA256/head<=40 summaries. Small typed fixture values are otherwise complete. Definitions retained once per case; duplicate monitor copies omitted except actor scope contrasts; page UI tails omitted. Full original observations remain in rawReports under dist.',
    existingEvidence: existing, sourceFacts, entries: summarizeRuntimeValue(entries), observations,
    okMeaning: 'All 39 in-scope exact original projects observed in official KN with >=3 passive snapshots and no uncaught page errors; NOT runtime parity or full-run correctness.', ok: true };
  await mkdir(path.join(root, 'docs/compatibility'), { recursive: true });
  await writeFile(path.join(root, 'docs/compatibility/hncompat2-official.json'), JSON.stringify(archive, null, 2) + '\n');
  const lines = ['# hncompat2 官方裁定 notes', '', `官方观测时间：${report.checkedAt}；浏览器 ${report.browserVersion}。`, '',
    '41 个条目中 fangjie、tiny-lm 两件排除；其余 39 件使用原始字节通过官方 previewUrl 实际执行。官方脚本仅暴露 webpack require 引用；没有修改域函数、时钟或随机源。未启动任何 Rust 二进制/构建/bench。', '',
    '证据：`docs/compatibility/hncompat2-official.json`。原始 bundle 与方法体仅留忽略目录 `dist/hncompat2-official/`，归档只保留 hash。', '',
    '## 关键新观察', '',
    '- actor 两件：最后样本全局 `cloneChanged=99,inherited=41,original=41,cloneRead=99,otherRead="other-value",done=1`。两个 UUID 仅在 owner 私有表；不传 entity 参数的读取抛出官方 scope 错误。首次探针没有捕获这个预期错误而失败，补测捕获后成功；失败保留在原始报告和 previousAttemptFailure。',
    '- deleted 最后 `afterDelete` 为数值 NaN（`{$number:"NaN"}`），不是字符串。早期400ms样本仍为0，必须区分删除前后。',
    '- starhold 官方本轮 `now/lastTime` 为0→0.57→1.77秒，`dt` 为0→0.05→0；RNG 为633955/221655196。只记录实际样本，不将这些随机/时间值硬编码为固定官方答案。官方 timer 底层 Date 差值的 sourceFacts 保留 bundle hash/偏移/excerpt hash，无源码抄入。',
    '- pencraft-before-present-fix 官方坐标本轮从(0,0)到(0,180)再到(-243.6578,98.4955)，采样帧1/42/181。并非旧双方12 tick的对齐证据，不能拿任一样本替代旧x/y裁定。',
    '- audio 在本轮约1.6s窗口没有捕获 audio finished console；变量始终{}。这是没有完成证据，不是已验证播放或已证明官方错误。',
    '- input-kn 官方被动开场计数为0，按a 350ms后a-down/any-down=83，释放后a-up/any-up=1。仅官方输入分支观察，未声称H/N双边输入一致。',
    '- timers 本轮最终ready=1,after=1,fired=0，与旧官方证据一致；object-json在官方完成并保留JSON/对象类型，不能据H unsupported反说官方不支持。', '',
    '## 每项建议', '', '| # | 原作/夹具 | 旧比较 | 裁定范围 | 未裁定范围 |', '|---|---|---|---|---|',
    ...entries.map(e => `| ${e.index} | \`${e.file}\` | ${e.baselineEqual ? 'equal' : 'different'} | ${e.adjudicated} | ${e.unresolved} |`), '',
    '## 通用局限', '', ...report.limitations.map(s => `- ${s}`),
    '- baseline differences 每件最多30条，是截断列表；不能据此声称列出了全量底层差异。',
    '- 官方 runtime manager 未指定 entity 的私有变量读取不是全局变量存在的证据；监视器也不是原体私有槽的权威值。',
    '- 旧 archive 哈希引用用于可追溯；其中本地实现对照字段不作为官方答案。',
    '- 官方页面存在console/resource错误（未登录401/403、一次422等），全部保留；pageErrors为空不表示网络/云服务运行干净。',
    '- 归档中runtime长字符串>128仅保留kind/length/SHA256/head最多40字符；definitions每件一次，除actor外不保留重复monitor副本。完整raw报告位置/hash/字节数见rawReports；小夹具typed变量、16位world文本不截断。',
    '- 未新增或修改 bcmkn；因此本轮不需要生成器 editor-compat 复验。实际执行也不等同于重新做完整编辑器校验。', ''];
  await writeFile(path.join(root, 'dist/hncompat2-official-notes.md'), lines.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
