# 可复现性能基准

在仓库根目录 PowerShell 运行（第三方输入始终只读，所有产物限定 `dist/`）：

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:CARGO_BUILD_JOBS='1'
$env:K4_PLAYER_DIR='E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
cargo build --release --bin perf-bench
node tools/bench/prepare.mjs dist/bench/prepared
node tools/bench/run.mjs --runtime both --fixtures dist/bench/prepared --corpus E:/nekoc/dist/kitten4-corpus --frames 60 --warmup 10 --repeats 3 --out dist/bench/current
```

默认 180 测量帧、30 预热帧、3 次独立进程/浏览器，seed=1，60 Hz 固定调度 delta。
正式对比时保持参数一致，串行执行，避免同时 Cargo 构建、浏览器基准。
`--binary dist/bench/before.exe` 可指定留存的优化前 release 二进制；
`--input <原始作品路径>` 只测一个作品，`--timeout` 限制原生子进程时间。
`--fixtures dist/bench/prepared` 使用同一批官方发布 AST（递归必须走此路径）；不传时直接生成工作区探针，
当前 NekoC 的工作区过程导入会显式失败，不能把该失败当成递归性能结果。
`--allow-assets` 复用 oracle 的声明素材 HTTPS 白名单，无凭据获取；默认严格断网。
`node tools/bench/compare.mjs before.json after.json dist/bench/comparison.json` 核对输入 hash、每次运行最终状态后输出比值。
正式优化前后推荐用交错顺序的配对测试，避免测试时间/温度漂移：
`node tools/bench/paired.mjs dist/bench/bin/before.exe target/release/perf-bench.exe dist/bench/prepared dist/bench/paired`
（7 次独立进程，预热 10 帧、测量 120 帧；记录二进制 SHA-256）。
也可把一个二进制参数替换成 `official`，交替运行外部离线 K4 与原生二进制；
例如 `node tools/bench/paired.mjs official target/release/perf-bench.exe dist/bench/prepared-string dist/bench/string-official`。
跨内核仍严格检查最终全状态；克隆/广播等已知工作量不同的作品会拒绝输出速度比。
跨内核比较只额外忽略官方显示名称 `variable_names` 和缺省/空的实体变量映射项，
仍比较所有实际全局、列表和私有值；帧号沿用原有诊断字段忽略约定。
旧性能快照 JSON 会将非有限数合并为 null；跨内核变量含 null/非有限数时保守返回
`unverified`，不凭该编码输出速度比。对象中已省略的 undefined 和符号零仍未完整保型，
官方配对当前只认证受控、有限数/文本/布尔/列表的自有夹具，不是通用语义 oracle。
最终状态相同仍不是逐帧语义等价的证明，回归以 `tests/jit_differential.rs` 等测试为准。
官方加载由 oracle 的 `timeoutMs` 限制，整个 worker 子进程另有 `--timeout` 硬超时（默认 120 秒）。
若操作系统强制终止 worker，浏览器的正常关闭 finally 无法保证执行，应检查是否残留孤立进程。
出现不支持、预算超限、官方报错时保留失败原因，退出码非零，不计为性能通过。

输出：`results.json`（环境、输入 SHA-256、每帧原始数据、最终状态）、
`summary.md`、`corpus-scores.json`（静态候选分数）、自制 `.bcm` 及失败诊断。
自制作品在每帧反复执行固定批次，避免预热后只测空闲；广播接收者有官方调度产生的流水线延迟。
语料按计算/克隆/画笔积木静态计数依次取未入选的第一名（固定选三个）；这**不证明**这些积木实际执行。
不要把第三方作品或播放器复制进仓库跟踪路径。

## 计量边界

- NekoC：导入=读文件、JSON、K4 转换、Program 编译、Engine 创建；不含进程启动。
  帧=整个 `Engine::advance`（脚本、JIT、帧输出构建，不含编码、渲染、最终快照）。
  内存=Windows `PeakWorkingSetSize` / Linux `/proc/self/status` VmHWM，整个进程高水位。
- 官方：复用 `tools/compat/k4-oracle.mjs` 的隔离 `.orig` 内核，受控 rAF 不等待实际屏幕刷新。
  导入=页面 navigation time origin 到作品素材 ready（含页面内核启动、可能的 workspace 编译和二次载入，
  **不是**纯 JSON 解析且不含浏览器启动）；帧=包围 `RuntimeManager.update` 的 `performance.now()`，
  不做逐帧完整快照，不含协议通信/rAF 外层绘图。update 内同步画笔/事件成本仍包含。
  内存同时记录 CDP 发现的各 renderer 进程 Windows PeakWorkingSet64 / Linux VmHWM（包括内核启动和同步绘制），
  与 `performance.memory.usedJSHeapSize` 帧末采样最大值。后者**不是浏览器 RSS 峰值**。
  renderer 不包含 browser/GPU 进程；不同进程高水位不能直接相加当作同时峰值，也不作内存效率加速比。
  原生 GC/JIT 均不强制干预；原始数组保留预热成本。
- 不保证相同 seed 跨内核随机序列一致；依赖 Date/网络/输入的第三方作品仅是无人输入情景。
  速度比较必须先核对工作量和状态，不支持/加载失败绝不能写成 0 ms。
- HateNeko 是 KN/Love2D 后端，不能把 K4 输入默认为同语义；使用下面独立的 KN 套件。

## 官方 KN 七项 runner（独立受控入口）

`tools/bench/official.mjs` 是 K4 oracle，`tools/bench/kn-ab.mjs` 是 native 历史
AB；官方 KN 使用独立的 `tools/bench/official-kn.mjs`。它不复制官方包：只读
`--bundle-dir`（或 `KN_OFFICIAL_BUNDLE_DIR`）下的三个 bundle，
并在启动前核对以下固定 SHA-256：

```text
main.8ccf2442.js  58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165
crc_libs.8196dbd1.js  462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7
main-vendors.07f7dd7e.js  38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68
```

本地缓存路径依据 [KN 源码调查](../../docs/kitten-n-runtime-findings.md)，必须通过
`--bundle-dir` 或 `KN_OFFICIAL_BUNDLE_DIR` 显式提供；本会话中记录的默认历史路径
`D:/AppData/Local/Temp/opencode/nekoc-kitenn/runtime-source/` 不存在，因此不会隐式采用。
本轮已核实可用的只读缓存是 `E:/nekoc-wt/hncompat2/dist/hncompat2-official/`，三个hash均匹配。
三个固定 bundle 都必须在该目录中存在并匹配 SHA-256；不会自动复制/下载主包、运行包或
vendors。编辑器 HTML、其他 UI 依赖仍需网络；
不是全离线播放器，也没有将任何第三方源码/作品放入跟踪目录。

先准备七份输入并做官方编辑器结构检查（不计时，但会启动浏览器）：

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/bench/official-kn.mjs --bundle-dir D:/path/to/read-only-kn-bundles --prepare-only
```

