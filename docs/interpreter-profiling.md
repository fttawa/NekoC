# 解释器函数／分支剖析

`interp-profile` 是独立的诊断 feature，普通构建没有计数器、时钟读取或统计 Map。
它不是 `jit-timing`，也不改变 JIT 策略或求值顺序。

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo build --release --features interp-profile --bin perf-bench
target/release/perf-bench.exe E:/nekoc/dist/kitten4-corpus/335327306.bcm --interpreter --frames 60 --warmup 0 1> dist/profile-result.json 2> dist/profile-entries.json
```

统计按线程记录；`perf-bench` 在预热之后清空，在最后一帧之后向 stderr 输出 JSON，
stdout 仍是原性能报告。插桩覆盖 `exec`（包括 reporter 过程本体）、值求值入口、
数值慢分派、全局/局部/实体变量读取、列表解析、K4相等比较、字符串连接、碰撞及每帧物理推进。
`node` 只计实际进入该函数的调用，不是每一个内联数值叶子；深树缓存命中的值入口
仍会计数。没有统计的辅助函数成本留在最近的已统计父级或统计范围之外。

每条记录有 `calls`、`inclusive_ns` 和 `exclusive_ns`；后者扣除嵌套已统计调用。
它们**包含插桩开销**（时钟、变体名格式化、Map、分配），不代表独立硬件采样的纯函数耗时。
Drop 中的统计写入也会影响父级时间。适合核对频率和大成本归属，不应用几十纳秒
叶子之间的差异下性能结论。数值只有同一运行的诊断意义；不可与无插桩 release 比耗时。

## 本轮定位与边界

335327306 的60帧解释器计数中，`Kitten4Add` 161307、`Compare` 126147、
`Item` 150989、`Parameter` 194570、`Global` 225176；`Join` 3917。
这些是动态入口，不是静态积木数，也不同于 JIT helper 不展开递归的旧计数。
比较路径发现 `k4_equals` 原先对数字/布尔/文本也分配结构遍历栈；现将标量入口
与结构 walker 分离，保留数字 NaN 相等、造型 ID 值相等及列表搜索的严格引用规则。
最终诊断中 `k4_equals` 38163次、`add_scalar` 161307次且没有 `add_text`，
连接helper仅1454次；这支持优先标量比较，而非重写rope。它不能独立证明历史
integrate比jit2多出的周期都来自比较；jit2也有旧标量遍历栈，精确差额归因仍未验证。

332140513 的历史 JIT helper 中 `Touching` 17201 次，源代码检查发现 `overlap`
每个采样点重复构造两边造型几何。本轮只在单次只读调用内复用几何，不跨帧缓存，
不改采样网格、UV 计算和透明判定。314937840 则以克隆/物理为候选，不能按
`Physics` op 的184次推断每帧物理成本。
本轮无素材60帧诊断中，该作品 `step_physics` 的60次入口仅约0.02ms（含插桩），
不支持把它判为这次运行的主热点；Clone约2.97ms，剩余调度／构帧成本不在op统计内。

深树 walker 非内联、叶子分流和强制内联曾降低部分栈帧，但三版九轮单件实验
均比集成基线慢，已撤销，不以栈尺寸代替性能证据。

所有语义结论限于现有实现的等价优化和本地回归。官方 K4 比较规则的已有源码
位置见 [jit-coverage.md](jit-coverage.md#官方证据与未验证)，造型碰撞继续使用原采样近似；
本轮无新增官方轨迹认证，也未移植 HateNeko。

最终性能必须使用不带 `interp-profile`/`jit-timing` 的 release，单件交替九轮，
全语料交替至少五轮、逐作品取中位数再求和；测前/测中/测后排除其他构建和测速进程。
最终门禁、hash、测量和失败实验的原始数据保存在本 worktree 未提交的报告与 `dist/interp2/`。

## 变更的回归约束

- 标量入口与原 walker 做全类型两两对照，覆盖 NaN、符号零、非有限数、
  相同／不同造型 ID、平坦／树形 Unicode 文本和混合类型。
- 结构 walker 保持原循环图处理；现有循环列表、对象及列表身份差分继续验证。
- 造型几何复用以冻结的旧算法逐项对照，不假设采样碰撞对称；同时验证正反
  顺序、自碰撞、翻转、旋转、缩放、缺造型、透明／截断 mask、文本和非有限状态。
- 缓存叶子测试验证重复输入队列仅消费一次，并区分 KN 全局 Null/Undefined
  回落与 K4 保留类型。该测试保留，即使此次叶子分流优化已撤销。

这些都是本地旧实现等价约束，不是第三方实现或官方行为证据。
