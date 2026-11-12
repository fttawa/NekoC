# NekoC 替代播放器总评分卡

## 本轮范围与结论

测量基线：`da8dc9c5c414a4b32c9239c33df437d6d8322cf1`（开始时最新 `oc/integrate`），
日期：2026-11-12，Windows x64 / Intel Core i7-14650HX / Node v24.12.0。
本轮浏览器为Edge `157.0.4341.46`，历史多轮为`.42`，浏览器更新也是历史性能比较的混杂因素。
本轮只做测量与文档，不改运行时；本页不使用缺少权重依据的“总分”或把未知项当零分。
所有数值均以本页的命令编号、日期与基线定位；历史官方证据明确另列版本与来源。
扩展 API 的当前能力/限制另按 v2 实现更新，不改变上述测量身份、历史性能数字或门禁记录；
扩展验收结果见 `OC-REPORT.md`，不能把本页历史基线追记为 v2 验收。

**目前不能宣称在适配、兼容性、性能、可扩展性四维全面超过官方或其他项目。**
导入/执行映射不等于完整兼容，短窗终态一致不等于全程输入、调度、像素与音频一致；
画笔、克隆、广播和转换有损的工作量不得拿来计算性能倍数。

| 维度 | 相对官方K4 | 相对官方KN | 相对HateNeko | 相对其他项目 |
|---|---|---|---|---|
| 适配 | N增加KN/TS与可嵌入Rust宿主；K4全作品替代未认证 | 原生KN导入存在；设备/服务不完整 | N同时接K4/KN；H有Lua/Love宿主 | 直接导入避开所测SB3转换损失；壳平台数不当内核数 |
| 兼容性 | 有限官方主路径/离线探针证据，42 partial保留 | 300名称无缺失不等于官方全集或全语义支持 | 精确41件短窗与既有官方裁定分列 | TW本体与转换器不能混为一谈；其他壳未全作品复测 |
| 性能 | 四项计算探针有配对耗时比，其余不授予倍数 | 缺历史正式runner；单独探索不能冒充历史复测 | 本轮三项可比，递归不等；KN数值存在历史退化风险 | 转换有损项不可排名；K4-ULTRA完整路径未验证 |
| 可扩展性 | N有v2宿主契约并兼容v1；官方第三方契约对齐未验证 | 本地trait不能代替官方设备/服务 | H同样有模块/host边界，不能说完全不可扩展 | N已支持reporter/Boolean/hat和JIT尾部helper；TW生态/K4-ULTRA插件链仍有差距，N无OS沙箱 |

## 测量身份、复现命令与口径

以下命令都在本 worktree 根目录运行。构建及门禁设置
`CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=1`；
浏览器工具设置 `NEKOC_NODE_MODULES=D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules`、
`K4_PLAYER_DIR=E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`。

| 编号 | 2026-11-12 / `da8dc9c` 的命令 | 边界 |
|---|---|---|
| B | `cargo build --release --bin perf-bench`；复制二进制到 `dist/bench/scorecard/bin/` | release / 默认 JIT，不含构建耗时 |
| K4 | `node tools/bench/prepare.mjs dist/bench/scorecard/prepared`；`node tools/bench/run.mjs --runtime both --binary dist/bench/scorecard/bin/perf-bench.exe --fixtures dist/bench/scorecard/prepared --frames 60 --warmup 10 --repeats 3 --out dist/bench/scorecard/k4` | 同一官方发布 AST，各自独立进程/浏览器，固定 seed=1、dt=1/60 |
| H | `node tools/bench/hateneko.mjs --binary dist/bench/scorecard/bin/perf-bench.exe --frames 60 --warmup 10 --repeats 3 --out dist/bench/scorecard/hateneko` | 七项 KN 探针，N/H 交替；默认新增夹具遍历不替代历史41件分母 |
| H41 | `node tools/bench/hateneko.mjs --compat-only --manifest docs/kncompat-hateneko-evidence.json --binary dist/bench/scorecard/bin/perf-bench.exe --normalize-private --out dist/bench/scorecard/compat41` | 精确锁定历史41件字节 hash，12 update、无预热、一次运行；原始/归一化分列 |
| P | `node tools/bench/peers.mjs --prepare --out dist/bench/scorecard/peers` | K4/KN各七项，10+60帧、三次；原转换结果，不修补第三方 |
| KN探索 | `node dist/scorecard-kn-official.mjs`；[可重建方法](scorecard-kn-method.md) | 新增本地观察脚本；真实rAF/默认墙钟，不同于K4受控调度，未认证等工作量 |
| C4 | `node tools/compat/k4-block-catalog.mjs E:/nekoc/dist/kitten4-corpus` | 官方注册并集与当前源码映射；377分母 |
| CN | `node tools/compat/kn-catalog-status.mjs --snapshot` | 仓库名称快照与当前源码；300不是官方全集 |
| R | `node tools/compat/k4-run-error-corpus.mjs E:/nekoc/dist/kitten4-corpus` | 53件、每件60帧、seed 1/6/42；不是官方全状态差分 |