测量由调用方在确认机器空闲后统一执行：

```powershell
node tools/bench/official-kn.mjs --fixtures dist/bench/official-kn/fixtures --bundle-dir D:/path/to/read-only-kn-bundles --native-binary dist/bench/bin/native.exe --out dist/bench/official-kn-run
```

本轮实测使用同一批历史AB输入 `dist/bench/kn-ab/fixtures`、
`--bundle-dir E:/nekoc-wt/hncompat2/dist/hncompat2-official`、
`--native-binary dist/bench/kn-ab/latest-final.exe`，额外同exe的
`--native-wall-clock-binary`仅留独立真时钟诊断。
首批输出 `dist/bench/official-kn-final` 因其它会话构建中断并保留；重试使用
`dist/bench/official-kn-final-retry`，不能将首批失败隐藏或与重试拼成成功套件。

如需把默认真实墙钟退化单独留档（额外 native 诊断，不参与官方比较），显式增加
`--native-wall-clock-binary dist/bench/bin/native.exe`。该行要求返回
`deterministic=false`，与正式 `--native-binary` 的 `deterministic=true` 分列保存，
不会混入任何比值。

每个 repeat 使用全新 Edge、独立 worker 硬超时；安装 rAF 透传包装后正常 bootstrap，
Start 前收拢/取消尚未执行的原生 rAF，之后仅手动推进 rAF 批次。每批使用固定
`dt=1/60`、callback 安全上限4096（超限失败，不延后部分 callback 冒充一帧），
并且必须恰好有一次有效 `RuntimeManager.update`。未经受控批次的 update 不执行，
结束后不再推进。官方 `config.deterministic={seconds_per_update:1/60}` 关闭4ms墙钟
切片，保留原始每 interpreter step 的30000循环尾/50000过程调用预算；配置不符失败。
这不是默认在线编辑器性能。源码位置/hash复用 [KN warp证据](../../docs/kn-warp.md)，
正式计时不包装循环/过程热点进行逐积木统计。
另传 `--diagnostic` 会启动独立的无计时诊断，包装 `OptiRunner.step` 和
`step_iteration_yield`，记录逐update循环尾、单step最大循环尾及边界返回数。
数值/列表/字符串可检查固定批次；这是官方单边证据，native没有同单位逐批诊断，
所以仍不产生双边等工作量证书。不得把诊断成本计入正式样本。

