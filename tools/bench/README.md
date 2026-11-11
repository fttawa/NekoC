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
