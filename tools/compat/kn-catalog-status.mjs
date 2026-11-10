#!/usr/bin/env node
// Static, conservative dispatch inventory, not a claim of full semantic parity.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { catalogSha256, catalogTypes, eventTypes } from "./kn-catalog-manifest.mjs";

export function dispatchEvidence(source, file) {
  // Comments cannot turn an unsupported block into an implemented block.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, s => " ".repeat(s.length));
  const evidence = new Map();
  // Only quoted match-arm patterns at the start of a line, with optional guards.
  // Field selectors on nested matches are filtered by the catalog caller below.
  const arm = /^[ \t]*((?:"[^"\n]+"\s*\|\s*)*"[^"\n]+")\s*(?:if\b[\s\S]*?)?=>/gm;
  for (const match of clean.matchAll(arm)) {
    const line = clean.slice(0, match.index).split("\n").length;
    for (const literal of match[1].matchAll(/"([^"\n]+)"/g)) {
      const entries = evidence.get(literal[1]) ?? [];
      entries.push(`${file}:${line}`);
      evidence.set(literal[1], entries);
    }
  }
  return evidence;
}

function filesUnder(root, suffix) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(name, suffix) : name.endsWith(suffix) ? [name] : [];
  }).sort();
}

export const statuses = ["有执行路径／未完整验证", "部分语义", "固定值占位", "元数据", "缺失"];

const risks = {
  appearance_of_sprite: "已实现独立横纵百分比与官方两位舍入；文本 costume 特殊缩放及全部错误路径未验证",
  get_orientation: "官方 desktop 无设备分支实测为 numeric 0；仍未接入移动端设备倾斜，固定值不算传感器支持",
  mouse_down: "已区分屏幕/当前实例/命名角色及克隆并保留布尔类型；非法目标编译期拒绝，完整事件顺序未验证",
  self_dialog_wait: "官方实际为无限时非阻塞气泡；已补可见性/空文本/截断，跨场景及并发 timed 气泡取消未验证",
  get_clone_index_property: "已补命名宽高/方向/造型属性；历史数字属性码与特效重叠及其他属性未完整验证",
  convert_type: "KN 只允许 number/string，其他转换报错；未验证全部强制转换边界",
  setTimeout: "按官方 0.27.4 原生实测丢弃 callback statement，只调度空回调；通用 JS function 回调未实现，墙钟精度未验证",
  setInterval: "按官方 0.27.4 原生实测丢弃 callback statement，只调度空回调；通用 JS function 回调未实现，墙钟精度未验证",
  clearTimeout: "取消尚未派发的定时器；浏览器 timer ID 数值不保证相同",
  clearInterval: "取消尚未派发的定时器；浏览器 timer ID 数值不保证相同",
  username_get: "仅无账户后端 profile：官方未登录文本；已登录用户未实现",
  user_id_get: "仅无账户后端 profile：官方未登录返回字符串 0；已登录用户未实现",
  get_voice_answer: "仅未开始识别的初始空文本；麦克风、权限与识别后端未实现",
  recognize_body_part: "仅无检测结果时 false；检测后端未实现",
  recognize_gesture: "仅无检测结果时 false；检测后端未实现",
  bump_into_body_part: "仅无检测结果时 false；检测后端未实现",
  check_tilt_direction_of_face: "仅无检测结果时 false；检测后端未实现",
  get_position_of_body_part: "仅无检测结果时 NaN；检测后端未实现",
  get_appearance_of_part: "仅无检测结果时 NaN；检测后端未实现",
  get_tilt_angle_of_face: "仅无检测结果时 NaN；检测后端未实现",
  move_to_body_part: "仅无检测结果时不修改位置；检测后端未实现",
  face_to_body_part: "仅无检测结果时不修改方向；检测后端未实现",
  ai_chat_answer: "仅未启动聊天后端、结果缓存为空时的空文本；聊天请求与真实答案未实现",
  ai_text_result: "仅 OCR 缓存为空时的 numeric NaN；OCR 获取与真实结果未实现",
  ai_text_result_check: "仅 OCR 缓存为空时求值 text 后返回 boolean false；OCR 获取与有效缓存未实现",
  get_face_detection_result: "仅人脸缓存为空时 NaN；字段对应的真实检测结果未实现",
  get_object_detection_result: "仅物体缓存为空时 NaN；检测后端未实现",
  check_gender: "仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现",
  check_emotion: "仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现",
  check_face_shape: "仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现",
  microbit_math_map: "仅无 microbit 连接时求值五个输入后 NaN；官方映射公式本身也检查连接，真实设备分支未实现",
};
const limitations = {
  __break__: "官方类型声明/API 伪名；编辑器实际积木为 break。此分派仅为兼容输入，非同名积木支持",
  script_variables_set: "官方代码 API，非注册积木；原生作品用 variables_set + 脚本变量 JSON。兼容别名参照 HateNeko",
  change_script_variables: "官方代码 API，非注册积木；官方 JS→XML 存在赋值转换异常，本地兼容别名未模拟该缺陷",
  get_timer: "独立 block timer；官方用墙钟，NekoC 用 VM 仿真时间，暂停/节流和精度一致性未验证",
  reset_timer: "只重置独立 block timer，不改变舞台计时器；官方墙钟与 VM 仿真时钟差异未验证",
  controls_while: "官方注册/JS 转换已验证；NekoC 前测循环有回归，KN 原生播放调度差分未验证",
  _break_statement: "官方注册/JS 转换已验证；KN 原生播放中的嵌套退出与调度差分未验证",
  _continue_statement: "官方注册/JS 转换已验证；KN 原生播放中的作用域与调度差分未验证",
  _return_statement: "官方注册/JS 转换已验证；NekoC 复用过程返回，KN 原生播放差分未验证",
  _execute: "官方域函数空体；NekoC 先求值 action 再丢弃结果，完整官方输入求值管线差分未验证",
  _array_literal: "官方 Object.values 与 items0… 已核实；NekoC 保留输入顺序/类型，完整参数绑定差分未验证",
  calculate: "复用现有官方来源公式求值器；KN 官方域函数有限样例已测，全公式语言与异常集未验证",
  _object_literal: "KN 共享引用对象；官方字面量/属性读写有限样例有证据，完整 JS 原型链及全部 JSON 边界未验证",
  _object_get: "KN 共享引用对象；属性缺失保留 undefined，完整 JS 原型链及特殊键未验证",
  _object_set: "KN 共享引用对象；赋值返回值及副作用有限样例有证据，完整 JS 原型链未验证",
  procedures_2_actor_param: "按 mutation 参数 ID 与 Actor 字段实参读属性；clone_index 显式拒绝，完整过程作用域与错误差分未验证",
};

