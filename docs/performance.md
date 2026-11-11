# NekoC / 离线 K4 播放器性能基准

## 结论与适用范围

本次以 `oc/integrate` 的 `146fd4f` 为优化基线，提供可复现的 release/headless 基准，
覆盖数值循环、列表操作、字符串拼接、克隆创建删除、广播风暴、过程递归和画笔七项自制作品，
另从只读 K4 语料静态筛选计算、克隆、画笔候选。所有作品及完整诊断只存放忽略目录 `dist/bench/`。
仓库不携带外部作品或内核源码。紧凑的自有测量证据见 [performance-evidence.json](performance-evidence.json)。

**这不是“所有作品 NekoC 比官方快”的结论。** 导入边界、渲染成本、广播/克隆调度存在差异；
对工作量不等或加载失败的项目不计算跨内核速度比。HateNeko 的独立 KN 同场实测见下文，不能套用本节 K4 数字。

## 环境与复现

- Windows x64，Intel Core i7-14650HX，24 逻辑 CPU，约 31.6 GiB RAM；Node v24.12.0。
- `cargo build --release --bin perf-bench`，Cargo release 配置为 opt-level=3 / fat LTO / codegen-units=1。
- 构建检查环境：`CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=1`。
- 官方为 headless Edge 157.0.4341.42，经 `K4_PLAYER_DIR` 只读加载离线 `player_v2*.js.orig`，
  主 bundle SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
  此离线包保留包装器 DI 暴露点，**未独立认证为线上原版**。
- 固定 seed=1、delta=1/60 秒，受控 rAF 连续推进，不等待屏幕刷新。
- 官方对照：预热 10 帧、测量 60 帧、3 次独立浏览器。优化配对：预热 10 帧、测量 120 帧、
  7 次独立原生进程，交替 before/after 顺序，报告各次帧均值的中位数。
- 重复运行不强制清 OS 文件缓存，不手工触发 GC；预热原始数组保留，不能理解为冷启动磁盘测试。
- 复现命令及计量完整约定见 [tools/bench/README.md](../tools/bench/README.md)。

先运行 `prepare.mjs`，用原生官方编译器生成七个自有探针的发布 AST；双方读取相同文件 hash。
递归不带过程参数，通过共享深度变量进入 20 层后还原，每批 40 次。没有生成或交付 `.bcmkn`。
准备时的官方编译耗时不纳入“已发布作品导入”；工作区直接加载另有试跑记录，不与正式表混用。

## 计量解释

1. NekoC 导入从读取作品到 Engine 创建，不含进程启动；官方导入从页面 navigation time origin
   到作品 ready，含页面内核启动、资源初始化，不含浏览器启动。**导入 ms 不能直接解释成同边界解析速度比。**
2. NekoC 帧是 `Engine::advance` 全耗时，含 JIT/帧输出构建，不含最终快照、序列化和渲染；
   官方帧包围 `RuntimeManager.update`，不含 rAF 外层绘图和协议往返，但包含 update 内同步画笔/事件处理。
   两边均不启用逐积木 trace，不做逐帧全量状态 JSON。官方每帧仅保存计数和内存采样。
3. NekoC 内存为独立进程 PeakWorkingSetSize；官方同时记录 renderer 进程各自 PeakWorkingSet64
   与帧末 JS heap 采样高水位。表中 renderer 取单次运行内最大 renderer 高水位，再取重复中位数，
   **不含 browser/GPU 进程**，也不把多个进程非同时的峰值相加。
   NekoC 在最终快照前读取高水位，官方 renderer 在最终快照后读取，因此后者还可能包含最终诊断分配。
4. 不将同 seed 视为跨内核同随机序列；第三方作品不模拟鼠标键盘，Date 计时器仍是现实时间。
5. 官方参考来源是本次 oracle 实测（输入 SHA、bundle SHA、原始每帧数组、最终状态见本地结果），
   并非 HateNeko 行为推测。这里只证明指定离线包、固定情景，完整官方一致性未验证。

## 自制作品对照

数值、列表、字符串、递归最终变量核对；数值允许浮点误差，不依赖画面 FPS。
克隆数和广播接收次数不等，单列而不宣称速度比。画笔只比较标量工作量，像素一致性未验证。

下表各单元格为三次独立运行统计量的中位数，帧单位 ms；内存单位 MiB。
N/K 分别为 NekoC / 官方离线 K4。此表不含 HateNeko（KN 后端另测，见下文）。

