# JIT 覆盖统计与边界

## 复现

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo build --release --bin jit-corpus
target/release/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --out dist/jit3/after.json --frames 60 --seed 1
target/release/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --out dist/jit3/timing-after.json --timing-only
node tools/compat/jit-report.mjs dist/jit3/before.json dist/jit3/after.json --out dist/jit3/comparison.md
cargo test --test jit_differential
```

`jit-corpus` 只读加载外部 `.bcm`，不会复制作品。逐作品固定随机 seed、虚拟时钟，默认每帧 2,000,000 指令预算（`--instructions` 可调整且双方相同），比较解释器/JIT 每帧 wire metadata（去墙钟字段）、绘图 bytes、`debug_snapshot`（包含角色私有单元）及 `jit_debug_snapshot`。后者额外观察 typed Cell、符号零/非有限数、列表/造型引用身份、暂停任务 PC/循环/调用栈/参数/局部单元及 PRNG；列表图按首次遇到的确定性序号比较，不比较进程地址。NaN payload/sign 不属于积木可见行为，统一为 NaN。快照只读，不重复求值 reporter 或消费随机数。异常与失败时快照也比较。普通预算/输出限制保持不变；预算让出不是完整帧工作完成的证明。加载/编译失败单独记录并使命令失败，运行异常只比较实际完成前缀，不算完整通过。

耗时为 `advance()` 墙钟微秒之和，含首次热编译和可选统计成本，不含导入、初始化及比较/序列化。默认工具开启统计，因此不是纯 native 微基准；共享主机并发、debug 构建和短采样噪声须明确披露。不能把 region 指令比例直接称为全机器码覆盖或提速。

`--timing-only` 不启用统计；报告工具支持 `--timing-before b1.json,b2.json,b3.json --timing-after a1.json,a2.json,a3.json`，按作品取三轮中位数，覆盖率仍取开启统计的报告。新 JSON 自动记录 debug/release、架构、OS 和指令预算，报告拒绝混合不一致的已记录设置；旧 JSON 缺字段明确显示未记录，不猜测构建模式。基线可从起点源码构建并保存独立二进制；不要在其他 worktree 修改源码，也不要一边运行 Windows 可执行文件一边重链接同一路径。

## 计数口径

- `Engine::enable_jit_profile()` 显式启用，普通播放器不建立统计 Map。计数在 `start()` 后保留，便于观察多次启动后变热的 region。
- `native_ops`：native region 实际消耗的 VM 指令（包含委托 helper）。
- `interpreted_ops`：调度器直接执行的 VM 指令。覆盖率为 `native_ops / (native_ops + interpreted_ops)`。
- 以上分母不包含 `call_reporter` 同步执行的过程本体内部指令（既有统计边界），因此只是调度器层的 region 覆盖率，不是所有实际 VM 指令的覆盖率。特别是 reentrant gateway 后，外层指令进入 region 不意味着 reporter 本体也已 native。
- `delegated_ops`：region 内通过 `h_exec` 执行的指令，是 `native_ops` 的子集。`(native_ops - delegated_ops) / 总指令` 是非通用指令委托比例，仍可能调用 Rust 的数值、列表、实体访问 helper，**不是**全内联机器码比例。
- `node_calls` 与 `helper_reasons`：region 中回调 evaluator/指令解释器的次数；reporter 次数不加入指令分母。`op/*` 表示通用 exec 委托，`native/*` 表示专用调用/返回/typed append/循环边界 helper，后者也有 Rust 运行开销，不冒称无 helper。`native/reentrant-*` 是同次 `native/*` 中的重入尾部子集，不可与父计数相加。直接内联数值 append/change 不额外产生 helper 分类计数，因此这些计数不是全量热指令分解。
- `fallback_reasons`：直接解释指令按冷路径、不支持/不纯、boxed/fuel、后端拒绝、禁用/不可用归因；支持的 K4 调度边界通过专用 helper 精确让出，不再必须直接解释。
- `fallback_inputs`：回退指令子树中静态存在的私有变量、列表、文本、比较或 reporter 过程等候选，每指令每类只计一次；不重新求值，不表示该叶子实际执行次数，可重叠，不能相加当指令总数。

## native 扩展与语义保护

- 不再因存在私有变量声明而整作品关闭 JIT。私有变量数值 helper 每次按 actor 索引访问，保留存活/作用域检查；数值 guard 只接受实际 `Cell::Number`。文本、布尔、Null、列表等保留类型路径；动态克隆编号读取仍用 evaluator。
- 过程数值参数、纯数值 K4 Add 可在 guard 后计算。参数变为文本时慢路径保留 JS 拼接及 typed 比较，不把文本数字当数值比较。
- 常见列表索引读取、长度读取支持 global/local/variable/expression 引用；typed item 赋值保留原 Cell/列表引用，不强转 f64。K4 列表写保留解释器的 splice、负索引和异常规则，不套用 KN 的舍入/append 快路径。
- K4 typed EQ/NE 保留 `NaN == NaN`；普通算术比较和 KN 规则不因此改变。
- 表达式异常在当前指令完成其解释器相同写入后立即退出，不执行后续指令。委托 helper 区分未执行与已执行失败，保留执行后 PC、正确扣除 fuel。
- Boolean、Encode/Decode64、ParseFloat/ParseInt、IsNumber 转换自身不会调度；纯度检查遍历其输入，只有子树含 reporter 过程才退出。不把转换标为纯数值或自行重写 JS 类型规则，复杂值仍调用 typed evaluator。
- Call/Return 使用专用 native helper 维护真实 VM 调用帧、参数、循环/范围深度和返回值，纯参数的调用在 region 内可直接跳到过程入口及已知返回点；其他返回点退出后重新选 tier。未静态内联过程，也没有绕过递归栈上限。
- 含 reporter 过程的 Call/Branch/AppendList/SetValue/ReturnValue/Kitten4Change 只允许 terminal gateway：执行完整指令后立即返回实际 PC，不探索后继，也不再读取 native 缓存的 slots/locals/values 指针。这样输入 reporter 即使广播/克隆导致 tasks 扩容、boxing 或停止/重启作品，也不会返回旧 region 的数值路径；调度器检查 done 后才重新选择 tier，restart 仍在原 ready-task 边界处理，不提前改变指令计数。Call/Append/Return 使用专用 helper；SetValue/Change 的通用 exec 如实记 delegated_ops。**reporter 本体仍由 call_reporter 解释执行**，不能将“unsupported 降为零”当作消除了实际解释成本。
- 全局/局部 `Kitten4Change` 仅在目标和增量实际为 Number 时执行 f64 ADD/SUB；文本拼接、列表/造型/Null 不写、typed coercion 都退回原指令。输入先求值、再读旧值，保留错误时写入顺序。
- AppendList 的数值路径支持所有 ListRef，包括 K4；typed 路径经专用 helper 保留 Cell 和嵌套列表引用，先求值再解析目标，保留循环引用拒绝和异常优先级。列表替换的 K4 splice/index 规则仍用原解释器。
- Next/RangeNext/WarpIteration 的专用 helper 执行一次边界，维护循环栈和原有 warp 计数；真正 yield 时设置 `jit_yield` 并立刻退款后续指令，调度器结束当前 pass。K4 末次 yielding 迭代、KN Range 末次差异和无进展错误均保留。只是消除 tier 往返，不删除让出或放宽预算。
- 直接的 clone/tell、场景切换等仍退出 region；可能重分配 native 缓存数组的 reporter 只允许上述尾部 gateway。列表 split 的纯值构造不改数组地址，可由 evaluator 在非重入 native helper 中执行。

## 官方证据与未验证

本次复核本地只读 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`，SHA-256 为 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。以下是 UTF-8 解码后 JS 字符偏移（0-based），不是字节偏移：

| 规则 | 官方源码位置 |
| --- | --- |
| 私有变量缺少实体单元抛错，不回落全局 | `get_var_or_list` 497245、`set_variable` 498099 |
| 索引有限性、0/小数、负索引及缺项错误 | `lists_get_value` 579696 |
| 替换使用 JS splice | `lists_replace` 579506 |
| typed EQ/NE 使用 lodash isEqual，含 NaN 相等 | `oiyH` 1643295，引入 `Y+p1`；`logic_compare` 1646589；另见 [kitten4-runerr2.md](kitten4-runerr2.md) |
| 每解释器循环/调度边界 | `step_iteration_yield` 444876、`OptiRunner.step` 451619；[kitten4-scheduling.md](kitten4-scheduling.md) |
| 过程调用帧/返回 | `prototype.step_call_procedure` 444019、`prototype.step_return_value` 446144；本地 native 约定保持现有 VM，非逐字段重现官方栈 |
| 变量增加/减少，非数值 ADD 可拼接，对象旧值不改 | `change_variable` 582550、算术 helper 577629 |
| 普通列表追加保持值、检查 Array 后 push | `lists_append` 579044 |

私有继承/删除/原角色与克隆单元隔离沿用 [官方已记录实测](actor-variables-official.json)，没有重新声明全作品官方一致。新增热循环差分是 JIT 与本地解释器的证明，不是独立官方 oracle。未参考或移植 HateNeko。

**已知既存限制／未验证：** K4 私有 `change` 的解释器目前仍直接数值化，而全局 `Kitten4Change` 保留 JS 值类型；官方 `change_variable` 582550、算术 helper 577629 表明文本 Add 可拼接。此次只扩展全局/局部 typed change 的数值路径，不声称已修复该既存私有文本 change 差异。官方数值算术可使用 Decimal，本轮不将“与本地解释器相等”误称“所有浮点数与官方相同”。全语料官方轨迹、像素、真实输入、长时间随机行为及 ARM64 真机执行未验证；ARM64 单元测试只检查后端编译。保留现有不支持积木和真实运行错误，不用 NaN/忽略错误伪造通过。
