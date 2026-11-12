# 解释器冷热代码布局

本次只重排 Rust 实现，不改变积木语义、JIT 阈值、默认配置或调度规则。

## 分类依据

以历史 `jit7` 的全53件语料、60帧、seed 1/6/42动态计数筛选必须保留的路径：

| 分类 | 三seed累计 |
| --- | ---: |
| reporter/Find | 2,320,055 |
| reporter/Item | 576,893 |
| reporter/Compare | 217,161 |
| reporter/Logic | 29,997 |
| op/Position | 507,631 |
| op/ReplaceList | 246,723 |
| op/PenProperty | 215,279 |
| op/SetActorVariable | 143,269 |
| op/AddY | 85,059 |

`helper_reasons["reporter/*"]` 仅记录 native 调用求值器的入口，不展开递归输入；
`op/*` 仅记录 native 委托 `exec`。直接解释的 `fallback_reasons` 还显示画笔路径、
造型、滤镜、印章、克隆、动画步进的稳定执行，因此不按功能名把这些分支一概标冷。
数值、常量、变量、列表、比较逻辑、拼接、调用返回、循环跳转及移动仍在主分派中。
这些历史计数不是完整纯解释器分支命中率；没有记录的分类不等于从不执行，尤其
K4语料不能证明KN服务在所有工程中均冷。分类的最终效果仍须独立release实测。

物理指令虽有稳定执行（`Physics` 3,413次/seed），仍单独隔离，避免rapier内部的
大临时对象随 `#[inline(always)] exec` 进入 `tick`。这是一项栈帧成本取舍，不表示物理作品不重要。
每帧调用一次的 `step_physics` 另设 `#[inline(never)]`，而不标记 `#[cold]`；
否则即使指令分派已拆开，整个Rapier帧推进仍可能被LTO内联进调度热函数。
`jit_compile` 则标记 `#[cold] #[inline(never)]`：偶发的编译持有大的Cranelift Context，
不应随 `jit_try` 展开到每次tick；native执行入口与热度判定保持不变。

## 保持语义的边界

- `eval_value_one` 仍负责 PREPARED、缓存及深求值前置检查；冷分派不再次执行这些检查。
- `exec` 的stage检查、移动旧坐标、dirty标记与公共错误检查顺序不变。
- 冷指令函数的 `None` 表示原分支正常落出，继续公共错误检查；`Some(bool)`
  表示原来的提前返回，不能被改成统一尾检。原先直接返回媒体/服务helper结果的分支同样保留。
- 主match显式列出冷变体，新增变体仍须通过穷尽检查；冷函数在运行时拒绝热变体误入。
  两处白名单必须同步维护，编译器并不静态验证两份集合相等。
- `ValueExpr` 的大payload置于 `Program` 侧表；尺寸守卫只约束布局，不宣称单独提速。

## 证据边界与复验

已有官方实测仍通过仓库的配对回归读取，例如属性第五/六轮、物理第六至八轮、
媒体默认值及KN面板实测；其来源见对应测试和兼容性文档。本次没有新增官方实测，
也没有移植HateNeko。JIT/解释器差分是同一实现的两种执行模式对照，不是独立官方认证。