| 自制作品 | 导入 N/K ms | 帧均值 N/K ms | 帧 p95 N/K ms | 进程/renderer 峰值 N/K MiB | K4 JS heap 采样 MiB |
|---|---:|---:|---:|---:|---:|
| 数值循环 | 1.95 / 395.10 | 0.1072 / 6.0050 | 0.1160 / 6.4000 | 7.14 / 142.34 | 24.40 |
| 列表操作 | 2.06 / 396.80 | 0.2717 / 0.9033 | 0.3273 / 1.1000 | 7.35 / 132.79 | 17.90 |
| 字符串拼接 | 1.81 / 446.00 | 0.8423 / 0.5683 | 0.9049 / 0.9000 | 8.02 / 131.46 | 17.55 |
| 克隆创建删除† | 1.74 / 399.70 | 0.2053 / 5.3667 | 0.2311 / 6.5000 | 6.46 / 227.80 | 82.24 |
| 广播风暴† | 2.74 / 394.50 | 0.2019 / 0.2500 | 0.2149 / 0.4000 | 8.92 / 129.57 | 18.28 |
| 过程递归 | 2.15 / 400.90 | 0.0527 / 1.3017 | 0.0527 / 1.6000 | 7.86 / 137.29 | 22.18 |
| 画笔‡ | 1.93 / 383.30 | 0.1581 / 273.8883 | 0.1730 / 528.0000 | 7.60 / 667.66 | 21.91 |

† 任务工作量/生命周期不等，不作跨内核速度比。‡ 同步绘图与增量输出边界不等，不作纯 VM 速度比。
官方 V8 在字符串上优于当前 NekoC，不回避该结果。

### 工作量与差异

- 数值：每批 4000 次 `(log + 1) * 0.999`；双方 70 帧后约 999，末位存在浮点舍入误差。
- 列表：每批清空后 1000 次 append + 查找不存在的 -1 + 标量更新；末尾长度 1000，log=1。
- 字符串：每批从空串拼接 2000 次八字节文本，末尾长度 16000。V8 可以保留 rope 字符串，
  NekoC `Rc<str>` 仍需复制；本次优化不是将其改为可变共享串，避免改变别名语义。
- 克隆：每帧创建 200 个 mirror，clone hat 删除；70 帧末 NekoC 201 个 actor、官方 401 个 actor，
  存在额外一帧生命周期差异，**跨内核性能比未验证**。不在本性能任务修调度语义。
- 广播：每帧发送 100 次、12 个监听器，70 帧后 NekoC log=82800、官方 log=828，
  重复消息接收任务合并/重启行为存在差异；具体官方机制根因**未验证**，不称性能兼容。
- 递归：每帧 40×20 次调用，70 帧后 log=56000、depth=0。
- 画笔：每批 4000 次移动，70 帧后 log=280000。画笔历史不清理，官方 update 随历史增长，
  NekoC 仅输出增量且没有颜色感知 raster；不能将其作为纯算术 VM 倍数。

## 三条重负载路径及优化

首轮同批 AST 的 5×60 帧原生样本，最慢三个**微基准工作负载**为字符串约 0.976 ms、列表约
0.263 ms、广播约 0.249 ms。下面是对应的代码路径优化，**不是采样 profiler 证明的全语料前三符号**：

1. 字符串：`Engine::eval_value(ValueExpr::Join)` 两段拼接和 K4 加法/增加变量改用 `Cell::concat`，
   text+text 一次预留完整容量，去掉两次临时字符串/扩容复制。保留左到右求值和列表先字符串化的顺序。
2. 列表：`ValueExpr::Find → Cell::index_in` 对数字 needle 先分派类型，四项批量检查，
   保留首个位置、严格类型、NaN 不匹配、±0 相等及列表/造型对象引用身份。
3. 广播：`Engine::broadcast` 不再对每个 script（包括非监听器）克隆含 hat/event 字符串的 Script，
   只复制标量索引，创建任务时借用原 Script；不缓存动态消息表达式、不改变遍历或实例顺序。

未修改 `src/engine.rs` 的 chain/表达式编译，不移植 HateNeko 逻辑。
每次配对输入 hash 与最终全部状态严格相同才输出自身优化速度比；最终状态并非逐帧等价证明，
另跑 `tests/jit_differential.rs`、K4 调度/列表/克隆/非有限数等全量回归。

