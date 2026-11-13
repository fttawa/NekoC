# NekoC / 离线 K4 播放器性能基准

> **最新整合复测入口（2026-11-12，`da8dc9c`）：[总评分卡](scorecard.md)。**
> 下文保留各轮历史数据、二进制身份与失败样本，不把它们冒充当前版本数据。
> 最新同参数七项、41件兼容、覆盖与未验证项见评分卡；跨内核工作量不等仍不授予速度比。

## 最新汇总：整合版本复测

2026-11-12，基线 `da8dc9c5c414a4b32c9239c33df437d6d8322cf1`。
测量命令为[评分卡命令表](scorecard.md#测量身份复现命令与口径)的K4/H：均10预热+60测量帧、
三次独立进程/浏览器、取帧均值的中位数；默认JIT，非插件作品。保留全部重复与失败样本。

| 探针 | N/K4帧均值ms | K4/N比值资格 | N/HateNeko帧均值ms（独立KN输入） | H/N比值资格 |
|---|---:|---|---:|---|
| 数值 | 0.036070 / 5.798333 | 160.75×，最终投影容差内相等 | 0.117712 / 1.662302 | 14.12×，三次观察相等 |
| 列表 | 0.223143 / 0.865000 | 3.88×，最终投影相等 | 0.240512 / 1.302922 | 5.42×，三次观察相等 |
| 字符串 | 0.148882 / 0.473333 | 3.18×，最终投影相等 | 0.204388 / 2.555538 | 12.50×，三次观察相等 |
| 克隆 | 0.234970 / 4.830000 | 不可比，角色投影不同 | 0.120642 / 0.910122 | 不可比，生命周期不同 |
| 广播 | 0.190592 / 0.223333 | 不可比，工作量不同 | 0.180145 / 0.730658 | 不可比，工作量不同 |
| 递归 | 0.039913 / 1.175000 | 29.44×，最终投影相等 | 0.032783 / 1.243263 | 不可比，一次H少一批 |
| 画笔 | 0.090340 / 277.985000 | 不可比，绘制边界不同 | 0.159500 / 3.501155 | 不可比，工作量/绘制边界不同 |

N/K4与N/H分别读取K4/KN作品，不可交叉当同输入排序。H实测仍为**0.4.0 / Love2D 11.5**，不是0.7.1。
递归H一次log=55200，另两次56000，N均56000，故本轮不能沿用历史40.09×；不删除不利样本。
KN数值N明显高于历史0.02551ms，未作同机历史二进制AB交替，原因**未验证**，保留为性能风险，
不能因其他探针变快就宣称全面无退化。官方KN七项不存在历史正式计时runner，不能用本表H列冒充。
完整p95、终态、覆盖、扩展接口限制、peerbench与官方KN取证边界见[总评分卡](scorecard.md)。
本轮完整门禁：fmt/Clippy通过；`RUST_TEST_THREADS=1 cargo test --all-targets`合计
**925 passed / 0 failed / 1 ignored**；`npm run -s test:tools`为**614 passed / 0 failed / 62 skipped**（676项）。
K4原命令三个seed均`{ ran: 52, run: 1 }`，保留`214725822`错误，不声称53件无错误。
H41精确复测：N **41/41**、H **40/41**，原始与仅私有默认副本归一化均**18/41**；
22双边不等、1 H unsupported，相等项集合不变。既有官方裁定18/20/0/3保留原证据边界，
详见[最新41件复测](compatibility/hateneko-verdicts.md#最新integrate短跑复测scorecard)。
peerbench本轮14/14转换、42次配对完成，仍14项全部不可比；T每step约12.996–12.998ms，
主要反映墙钟调度预算/有损转换，不发布N/T速度比。[本轮14项表](scorecard.md#peerbenchkitten2scratch--turbowarp复测)
保留三次中位数和原因。固定vendor及参数与历史一致，N二进制hash与K4/H本轮一致。
另已实际运行官方KN七项新探索（21次，10+60有效update）：均值中位数依次数值3.863333、
列表3.721667、字符串3.476667、克隆6.033333、广播0.558333、递归3.735000、画笔4.020000ms。
main/crc双bundle hash均匹配已有官方KN归档；默认rAF/墙钟切片导致列表、字符串、递归、画笔
实际工作量不同，克隆实体未采集，**七项全部不发布官方KN/N倍数**。这是新方法探索，不冒充
不存在的历史正式计时复测；见[方法](scorecard-kn-method.md)与[本轮结果](scorecard.md#官方-kn-七项的证据缺口)。
下文从“结论与适用范围”起均为历史分轮记录，保留原提交号与限制。

## KN 数值退化定位与受控 runner（2026-11-12）

本节修正上文“KN数值退化原因未验证”的历史状态。历史约0.02551ms与整合约0.11771ms
不是同一批配对数据；本轮使用同机release、同字节七份KN夹具、10预热+60测量，
每项五轮独立进程AB/BA交替，比较每次帧均值的中位数。计时前排除已知
cargo/rustc/jit-corpus/perf-bench竞争，不杀其它会话；原始样本和中断日志全部保留。
构建禁用debug信息/incremental，历史源码只解到本worktree忽略目录，不切换工作分支。

### 确认不是噪声，并锁定引入边界

| 探针 | 历史0832707 ms | 整合f0edaea ms | 耗时变化 |
|---|---:|---:|---:|
| 数值 | 0.026997 | 0.116620 | +331.98% |
| 列表 | 0.232208 | 0.239048 | +2.95% |
| 字符串 | 1.071160 | 0.205818 | -80.79% |
| 克隆 | 0.119960 | 0.116205 | -3.13% |
| 广播 | 0.167980 | 0.182038 | +8.37% |
| 递归 | 0.030292 | 0.032215 | +6.35% |
| 画笔 | 0.071808 | 0.155750 | +116.90% |

七项各五对最终状态严格相同。数值五轮范围为历史0.025140–0.028697ms、
整合0.111897–0.118022ms，完全分离，不以其它项加速抵消退化。
进一步直接比较父提交`cf310a9`与其后继
`2be78a1ab3c5ceb01dd0d1011d7be64cfc684b23`：数值
**0.025173→0.115047ms（+357.02%）**，五轮范围同样分离。
该父子比较数值范围为0.024165–0.027633 / 0.111013–0.133590ms，
画笔0.073153→0.159667ms（+118.26%）；列表+8.76%、字符串+29.68%、
克隆+8.06%、广播+11.74%、递归+7.11%。七项最终状态仍全部相同。
引入点是[KN warp切片](kn-warp.md)的真实时钟检查：每个循环body-tail读钟，
默认严格`>4ms`，旧计数`>30000`后再递增。JIT也通过同一boundary helper检查。
这是新增语义成本，不是可以直接删掉的冗余检查；knperf 当时限定逐尾语义，不降低
读钟频率、不扩大预算、不把默认模式切到虚拟时间，也不回退到历史实现来“恢复”旧数字。
后续 knwarp2 显式研究有界采样偏差（见下节），不能把它称作官方逐尾语义等价优化。

### 保留语义的候选与测量边界

`Slice`每step预计算`deadline=Instant::now()+4ms`，每个循环尾仍读一次
`Instant::now()`，严格比较`now>deadline`；只省去每尾构造elapsed Duration。
计数顺序、每step重置、K4策略、JIT/解释器共用检查不变。边界单测覆盖恰好4ms、
多1ns、30001/30002尾、过期/reset与deterministic忽略真实时间。

初版候选独立历史配对数值0.104258ms、画笔0.151078ms，仍明显慢于历史；
该候选不是最终二进制，且没有与f0edaea直接配对，**不从不同批次相除发布优化百分比**。
最终直接配对结果另见本节后续记录及 `knperf-evidence.json`。

最终以新整合基线`f8bb6d8`分别重建未优化/候选release二进制，同基线五轮
直接AB（默认真实时钟，10+60，保留完整原始数组）如下：

| 探针 | f8bb6d8 ms | deadline ms | 耗时变化 |
|---|---:|---:|---:|
| 数值 | 0.120920 | 0.110280 | -8.80% |
| 列表 | 0.242247 | 0.247982 | +2.37% |
| 字符串 | 0.211380 | 0.210707 | -0.32% |
| 克隆 | 0.112508 | 0.117582 | +4.51% |
| 广播 | 0.176893 | 0.180935 | +2.28% |
| 递归 | 0.033693 | 0.034200 | +1.50% |
| 画笔 | 0.169778 | 0.161732 | -4.74% |

七项各五对最终状态严格一致。数值五轮范围0.115668–0.121860 / 0.106468–0.115407ms，
画笔0.166028–0.178768 / 0.155755–0.165643ms；其它项范围存在重叠，但不能据此
排除小幅退化或将慢项全部归因于噪声。中途检测其它会话Cargo构建而停止，恢复时只复用
完整配对，受干扰的未完成单边尝试另存，不删除；因此五对并非同一连续空闲窗口。
这只是有限改善，**默认数值未恢复历史约0.02551ms，不能宣称全面无退化**。
前/后exe SHA-256分别为`4c703067775394636db433d273c588655ecd9d65f452f0e6845c5b3cac070719`、
`188cc2d8c8592515200f694769afd1733692ef6c3e597f9b0fc93c8188bfe437`。

新增 `perf-bench --deterministic` 显式调用 `Engine::use_virtual_clock()`，JSON返回
`deterministic=true/false`；默认仍是真实4ms模式。受控官方比较与默认退化诊断分列，
虚拟时间的快数字不能冒充默认墙钟性能恢复。

### 官方 KN 受控入口的资格限制

新增[official-kn.mjs](../tools/bench/official-kn.mjs)，固定dt逐帧推进，默认10+60帧、
三次独立Edge/worker；计时仅包原始同步`RuntimeManager.update`，不包rAF外层绘制、
协议通信和最终投影。三个固定官方bundle只读本地缓存并严格hash gate，不提交或下载它们；
HTML和其它编辑器UI仍联网。原始每帧样本、预热、输入/二进制/bundle/harness hashes、
配置、浏览器版本与错误全部保存。源码调度证据沿用[kn-warp.md](kn-warp.md)。

最终观察保留当前场景、全局标量/完整列表、全部存活角色/clone及其原型、属性、声明私有值。
clone按属性/私有值多重集匹配，不靠临时ID拼写。官方变量undefined/非有限数/负零有标签，
native旧JSON不能保型时保守拒绝比较；几何坐标负零规范为0。真实浏览器smoke已发现并
修复几何负零导致的投影误拒绝，不把mock单测当官方实测。
非零位置(17,-23)、输入旋转37弧度的诊断观察到官方折叠整圈，投影130.056158度，
native保留整圈为-2029.943842度；不将这种差异归一化成相等。七项原夹具初始旋转均为0。

`--diagnostic`独立运行无计时的step/tail包装，尝试认证数值4000、列表1000、字符串2000尾
的固定批次，保留每update计数、单step最大尾数和边界返回。**native目前只报告总指令数，
没有相同单位的逐update完成批次/循环尾证据，因此CLI始终不授予跨内核倍数**。
最终投影相等或固定帧数相等都不够。克隆、广播、递归工作量不预设相同；画笔因同步绘制
与增量输出边界不同始终不可比。官方/默认native的时间边界也不是全面语义或像素兼容认证。
本轮该独立诊断已真实完成：数值/列表/字符串的70次update（含10预热）每帧分别
4000/1000/2000尾；60测量帧合计240000/60000/120000尾，单step最大值同批次大小，
均无runtime/page错误、无预算边界返回。三项均只获得官方单边`certified=true`、
`equivalent=false`，不是正式计时，也不是native证书。

正式七项套件两次均因其它会话Cargo构建被竞争门禁中断：首批仅数值前两次完成，
第三次受干扰；第二批数值/列表各三次完成，字符串首轮受干扰，克隆/广播/递归/画笔未测。
第二批数值三次均值26.063333/21.525000/28.140000ms，列表
36.776667/34.058333/37.056667ms；这六次最终投影均与受控native相等，
仍因native缺少同单位工作量证据而全部`unverified`，**不计算倍数**。
这些不是完整七项结果，也不拿其中较快样本替代失败样本；两批原始与错误均归档。
独立单边尾数诊断虽成功，也不能补作缺失的正式计时。当前交付是部分完成。

最终在整合基线`f8bb6d8`上通过`cargo fmt --check`、
`cargo clippy --all-targets -- -D warnings`、`cargo test --all-targets`：
**946 passed / 0 failed / 1 ignored**。原命令K4语料seed 1/6/42均
`{ ran: 52, run: 1 }`，保留原有错误，不将其写成53件全部运行成功。
`npm run -s test:tools`为 **649 passed / 0 failed / 64 skipped**（713项）。

复现命令与路径防护见[bench README](../tools/bench/README.md)。原始AB位于
`dist/bench/kn-ab/{history-head,warp-introduction,deadline-head,latest-final}/results.json`；
历史构建共享target时必须先`cargo clean --release -p nekoc`，并以留存exe hash核对身份，
不能只看Cargo“Finished”来认为切换了源码。

## KN warp 墙钟摊销检查（knwarp2，2026-11-12）

基线 `69e201d`，随后 fast-forward 至 `7d64154`（仅文档变化，运行时代码相同）。
实际只读核验 `official-kn.mjs` 固定的离线官方 bundle：`OptiRunner` 默认每个
warp tail 读一次墙钟，没有隔 N 尾检查；恰好 4ms 不让出，旧计数 `>30000` 后
再递增。源码模块/字符偏移、SHA-256 和循环尾时机见 [完整锚点](kn-warp-sampling.md)。

采样只用于真实墙钟模式，确定性计数路径不接触采样状态；JIT 和解释器继续共用
`warp_iteration_yields`，不修改 `engine.rs` 公共结构或 K4 调度。
间隔从 1 逐步翻倍至最多 32 尾，以历史最慢批次均值选取 25μs 目标，剩余时间
减半限制间隔，最后 50μs 逐尾检查。保持严格 `now>deadline`，不提前让出。
同一执行轨迹上相对逐尾检查**最多额外 31 尾**；若完整尾间墙钟间隔 ≤3μs，
则附加延迟 ≤93μs。合成时钟枚举相位、速度变化、突发 1s 跳变证明该尾数界，
并覆盖临界/reset/粗时钟、计数边界及 JIT/解释器交替消费同一采样状态。

**限制：25μs 是估算目标，不是无条件的时间硬界**。循环体耗时突变、阻塞或
OS 抢占可超过它；没有 WCET 或可中断执行就不能保证绝对 ≤0.1ms。
官方默认逐尾让出时刻与本方案不逐位一致；固定时钟/trace/jit-corpus 不受采样影响。
未参考或移植 HateNeko 实现，不提供跨内核速度比。

确定性前后诊断：七项 × JIT/解释器 × seed 1/6/42 共 **42/42 对公开 JSON 投影相等**。
排除计时/RSS字段，其余无数值容差；旧 JSON 不保型 undefined/null/非有限数，
JS 解析不保留负零/超安全整数，不能代替任意 Cell 逐位证明。Rust 单测另外将
固定时钟计数/让出结果与旧公式逐尾精确对照，既有12项官方确定性项目仍逐update验收。
release `jit-corpus` 三seed均 **53件、0差异**；其中52件完成60帧，
`214725822` 保留双边相同的既有列表下标错误，不称53件全成功。

原命令 `node tools/compat/k4-run-error-corpus.mjs E:/nekoc/dist/kitten4-corpus`
三个 seed 均 `{ ran: 52, run: 1 }`，保留既有错误。第一轮完整 Rust 测试
**955 passed / 0 failed / 1 ignored**；fmt 与 Clippy `-D warnings` 通过。
最终复跑全量 Rust 仍为 **955 passed / 0 failed / 1 ignored**，debug bins 重建成功。
初版五轮 AB（35对终态全部相等）数值 **0.112635→0.039443ms（-64.98%）**、
画笔 **0.162100→0.088828ms（-45.20%）**，列表-6.06%、克隆-1.23%、广播-2.17%；
但字符串 **0.216198→0.255087ms（+17.99%）**、递归+4.37%。该初版不能宣称
“其余不退化”。全部初版样本留存 `dist/knwarp2/ab/results.json`；随后修正
无法采样的逐尾慢路径：最慢批次均值≥25μs后锁定逐尾，不再每尾重复算间隔；
使用饱和u64纳秒运算替代u128除法。最终v2重新完整五轮AB，不以删除初版坏样本代替。
初版完整原始报告 SHA-256：
`ff6a0aa02dd86066943d155f0272a1487b4f8b461c693b2250756c1e41e1e95b`。
最终v2五轮配对（默认墙钟，10预热+60测量、AB/BA交替，各次帧均值中位数）：

| 探针 | 基线 ms | v2 ms | 耗时变化 |
|---|---:|---:|---:|
| 数值 | 0.110933 | 0.036285 | -67.29% |
| 列表 | 0.246278 | 0.234742 | -4.68% |
| 字符串 | 0.208945 | 0.215130 | +2.96% |
| 克隆 | 0.117980 | 0.111935 | -5.12% |
| 广播 | 0.179733 | 0.182802 | +1.71% |
| 递归 | 0.033332 | 0.032005 | -3.98% |
| 画笔 | 0.156240 | 0.083963 | -46.26% |

35对终态全部相等。数值前/后五轮范围0.110602–0.114693 / 0.034493–0.037145ms，
画笔0.154777–0.164280 / 0.082670–0.086098ms，均完全分离。数值达到≤0.04ms；
画笔接近历史约0.07ms但未达0.04ms。字符串和广播仍有小幅中位数退化，不用范围
重叠作无退化证明；**整体性能目标部分完成**，按要求提交确定收益。原始帧数组、
所有五轮均值、输入/二进制hash、空闲检查及初版坏样本见
[knwarp2-evidence.json](knwarp2-evidence.json) 与本地原始报告。
最终报告 `dist/knwarp2/ab-v2/results.json` SHA-256
`0d48027ba7de69b0853d4e9b1547244c6f04c4449a8463a20ea4e56dfa963d57`；
before/after exe SHA-256分别
`25c5ca9bec0cf93ae0b90215c04e89b6a03ac9ecd85a5fb6f4cd473b7f2b75dd` /
`ad89c0744942b23390fa48e29ab549b638611c5e6ab87addcd21eb13f5189f6a`。
竞争Cargo/jit-corpus多次打断，完整配对按runner协议恢复，未完成单边尝试和所有
中断日志保留；每次测量前后均无已知竞争进程，但不是系统独占或连续空闲窗口证明。
比较固定开始工作时的整合基线；等待期间新合入的K4设备功能不混入本轮数据。

v2最终验收：fmt、Clippy `-D warnings`通过；全量Rust
**955 passed / 0 failed / 1 ignored**；JS工具
**651 passed / 0 failed / 63 skipped（714项）**；原命令语料三seed均52 ran；
release jit-corpus三seed均0差异；前后确定性公开投影42/42相等。
原始数据仅保存在本 worktree 的 `dist/knwarp2/`，不将第三方作品或官方内核入库。

### 合并 071c56c 后复验

已执行 `git merge oc/integrate`，合并提交 `2534319`，包含 K4 设备宿主和 CI 修复。
上述历史数据仍绑定旧基线，不将其当作本次合并后的计时或门禁。新一轮基线使用
`071c56c` 归档，只解到本 worktree 忽略目录；候选使用合并后的当前运行时代码，
共享 target 前执行 package clean 并留存两个固定 exe/hash。
新增测试仅补快速循环临近 deadline 的合成时钟分支覆盖，不改变运行时策略。
合并后完整门禁已通过：fmt、Clippy `-D warnings`；Rust **959 passed / 0 failed /
1 ignored**；JS **667 passed / 0 failed / 66 skipped（733项）**；原命令语料
seed 1/6/42均 `{ ran: 52, run: 1 }`；release jit-corpus三seed均53件、0差异，
其中52件完成60帧，214725822既有列表错误不变；前后确定性公开投影42/42相等。
七项五轮 AB 单独记录如下，原始目录 `dist/knwarp2/postmerge/`，历史报告不覆盖。

postmerge 最终七项五轮 AB（`071c56c` 基线 vs 合并后候选，默认墙钟，10预热+60测量，
AB/BA交替；35对终态全部相等）：

| 探针 | before ms | after ms | 变化 |
|---|---:|---:|---:|
| 数值 | 0.113223 | **0.036383** | **-67.87%** |
| 画笔 | 0.183238 | 0.109508 | -40.24% |
| 列表 | 0.254768 | 0.232752 | -8.64% |
| 递归 | 0.035795 | 0.031845 | -11.04% |
| 克隆 | 0.115143 | 0.114367 | -0.67% |
| 广播 | 0.185373 | 0.184430 | -0.51% |
| 字符串 | 0.218240 | 0.225917 | +3.52% |

数值达到 ≤0.04ms；画笔较合并前显著改善但仍未回到约0.07ms历史水平，字符串仍有
小幅退化，故仍不宣称全面无退化。postmerge 原始报告 SHA-256
`eed725cb8bbe5293f27ea24e36a383dfa53faa04ec73096e8a91a6509d082a2c`；before/after
二进制 SHA-256 为 `0ec3a6940ab4c5d58f3c2398178f16023b48283c91d0bd4126f7ba534785954d` /
`3cb1865ac63efe6594978f4e26dfd66a00822aeb413c47980d754a5fc14f5d3b`。
每次运行前后均通过竞争进程检查；多次被其他 cargo/jit-corpus 打断的完整日志和
单边样本均保留，未纳入中位数。

## JIT 编译卡顿：每帧编译预算（2026-11-13）

335327306 开 JIT 的中位帧（0.638 ms）比纯解释器（0.719 ms）快，但帧均值反而更慢，
而且 1200 帧内有 6 帧超过 10 ms，最长 41 ms。原因是热点集中出现时，同一帧里会连续编译
十几个 region：这件作品共编译 134 个 region，Cranelift `define_function` 占编译时间约
95%，单个 region 平均约 900 条 IR，单次最长约 3.5 ms。

- **每帧最多编译 2 个 region**（`COMPILES_PER_FRAME`）。达到热度阈值但本帧额度已用完的
  pc 保持热状态，下一帧再编。按次数计，结果确定；执行结果与解释器逐帧一致
  （`hot_regions_compile_over_several_frames`）。
- **Cranelift `opt_level` 由 `speed` 改为 `none`**：335327306 编译总时间 228.6 → 184.6 ms；
  全语料 3 轮 300 帧，逐作品中位帧均值合计 11.26 → 11.12 ms，305999424 / 267573240
  差异在 ±1% 以内。
- 试过 `regalloc_algorithm=single_pass`：编译更快（与 `none` 合用为 140.5 ms），但
  305999424 从 7.48 ms 变为 9.6 ms、267573240 从 0.76 ms 变为 1.1 ms，未采用。

335327306，1200 帧、无预热、release：

| 版本 | 最长帧 | >5 ms 帧 | >10 ms 帧 |
|---|---:|---:|---:|
| 不限编译次数 | 41.0 ms | 15 | 6 |
| 每帧 2 个 | **7.1 ms** | 19 | **0** |

另外 5 件重作品，3 轮 600 帧：各作品最长帧中位数之和从 134.7 ms 降到 80.4 ms（预算加
`none`），帧均值合计 9.30 → 9.19 ms。同批与 jit2 的 5 轮交替对照中，只有 324380532
仍比 jit2 慢（JIT +2.6%、解释器 +5.0%）；314937840、267573240、335327306 已不慢于 jit2。

## KN 循环尾快路径（2026-11-13）

与 jit2 对照仓库自有 KN 探针时发现 numeric 慢 3.6 倍（0.0103 → 0.037 ms）、pen 慢约
55%，两边指令数和终态完全相同。原因是 JIT 每次 `Next` 都进入完整的 `h_boundary`：
`begin`、按 op 分派、warp 让出检查、`finish` → `h_error`。jit2 的 `h_next` 只做计数
减一，**不实现 KN 官方 warp 让出**，所以不能直接回到它的做法。

新增 `h_next`：非最后一次、非让出型的 `Next`，在未开 profile、未达输出上限、没有
待处理错误时，只做计数减一和一次 warp 计数（让出规则仍由 `warp_iteration_yields`
决定）；其余情况一律转给 `h_boundary`，语义不变。新增不开 profile 的差分测试
`unprofiled_native_repeat_tails_match_the_interpreter`（跨 KN 30002 次让出、嵌套最后
一次迭代、画笔输出），并用故意改坏快路径的变异验证了它能抓到错误。

release，60 帧 + 10 预热，3 次中位数（ms）：

| 探针 | jit2 | 之前 | 现在 |
|---|---:|---:|---:|
| numeric | 0.0103 | 0.0356 | **0.0258** |
| pen | 0.0528 | 0.0848 | **0.0732** |
| list | 0.2216 | 0.2329 | 0.2297 |
| recursion | 0.0214 | 0.0196 | 0.0201 |

快路径先判断计数：最后一次迭代直接交给 `h_boundary`，不重复做其余检查。第一版先查
profile / 输出上限，短循环多的 305999424 因此慢 1.6%；调整顺序后 9 轮为 7.38 → 7.40 ms，
在噪声内。7 件重作品 5 轮合计 10.11 → 10.10 ms。

numeric 和 pen 与 jit2 的剩余差距来自每次迭代的 warp 计数与 helper 调用，这是按官方
KN 规则让出所需的开销。`jit-corpus` 现在也接受 `.bcmkn`，便于对 KN 夹具做 JIT 剖析。

## 「移到」专用 helper（2026-11-13）

pen 探针剩下的大头是 `self_move_to`：JIT 每次通过 `h_exec` 进入通用 `exec`。现在当
x、y 都是严格纯数值表达式（常量、数值变量、四则运算，无副作用、不会报错）时，
由生成代码求值后调用 `h_position`；它与 `exec` 共用 `set_position`（非有限轴忽略、
画线、填充路径），并保留输出上限、错误和退出码约定。其他表达式仍走 `h_exec`。

pen 探针（3 次中位数）0.0737 → **0.0597 ms**（jit2 0.0505）；全语料 3 轮 300 帧合计
11.02 → 11.04 ms，噪声内。不开 profile 的差分测试加入 NaN 轴，交换 x/y 的变异会被它
抓到。

## 广播分发：字面量监听免求值（2026-11-13）

每次广播都要遍历全部脚本，原来对每个监听者都 `eval_value(...).text()`，即使消息是字面量
也会分配一个 String；另外每次都把消息克隆进 `received` 集合。现在字面量文本监听直接比较
常量，不求值、不分配；消息已在集合里时跳过插入。非字面量监听（表达式、数字常量）仍完整
求值，测试 `broadcast_matches_literal_and_computed_listener_messages_alike` 同时覆盖
字面量、近似字面量和拼接表达式三种监听。

broadcast 探针（3 次中位数）0.186 → **0.136 ms**（jit2 0.163）；全语料 3 轮 200 帧合计
11.94 → 11.86 ms，噪声内。

## 「移到」helper 放宽到纯表达式操作数（2026-11-13）

`h_position` 原来只接严格纯数值的 x、y；324380532、305999424 里大量「移到」的操作数是
列表项等纯 reporter，仍走 `h_exec`。纯表达式（`jit_pure_expr`，与 `Set` 原生求值同一
标准）现在也由生成代码求值：先 x 后 y，移动后再报待处理的值错误，与 `exec` 顺序一致。
`hot_move_to_with_list_item_operands_matches_the_interpreter` 在 KN/K4 下各跑一次，
x 为越界列表项（K4 报 `lists_get_value_bad_index`）；交换 x/y 的变异会被它抓到。

5 轮 300 帧中位数：305999424 7.48 → 7.37 ms（jit2 6.97），324380532 0.656 → 0.651 ms
（jit2 0.664），335327306 持平。

**否决：内联错误检查。** 305999424 每帧约 7.7 万次 `h_error`，曾把 `value_error` 改成
`Option<Box<String>>` 新类型，让生成代码读一个指针字、非零才调 helper。实测 7.27 →
7.38 ms（噪声内、略差）：这个 helper 调用本来就便宜，不值得改动 80 处调用点。剩余差距主要
在过程调用与返回各自退出、重进区域（region/run 每帧约 1.1 万次）。

## list 探针：剩余差距在线性查找，不再追（2026-11-13）

list 探针的 `listIndexOf(-1)` 编译为 `list_index_of`，查找值永远不在列表里，每轮都要扫完
最多 1000 项，每帧约 50 万次比较。`Cell::index_in` 已按 4 项一批比较数值，每次约 0.44 ns，
接近内存带宽，探针 0.230 ms 对 jit2 0.221 ms 的 4% 差距不值得为它特化。

顺带把 `变量 = 列表最后一项` 从通用 `exec` 改为 `h_assign_last_item`，与按序号取项的
`h_assign_item` 共用实现。共用时修正了一处既有差异：KN 下取到 undefined 元素时，解释器
给 NaN，原 JIT helper 却直接赋 undefined。不开 profile 的差分测试加入断开连接的 micro:bit
音量（undefined），两种取法都检查；去掉 NaN 映射的变异会被它抓到。

## 结论与适用范围

本次以 `oc/integrate` 的 `146fd4f` 为优化基线，提供可复现的 release/headless 基准，
覆盖数值循环、列表操作、字符串拼接、克隆创建删除、广播风暴、过程递归和画笔七项自制作品，
另从只读 K4 语料静态筛选计算、克隆、画笔候选。所有作品及完整诊断只存放忽略目录 `dist/bench/`。
仓库不携带外部作品或内核源码。早期测量证据见 [performance-evidence.json](performance-evidence.json)，
最新字符串专项见 [string-concat-evidence.json](string-concat-evidence.json) 与下文独立章节。

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
这是早期实现的历史数据；字符串专项的最新配对结果见下节。

### 工作量与差异

- 数值：每批 4000 次 `(log + 1) * 0.999`；双方 70 帧后约 999，末位存在浮点舍入误差。
- 列表：每批清空后 1000 次 append + 查找不存在的 -1 + 标量更新；末尾长度 1000，log=1。
- 字符串：每批从空串拼接 2000 次八字节文本，末尾长度 16000。V8 可以保留 rope 字符串，
  早期 NekoC `Rc<str>` 仍需复制；最新字符串专项改为不可变延迟拼接树，见下节。
- 克隆：每帧创建 200 个 mirror，clone hat 删除；70 帧末 NekoC 201 个 actor、官方 401 个 actor，
  存在额外一帧生命周期差异，**跨内核性能比未验证**。不在本性能任务修调度语义。
- 广播：每帧发送 100 次、12 个监听器，70 帧后 NekoC log=82800、官方 log=828，
  重复消息接收任务合并/重启行为存在差异；具体官方机制根因**未验证**，不称性能兼容。
- 递归：每帧 40×20 次调用，70 帧后 log=56000、depth=0。
- 画笔：每批 4000 次移动，70 帧后 log=280000。画笔历史不清理，官方 update 随历史增长，
  NekoC 仅输出增量且没有颜色感知 raster；不能将其作为纯算术 VM 倍数。

## 字符串专项：不可变延迟拼接

本专项以 `oc/integrate` 的 `0832707` 为起点。`Cell::Text` 改用
`src/engine/value/text.rs` 的共享不可变拼接树：text+text 只创建节点，空串拼接复用另一侧；
平坦叶仍使用 `Rc<str>`，避免把每个原始文本变成 `String` 再包一层；
数字、布尔、列表等仍在原 `Cell::concat` 调用时转换，**不延迟可变对象的字符串化**。
两项 join 在左值为文本时保留左值、再求右值；列表左值沿用先转换再求右值的既有顺序。
KN 遇 undefined 截断连接的规则保留；K4 `+` / 增加变量沿用原分派，不改 KN 数值加法。
JIT 的 typed evaluator/helper 与解释器共享此表示，不改 chain、调度或数值快路径。
赋值的数值镜像会读取 `Cell::number()`；文本节点额外携带保守的“必非数字”标记，
仅含 JS 数字语法绝不允许的 ASCII 字符时直接返回 NaN。标记在拼接时按位合并，
其余文本仍用原 JS Number parser（包括 radix、Infinity、Unicode 空白、符号零）。
因此命中该标记的文本赋值不再复制整段前缀，也不以“子串为 NaN”推断拼接结果为 NaN。

连续 UTF-8 消费者按需缓存平坦字节，输出追加可直接遍历而不强制建立缓存。
迭代遍历与析构避免长链递归溢出；工作栈最坏 O(深度)。已观察前缀再次拼接时共享平坦叶子，
不继续引用它的历史树；若先构造所有前缀再分别观察，仍可能保留多个前缀缓存，最坏内存风险未消除。
小串的节点分配成本也不保证比原 `Rc<str>` 小，需看控制项实测。

首轮仅引入 rope、未避免数值镜像扁平化的版本失败：七次配对中字符串从
0.767253 ms 增至 0.872750 ms（慢 13.75%），**不采用该版本作为优化结果**。
此轮画笔控制项从 0.083838 ms 增至 0.089239 ms（慢 6.44%），保留不利样本供复核。
原始失败版结果在 `dist/bench/paired/`（最终测量另存，不覆盖）。
全为数字语法候选字符的长串（如 `deadbeef`）、纯中文/emoji 等非 ASCII 文本仍可能在
数值镜像读取时扁平化，**此类负载的加速未验证**；基准的 `abcdefgh` 含确定非法的 `g/h`。
本专项不改变 parser 的舍入、指数、radix 或非 ASCII 字符处理规则。

### 最终版本：七次交替配对结果

每进程/浏览器预热 10 帧、测量 120 帧，7 次 AB/BA 交替，取每次帧均值的中位数。
所有七项前后输入 hash 与最终状态相同；官方只配对字符串这一项，状态也相同。

| 工作负载 | 0832707 ms | strcat ms | 耗时变化 |
|---|---:|---:|---:|
| 字符串 | 0.810859 | 0.152480 | -81.20% |
| 广播 | 0.211885 | 0.199332 | -5.92% |
| 克隆 | 0.225176 | 0.222840 | -1.04% |
| 列表 | 0.233109 | 0.238756 | +2.42% |
| 数值 | 0.037696 | 0.037789 | +0.25% |
| 画笔 | 0.087457 | 0.089347 | +2.16% |
| 递归 | 0.030373 | 0.031231 | +2.83% |

官方字符串配对为 **K4 0.465833 ms / NekoC 0.154010 ms**，NekoC 约快 3.02×，
达到 ≤0.46 ms 目标；此结果不是其他作品/所有字符组合的速度承诺。
原始数组与完整状态保存在 `dist/bench/paired-text-final/`、
`dist/bench/string-official-text-final/`；二进制与结果 SHA-256 见专项 evidence。
克隆控制项最终不再变慢；列表、画笔和递归仍约慢 2–3%，
**不能证明不存在代码布局退化**，也不把全部慢项归因于宿主噪声。

较早候选（尚未改为直接 `Rc<str>` 平坦叶）的七次配对单独保留：
`dist/bench/paired-final/` 字符串 0.786382→0.143310 ms，克隆 +7.29%；
`dist/bench/string-official-final/` K4 0.454167 / NekoC 0.146957 ms。
该轮原生字符串进程峰值中位数 8.55→7.91 MiB（最终快照前读取），不冒作最终版本内存结果。
第二轮同样七次交替（`dist/bench/paired-confirm/`）：字符串 0.725654→0.145347 ms；
克隆 0.216327→0.223523 ms（+3.33%）、列表 +1.93%、画笔 +2.68%、数值 -0.74%、
递归 -0.67%、广播 -4.42%。克隆两侧独立进程范围 0.213363–0.227160 / 0.212080–0.230875 ms
重叠，画笔为 0.079974–0.084197 / 0.082795–0.085729 ms；
观察到小幅慢项，**不能证明不存在 2–3% 的代码布局退化**，也不把全部慢项归功于宿主噪声。

最终重建版 `jit-corpus` seed 1/6/42 及每帧 997 指令预算均为：53 works、52 complete、
1 原有 error、0 differences、0 load/compile errors（997 预算使用 seed 1）。每帧比较 typed Cell、别名图、任务栈、
输出和调度状态；错误作品 `214725822` 双方均在采样前失败，不算完整通过。
最终原始报告为 `dist/strcat/text-final-seed-{1,6,42}.json` 及 `text-final-budget997.json`，
二进制与报告 SHA-256 见专项 evidence。最终三 seed 单次 JIT 总耗时为
2,606,900 / 2,639,514 / 2,579,826 μs；只有 after，没有交替 before，不据此推导性能无退化。
较早候选三 seed 无统计 JIT 总耗时（before→after，μs）分别为
2,625,552→2,687,288、2,863,977→2,792,192、2,534,392→2,703,724；
这些分离批次不是交错配对，变化 +2.35%/-2.51%/+6.68%，尚不能据此宣称无退化。
控制项及语料配对复测另列，原始输出在 `dist/strcat/`。
该较早候选三轮 seed1 交替前后复测，按作品取中位数再求和：解释器
3,194,959→3,270,870 μs（+2.38%），JIT 2,750,220→2,871,766 μs（+4.42%）。
主要慢项 `305999424` 2,005,409→2,119,720 μs（+5.70%），
`267573240` +6.17%、`324380532` +2.96%。**此候选尚未证明语料不退化**，
最终平坦叶版本尚未有三轮交替语料性能复测；不能仅因字符串达标与差分相同就宣称所有性能要求完成。

### 语义证据边界

- 重新只读核对离线 K4 `.orig` bundle，SHA-256 与本文环境段相同；
  UTF-8 解码后 0-based JS 字符偏移：`text_join:function` **1645940**，
  `change_variable:function` **582550**，`math_arithmetic` helper **577629**。
  它们分别连接转换后的值、先读增量再读旧变量、按原类型执行 JS 加法。
  这些是语义来源，不是移植该内核实现或证明所有输入一致。
- KN 的 undefined 截断依据为 [kn-objects.md](kn-objects.md) 中官方 `C:822263`；
  K4/KN 不同加法及转换依据沿用各自已有官方证据。
- 新增 `tests/string_concat_regression.rs`：变量别名、角色私有文本、自赋值、列表旧值、
  长串、自拼接、混合类型、UTF-16 长度、reporter 左到右及列表转换时机；
  每帧比较解释器/JIT typed 状态、输出与调用栈，并检查实际进入 native region。
  这是本地逐帧一致性证明，**不是独立官方运行时 oracle**。
- 无 HateNeko 逻辑移植。`Cell::Text` 的 Rust 载荷类型改变；使用 `.into()`/`AsRef<str>`
  的现有代码兼容，直接依赖旧 `Rc<str>` 载荷的外部源码调用者需迁移。
- 官方配对只忽略显示名称与空实体变量映射等诊断差异，不忽略任何实际私有值；
  旧性能 JSON 合并非有限数/null，因此含此类变量的跨内核比较保守返回 `unverified`。
  对象中已省略的 undefined 和符号零未完整保型，通用跨内核快照不作为语义 oracle；
  本次受控字符串夹具的变量只含有限数、文本与空列表，避开该证据缺口。

## 三条重负载路径及优化（历史基准）

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

#### hncompat2：41 件逐项三方裁定（2026-11-12）

后续复核以 `d2d277b`（当时最新 `oc/integrate`）为基线，详见
[41件裁定表](compatibility/hateneko-verdicts.md)。不改写上方历史性能数字，不把观察投影相等
升级为逐帧、像素、音频或输入语义全等。官方仍为 KN 0.27.4，HateNeko 为0.4.0 / Love2D 11.5；
本轮行为复跑用 dev 无调试信息二进制，不发布新的速度比。

- 新增显式私有默认副本归一化、指定全局字段排除，**原始比较与归一化比较分开保留**；
  不删除运行失败或 unsupported，不据归一化授予速度比。actor 两件还有 `cloneChanged`
  进度差异，不能仅凭去掉全局副本宣称一致。
- [本轮官方长程证据](compatibility/hncompat2-progress-official.json) 直接运行完整原作：
  fangjie 约595秒完成524288项 world、64项 chunk_x/z及标题逻辑 y=-65；旧轮五分钟
  未完成的边界已补齐。tiny-lm 约20秒自然 `DONE / EOS`，完整15项id，输出
  “走到山上，看见了云。它很开心。”。两个原作都没有缩短循环或更改官方调度配置。
- [其余39件官方观察](compatibility/hncompat2-official.json) 全部绑定原始作品hash；
  actor 私有变量不属于全局表，完成后 `cloneChanged=99`；timer仍 `fired=0`；
  列表类型/缺失值结果支持已有 N 路径。starhold 官方读取墙钟，并有随机会话字段，
  不能通过静默排除随机数或写死官方墙钟值伪造一致。
- audio/input 等原始一致只是无合成输入开场；官方单独按键观察不冒充 N/H 双边输入验证，
  空全局表不证明音频播放完成。pencraft-before-present-fix 的列表类型虽已裁定，
  x/y 未有同里程碑配对的部分仍保留无法裁定。

最终复跑计数、JIT开/关长程结论及门禁摘要见裁定表；旧节的18/41保留为原轮记录。
本轮锁定同一41件重新实测为 N **41/41** 成功、H **40/41** 成功/1 unsupported，
原始一致 **18/41**，仅私有副本归一化后仍 **18/41**，新增相等0；
完整双边证据为 [hncompat2-hateneko-evidence.json](compatibility/hncompat2-hateneko-evidence.json)。
基线默认遍历已扩展到63件，本轮用显式历史manifest及逐作品hash锁定41件，不混用两组分母。

| hncompat2 最终互斥裁定 | 数量 |
|---|---:|
| 和 H 原始观察一致 | **18** |
| 官方裁定 NekoC 正确（本次争议范围） | **20** |
| NekoC 本轮新增修复 | **0** |
| 无法裁定（具体未配对输入/进度） | **3** |

[600 update长程配对](compatibility/hncompat2-long-evidence.json) 的JIT开/关结果一致：
tiny-lm 的N为官方同一完整15项id、EOS输出；H为32项不同id后自然`DONE / LIMIT`。
actor 两件长程后H仍 `cloneChanged=cloneRead=otherRead=0`，官方与N为99/99/other-value。
fangjie 三方world/chunk完整hash、标题y=-65一致，但N/H尚有4个鼠标相关值未同输入裁定，
故与pencraft-before-present-fix坐标、starhold墙钟/RNG一起保留“无法裁定”，不偷偷增加一致率。

门禁：fmt、Clippy `-D warnings` 通过；`cargo test --all-targets` **848 passed / 0 failed / 1 ignored**。
JS工具最终完整门禁为 **547 passed / 0 failed / 53 skipped**（600项），未删减测试。
K4语料原命令seed1/6/42均 `{ ran: 52, run: 1 }`，达到52门槛并保留原有运行错误，不声称全语料零错。

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

## 同类项目对比

### kitten2scratch → TurboWarp 编译运行时（2026-11-11/12）

**已实测，但没有可发布的等工作量速度比。** 复用本文 K4 七探针的官方发布 AST 和
`kn-fixtures.mjs` 七份 KN；14/14 均成功转换成 SB3，双边各完成三次独立进程、预热10帧、
测量60帧，按 N/T、T/N、N/T 交替。所有 KN 均经官方 KN 0.27.4 编辑器检查 `ok=true`、
无 issues/pageErrors。转换成功不代表语义保真；14项均判为**不可比**，没有删除失败项或修补转换结果。

- NekoC 基线为 `d8fd090`（包含本轮开始时最新 `oc/integrate` 的 `7cc5039`），release/default JIT；
  binary SHA-256=`73675489b63709950d47318b1c0c571f2b144331484506bc1ff216691e73528e`。
- 转换器 [CodeManTeam/kitten2scratch](https://github.com/CodeManTeam/kitten2scratch/tree/3b2dc03044e958b8052e947eebae09f2ec24ed5c)，
  commit `3b2dc03044e958b8052e947eebae09f2ec24ed5c`。
- VM [TurboWarp/scratch-vm](https://github.com/TurboWarp/scratch-vm/tree/0cb82afe62506f3d9f2ff849c95593f0473b5d2c)，
  commit `0cb82afe62506f3d9f2ff849c95593f0473b5d2c`，Node v24.12.0 无头直接加载源码，
  `compilerOptions={enabled:true,warpTimer:false}`、turboMode=false、60 Hz。
  每次运行均观察到 compiled thread，编译器并非只设置开关而未进入；不据此证明每个子体都已执行。
  结果中的 `compiled_threads` 为含预热的逐帧观察次数之和，不是唯一线程数或编译覆盖率。
- 同机 Windows x64 / i7-14650HX / 24逻辑CPU。没有强制 GC/清文件缓存；检查瞬间的竞争构建进程为空，
  但不是系统级独占，其他 Node/浏览器、频率温度和 OS 调度仍可能干扰。
- 紧凑证据：[performance-peers-evidence.json](performance-peers-evidence.json)。完整原始数组、终态、
  转换 SB3/project.json、每次 stderr 和官方编译/编辑器诊断在 `dist/bench/peers/`，不提交作品或 vendor 源码。
  复现命令见 [tools/bench/README.md](../tools/bench/README.md#同类项目--kitten2scratch--turbowarp)。

下表是**转换兼容性诊断运行**的三次帧均值中位数（ms），不是等价负载的性能排行。
T 的约13 ms主要反映保留的墙钟调度预算；不得除以 N 的数字宣称加速。

| 格式 | 探针 | N 帧均值 ms | T 帧均值 ms | 终态/工作量检查，结论均为不可比 |
|---|---|---:|---:|---|
| K4 | 数值 | 0.03911 | 12.99663 | log 均约999；收敛不能证明迭代数相等，warp/帧边界丢失 |
| K4 | 列表 | 0.22926 | 12.99755 | N 长1000；T 长73434/73622/72960；清空积木缺 INDEX |
| K4 | 字符串 | 0.15496 | 12.99663 | N 长16000；T 为 `"00"`；join 缺 STRING1/STRING2 |
| K4 | 克隆 | 0.22149 | 12.99701 | 标量相同但 N 有201角色、T 仅1角色，生命周期/工作量不同 |
| K4 | 广播 | 0.19640 | 12.99641 | N log=82800，T=0 |
| K4 | 递归 | 0.03847 | 12.99656 | N log=56000；T 为11536375/11317248/11436029；批次数不等 |
| K4 | 画笔 | 0.08305 | 12.99703 | N log=280000；T 为14920673/15426586/15345138，无 renderer/绘图 |
| KN | 数值 | 0.02682 | 12.99667 | N log约999，T=0 |
| KN | 列表 | 0.23394 | 12.99612 | N log=1、长1000；T log=0、空列表 |
| KN | 字符串 | 0.16196 | 12.99646 | N 长16000；T log仍为数字0 |
| KN | 克隆 | 0.12973 | 12.99664 | 标量/末尾角色数相同，但 T 没执行 warp 子体，不能把空转当兼容 |
| KN | 广播 | 0.15923 | 12.99662 | N log=84000，T=0 |
| KN | 递归 | 0.02984 | 12.99659 | N log=56000，T=0 |
| KN | 画笔 | 0.07181 | 12.99655 | N log=280000，T=0，无 renderer/绘图 |

**具体转换证据**（这些是第三方转换器/VM 证据，不是官方行为来源）：

1. 转换器 [`src/block_map.js:111`](https://github.com/CodeManTeam/kitten2scratch/blob/3b2dc03044e958b8052e947eebae09f2ec24ed5c/src/block_map.js#L111)
   把 warp 映射为 `motion_align_scene`；[`src/parse_kitten4.js:722–730`](https://github.com/CodeManTeam/kitten2scratch/blob/3b2dc03044e958b8052e947eebae09f2ec24ed5c/src/parse_kitten4.js#L722-L730)
   将其当 no-op 展开。TurboWarp [`src/blocks/scratch3_motion.js:41`](https://github.com/TurboWarp/scratch-vm/blob/0cb82afe62506f3d9f2ff849c95593f0473b5d2c/src/blocks/scratch3_motion.js#L41)
   确实将该 opcode 实现为 no-op，**不是说 TurboWarp 缺这个原语**。这里丢失的是原 warp 的语义。
2. KN 转换 [`src/parse_kittenn.js:181–204`](https://github.com/CodeManTeam/kitten2scratch/blob/3b2dc03044e958b8052e947eebae09f2ec24ed5c/src/parse_kittenn.js#L181-L204)
   保留 SUBSTACK，但没有对应的 warp 特殊执行。实测输出 `kn-numeric-project.json` 的 `b15`
   为带 `SUBSTACK=b16` 的 `motion_align_scene`，`next=null`；VM 的 no-op 不执行此子体。
   另外数值影子 fields 为空、算术仍为 A/B 等转换问题存在，但未绕过 warp 单独验证其因果贡献。
3. K4 list/string 原始 stderr 显式报告 `data_deleteoflist: missing input INDEX` 和
   `operator_join: missing input STRING1/STRING2`；生成项目仍用 TYPE / ADD0 / ADD1。
   不修改这些插槽后重新测速，以免把自制修复当第三方现状。
4. K4 广播/克隆的进一步根因**未验证**；不能把所有差异都归因于某一个原语。
   KN 末尾没有克隆也不是证明每帧完成了同量创建删除；空体可产生相同标量和角色数。

**计量边界：** N 导入为读作品→转换/Program 编译→Engine 创建；T 导入为已加载 VM 模块后的
读 SB3→VM 创建→loadProject，无 renderer/audio/storage，不含 Node 启动或转换器；greenFlag/初次编译另列 start_ms。
转换墙钟含 CLI 启动，单次记录，不计算导入比。N 帧为 Engine.advance；T 为完整 `_step`，
手动设置 `currentStepTime=1000/60`，不启 `vm.start()` 的 interval。保留 sequencer 的现实墙钟预算
（[sequencer.js:72–93](https://github.com/TurboWarp/scratch-vm/blob/0cb82afe62506f3d9f2ff849c95593f0473b5d2c/src/engine/sequencer.js#L72-L93)），
一个 `_step` 不等于原作的一批循环。T 不执行绘图，画笔无论标量是否相等都不能给纯 VM 比。
N 内存是进程 PeakWorkingSetSize；T 是 Node maxRSS，两者都在最终快照前读取，不是浏览器 renderer 或全播放器内存比。
未模拟输入，不涉及跨 VM 随机一致性；没有逐帧、任务栈、别名或像素等价证明。
连续同步 step 之间没有让异步回调获得事件循环轮次，也不表示真实经过1/60秒；只适用于这些同步探针。
静态 opcode 分类无法发现所有“未知源积木→合法 Scratch 原语”的降级，不作为全支持认证。
vendor commit/lockfile 已固定并记录，但安装的 node_modules 全树完整性未独立认证。

首次探索发现手动 step 不会由 setFramerate 更新 `currentStepTime`（正常更新在 FrameLoop.start），
因此首轮默认30Hz预算的样本仅保存在 `exploratory-30hz-results.json`，没有用于上表。
正式60Hz样本另存 results.json；套件退出1表示明确不可比，不是运行崩溃或本仓库测试失败。

### K4-ULTRA：源码评估，性能未验证

固定 [JXW666NB/K4-ULTRA `e6465b1c`](https://github.com/JXW666NB/K4-ULTRA/tree/e6465b1c23479bde68b5811b8f8f27fb26724053)。
没有运行仓库的 exe 或桌面壳，也没有移植源码。`resources/app/build/kitten.822d814413fb10654fde.js`
SHA-256=`9898000cbebc96d6c49c3447b5967aba69be4768e7680535f109efdaf91f43b0`。

- [`64644–64931`](https://github.com/JXW666NB/K4-ULTRA/blob/e6465b1c23479bde68b5811b8f8f27fb26724053/resources/app/build/kitten.822d814413fb10654fde.js#L64644-L64931)
  定义 `OptiRunner`，[`65158–65219`](https://github.com/JXW666NB/K4-ULTRA/blob/e6465b1c23479bde68b5811b8f8f27fb26724053/resources/app/build/kitten.822d814413fb10654fde.js#L65158-L65219)
  定义 `OptiCompilerImpl` 并在65201行用 `new Function` 生成 JS 函数。
  本轮证据支持“有 JS 编译器和执行器”，**不支持直接照抄‘自研字节码内核’宣传**。
- 62275行内嵌 `@crc/blink 0.28.17 / Codemao` 元数据；不能仅凭可编辑元数据认证整个包来源。
  两个类依赖 Registry/BlockPool/EventBus/FramePool/Config/内部 AST 和 domain functions，
  不是能直接接收 `.bcm` 的独立模块 API。
- 最小 Webpack 白名单装载成功取得两个 function 导出（先载入 bundle 自带 reflect-metadata）；
  进一步在 headless Edge 157.0.4341.42 用原生 `new_heart`、basic domain 注册、Opti 编译及 runtime load
  实际执行原有 numeric AST 五次 update，追踪计数20000次变量赋值、40000次算术调用；不是算术替身。
  **原始输入语义门禁失败**：`NUM="1"` 经最小基本 Heart 原样进入 ADD，出现 `0+"1"→"01"`，
  五帧最终log=`0.0020457384397430836`，期望为`998.9999979614092`；无runtime/page错误。
  只在内存把三个NUM字符串转为number后五帧正确，但这是`diagnostic-only`，不是正式基准。
  应用另有含类型分派的算术域函数（[88295–88335](https://github.com/JXW666NB/K4-ULTRA/blob/e6465b1c23479bde68b5811b8f8f27fb26724053/resources/app/build/kitten.822d814413fb10654fde.js#L88295-L88335)），
  尚未验证完整应用域注册/输入标准化，**不能据此说完整K4播放器算错**。
  本探针无渲染/预热/三轮且有调用计数插桩，**未获得可比的正式性能结果**。
  诊断脚本与原始JSON为`dist/peers/k4-browser-probe.cjs`、`k4-browser-probe.json`、`k4-browser-normalized.json`。
- 本轮没有执行 bundle 顶部扩展扫描器。**2026-11-12源码复核补充**：旧 `_loadExtensions`
  在116–118行立即`return`，因此23行fs/path与178–200行动态执行代码不能证明旧路径实际执行。
  HTML实际加载`extension-loader-v2.js`，其241/253行确有`new Function`及生成器/runtime注册，
  详见[可扩展性源码依据](scorecard-extensibility.md#k4-ultra纠正旧扫描路径实际依据是-v2)。
  只审查后的注册表达式及依赖工厂用于既有最小加载；`node:vm`不是恶意代码安全隔离保证。

另用 Terser 4.8.1 只做静态模块工厂比较，不执行模块：bcm与本文`.orig`参考的`Lcae/LmbJ`
去注释/格式、统一局部变量后完全相同；K4再归一化导入ID、展开`__main__`常量后也相同。
归一化runner/compiler SHA-256分别为`40d4df3fd4629aadd247abf7e3e36b119d1a3004b26bc6d1c4034050026a7e74` /
`5411a04349dd26578dcebaaa5fe0e73c04c0eb47f5a28b6951d5f6f268f116f9`。
这只证明指定两工厂实现结构相同；不证明归一化掉的依赖相同，更不认证整包官方身份。
完整规则、偏移、各级hash在`dist/peers/k4-executor-compare.json`，未复制任何第三方源码进跟踪路径。

### bcm_convertor：官方播放器封装，不重复独立内核测速

固定 [sf-yuzifu/bcm_convertor `7c88ead2`](https://github.com/sf-yuzifu/bcm_convertor/tree/7c88ead2757f36d571ec1b212e234d8b99e6bdd6)。
在线路径 [`onlineTemplateAdapter.js:36–57`](https://github.com/sf-yuzifu/bcm_convertor/blob/7c88ead2757f36d571ec1b212e234d8b99e6bdd6/src/services/templates/adapters/onlineTemplateAdapter.js#L36-L57)
构造 `kn.codemao.cn/player` / `player.codemao.cn/we` 官方 URL，
[`src-tauri/convert/online/index.js:61–63`](https://github.com/sf-yuzifu/bcm_convertor/blob/7c88ead2757f36d571ec1b212e234d8b99e6bdd6/src-tauri/convert/online/index.js#L61-L63)
直接 loadURL。**在线模式：内核等同官方，性能参照官方数据**，不另算封装层的内核加速。

离线 K4 [`preload.js:6–21`](https://github.com/sf-yuzifu/bcm_convertor/blob/7c88ead2757f36d571ec1b212e234d8b99e6bdd6/src-tauri/convert/kitten4/main/preload.js#L6-L21)
注入作品 JSON，renderer 加载随附 `player_v2.bb850a0057626e190668.js`；
该单行 bundle 的零基字符偏移359387含 `@crc/stage 0.5.6 / Codemao`，451186/476153导出
同名 OptiRunner/OptiCompilerImpl，1152196从 `window.kitten4_player.bcmc_json` 进入 `action_load_bcmc_by_json`。
这是复用编程猫播放器体系的强证据，**不是离线包与官方发布物字节相同或未经修改的证明**。
离线性能仅参照本文官方路径作背景，不宣称版本/配置相同；离线K3精确官方来源链同样**未验证**。
未执行其 npm builder（会自行安装工具链）或 Electron 壳（部分配置 nodeIntegration=true、webSecurity=false）。
HateNeko 按任务约定不重复测量，沿用上节独立 KN 结果。

本轮门禁：`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、
`RUST_TEST_THREADS=1 cargo test --all-targets` 全通过（Rust合计799 passed / 0 failed / 1 ignored）；
`npm run -s test:tools` 为482 tests / 430 passed / 0 failed / 52 skipped。
按原命令运行K4语料门禁，seed 1/6/42均`{ ran: 52, run: 1 }`，达到52门槛，仍保留原有1份运行错误。
本任务不改引擎语义，不把语料门槛通过写成全语料无错误。release二进制保留于`dist/bench/peers/bin/`后清理target。

## 验证与已知风险

- Rust 格式、全目标 Clippy（warnings=deny）、全目标测试（no-fail-fast）、JS 工具测试均需通过后提交。
  以下计数属于历史基准门禁，不是字符串专项最终计数：`cargo fmt --check` 成功；`cargo clippy --all-targets -- -D warnings` 成功；
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
- 字符串专项最终门禁：`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、
  `cargo test --all-targets` 均通过；Rust 合计 796 passed / 0 failed / 1 ignored，
  其中字符串专项 6 passed、`jit_differential` 17 passed。
  `npm run -s test:tools` 为 443 tests / 392 passed / 0 failed / 51 skipped。
  skip 包含需显式启用的外部 oracle，不等于完整官方验证。