构建设置与命令：

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo build --release --locked --bin jit-corpus --bin perf-bench
cargo rustc --release --lib -- --emit=asm
target/release/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --timing-only --frames 60 --seed 1 --out dist/interp/timing.json
target/release/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --frames 60 --seed 6 --out dist/interp/diff-seed-6.json
target/release/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --frames 60 --seed 1 --instructions 997 --out dist/interp/diff-budget997.json
```

不带 `jit-timing` feature；测速前检查其他cargo/测速进程。基线、起点和新版交替至少五轮，
逐作品取中位数再求和，分别报告解释器和默认JIT；相同运行错误只验证失败前缀，不算完整作品成功。
具体二进制hash、栈帧、数据和门禁结果保存在本worktree未提交的 `OC-REPORT.md` 与忽略的 `dist/interp/`。

## 初步结果

第一次仅拆指令/值分支时，`eval_value_one` 从1,640 B降到1,352 B，
`call_reporter` 从1,752 B降到1,112 B，但 `tick` 仍为12,200 B（起点12,760 B）。
汇编确认物理帧推进仍被内联。这说明“把物理指令搬出exec”不足以消除每帧物理大栈，
也不能从某个函数栈帧变小直接推导整语料更快。

本地布局回归覆盖热/冷分支公共错误尾检、冷helper直接返回、阻塞提前返回、
物理参数失败不创建世界，以及Microbit五输入的顺序和重复引用。侧表测试还覆盖
K4Media、K4Property和KnCloneProperty的非零槽、72层深输入/深父树、重复求值、
类型/错误结果与缓存/调用栈清理；这些是本地回归，不是新增官方证据。

第一版五轮全语料交替测量，逐作品中位数求和如下（ms；52件完成60帧，另1件既有错误）：

| 版本 | 解释器 | 默认JIT |
| --- | ---: | ---: |
| jit2 | 3093.582 | 2844.390 |
| 起点8b08174 | 3531.919 | 2987.798 |
| 第一版拆分 | 3098.893 | 2754.704 |

第一版相对起点解释器用时少12.260%、默认JIT少7.802%，但解释器收益约87.9%
来自305999424，且335327306的默认JIT在此批次增加3166us，不能声称逐作品不退化。
同版335327306独立9轮120测量帧/30预热的解释器帧均值中位数为0.675271ms，
起点0.678474ms，jit2为0.597530ms；这个单件目标尚未追回。
后续非内联边界的最终结果需另行测量，不能沿用此表。

增加两个非内联边界后，同工具链release汇编中的静态栈分配如下；这是代码生成
结果，不是性能测量或运行时最大总栈深度（冷调用仍会分配自己的栈帧）：

| 函数 | 起点 | 第一版 | 非内联边界版 |
| --- | ---: | ---: | ---: |
| `tick` | 12760 B | 12200 B | 1672 B |
| `eval_value_one` | 1640 B | 1352 B | 1352 B |
| `call_reporter` | 1752 B | 1112 B | 1112 B |

最终 `jit_compile` 独立栈帧为10984 B，`step_physics`为904 B；不再让未编译或
无物理世界的普通tick无条件携带这些局部临时的栈空间。

## 最终验证结果

同一工具链、无`jit-timing`的release，三方交替五轮，逐作品中位数求和（ms）：

| 版本 | 解释器 | 默认JIT |
| --- | ---: | ---: |
| jit2 | 3041.762 | 2824.595 |
| 起点8b08174 | 3473.509 | 3023.642 |
| 最终版 | 2999.781 | 2696.545 |

最终版相对起点用时分别减少13.638%和10.818%，相对jit2分别减少1.380%和4.533%。
解释器收益约87.0%来自305999424；排除此件后，相对起点解释器减少8.383%、JIT减少1.592%。
不能宣称所有作品均不退化：332140513的默认JIT从267.215ms增加至274.906ms，
314937840的解释器从20.571ms增加至22.229ms。保留这些未达标结果，不以总量掩盖单件回退。

335327306另作三方交替九轮，每轮30帧预热、120帧测量、`NEKOC_JIT=0`，
各轮帧均值的中位数：jit2为0.590021ms，起点0.679585ms，最终版0.614742ms。
最终版比起点用时少9.541%，仍比jit2多4.190%，单件追回目标未完全达到。
这些数据是同批对照，不与附件或第一版不同批绝对时间混算。

`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、
`cargo test --all-targets`均通过；库127 passed/1 ignored，新增11项布局测试全部通过。
JS工具测试578 passed/0 failed/59 skipped。语料coverage的seed 1/6/42均52 ran、1 run错误。
全53件的seed 1/6/42（60帧、2,000,000预算）和seed 1（997预算）差分均为
52件完成、1件既有运行错误、0差异、0加载错误。214725822完成0帧，不算全件成功。
此处为本地解释器/JIT对照，不是新增官方一致性认证。