P脚本实际硬编码读取`target/release/perf-bench.exe`，不接受B的快照路径；
本轮不重建/替换该release产物，并分别核对P记录的binary hash与B快照一致后才归为同一二进制。
遇竞争中断的H/H41使用同一命令加`--resume`，校验完整输入manifest及binary/probe/vendor hash；
P已准备输入后重跑省略`--prepare`，不复用未完成的旧计时样本。全部失败与中断仍留本地日志。

K4 官方参考为 `.orig` 主包 SHA-256
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
其与线上身份关系限于 [在线/离线取证](compatibility/k4-online-vs-offline.md)：指定主包除 DI 暴露外一致，
三份公开作品的受控状态一致；不是所有版本或真实联网认证。
H 为 **HateNeko 0.4.0 / Love2D 11.5**，沿用历史同场口径，不能改称0.7.1。
授权可参考的0.7.1与本次实际运行的0.4.0必须分开；本轮没有移植任何 HateNeko 逻辑。

性能套件串行执行，开始前检查 cargo/rustc/jit-corpus/perf-bench/Love，H/P 内还逐次 guard。
检查不是系统独占锁，不排除后来启动的进程、其他浏览器/Node、频率/温度变化。
准备期间有一次误启动的本 worktree 重复构建，仅等 Cargo 锁，已停止；不属于计时样本。
统计量为“每次帧均值的中位数”，不是把三次帧拼接后的均值。
导入边界、内存与绘制边界沿用 [性能计量解释](performance.md#计量解释)，不计算导入/内存倍数。
固定release `perf-bench.exe` SHA-256：
`d888cd791d26b7e3efebd8bc3975b126576f809cfb731e8da29fefa774d534ec`。
本轮[紧凑证据](scorecard-evidence.json)包含各原始报告hash、binary/vendor/input身份、逐次统计及差异；
不包含第三方作品、素材或内核源码。原始数组/完整状态只留`dist/bench/scorecard/`。
K4七份输入hash与`performance-evidence.json`历史官方七项逐一一致；KN七份输入hash与
`performance-hateneko-evidence.json`历史七项逐一一致，不是悄悄换小负载后比较。

## 维度一：适配

| 对照 | NekoC 当前事实 | 对照事实与证据 | 判断／未验证 |
|---|---|---|---|
| 官方 K4 | 直接导入K4工作区与发布AST；同一 Rust 核心也接KN/TS；C4统计见下 | 官方K4包及原生编译器是本轮K4 oracle | 输入与宿主覆盖较宽；不能据此宣称所有K4作品可替代 |
| 官方 KN 0.27.4 | `.bcmkn` 原生编译、KN语义分支；CN统计见下 | [官方KN源码审计](kitten-n-source-audit.json)、[面板审计](kn-panel-audit.md) | 硬件/AI/网络后端仍明显欠缺，不能全面替代官方编辑器/播放器 |
| HateNeko | 同时处理K4/KN，H41精确复测 | H路径为KN→Python编译Lua→LoveHost；[历史计量边界](performance.md#hateneko) | 格式适配范围较宽不等于同作品全程兼容；0.7.1实测未验证 |
| kitten2scratch→TurboWarp | 直接读取原作，不经SB3 | P实际转换并运行；固定转换器 `3b2dc03044e958b8052e947eebae09f2ec24ed5c`、VM `0cb82afe62506f3d9f2ff849c95593f0473b5d2c` | 转换存在warp/插槽损失；不把TurboWarp对Scratch本身的能力说成不支持 |
| K4-ULTRA / bcm_convertor | 自有Rust核心与宿主 | [既有固定源码评估](performance.md#k4-ultra源码评估性能未验证)；convertor在线直接load官方URL | 本轮未重建/运行其桌面壳；适配广度与整机性能未验证 |

## 维度二：兼容性与覆盖

### K4：两条分类轴不能相加

C4，本轮日期/基线如上；[完整覆盖表](kitten4-block-coverage.md)、[机器表](kitten4-block-coverage.json)。

| 显式导入／执行映射主状态 | 类型数 |
|---|---:|
| 已实现 | 259 |
| 设备降级 | 118 |
| stub / 缺失 | 0 / 0 |
| 合计 | 377 |

| 独立 `semantics` 证据轴 | 类型数 | 不能外推的范围 |
|---|---:|---|
| mapped-not-parity | 189 | 只有映射，未认证全部语义 |
| main-path-verified | 41 | 有限主路径，不是全选项/像素/求解器认证 |
| offline-oracle-verified | 15 | 指定离线包与原创夹具范围 |
| partial | 42 | 已知子分支、渲染、物理或服务差距仍保留 |
| offline/device | 90 | 无设备/离线降级，不是设备可用 |
| 合计 | 377 | partial是第二条轴，不是新增42种类型 |

### KN：有路径不等于完整支持

CN，本轮日期/基线如上；[完整KN表](kn-block-coverage.md)。

| 分类 | 类型数 |
|---|---:|
| 有执行路径／未完整验证 | 190 |
| 部分语义 | 107 |
| 固定值占位 | 1 |
| 元数据 | 2 |
| 缺失 | 0 |
| 合计 | 300 |

该名称集来自已有第三方清单，不是官方全集；本审计认证“完整语义支持”仍为 **0**。
官方面板的独立分类为默认142、可配置隐藏52、嵌套动态1、注册未列出41、硬件60、API/别名4，
详见 [面板官方证据](kn-panel-evidence.json)。不把这些数值与VM状态混算。

### K4 53件运行stage复测

命令R，2026-11-12、`da8dc9c`；debug无调试信息、60帧、无合成输入、原作只读。

| seed | ran | run错误 | import错误 | compile错误 |
|---|---:|---:|---:|---:|
| 1 | 52 | 1 | 0 | 0 |
| 6 | 52 | 1 | 0 | 0 |
| 42 | 52 | 1 | 0 | 0 |

三次run均为`214725822`；保留列表越界错误，既有官方错误调查见
[运行错误证据](kitten4-runerr2.md)。这是“52件完成本地运行”的门槛，不是52件官方状态/像素相等。
`opaque`是导入/诊断计数，不能按字段名把每个出现都说成当前未实现。
原始每件结果为`dist/runerr2/debug/coverage-{1,6,42}.json`。

### HateNeko精确41件与hncompat2归一化

命令H41，同日同基线、release/default JIT；完整manifest逐字节hash与历史41件锁定。

| 统计 | 本轮 | hncompat2原轮 |
|---|---:|---:|
| N运行成功 | 41/41 | 41/41 |
| H无报告错误/缺原语 | 40/41 | 40/41 |
| 原始最终观察投影相等 | 18/41 | 18/41 |
| 仅私有默认副本归一化相等 | 18/41 | 18/41 |
| 双边运行但不等 / H unsupported | 22 / 1 | 22 / 1 |

相等项集合未变，归一化新增相等0件；不排除任何全局时钟/RNG字段。
既有官方证据支持的互斥裁定保持18原始一致、20官方支持N、0本轮新修复、3无法裁定，
详见[更新后的逐件裁定表](compatibility/hateneko-verdicts.md)。三件未裁定仍为fangjie指针、
pencraft-before-present-fix坐标、starhold墙钟/RNG；短窗复跑不代替旧轮官方长程。
H的`object-json`缺JSON/Object原语保留unsupported；退出1是保留不等诊断，不是门禁失败。

### 跨项目兼容结论（证据边界）

| 对照 | 本轮证据 | 结论／不能声称的事 |
|---|---|---|
| 官方K4 | C4 + R + K4受控探针；既有逐帧/像素专项单独引用 | 映射清零不等于全语义清零；语料运行stage不是官方相等 |
| 官方KN | [hncompat2官方逐件证据](compatibility/hateneko-verdicts.md#证据索引) | 保留官方支持N的类型/回调裁定；本轮没有重做所有官方长程观察 |
| HateNeko | H41；原始/私有默认副本归一化分别统计 | 不把两实现不等自动归罪N；不把归一化当速度比资格 |
| 转换→TurboWarp | P，转换原样保留 | 能生成SB3不等于保真；不对有损路径给性能比 |
| 其他桌面封装 | 历史固定源码、非本轮全作品复跑 | 未验证，不给跨版本兼容率 |

## 维度三：性能

### K4 七项同参数复测

命令K4，2026-11-12，`da8dc9c`；10预热+60测量帧、三次独立运行，单位ms。
N帧为`Engine::advance`，K帧为`RuntimeManager.update`，不含各自外层渲染。
最终投影比较保留全局、列表、实体私有值及角色属性，数值容差`1e-9 × max(1,|a|,|b|)`；
只忽略帧诊断编号、变量显示名称和空实体映射。不是任务/像素等价证明。
原脚本的官方performance对象未附seed/frames/warmup，不能直接交给`compare.mjs`而冒充字段齐全；
本轮按命令、样本数组长度及原始全状态另作显式核对，不补写官方原始字段。

| 探针 | N均值 | K均值 | N p95 | K p95 | K/N耗时比／资格 |
|---|---:|---:|---:|---:|---|
| 数值 | 0.036070 | 5.798333 | 0.0391 | 6.1000 | 160.75×，最终投影容差内相等 |
| 列表 | 0.223143 | 0.865000 | 0.2468 | 1.0000 | 3.88×，最终投影相等 |
| 字符串 | 0.148882 | 0.473333 | 0.1720 | 0.6000 | 3.18×，最终投影相等 |
| 克隆 | 0.234970 | 4.830000 | 0.2785 | 5.4000 | 不可比；双方401角色，但完整角色投影不等 |
| 广播 | 0.190592 | 0.223333 | 0.2053 | 0.3000 | 不可比；log=82800 / 828 |
| 递归 | 0.039913 | 1.175000 | 0.0275 | 1.5000 | 29.44×，log=56000、depth=0且最终投影相等 |
| 画笔 | 0.090340 | 277.985000 | 0.0938 | 548.5000 | 不可比；同步绘制与增量输出边界不等 |

数值log分别`998.9999999999424`与`998.9999999998957`，不是逐位相等；收敛末值本身不证明迭代数，
工作量依据仍是受控原探针每批4000次及既有官方执行路径证据，不推广实际游戏速度。
列表最终1000项数字1、log=1；字符串完整16000字符严格相等。递归保留慢帧，均值大于p95并非笔误。
克隆数已较历史201/401改善为401/401，但命名/实体配对及逐帧生命周期未独立认证，不给倍数。

导入/峰值继续按历史分别记录，不对不同边界做倍数：

| 探针 | N/K导入ms | N进程/K最大单renderer峰值MiB |
|---|---:|---:|
| 数值 | 1.912 / 379.20 | 8.06 / 141.94 |
| 列表 | 1.930 / 373.70 | 8.27 / 131.79 |
| 字符串 | 1.786 / 388.40 | 8.02 / 130.23 |
| 克隆 | 1.737 / 377.60 | 8.82 / 226.99 |
| 广播 | 2.764 / 391.00 | 9.97 / 128.48 |
| 递归 | 2.101 / 394.30 | 8.93 / 136.96 |
| 画笔 | 1.814 / 377.40 | 8.52 / 728.05 |

N导入含读作品/JSON/Program/Engine，K从navigation time origin到ready；都不含进程/浏览器启动。
K内存不含browser/GPU进程，最终诊断快照时点也不同，不能称“省内存若干倍”。

### KN 同输入：HateNeko 0.4.0

命令H，2026-11-12，`da8dc9c`；参数同历史10+60帧、三次N/H交替。
七项已全部完成；套件后续默认遍历遇外部Cargo guard中断不抹去这些样本。
H导入从预编译Lua的观察模块入口开始，N导入含JSON/编译，不能算导入比。
H含Love窗口/驱动/绘制，不算内存效率比。H只计`rt.step`，不含外层draw/present。
“观察相等”均指比较器的最终投影：数值容差`1e-9 × max(1,|a|,|b|)`，heading换算、
角色属性多重集及实体私有值参与比较；不是严格原始JSON或逐帧相等。

| 探针 | N均值ms | H均值ms | N p95 ms | H p95 ms | H/N耗时比／资格 |
|---|---:|---:|---:|---:|---|
| 数值 | 0.117712 | 1.662302 | 0.1386 | 1.9827 | 14.12×，三次观察投影相等 |
| 列表 | 0.240512 | 1.302922 | 0.2602 | 1.8119 | 5.42×，三次观察投影相等 |
| 字符串 | 0.204388 | 2.555538 | 0.2354 | 4.2216 | 12.50×，三次观察投影相等 |
| 克隆 | 0.120642 | 0.910122 | 0.1717 | 1.8964 | 不可比，角色/生命周期不同 |
| 广播 | 0.180145 | 0.730658 | 0.1885 | 1.4579 | 不可比，接收工作量不同 |
| 递归 | 0.032783 | 1.243263 | 0.0221 | 1.6184 | **不可比**，H一次log=55200，另两次56000；N均56000 |
| 画笔 | 0.159500 | 3.501155 | 0.1723 | 4.0642 | 不可比，末值/位置不同且同步绘图边界不等 |

不删除递归不利样本、不用两次一致覆盖一次不等；具体少一批的墙钟/调度根因**未验证**。
KN数值比历史N约0.02551ms慢，本轮约0.11771ms；输入hash已确认相同，但前后版本/本机状态未作历史AB交替配对，
**记录为性能风险，不能宣称集成后全面无退化，也不把差距全归于系统噪声**。
字符串比历史改善不构成所有字符组合、所有作品或当前 v2 扩展 helper 路径的保证。

### 官方 KN 七项的证据缺口

仓库现有 `tools/bench/official.mjs` 导入的是K4 oracle；KN作品经
`tools/editor-compat.mjs` 返回 `ok=true` 只证明结构可加载，**不是官方KN性能**。
历史没有可沿用参数/计时边界的官方KN七项报告。H与P的KN数字也不能填入官方KN列。
官方KN默认warp有墙钟切片，等update不保证等工作量，见 [KN warp官方取证](kn-warp.md)。
为尽量覆盖任务要求，本轮另用[新探索方法](scorecard-kn-method.md)实际加载同一七份KN输入：
原始main/crc bundle双hash门禁、三次全新Edge、10预热+60测量update，默认rAF与4ms墙钟切片。
只计同步`manager.update`，没有改官方配置、随机源或循环体；最终变量在计时外采样。
它与K4受控连续rAF和N固定dt不是同一调度契约，**即使终值相同也不授予KN跨内核速度比**。

KN探索七项、21次全新浏览器均完成70次有效update，两个官方bundle hash全部匹配已归档KN，
无pageErrors；不是只做编辑器加载检查。下表为三次帧均值中位数；N取同输入H套件的独立原生记录。

| KN探针 | N均值ms（H套件） | 官方KN探索均值ms | 官方KN探索p95 ms | 第70次update后声明变量观察／不可比理由 |
|---|---:|---:|---:|---|
| 数值 | 0.117712 | 3.863333 | 4.2000 | log约999，收敛末值不能证明执行批次数 |
| 列表 | 0.240512 | 3.721667 | 4.2000 | result长210 / 1000 / 1000；不都完成一批 |
| 字符串 | 0.204388 | 3.476667 | 4.2000 | log长16000 / 14456 / 15104；末批进度不同 |
| 克隆 | 0.120642 | 6.033333 | 7.9000 | log=0；actor/clone数量与私有owner值未采集，不能认证工作量 |
| 广播 | 0.180145 | 0.558333 | 0.7000 | 官方log=828，N=84000，接收量不同 |
| 递归 | 0.032783 | 3.735000 | 4.5000 | 官方log=10600 / 11200 / 11200，N=56000 |
| 画笔 | 0.159500 | 4.020000 | 4.2000 | 官方log=18363 / 19313 / 18829，N=280000，绘制边界亦不等 |

声明变量通过无owner读取并立即复制编码（undefined/非有限数有显式标记），不是完整终态；
未采集clone数量、属性、按owner私有值与生命周期，不用空log/空列表推断兼容。
这次新探索满足“确实运行官方KN七项”，但**不存在可称同方法历史复测的旧官方KN七项基线**。
全部七项只报诊断时间、不发布官方KN/N比值；每次结果和双hash在紧凑证据中保留。

### peerbench：kitten2scratch → TurboWarp复测

命令P，同日同基线、10+60帧、三次N/T与T/N交替，固定两vendor commit如适配表。
14/14成功转换，42次配对记录全部完成、双边均可运行；14项均判**不可比**，不计算速度比。
`compilerOptions={enabled:true,warpTimer:false}`、turboMode=false、`currentStepTime=1000/60`，
实测有compiled thread；保留墙钟预算。约13ms是VM `_step`调度预算，不等于完成原作一批。
P的binary hash与B一致，未套用其他worktree产物。
14份输入hash与历史peerbench逐一一致；每次`compiled_threads=71`是包括预热的线程观察次数之和，
不是71个不同线程、不是所有子体都已执行、也不是编译覆盖率。

| 格式 | 探针 | N帧均值ms | T帧均值ms | 判定 |
|---|---|---:|---:|---|
| K4 | 数值 | 0.037397 | 12.997028 | 不可比，warp语义损失 |
| K4 | 列表 | 0.223607 | 12.998333 | 不可比，变量/类型/列表不等 |
| K4 | 字符串 | 0.146987 | 12.996002 | 不可比，变量/类型不等 |
| K4 | 克隆 | 0.232562 | 12.996693 | 不可比，warp/生命周期未认证 |
| K4 | 广播 | 0.201095 | 12.996875 | 不可比，接收工作量不等 |
| K4 | 递归 | 0.042015 | 12.996798 | 不可比，批次工作量不等 |
| K4 | 画笔 | 0.090188 | 12.997293 | 不可比，工作量不等且T无renderer |
| KN | 数值 | 0.115023 | 12.996830 | 不可比，T变量仍0 |
| KN | 列表 | 0.249007 | 12.996443 | 不可比，T空列表 |
| KN | 字符串 | 0.203295 | 12.996770 | 不可比，T变量仍数字0 |
| KN | 克隆 | 0.107782 | 12.996717 | 不可比，warp子体未执行 |
| KN | 广播 | 0.183615 | 12.996847 | 不可比，接收工作量不等 |
| KN | 递归 | 0.032863 | 12.996650 | 不可比，T log仍0 |
| KN | 画笔 | 0.157612 | 12.996915 | 不可比，T log仍0且无renderer |

这些只是转换兼容诊断时间，不是N比T快百倍的排行榜。具体源码损失定位沿用
[固定转换器/VM证据](performance.md#同类项目对比)：K4 warp展平、KN no-op不执行SUBSTACK、
list/string插槽名丢失；本轮不修改转换结果来制造可比性。无renderer/audio/storage，
Node进程maxRSS不当浏览器播放器内存。K4-ULTRA及bcm_convertor未运行第三方exe，
只复核固定源码，不拿历史最小域装载失败推断完整产品正确性或速度。

### 性能维度总判定（汇总）

| 对照 | 当前可以发布 | 仍不可发布／落后与未验证 |
|---|---|---|
| 官方K4 | 上表四份受控计算探针的最终投影配对与耗时比 | 克隆/广播/画笔、全语料交互性能、整机FPS、内存效率比未认证 |
| 官方KN | 历史官方语义证据；七项正式性能缺口明确列出 | 不以编辑器加载或H第三方数字代替官方KN性能 |
| HateNeko | 仅三项本轮全重复观察一致的计算探针倍数 | 递归退回不可比；KN数值N明显慢于历史，缺AB因果证据 |
| 转换→TurboWarp | 原样转换后的诊断耗时与差异 | warp/插槽语义丢失路径不授予速度比，不把空转当快 |
| K4-ULTRA / bcm_convertor | 固定源码与历史装载调查 | 未重测完整应用，不认证性能高低；在线官方封装不当独立内核重复计分 |

## 维度四：可扩展性

本维度按源码可定位的扩展合同比较，不使用“有插件所以性能/兼容更好”的推断。
完整函数、固定第三方源码链接见 [可扩展性依据](scorecard-extensibility.md)。第三方/非扩展调查沿用原基线，
NekoC 扩展限制按当前 v2 实现更新；静态接口调查不是宿主实测，也不改变本页性能基线。

| 对照 | NekoC 的可核验扩展点 | 对照的可核验事实 | 判断与差距 |
|---|---|---|---|
| 官方K4 | `Extension::call` / `compile_with_extensions`；`CloudBackend`；TS→`.bcm`；多宿主 | 固定官方包有 domain/responder/compiler 注册体系，C4定位可查；本轮未核验面向第三方的稳定插件契约 | N有明确可信宿主API；不能据未查到官方契约宣称官方不能扩展 |
| 官方KN | TS→`.bcmkn`、inspect/decompile/pack/watch等CLI；Web/原生/Android源码 | [官方面板](kn-panel-audit.md)可配置扩展/硬件；[官方源码审计](kitten-n-source-audit.json) | 官方设备/服务路径不能由本地降级替代；第三方插件ABI横向对齐未验证 |
| HateNeko 0.4.0 | NekoC 当前为版本化Rust/JS v2积木（兼容v1）与可替换本地云trait | Lua `registry.build`、`rt.set_host/load/build_f`、KN→Lua/`.love`工具 | H不是“不可扩展”；本轮未发现同级云trait证据，不外推其他版本；N未移植HateNeko |
| TurboWarp | command/reporter/boolean/hat，异步pending/complete及宿主事件；默认不从作品加载任意代码 | `ExtensionManager`有URL/worker/iframe/unsandboxed；`BlockType`含reporter/hat/event；`Cloud.setProvider` | N已扩大表达式/事件契约，仍未对齐全部类型、生态和隔离选项；不能声称可扩展性全面领先，TW生态不等于转换保真 |
| K4-ULTRA | 宿主预注册schema，metadata驱动`palette()`面板描述；捆绑编辑器UI未自动接入 | 实际v2 loader含manifest、目录/`.k4ultra`、UI积木/生成器/runtime注册 | 其UI→生成器→runtime链仍更完整；旧扫描入口立即return，不能拿死路径证明运行行为 |
| bcm_convertor | 自有Rust VM、TS前端、多宿主与打包入口 | 官方URL/Electron封装、离线JSON注入、Android WebView模板 | 后者是分发能力，不重复当独立内核性能优势；N的Android本轮未真机验证 |

当前N侧扩展契约：`API_VERSION=2`、支持 `[2,1]` 最高共同版协商；v2 schema 不降级。
`BlockSchema` 可选 `kind`（command/reporter/boolean/hat）及 `metadata {name,category}`，参数仍为 `{name,value_type}`。
Web 封套仍为 `nekoc_extension_handshake:1`，通过 `extension_api_versions`/ready 的 `extension_api_version` 协商。
reporter/Boolean 异步 lowering 写任务局部值，保留嵌套操作数执行顺序、不重复执行；Rust 支持 Ready/Pending，
JS 远程可调用积木均 blocking。hat 用 `register_hat` 或 JS 无 handler 的 `register`，`emit_extension_event`/
`player.emitExtension` 向当前场景（含克隆）排队，以 `self_listen_value` 读取 payload，任务上限4096。

**不再整Program关闭JIT**：`Op::Extension` 经 reentrant 尾部 helper 调用 `exec` 后退出 native region，
保留 Ready 非blocking、blocking、Pending 的调度及指令预算；不把 handler 编成机器码。
`CallPolicy` timeout 默认1s、范围1ms..60s；默认 `Propagate` 保留v1 fail-fast，`Report` 记logs仅结束调用任务，
`DefaultValue` 记logs并以中性typed result继续。Web v2默认Report，不因调用错误关闭连接，v1仍Propagate。

必须保留的N侧限制：reporter procedure 仍不能执行扩展调用；显式结果目标只支持已声明全局，
JSON标量/列表不涵盖任意对象/undefined/非有限数。Rust只捕获unwind panic，返回后检查超时，不能强杀不返回的函数；
Pending按`Instant`墙钟计时，virtual_clock也不例外。JS timer/AbortSignal忽略迟到Promise但不能抢占同步JS。
capability并非OS沙箱，无独立进程强抢占、稳定动态库ABI或插件IR注入；自动生成面板描述不等于捆绑编辑器UI已接入。
不声称官方私有积木兼容，真实第三方编辑器往返及ARM真机未验证。普通CLI `run`仍走旧`runtime::run_project`，
不能套用本页`engine::Engine`默认JIT数字。Web是本机Rust服务+前端，不是纯浏览器WASM；
desktop/Android是不同壳，存在源码不等于本轮验收。TS为DSL子集，`await`不提供Promise调度。
内置云仅Memory/File，本地profile不等于官方登录，多key逐次store也不是全有或全无事务。

## 已知差距与未验证项

- 官方KN七项缺少既有正式runner/历史样本；本轮已新探索实际运行，但不发布冒充“同方法复测”的性能比。
- 真实硬件、AI/账户/摄像头、远程云后端及官方线上服务未完成同输入端到端认证。
- K4软体求解器、滤镜组合、过渡纹理/时钟及42个partial仍有边界；见
  [soft](kitten4-soft.md)、[第十轮](kitten4-partial-10.md)、[效果证据](kitten4-partial-effects-10.md)。
- 固定短窗、无输入开场不验证完整游戏、鼠标/键盘、真实音频、随机序列与像素全等。
- 旧性能JSON的NaN/Infinity→null及undefined省略限制仍在；不据它认证完整带类型语义。
- 导入计时、renderer/原生内存、画笔同步绘制/增量输出边界不同，不给对应效率倍数。
- 第三方K4-ULTRA最小装载路径不是完整应用域注册；其既有失败不能用来断言完整播放器算错。
- 本轮只记缺陷，不修改运行时代码；构建产物及第三方源码/作品仅留忽略的`dist/`，不入库。

## 本轮质量门禁

2026-11-12，`da8dc9c`，完整门禁未删减：

- `cargo fmt --check`：退出0。
- `cargo clippy --all-targets -- -D warnings`：退出0，无warning。
- `RUST_TEST_THREADS=1 cargo test --all-targets`：107个测试程序汇总，**925 passed / 0 failed / 1 ignored**。
- `npm run -s test:tools`：**676 tests / 614 passed / 0 failed / 62 skipped**；skip不算外部官方验证通过。
- 命令R：三个seed均`{ ran: 52, run: 1 }`，达到52门槛，不是全语料无错误。

原始门禁日志为本worktree `dist/scorecard-{fmt,clippy,test,tools,corpus}.log`。
测速等待过`k4effects11`的`jit-corpus`及外部Clippy，未停止外部进程或绕过guard。
