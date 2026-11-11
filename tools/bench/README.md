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
- 正式测量每次启动前检查 Windows cargo/rustc/perf-bench/love/lovec 进程；发现竞争任务立即中止，
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
  `--input` 可指定单份输入；`--binary`、`--python`、`--copy`、`--out`、`--timeout` 可覆盖默认值。
  素材使用离线 `--no-assets`，外部素材/网络/鼠标键盘/真实音频时间不在可验证范围。
- 状态核对包含全局标量/列表、当前场景、角色数与属性及实体变量；克隆按原型与属性多重集比较，
  不要求两边临时 ID 字面相同。NekoC 的 K4-facing oracle rotation 经 `90-rotation` 还原 VM heading，
  与 H 的 `dir` 寄存器比较；这不证明两边渲染角度一致。数值容差 `1e-9 * max(1, abs(a), abs(b))`。
  最终观测一致不是逐帧或像素证明；失败/未知原语/状态差异不计算速度比，画笔即使标量一致也不算纯 VM 比。
- `results.json` 保留编译日志、输入/二进制/vendor/probe hashes、环境、原始数组、完整最终状态和差异。
  任何不一致或加载/运行失败返回非零，不删除失败项制造全通过结论。
- 如果竞争任务导致中断，用同一命令加 `--resume` 继续；校验 binary/probe/vendor/input hashes 与帧数，
  仅跳过已完成双边测量，未完成的一对从头测，不混用不兼容产物。
  `node tools/bench/hateneko-evidence.mjs dist/bench/hateneko/results.json docs/performance-hateneko-evidence.json`
  只从原始样本重新计算观察投影/中位数并生成紧凑证据，不修改原始计时。

完整实测、限制及优化前后见 [docs/performance.md](../../docs/performance.md)。