只计原始同步 `manager.update`（不含协议、外层绘制、最终快照）；10预热+60测量，
三次独立运行，全部样本、input/binary/harness/bundle hashes、浏览器版本、配置和
page/console/runtime 错误保留在 `results.json` 及各 `*-official.json`。
worker 每帧计时结束后持久化已完成样本，失败/超时不记成0，不删除慢帧。
已有 `results.json` 的输出目录拒绝重跑覆盖，重新测量应指定新的 `--out`。
硬杀 worker 可能遗留浏览器，需人工检查，不会主动杀掉其他任务。

最终投影完整保留全局带类型值/列表、当前场景、全部存活角色/clone及其prototype、
位置/旋转/双轴scale/造型/可见性、各存活实体的所有声明私有值；没有长列表截断。
undefined/非有限数/循环引用有标签，未知actor API/漏项失败而非回退成空表。
比较时clone按prototype/属性/私有值多重集匹配，不要求临时ID拼写相等；native
`oracle_snapshot` 旋转保持原样；官方stage的弧度heading转换为 `90-heading*180/PI`。
该约定经真实浏览器非零位置/角度smoke检查；官方可能折叠整圈而native保留整圈，
此类差异不忽略。几何 `-0` 规范为0，变量中的 `-0` 仍带标签并拒绝不保型的native比较。
数值容差为 `1e-9*max(1,abs(a),abs(b))`，不忽略真实字段。

`--native-binary` 仅可选地附加同输入 native 诊断；官方 KN runner 默认不生成跨
内核比值。正式附带 native 时 runner 强制传 `--deterministic`，并要求返回
`deterministic=true`；这与官方 `config.deterministic` 一样关闭 KN 4ms warp 墙钟切片。
默认真实墙钟 native 退化不混入正式结果，应作为独立诊断另行记录。即使两边都为
deterministic，当前也没有每批工作量证书，所以CLI**不会输出比值**；完整投影
一致也只记录 `projection_equal`，不授予工作量资格。比例工具函数还要求完整样本、
无错误、明确等工作量认证；画笔因同步绘制/增量输出边界不等始终不可比。
这不是任务栈、像素、音频、输入、逐帧全过程或全面兼容认证。

Windows每次worker/native启动前复用`assertIdle()`排除已知cargo/rustc/perf-bench/love
竞争任务，只读检查、不杀进程；检查不是系统独占锁。所有写入限制本worktree的dist，
并拒绝输出路径经过junction/symlink。不要并发改输入、bundle或输出。

只跑工具契约测试（不会启动官方七项套件或 Rust 构建）：