| 工作负载 | 优化前 ms | 优化后 ms | before/after | 耗时下降 |
|---|---:|---:|---:|---:|
| 字符串（热点 1） | 0.985805 | 0.803530 | 1.227× | 18.49% |
| 列表（热点 2） | 0.271117 | 0.246117 | 1.102× | 9.22% |
| 广播（热点 3） | 0.241898 | 0.204118 | 1.185× | 15.62% |
| 克隆（控制项） | 0.216231 | 0.211116 | 1.024× | 2.37% |
| 数值（控制项） | 0.109977 | 0.103289 | 1.065× | 6.08% |
| 画笔（控制项） | 0.162015 | 0.160528 | 1.009× | 0.92% |
| 递归（控制项） | 0.048008 | 0.046362 | 1.035× | 3.43% |

这里“快 22.7%”等于吞吐/速度比增加，字符串**耗时下降是 18.49%**，二者不混写。
控制项的小幅变化不归功于未修改的代码路径。第一版列表仅类型分派曾测得变慢，未用该版本作为最终优化；
最终四项批量版本以配对测试确认收益。结果包含整个程序代码布局影响，未做三项逐一消融，因果贡献大小未验证。

## 语料候选与不成功样本

扫描原始语料 `E:/nekoc/dist/kitten4-corpus/*.bcm`，只读遍历 compile_result（无则 workspace），
计算/克隆/画笔类别依次取未入选的最高计数；计数是候选筛选，不证明积木被执行。

| 类别 | ID | compute | clones | pen |
|---|---|---:|---:|---:|
| 计算 | 235277933 | 17463 | 8 | 371 |
| 克隆 | 214725822 | 14592 | 808 | 8 |
| 画笔（不重复选中计算项） | 335327306 | 5058 | 10 | 236 |

严格断网下前两项官方素材初始化超时（loading/error），不是“官方无限慢”。
启用 `--allow-assets` 后只允许作品声明的 CDN 资源，不发送 Cookie/凭据，重新实测。
`214725822` 在双方均触发 `lists_get_value_bad_index`，错误积木位置不同，不参与速度表。
未通过改变语料、伪造图片或剔除出错脚本让基准通过。

| 候选作品 | 导入 N/K ms | 帧均值 N/K ms | 帧 p95 N/K ms | 进程/renderer 峰值 N/K MiB | K4 heap MiB | 有效性 |
|---|---:|---:|---:|---:|---:|---|
| 235277933 | 953.35 / 23798.70 | 0.0055 / 0.7600 | 0.0057 / 1.2000 | 576.27 / 5580.50 | 265.53 | 仅无人输入开场，无速度比 |
| 214725822 | — | — | — | — | — | 双方列表越界，未验证 |
| 335327306 | 409.78 / 1499.10 | 0.3616 / 44.4233 | 0.5816 / 62.7000 | 286.54 / 560.81 | 132.76 | 仅固定开场，无速度比 |

有效行均 3 次、10+60 帧；K4 显式允许素材 CDN。作品 SHA-256 及标量结果在 evidence 中，完整状态在 dist。
235277933 的 NekoC 测量段总共仅执行 3734 条 VM 指令（60/60 帧非空），
335327306 执行 426900 条（60/60 帧非空），说明“静态计算最多”不等于无人输入开场正在计算。
语料双边逐帧状态、自动输入及实际热点路径未验证，不能以此算出上百倍兼容加速。

原始证据目录：

- `dist/bench/native-final/`：七个自有 AST + 三个语料的 NekoC，包含失败，套件退出 1 是预期的显式失败。
- `dist/bench/official-memory/`：七个自有 AST，三次官方逐帧数据、renderer 高水位、bundle hashes。
- `dist/bench/corpus-compute-final/`、`corpus-pen-final/`：两个有效语料三次官方数据。
- `dist/bench/corpus-assets/`：克隆候选的官方错误实测；`official/` 保留严格断网初始化失败。
- `dist/bench/paired/`：优化前后交错配对原始数据与最终状态校验；`bin/before.exe` 保留基线二进制。

配对二进制 SHA-256：before=`29fb20535bde20536ad44fe8139b7b0d87a3cdb6c69c3191848efd171d7de661`，
after=`c2dd5636099fca1782852e3669c42102696c3107b7fe16aaf22d404ad04a40fd`。
after 基准之后只收紧 CLI 溢出参数校验，不改变正常输入测量路径；其性能源码与提交版该路径一致。

