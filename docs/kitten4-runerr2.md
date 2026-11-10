# K4 固定输入离线执行与 305999424 后续错误

## 改动及边界

- `coverage_with_seed` 和 `k4-trace` 显式调用 `Engine::use_virtual_clock()`。日历基准为 UTC 2000-01-01，加调用者的模拟时间；timer/wait 继续使用 `dt`。离线运行不再因 debug/release 或机器速度触及墙钟预算而改变线程进度。
- 虚拟模式只忽略墙钟预算，不忽略每次 advance 的指令数和输出上限；`budget_frames` 表示触及这些确定性安全边界的帧数。普通播放器不调用此接口，保留墙钟预算和真实日历。
- 固定 seed 只固定本地随机输入。素材、云端、用户输入和官方 PRNG 不因此变成相同；`ran` 也不是完整兼容性证明。
- K4 `logic_compare` 的 EQ/NEQ 按结构比较列表和造型值，NaN 与 NaN 相等；不改变 KN、列表搜索的严格引用相等。比较使用显式工作栈及活动路径检测，避免递归比较溢出及循环列表无限递归。
- K4 角度三角函数结果保留两位小数；不改变 KN 全精度三角函数。

## 官方依据和自制探针

只读官方 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`：

| 位置 | 实测/源码结论 |
|---|---|
| `oiyH/get_domain_functions` 的 `p.EQ/NEQ`、`logic_compare` | 调用 `Y+p1`，该模块委托 lodash `wF/u` 的 isEqual，不是 JS `===` |
| `Tn6a` 列表查找 | 使用 indexOf，不能一并改成结构搜索 |
| `oiyH` 的 SIN/COS/TAN/ASIN/ACOS/ATAN | `f(x,2)`，内部 `Math.round(x*100)/100` |

`tools/compat/k4-runerr2-fixtures.mjs` 从仓库自制基础作品生成 equality/trig/clock 三个最小夹具，不摘抄第三方作品。文件哈希、官方资源哈希及四帧变量保存在 [kitten4-runerr2-evidence.json](kitten4-runerr2-evidence.json)。

- equality：独立 split 列表 EQ 为 true、NEQ 为 true，列表搜索独立列表仍为 false，条件分支写入 log=1。
- trig：COS(18)、SIN(18)、SIN(-72)、ATAN(0.5) 官方值为 `[0.95,0.31,-0.95,26.57]`。
- clock：诊断替换 Date 后返回 2000 年、星期六；wait 0 后的标记在第三帧出现。**这是替换时间输入的诊断，不是官方原生墙钟行为。** 本地另测真实延迟、零墙钟预算、两种执行模式和指令安全上限。
- 不声称官方 timer 与本地完全相同：旧 timer 路径在离线驱动下实测为 0；新路径使用 Date 毫秒并受 update 取样点影响。本地 timer 仍按 dt 推进。

复验：

```powershell
$env:K4_PLAYER_DIR='只读官方播放器 app 路径'
$env:NEKOC_NODE_MODULES='外部 Playwright node_modules 路径'
node tools/compat/k4-runerr2-fixtures.mjs --record
$env:K4_ORACLE_INTEGRATION='1'
node --test tests/k4-runerr2.test.mjs
cargo test --test kitten4_runerr2
```

## 305999424 定位

固定 seed 1 的虚拟时间旧语义运行到第 29 帧，`hZpZJjof3puTMCUX4jfr` 读取长度 5 列表第 8 项，调用位置为 `GqVt0z7aWfMbaiurzjIe`。先前每帧 200 ms 的 coverage 会随机器速度改变到达此路径的时机，曾把短跑的 ran 当作修复成功，不能据此判断。

相关比较 `G7zmc0UVgd0v0Kf8DYXe` 把已有坐标列表与本次 split 新建的坐标列表作 EQ。引用比较即使坐标内容相同仍为 false，改变“查找区块”的控制流。结构比较修复后不再出现该异常，未改动越界检查。与此独立，首帧噪声高度还暴露出三角函数保留位数差异，因此同时补上有官方最小探针支持的精度修复。

官方过滤追踪（seed 1，`--random-source nekoc` 仅替换 random 积木输入）实测该比较第一次发生在第 4 帧：`A=[1,1]`、`B=[1,1]`、`OP=EQ`，输出 **true**；105 帧无错误且未截断，原始轨迹为 `dist/runerr2/compare-official.json`。另一次过滤 240 帧官方运行也无错误。双方调度速度仍有差异，不能用第 4 帧对齐本地所有状态，也未证明这是整个作品最早的状态分歧。

完整作品最早的所有值级分歧、Decimal 算术、同步 reporter 的中途挂起和每解释器 50000 procedure step 上限仍**未验证/未实现**；不能声称完整逐帧状态与官方相同。第三方追踪只留在 ignored `dist/runerr2/`，不携带作品或内核源码。没有使用/移植 HateNeko。

## 全语料复现

```powershell
node tools/compat/k4-run-error-corpus.mjs E:/nekoc/dist/kitten4-corpus --profile debug
node tools/compat/k4-run-error-corpus.mjs E:/nekoc/dist/kitten4-corpus --profile release
```

默认写入 `dist/runerr2/{profile}/`，`--out` 可指定另一次输出以重复比较。每种 profile 含 seed 1、6、42，各 53 件、60 帧；比较完整 coverage 对象而不只是 stage 计数。

### 实测分布（2026年11月10日）

| seed | debug | release | release 重复 | coverage 文件 SHA-256（三次相同） |
|---|---|---|---|---|
| 1 | ran 52 / run 1 | ran 52 / run 1 | ran 52 / run 1 | `a886a68716dfa22c116113ea3efc07a343555f538a5989e5661219147f5fe936` |
| 6 | ran 52 / run 1 | ran 52 / run 1 | ran 52 / run 1 | `2293bb95e535c6da330bbeaca6c250e4117d34d9c52592efd7163244f9c4a3b8` |
| 42 | ran 52 / run 1 | ran 52 / run 1 | ran 52 / run 1 | `76b9ed80bf8b770c7a5167f3c82b8a4486e456f7599f7d9e8a46aa0c8636e54b` |

- 同一 seed 的 debug、release 及独立输出目录的 release 重复运行，完整 coverage 对象深比较差异为 0，文件逐字节相同。哈希包含本机语料绝对路径，换路径后只能比较对象内容。
- 没有 import/compile 错误；所有成功作品 `budget_frames=0`。305999424 在三个 seed 下均为 ran。
- 唯一的 run 错误在三个 seed、两种 profile 下相同：`214725822.bcm`，`lists_get_value_bad_index (index Some(2), length 1) at block 8pBbyMp94KX94H4C0g28`。**本轮未定位**，越界检查没有放宽。
- `ran` 只表示 60 帧内没有运行期错误，不是与官方逐帧一致的证明。