```powershell
node --test tests/official-kn-bench.test.mjs tests/kn-bench-fixtures.test.mjs
```

## KN 历史 / 当前 native 五轮 AB

```powershell
node tools/bench/kn-ab.mjs dist/bench/kn-ab/latest-before.exe dist/bench/kn-ab/latest-final.exe dist/bench/kn-ab/fixtures dist/bench/kn-ab/latest-final
node tools/bench/kn-evidence.mjs
```

固定10预热+60测量、五轮独立进程AB/BA，默认真实4ms时钟（不传deterministic），
每次前后检查竞争任务、输入/二进制hash、完整最终状态。中断后同命令只复用完整双边对；
恢复重新计算摘要和状态相等性，参数、输入、二进制身份不一致即拒绝。
输出仅允许本worktree的 `dist/`，拒绝junction/symlink。不删除失败日志或慢样本。
历史源码可用 `git archive` 解到 `dist/bench/kn-ab/snapshots/`；共享Cargo target构建
不同快照时先 `cargo clean --release -p nekoc`，否则mtime可能使旧产物被错误复用。
历史、引入边界与最终候选是三组不同配对，不能拿独立批次相除宣称优化幅度。
`kn-evidence.mjs`重新从本轮固定位置的完整原始数组计算中位数和状态hash，
写入 `docs/knperf-evidence.json`；缺失套件不冒充完成，不包含第三方源码或作品。