## HateNeko

### 同一 KN 输入实测（2026-11-11）

已以 **HateNeko 0.4.0 / Love2D 11.5** 真正运行 KN 作品，替换此前的前置检查/N/A。
不是 0.7.1，不是 K4 输入适配，也不是脱离作品运行时的 Lua 算术循环。
代码基线 `0832707`，未做引擎优化；本表不含同时进行的 strcat 分支改动。
同机 Windows x64 / i7-14650HX / Node v24.12.0，NekoC 使用 release `perf-bench` 默认 JIT。
紧凑证据见 [performance-hateneko-evidence.json](performance-hateneko-evidence.json)，完整每帧数组与状态
在 `dist/bench/hateneko/results.json`，Love 输出/错误日志同目录。

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:CARGO_BUILD_JOBS='1'
cargo build --release --bin perf-bench
node tools/bench/hateneko.mjs --frames 60 --warmup 10 --repeats 3
# 竞争任务中断后以相同参数加 --resume 续跑
node tools/bench/hateneko-evidence.mjs dist/bench/hateneko/results.json docs/performance-hateneko-evidence.json
```

`kn-fixtures.mjs` 使用本仓库 TS→积木生成器，七份 `.bcmkn` 均通过在线官方 KN 编辑器
`tools/editor-compat.mjs`（`ok=true`、无 issues/pageErrors）。**编辑器检查只证明积木结构可加载，
不证明本表工作量与官方运行结果一致**；HateNeko 是第三方对照，不是官方行为证据。
递归无值参数、无返回值积木，不绕开参数 id 约定。

只读参考完整复制到忽略目录 `dist/hateneko-run/`，其全树 SHA-256 在运行前后核对不变。
只在副本内用 `kn.py compile --no-assets` 编译；所有 Lua/SVG 转换产物留在副本。
副本 main 顶部加载自有 `hateneko-probe.lua`；conf 仅增加作品选择环境变量和关闭全屏/vsync。
未改 scheduler/原语/作品语义，未移植 HateNeko 逻辑；来源注释清单为空。
仍调用原 main.update、LoveHost 预加载及绘制，不启用会自动点击的 vendor probe/shot。

七项自制微基准各预热 10、测量 60 帧，3 次独立 N/H 进程，交替先后顺序；固定 dt=1/60、不强制 GC。
每次启动前检查 cargo/rustc/perf-bench/love/lovec；兼容套件中途发现 strcat 构建后自动中止、空闲后续跑。
该检查不是系统级独占锁，检查后新启动任务及频率/温度/OS 调度仍可能干扰。

**边界不可混淆：** N 导入为读取 `.bcmkn`→Program 编译→Engine；H 为观察模块入口→预加载→rt.start 返回，
conf 已提前 require 预编译 Lua（证据 `work_cached_at_probe_entry=true`），不含该作品解析、进程启动或 Python 编译。
Python 编译墙钟另存 `compile_wall_ms`（含 Python 启动和内联 SVG 转换）。因此不算导入速度比。
N 帧是 Engine.advance；H 帧只包围 rt.step，含同步画笔处理但不含外层 draw/present。
内存均为最终诊断快照前的进程 PeakWorkingSetSize，H 包含 Love 窗口/驱动/绘制，不算内存效率倍数。

下表为三次运行统计量的中位数；N/H 分别为 NekoC/HateNeko。帧单位 ms、内存 MiB。

| KN 自制作品 | 导入 N/H ms | 帧均值 N/H ms | 帧 p95 N/H ms | 进程峰值 N/H MiB | H/N 帧耗时比 |
|---|---:|---:|---:|---:|---:|
| 数值循环 | 0.770 / 205.36 | 0.02551 / 1.66385 | 0.02680 / 2.03250 | 6.98 / 152.50 | 65.21× |
| 列表操作 | 0.754 / 195.38 | 0.22664 / 1.35933 | 0.23790 / 1.88200 | 7.24 / 152.59 | 6.00× |
| 字符串拼接 | 0.755 / 192.10 | 1.11807 / 2.50636 | 1.21660 / 4.17950 | 10.73 / 154.18 | 2.24× |
| 克隆创建删除 | 0.719 / 186.59 | 0.11878 / 0.91682 | 0.12980 / 1.94290 | 7.09 / 156.66 | 不可比 |
| 广播风暴 | 1.036 / 186.36 | 0.17051 / 0.75654 | 0.18040 / 1.47600 | 8.34 / 152.80 | 不可比 |
| 过程递归 | 0.886 / 187.61 | 0.03119 / 1.25052 | 0.01940 / 1.71080 | 7.71 / 152.52 | 40.09× |
| 画笔 | 0.808 / 209.84 | 0.07816 / 3.56698 | 0.08210 / 4.07130 | 7.36 / 154.64 | 不可比 |

递归存在少量较慢帧，故均值可大于 p95，原始数组保留；不剔除离群帧。
倍数是中位帧均值 H/N，**只适用于这四份微基准与本次观察范围**，不推广为完整 KN 或实际游戏加速。

#### 最终状态、工作量与失败项

核对全局标量/逐项类型化列表、当前场景、角色属性多重集及实体变量；数值相对/绝对容差 1e-9。
克隆临时 ID 按原型/属性归一，不删除角色数；N 的 K4-facing oracle rotation 用 `90-rotation` 还原为
VM heading，与 H 的 dir 寄存器比较。此转换不代表渲染角度/像素已经一致。

- 数值：两边 log=`998.9999999999424`；列表：log=1、1000 项均为数字 1；字符串：
  16000 字符，完整字符串严格一致；递归：log=56000、depth=0。四项三次均为观察状态一致后才给比值。
- 克隆：70 帧末 N 只有原角色 1 个，H 为 101 个；标量都是 0，**不能因标量相同忽略生命周期差异**。
  限额/延迟销毁的具体根因未验证，不修引擎来迎合测速。
- 广播：70 帧末 N log=84000，H log=840，接收工作量不等。是否由重复消息重启/合并导致未验证。
- 画笔：N log=280000，H 三次为 138496 / 137984 / 138560，位置也不等。
  H 墙钟预算/同步绘图可能导致每帧完成工作量变化，因果未验证；即使标量相同也不能当纯 VM 比。
- 最终状态一致不是逐帧、调用栈、别名、像素或随机序列一致；两边 seed=1 不保证同 PRNG。

#### 仓库自有 KN 兼容短跑

**修复前基线（`e46d38e` 所归档）**：完整遍历 `projects/` 16 份、`tests/fixtures/` 20 份 `.bcmkn`，各 12 帧、无预热、一次独立进程；
未改作品、未合成鼠标/键盘输入，超时上限 20 秒。36 份 HateNeko 均编译成功；
NekoC 30 份加载运行成功、6 份加载失败；HateNeko 35 份无报告错误/缺失原语、1 份显式 unsupported。
最终 **JSON 可表达观察状态 17/36 一致**，另 12 份双边运行但状态不同、6 份 N 加载失败、1 份 H 不支持。
本套件退出 1 是如实保留不一致项，不是全通过；所有短跑都不给性能倍数。

| 范围 | 一致/总数 | 差异、失败或未验证 |
|---|---:|---|
| projects/eisei | 1/8 | `eisei_pv` 开场一致；`eisei_pen`、`_128`、`_128_compact`、`_128_full_rebuilt`、`_128_import_probe`、`_128_lite` 的 N 加载均报 `math_arithmetic: missing input A`，H 可运行；`_128_fixed` 的列表有文本 `"1"` vs 数字 `1` |
| projects/qwen-chat、qwen-mini | 2/2 | 两个 base 无输入开场一致，不是实际模型生成验证 |
| projects/fangjie | 0/1 | y=-65 vs 0，chunk_x 列表长度 64 vs 0；具体根因未验证 |
| projects/pencraft | 0/3 | world 列表文本 `"3333333333333333"` vs 数字 `3333333333333300`，含类型/精度差异 |
| projects/starhold | 0/1 | dt、lastTime 不等，H 使用墙钟（例 lastTime=0.04 vs 0.18333）；不能据此断言调度错误 |
| projects/tiny-lm | 0/1 | 生成 id 列表长度 10 vs 0；无人输入、短帧窗口，工作进度不等，原因未验证 |
| actor-variables 两份 | 0/2 | H 全局变量表含私有变量默认值，N 只在实体变量中导出；观察结构/作用域差异，不直接当成私有变量执行错误 |
| audio、input-kn | 2/2 | 无输入开场一致；真实音频结束与输入响应未验证 |
| kn-async-services/timers | 0/1 | fired=0 vs 2；N 不执行 native callback 插槽，H 有回调，非同工作量 |
| kn-semantics | 9/12 | broadcast[-wait]、clone、conversion-boolean、list、scheduling、wait-negative、yield[-warp] 一致；conversion 的嵌套列表/串化不同，objects 缺失值不同；object-json 的 H 缺 `JSON.parse/JSON.stringify/Object.keys`，虽未报崩溃仍记 unsupported |
| list_writes、nonfinite 两份 | 3/3 | JSON 观察一致；非有限数会序列化为 null，不能验证 NaN/Infinity 身份或列表别名 |

逐项错误/状态摘要和 hash 均在紧凑证据；完整变量/列表不嵌入文档，仅留 dist。
Love 窗口仍可能收到 OS 鼠标/焦点事件，随机、墙钟、素材/音频外部状态不等时一律保留为未验证，
不以“第三方实现等于官方”判定哪边正确。

#### kncompat 官方复核与修复（2026-11-11）

本轮以 `e46d38e` 为基线，不合入同时进行的 strcat 改动，不重写上方历史微基准数字。
测量二进制来自本 worktree 未提交修复源码（报告 revision 是基线 HEAD，不冒充已提交修订）；
release `perf-bench` SHA-256 为 `7bd2611afa63de1a1b4b5e2fe8b3b3a941919ba46bc7ca29a9dcb2ea774c645e`。
只修官方证据确认的 KN 问题，不追求与第三方输出无条件相同。详细取证和限制见
[kncompat.md](kncompat.md)、[类型复核](kn-value-types.md)、[运行进度与 callback](kn-project-progress.md)。

| 原争议 | 官方 KN 0.27.4 实测／源码结论 | 本轮处理 |
|---|---|---|
| 六份 eisei 缺少算术 A/B | 缺槽得到数值 NaN，脚本继续；不是默认 0 | 修正 KN 算术编译，原作品不变，六份均可完整编译 |
| eisei 列表 `"1"` | 初始/运行时列表保留文本 | NekoC 正确，保留类型 |
| pencraft world 长数字文本 | 保留 `"3333333333333333"`，不能按数值舍入 | NekoC 正确，保留类型 |
| conversion 嵌套列表、objects 缺失值 | 逗号串化与按使用上下文处理缺失值，与 NekoC 已有主路径一致 | 增加五份带类型原创回归，不迎合第三方 |
| 新探针：列表中的 Undefined 再读取 | 普通索引/last 均 NaN；null 则保留 | 修正 KN typed `list_item`，JIT 开/关与官方逐变量一致 |
| fangjie y、chunk_x | world 初始化先于 chunk_x/标题；官方原作也能长时间保持 y=0、chunk_x=0 | 进度差异，不伪造列表修复；完整原作终态及逐帧策略仍未验证 |
| tiny-lm id 长度 | 官方自然完成生成15项，前10项与 NekoC 记录相同 | 固定12次 update 工作量不等，不据此认定采样/append 错 |
| native timer callback 插槽 | 官方编译未传 statement body，只传 delay；替换为空函数，fired=0 | 保留不执行插槽，不能因 H fired=2 而修改 |

独立兼容复跑使用新选项 `--compat-only`，不生成/计量七份性能探针；新增五份原创类型夹具
均通过官方 editor-compat。固定12帧、无预热、无合成输入的状态比较仍只是短窗观察，
不把 KN 的默认 30000 次/4ms warp 切片差异伪装成完整调度一致性。

```powershell
node tools/bench/hateneko.mjs --compat-only --out dist/bench/kncompat
# 检测到其他任务启动 cargo/bench 后中止，空闲时同参数续跑
node tools/bench/hateneko.mjs --compat-only --out dist/bench/kncompat --resume
node tools/bench/hateneko-evidence.mjs dist/bench/kncompat/results.json docs/kncompat-hateneko-evidence.json
```

本轮原始兼容复跑与门禁结果另行归档，历史的 `performance-hateneko-evidence.json` 保持不变。
完整结果为 [kncompat-hateneko-evidence.json](kncompat-hateneko-evidence.json)，manifest 41项全部双边完成，
参考树指纹前后不变。运行期间其他任务三次启动 cargo，guard 中止后以相同二进制、参数、作品 hash 续跑；
没有禁用空闲检查，没有删除任何失败/unsupported/不等状态。套件最终退出1是保留不一致的预期结果。

| 短跑范围 | NekoC 运行成功 | HateNeko 无报告错误／缺失原语 | 观察状态相等 | 剩余情况 |
|---|---:|---:|---:|---|
| 原有36份（修复前） | 30/36 | 35/36 | 17/36 | 6份 N 加载失败、12份双边不等、1份 H unsupported |
| 同一36份（本轮） | **36/36** | 35/36 | 17/36 | 六份 eisei 已加载运行，仍有官方支持的字符串类型差异；共18份双边不等、1份 H unsupported |
| 新增5份类型回归 | 5/5 | 5/5 | 1/5 | runtime-lists 一致；另外4份不同，但5份均与官方逐变量一致 |
| 本轮完整41份 | **41/41** | 40/41 | 18/41 | 22份双边不等、1份 H unsupported，不计算性能比 |

本轮格式/Clippy 已通过；JS 工具测试 `420 passed / 0 failed / 50 skipped`；K4 原命令三 seed
均 `ran:52, run:1`，达到52门槛但仍保留原有运行错误，不声称全语料零错误。
`RUST_TEST_THREADS=1 cargo test --all-targets` 为 `786 passed / 0 failed / 1 ignored`，完整测试不删减。
已保留本轮二进制于 `dist/bench/kncompat/bin/`，之后 `cargo clean` 清理本 worktree 4.4 GiB 构建产物。

#### 修复前性能测量的历史验证记录

以下仍是前一轮七项性能测量的原始记录，不是本轮 kncompat 二进制或门禁结果。
该轮 Python 编译墙钟七项分别约 391 / 408 / 397 / 392 / 411 / 422 / 413 ms（只编译一次，不是统计中位数）。
实测 N 二进制 SHA-256：`068adef6b56ce947905d3544ba22cc5eec37530f649e8f165bb34a962b93be47`；
探针 SHA-256：`0b0b593ccf3554b21cf8834ee1d07d59baecc8a1992bf6c8deaf2ddf789aa384`。
后续修改仅收紧脚本验证/比较投影，不修改帧数组、二进制或 Lua 计时探针。

本任务验证：`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` 成功；
`RUST_TEST_THREADS=1 cargo test --all-targets` 为 780 passed / 0 failed / 1 ignored。
默认并行首次在已有 columns JIT 差分测试 frame 53 失败，未修改测试，单线程全套重跑成功；根因未验证。
`npm run -s test:tools` 最终为 406 passed / 0 failed / 51 skipped；K4 三 seed 均 `ran:52, run:1`，
达到门槛但不隐藏剩余运行错误。详细原文摘要见根目录未提交 `OC-REPORT.md`。
已保留 release 二进制于 `dist/bench/hateneko/bin/` 后清理本 worktree 4.3 GiB Cargo 临时构建产物；复验需按上述命令重建。

## 验证与已知风险

- Rust 格式、全目标 Clippy（warnings=deny）、全目标测试（no-fail-fast）、JS 工具测试均需通过后提交。
  本次结果：`cargo fmt --check` 成功；`cargo clippy --all-targets -- -D warnings` 成功；
  `cargo test --all-targets --no-fail-fast` 共 461 passed / 0 failed / 1 ignored，
  其中 `jit_differential` 10 passed；`npm ci --ignore-scripts` 成功（0 vulnerabilities），
  `npm run -s test:tools` 为 133 passed / 0 failed / 8 skipped。
  另设 `K4_ORACLE_INTEGRATION=1` 单跑 `tests/bench.test.mjs`：6 passed / 0 failed / 0 skipped，
  实测性能插桩不改变 numeric 探针变量，并验证 update 数量与 renderer 内存读取。
- 不设置性能硬门槛：Windows 频率/调度、浏览器 GC/JIT、0.1 ms 时间量化会影响小样本，
  原始数组与峰值、预热成本均保留；跨机器应重新测，不能照抄表中比例。
- 自制探针的官方编译/运行实测覆盖本次工作量；第三方作品完整交互、随机、像素和音视频性能未验证。
- 当前没有全语料采样 profile，所以“全仓库最慢三个函数”仍未验证；本任务优化的是实测最慢三个微基准路径。
- 本文有意公开差异/失败项；不能将基准运行退出非零等同于测试回归失败，也不能删掉失败项声称全面对齐。