function primaryDispatch(engine) {
  // Restrict to the four real type dispatches. A field-option match, expression
  // traversal hint or dormant-root allowlist is not implementation evidence.
  const ranges = [
    ["fn value_one(", "fn push_constant(", 12],
    ["fn expression_one(", "fn scripts(", 12],
    ["fn scripts(", "// Official KN leaves disconnected statement stacks dormant.", 16],
    ["fn chain(", "\nfn json_proxy(", 20],
  ];
  const result = new Map();
  for (const [start, end, indent] of ranges) {
    const a = engine.indexOf(start), b = engine.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Re-audit VM dispatch scope ${start}`);
    const fragment = engine.slice(a, b);
    const allowed = new Set(fragment.split("\n").flatMap((line, i) =>
      new RegExp(`^ {${indent}}"`).test(line) ? [i + 1] : []));
    for (const [type, entries] of dispatchEvidence(fragment, "src/engine.rs")) {
      const lines = entries.map(x => Number(x.split(":").at(-1))).filter(n => allowed.has(n));
      if (lines.length) result.set(type, [...(result.get(type) ?? []), ...lines.map(n =>
        `src/engine.rs:${engine.slice(0, a).split("\n").length + n - 1}`)]);
    }
  }
  return result;
}

export function inventory(root, reference, engineSource) {
  if (reference) {
    const bytes = fs.readFileSync(path.join(reference, "kn_spec/block_catalog.json"));
    if (createHash("sha256").update(bytes).digest("hex") !== catalogSha256) {
      throw new Error("External catalog changed: re-audit the 300-name manifest and report");
    }
    const names = Object.keys(JSON.parse(bytes)).sort();
    if (JSON.stringify(names) !== JSON.stringify(catalogTypes)) throw new Error("Catalog manifest mismatch");
  }
  const engine = engineSource ?? fs.readFileSync(path.join(root, "src/engine.rs"), "utf8");
  const compiler = fs.readFileSync(path.join(root, "src/bcmkn_compiler.rs"), "utf8");
  // Fail closed if the type-agnostic import path changes. It clones *all* fields,
  // including type, without a block whitelist (not TS API emission support).
  if (!compiler.includes("let mut nested = block.as_object().cloned().unwrap_or_default();") ||
      !compiler.includes("Ok(Value::Object(nested))")) {
    throw new Error("Re-audit bcmkn_compiler::build_nested_block before classifying readable types");
  }
  const evidence = primaryDispatch(engine);
  // Non-dispatch definitions/loop parameters are consumed as compiler metadata.
  for (const type of ["procedures_2_defnoreturn", "traverse_number_param"]) {
    const at = engine.split("\n").findIndex(line => line.includes(`"${type}"`)) + 1;
    if (!at) throw new Error(`Re-audit metadata support for ${type}`);
    evidence.set(type, [`src/engine.rs:${at} (compiler metadata)`]);
  }
  const frequencies = new Map();
  const projects = ["samples", "projects"].flatMap(dir => filesUnder(path.join(root, dir), ".bcmkn"));
  function count(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.type === "string" && catalogTypes.includes(value.type)) {
      frequencies.set(value.type, (frequencies.get(value.type) ?? 0) + 1);
    }
    Object.values(value).forEach(count);
  }
  for (const file of projects) count(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")));
  const lua = reference ? filesUnder(path.join(reference, "rt/impl"), ".lua").map(file => [file, fs.readFileSync(file, "utf8")]) : [];
  const testFiles = filesUnder(path.join(root, "tests"), ".rs").filter(file =>
    !path.basename(file).startsWith("kitten4") && !["kitten_n_compat.rs", "k4_trace.rs", "web_kitten4.rs"].includes(path.basename(file)));
  const testSources = testFiles.map(file => [file, fs.readFileSync(file, "utf8")]);
  const rows = catalogTypes.map(type => {
    const vm = evidence.get(type) ?? [];
    // The expression compiler normalizes these shadow block names explicitly.
    if (type.startsWith("math_number_with_") || type === "math_number_not_allow_text") {
      const at = engine.split("\n").findIndex(line => line.includes('kind.starts_with("math_number_with_")')) + 1;
      vm.push(`src/engine.rs:${at} (number-shadow normalization)`);
    }
    const referenceFunctions = lua.filter(([, source]) => source.includes(`M.${type}`))
      .map(([file]) => path.relative(reference, file).replaceAll("\\", "/"));
    const metadata = ["procedures_2_defnoreturn", "traverse_number_param"].includes(type);
    const status = !vm.length ? "缺失" : metadata ? "元数据" : type === "get_orientation" ? "固定值占位" : risks[type] ? "部分语义" : statuses[0];
    const tests = testSources.filter(([, source]) => source.includes(`"${type}"`))
      .map(([file]) => path.relative(root, file).replaceAll("\\", "/"));
    return { type, status, risk: risks[type] ?? limitations[type] ?? (vm.length ? "显式路径仅证明会编译；全部字段、选项、错误与官方行为尚未逐项验证" : missingReason(type)),
      occurrences: frequencies.get(type) ?? 0, event: eventTypes.has(type), tests,
      vm, compiler: "src/bcmkn_compiler.rs::build_nested_block (generic field-preserving import)",
      reference: referenceFunctions };
  });
  const catalogTest = testSources.find(([file]) => path.basename(file) === "kn_catalog.rs")?.[1] ?? "";
  return { catalogCount: rows.length, projectCount: projects.length,
    catalogTestCount: [...catalogTest.matchAll(/#\[test\]/g)].length,
    scope: "显式 VM 分派覆盖；不代表所有字段/子选项均已实现。编译器能读指原生 JSON/工作区导入，不代表 TS API 会生成。游离积木被忽略不算 VM 支持。",
    counts: Object.fromEntries(statuses.map(s => [s, rows.filter(r => r.status === s).length])), rows };
}

function missingReason(type) {
  if (type === "get_sprite_property") return "官方未注册同名积木；这是转换到 coordinate/style/appearance/effect 等积木的代码 API，不伪造 VM 入口";
  if (/microbit_|catbit_|wand_|robot/.test(type)) return "缺少硬件/连接后端或对应计算实现；不是 stub 支持";
  if (/ranking|user_id|user_info|username|translate|conversation|ai_|voice|evaluate|detect|face|body_part|gesture|emotion|gender|appearance_of_part/.test(type)) return "缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持";
  if (/camera|webcam/.test(type)) return "缺少摄像头后端及对应执行路径；不是 stub 支持";
  return "没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持）";
}

export function coverageMarkdown(result) {
  const counts = result.counts;
  const shortRisk = {
    "元数据": "非独立指令；由过程/循环编译消费",
  };
  const testIds = [...new Set(result.rows.flatMap(row => row.tests))].sort();
  const testRef = file => `T${testIds.indexOf(file) + 1}`;
  const lines = [
    "# KN 300 项积木编译／运行覆盖审计", "",
    "> 审计口径：原生 `.bcmkn` → `Program::compile` → engine VM；不是 TS API 发射清单，也不是官方行为全兼容认证。", "",
    "## 结论与统计", "",
    `清单共 **${result.catalogCount} 项**，**${counts["缺失"]} 项缺失**，其余 ${result.catalogCount - counts["缺失"]} 项只有执行路径或元数据证据。**本报告认证完整语义支持的项数为 0**；不能将显式分派数当作兼容率。大量硬件、AI、网络、账户、摄像头后端仍未完成。`, "",
    "| 分类 | 项数 | 含义 |", "| --- | ---: | --- |",
    ...statuses.map(status => `| ${status} | ${counts[status]} | ${status === "缺失" ? "无对应执行路径；不是 stub 支持" : status === "固定值占位" ? "返回固定值，不代表设备能力" : status === "部分语义" ? "有路径且已识别具体限制/近似" : status === "元数据" ? "由其他编译环节消费，不独立执行" : "代码存在；未逐字段、选项、异常与官方差分"} |`),
    "", "分类互斥且加总 300。`部分语义` 并非只有这几项存在风险；其余有路径项同样没有完整语义保证。", "",
    "## 清单、证据与复现边界", "",
    "- 外部清单：`E:/nekoc-wt/_ref/hateneko/player/kn_spec/block_catalog.json`（300 个类型名）；仅转录名称/事件标记，不把第三方作品或运行时内核复制入库。",
    `- 清单文件 SHA-256：\`${catalogSha256}\`。本地名称快照在 [kn-catalog-manifest.mjs](../tools/compat/kn-catalog-manifest.mjs)，传外部路径运行时会校验哈希和全量集合。`,
    "- HateNeko **仅是实现参考和清单来源，非官方语义证据**。官方来源、下载哈希和小段定位见 [kncat-official-evidence.md](kncat-official-evidence.md)。",
    "- 最新集成基线另有 [kn-semantics.md](kn-semantics.md) 的官方 KN 原创夹具实测，覆盖有限调度、列表读取与转换样例；它不把本表升级成全类型/全字段认证。",
    "- 第二轮对象、定时器及离线服务降级的证据和未验证范围见 [kn-objects.md](kn-objects.md)、[kn-async-services.md](kn-async-services.md)、[kn-timers.md](kn-timers.md)；无设备降级路径不代表真实设备、AI 或账户后端。",
    "- 第三轮常用外观/对白与鼠标目标的修复见 [kn-appearance-dialog.md](kn-appearance-dialog.md)、[kn-pointer.md](kn-pointer.md)；新增 AI/OCR/检测查询仅是 [kn-offline-round3.md](kn-offline-round3.md) 的官方空缓存分支，不实现获取命令或实际后端。microbit map 的无连接 NaN 分支见 [kn-microbit-map.md](kn-microbit-map.md)，不能把它当作无条件数学映射。",
    "- 官方 bundle：`https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`；SHA-256 `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`。`_execute` byte 2962264 是空函数；`_array_literal` byte 2962446 使用 `Object.values`。空函数不等于输入不求值，执行管线仍需单独验证。",
    "- 导入层 `src/bcmkn_compiler.rs::build_nested_block` 泛型保留 type/fields，再按连接重建 inputs/statements/next；这只能说明能装配/读取，不能证明 VM 支持。`tests/kn_gap.rs::workspace_compiler_preserves_unknown_types_without_claiming_vm_support` 专门覆盖此区别。",
    "- 实现定位只扫描 value_one、expression_one、scripts、chain 的类型分派，排除注释、字段选项、expression_inputs 遍历提示和游离根忽略名单。元数据单独列出。此静态审计不能证明每条 guard 在 KN 模式均可达，也不能替代运行测试。",
    "- 表中缺失项的 `—` 表示四处执行分派及两处元数据均无匹配；当前表达式/指令/根事件分别进入 unsupported 诊断。游离或未执行代码被忽略不算运行支持。",
    "- 该 300 项清单不是官方全集；例如基础阴影/过程类型可能不在此清单，不能据此推断它们缺失。", "",
    "## 测试证据与未验证项", "",
    "- 工具回归：`npm run -s test:tools`；Rust 全量回归：`cargo test --all-targets`。最终执行结果及失败后重跑记录见 worktree 根目录未提交的 `OC-REPORT.md`，这里不固化随测试环境变化的历史失败数。防漂移测试校验 300 名称、互斥统计、保守状态、真实类型分派过滤和文档 300 行；可选外部清单校验由工具完成。",
    `- 本次 \`tests/kn_catalog.rs\` 含 **${result.catalogTestCount} 个测试**，覆盖 **12 个新增类型**：\`script_variables_set\`、\`change_script_variables\`、\`controls_while\`、\`__break__\`、\`_break_statement\`、\`_continue_statement\`、\`_return_statement\`、\`_execute\`、\`_array_literal\`、\`calculate\`、\`get_timer\`、\`reset_timer\`。这不是 300 项逐项运行认证。`,
    "- `tests/kn_catalog.rs` 覆盖 while 前测/重测、内层 break、continue 的 repeat/range/while 与 warp、脚本变量、返回及输入副作用、数组键顺序/类型、公式、独立计时器；部分测试请求 JIT 开关，不表示每个分支都实际进入热 JIT。",
    "- `tests/kn_gap.rs` 有 16 个前序代码视图类型的执行、数值/Latin-1 边界、严格 Number 谓词、热循环侧退出及未知类型导入/拒绝测试。",
    "- 下表 `Tn` **仅表示测试源码直接引用该类型名**（动态构造、辅助函数或间接覆盖可能未计；同样可能只是错误测试），不表示所有字段/子选项已测。`未定位` 也不等于没有任何测试。已过滤 Kitten4 专属与 `kitten_n_compat.rs`；余下文件可能包含旧 runtime/导入层测试，源码引用仍不能直接当作 engine 行为证据。",
    "- 未完成：300 项分别构造原生工程编译/执行、每个 dropdown/socket 与 malformed input、官方编辑器差分、跨平台硬件/AI/网络后端、渲染和音频最终输出的全量验证。原创 KN 夹具的编辑器检查以对应证据文档和带 SHA-256 的记录为准，不能推广到全部积木。", "",
    ...testIds.map(file => `- **${testRef(file)}**：[${file}](../${file})（源码引用，执行状态见上文）`),
    "", "## 全量逐项表（300 行）", "",
    "所有行的导入层均为上文 `build_nested_block` 泛型路径；只在“VM/编译位置”列有路径时才有进一步实现证据。行号随源码演化变化，可用下述命令重新生成。", "",
    "| # | 类型 | 状态 | VM/编译位置 | 测试源码线索 | 限制／未验证 |",
    "| ---: | --- | --- | --- | --- | --- |",
    ...result.rows.map((row, i) => `| ${i + 1} | \`${row.type}\` | ${row.status} | ${row.vm.map(at => `\`${at}\``).join("<br>") || "—"} | ${row.tests.map(testRef).join(", ") || "未定位"} | ${shortRisk[row.status] ?? limitations[row.type] ?? (row.status === statuses[0] ? "有路径；完整语义未验证" : row.risk)} |`),
    "", "## 复现与更新", "", "```powershell",
    "# 无外部依赖：用仓库内名称快照重新扫描当前 engine 并生成文档",
    "node tools/compat/kn-catalog-status.mjs --snapshot docs/kn-block-coverage.md",
    "# 校验外部原始清单并输出带参考函数位置的 JSON（可选）",
    "node tools/compat/kn-catalog-status.mjs E:/nekoc-wt/_ref/hateneko/player",
    "npm run -s test:tools", "```", "",
    "统计和逐项表由工具生成；新增执行分派、清单变更、测试引用或风险分类变化后应重生成并人工复审，不能只将状态批量改成“已实现”。", "",
  ];
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reference, output] = process.argv.slice(2);
  const result = inventory(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), reference === "--snapshot" ? undefined : reference);
  const text = output?.endsWith(".md") ? coverageMarkdown(result) : JSON.stringify(result, null, 2) + "\n";
  if (output) fs.writeFileSync(output, text);
  else process.stdout.write(text);
}