## HateNeko / KN 同场实测

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
cargo build --release --bin perf-bench
node tools/bench/hateneko.mjs --ref E:/nekoc-wt/_ref/hateneko --love D:/Tools/love-11.5-win64/lovec.exe --frames 60 --warmup 10 --repeats 3
```

- 首次将只读参考完整复制到本 worktree 的 `dist/hateneko-run/`，只在带所有权标记的副本内运行
  `python tools/kn.py compile <副本内作品> --no-assets`；不打包 `.love`，不复制第三方源码至跟踪目录。
  前后记录参考全树 SHA-256，参考有变化即报错。复用副本还逐文件校验编译器/runtime 与参考一致，
  记录实际执行树（含明确的 main/conf/probe 插桩）；仅 works/builds 允许生成文件。
  副本、输出拒绝互相嵌套、与参考重叠、越出 dist 或经过 junction。
- `kn-fixtures.mjs` 从自有积木生成器生成七个 `.bcmkn`，工作量对应 K4 七探针；每次先执行
  `tools/editor-compat.mjs --channel msedge`，要求官方编辑器 `ok=true`。可用 `--prepare-only` 只准备。
- 正式测量每次启动前检查 Windows cargo/rustc/jit-corpus/perf-bench/love/lovec 进程；发现竞争任务立即中止，
  **不会**杀掉其他任务。独立 N/H 进程交替先后顺序，固定 delta=1/60，保留全部预热和测量数组。
  这只能排除检查瞬间的这些进程，不能排除之后启动的任务或其他系统干扰。
- Love2D 使用真实 main.lua、LoveHost、预加载、绘制；副本 main 顶部加载自有观察模块
  `hateneko-probe.lua`，包装 rt.start/step 与错误通道；固定帧数后自动写 JSON 并退出。
  不启用 vendor 的 probe/shot（它们会点击/截图），不更改 scheduler、原语或作品。
  conf 只以环境变量选择作品并关闭全屏/vsync；仍走真实窗口和 GPU，不是无渲染 VM。
- NekoC 导入含读取 JSON/编译；HateNeko 导入含运行时初始化/素材预加载，输入为预编译 Lua；
  原版 conf 会提前 require 作品，该解析发生在 probe 前，JSON 的 `work_cached_at_probe_entry` 明确记录此边界。
  Python 编译墙钟另列（含 Python 进程启动），不与导入混算。两个导入边界不等，不能算导入速度比。
  H 帧只计 `rt.step`，N 帧计 `Engine::advance`，均不含外层绘制/最终快照；同步画笔工作仍不等。
  内存均取 Windows 进程 PeakWorkingSetSize，H 包括窗口/GPU 驱动映射、draw、预加载；不算内存倍数。
- 默认另遍历 `projects/`、`tests/fixtures/` 的 `.bcmkn`，各运行一次 12 帧无预热，运行超时最多 20 秒。
  `--compat-only` 只跑这组仓库自有兼容短跑，不生成/计量七份性能探针，不可与 `--input` 同用；
  可将独立复验结果导出到 `docs/kncompat-hateneko-evidence.json`，不覆盖历史性能表的原始证据。
  `--manifest docs/kncompat-hateneko-evidence.json` 可锁定该历史41件，逐一核对路径与原始字节hash；
  仅可与 `--compat-only` 同用，不从新增夹具中隐式筛选或把当前全遍历冒充旧41件。
  `--input` 可指定单份输入；`--binary`、`--python`、`--copy`、`--out`、`--timeout` 可覆盖默认值。
  `--project-frames N` 显式覆盖原作的12帧上限（1..100000），同时允许使用给定 `--timeout`；
  `--interpreter` 只给 NekoC 加禁用 JIT 参数，H 不变，不把不同工作量当作相同帧语义。
  素材使用离线 `--no-assets`，外部素材/网络/鼠标键盘/真实音频时间不在可验证范围。
- 状态核对包含全局标量/列表、当前场景、角色数与属性及实体变量；克隆按原型与属性多重集比较，
  不要求两边临时 ID 字面相同。NekoC 的 K4-facing oracle rotation 经 `90-rotation` 还原 VM heading，
  与 H 的 `dir` 寄存器比较；这不证明两边渲染角度一致。数值容差 `1e-9 * max(1, abs(a), abs(b))`。
  最终观测一致不是逐帧或像素证明；失败/未知原语/状态差异不计算速度比，画笔即使标量一致也不算纯 VM 比。
- `results.json` 保留编译日志、输入/二进制/vendor/probe hashes、环境、原始数组、完整最终状态和差异。
  任何不一致或加载/运行失败返回非零，不删除失败项制造全通过结论。
- 如果竞争任务导致中断，用同一命令加 `--resume` 继续；校验 binary/probe/vendor/input hashes 与帧数，
  仅跳过已完成双边测量，未完成的一对从头测，不混用不兼容产物。
  每次调用前及套件结束后复核二进制hash；建议先复制到本worktree `dist/` 固定路径，
  不与可能被本地构建替换的 `target/` 产物混用。
  `node tools/bench/hateneko-evidence.mjs dist/bench/hateneko/results.json docs/performance-hateneko-evidence.json`
  只从原始样本重新计算观察投影/中位数并生成紧凑证据，不修改原始计时。
- 可显式增加 `--normalize-private`，仅删除与声明初始值相同、且所有现存对应实体已有私有值的
  冗余全局副本；不删除缺失或变更的私有值，不覆盖实体值。`--exclude-variables id1,id2` 只排除
  明确列举的全局字段，不自动忽略随机数/计时字段，也不改变运行时。另存 `normalized_comparison`，
  原始 `comparison` 不变；归一化不能授予速度比。两个参数也可传给 evidence 工具在同一原始
  样本上重放，声明需匹配原作品 SHA-256。完整41件裁定见
  [hateneko-verdicts.md](../../docs/compatibility/hateneko-verdicts.md)。

完整实测、限制及优化前后见 [docs/performance.md](../../docs/performance.md)。

## 同类项目 / kitten2scratch → TurboWarp

第三方代码仅 clone 到当前 worktree 的忽略目录 `dist/peers/`。先审查源码，
不运行第三方 exe，不运行 npm 生命周期脚本，不修改转换器或 VM：

```powershell
git clone https://github.com/CodeManTeam/kitten2scratch.git dist/peers/kitten2scratch
git -C dist/peers/kitten2scratch checkout 3b2dc03044e958b8052e947eebae09f2ec24ed5c
git clone https://github.com/TurboWarp/scratch-vm.git dist/peers/scratch-vm
git -C dist/peers/scratch-vm checkout 0cb82afe62506f3d9f2ff849c95593f0473b5d2c
npm --prefix dist/peers/kitten2scratch ci --ignore-scripts --no-audit --no-fund
npm --prefix dist/peers/scratch-vm ci --ignore-scripts --omit=dev --no-audit --no-fund
# 环境变量同本文开头；先构建本仓库 release perf-bench
node tools/bench/peers.mjs --prepare
node tools/bench/peers-evidence.mjs dist/bench/peers/results.json docs/performance-peers-evidence.json
```

- `--prepare` 先复用官方 K4 编译和本仓库 KN 生成器，七份 KN 全部执行官方编辑器检查，
  然后运行测量；再次测量不传该选项可复用已准备输入。不会使用第三方语料。
  `--prepare-only` 只准备并写入输入 hash manifest；复用时要求输入未变且素材仅内联 data URL，
  拒绝 CDN、本地资源路径和输出树内已有 symlink/junction。不要并发修改输出目录（检查不是原子沙箱）。
- 固定预热 10、测量 60（可 `--frames 120`）、三次独立 N/T 进程，按 NT/TN/NT 交替；
  原始数组、预热、完整变量/角色、输入/SB3/binary/vendor/harness hashes 均写入 `dist/bench/peers/`。
- Node 无头加载真实 TurboWarp VM，`enabled=true, warpTimer=false, turboMode=false`，不启动屏幕刷新循环；
  手动 `_step`，显式设置 `currentStepTime=1000/60`，保留其墙钟工作预算，不伪造单帧批次数。
  不装 renderer/audio/storage，素材警告留在每次 stderr 日志；因此不是可视播放器性能测试，画笔尤其不可比。
- 转换 CLI 与 VM 均预载 `peers-offline.cjs` 禁止 HTTP/HTTPS、fetch、Socket、WebSocket；
  这仅防止已审查自有输入意外联网，**不是恶意 Node 代码的安全沙箱**。
  只接受内建/pen 扩展，禁止外部 extensionURLs。未知/有损积木、编译失败、状态/工作量不同均不出速度比。
- 预热和测量不强制 GC。导入不含进程启动；转换墙钟含 CLI 启动，单次记录，不能算导入速度比。
  N 帧为 `Engine::advance`；T 帧为完整 `_step`，未执行渲染但含其调度循环与墙钟预算。
  T 峰值是 Node 进程 `resourceUsage().maxRSS`，不等于浏览器 renderer 内存。
- 当前转换器丢失 warp 语义，因此所有行均判“不可比”，套件完成后**预期退出 1**。
  不能把这个诊断退出码当成本仓库测试失败，也不能把 `status=ok` 当语义兼容。
  数值相对/绝对容差 1e-9，严格区分文本/数字/列表；相同终值不是等工作量证明。
- `compiled_threads`/`interpreted_threads` 是每帧线程观察次数之和（包括预热、重复观察同一线程），
  不是唯一线程数量、编译覆盖率或批次完成量。静态 opcode 分类也不是源积木全支持证明：
  转换器可把未知源积木降级成合法 opcode；具体结论以保留的终态差异和 warp 源码为准。
  vendor commit 固定校验，lockfile 留 hash，但未独立认证已安装 node_modules 全树完整性。
- Windows 每次启动前复用 `assertIdle` 检查 cargo/rustc/perf-bench/love 等竞争进程；
  检查不是系统独占锁，其他 Node/浏览器或检查后启动的任务仍可能干扰，不据此承诺绝对速度。
- 如机器用户 npm 配置的 `allow-scripts` 导致 Git 依赖准备报 `EALLOWSCRIPTS`，
  可把 `NPM_CONFIG_USERCONFIG` 指向本 worktree `dist/peers/` 内仅含注释的空配置，
  同时设置 `NPM_CONFIG_IGNORE_SCRIPTS=true` 后重试；不要改全局配置或启用脚本绕过。
