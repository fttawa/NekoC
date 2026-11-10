# JIT 覆盖统计与边界

## 复现

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo build --bin jit-corpus
target/debug/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --out dist/jit2/after.json --frames 60 --seed 1
target/debug/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --out dist/jit2/timing-after.json --timing-only
node tools/compat/jit-report.mjs dist/jit2/before.json dist/jit2/after.json --out dist/jit2/comparison.md
cargo test --test jit_differential
```

`jit-corpus` 只读加载外部 `.bcm`，不会复制作品。逐作品固定随机 seed、虚拟时钟、2,000,000 指令预算，比较解释器/JIT 每帧 wire metadata（去墙钟字段）、绘图 bytes、`debug_snapshot`（包含角色私有单元），并比较异常与失败时快照。普通预算/输出限制保持不变；预算让出不是完整帧工作完成的证明。加载/编译失败单独记录，运行异常只比较实际完成前缀，不算完整通过。

耗时为 `advance()` 墙钟微秒之和，含首次热编译和可选统计成本，不含导入、初始化及比较/序列化。默认工具开启统计，因此不是纯 native 微基准；共享主机并发、debug 构建和短采样噪声须明确披露。不能把 region 指令比例直接称为全机器码覆盖或提速。

`--timing-only` 不启用统计；报告工具支持 `--timing-before b1.json,b2.json,b3.json --timing-after a1.json,a2.json,a3.json`，按作品取三轮中位数，覆盖率仍取开启统计的报告。基线可从起点源码构建并保存独立二进制；不要在其他 worktree 修改源码，也不要一边运行 Windows 可执行文件一边重链接同一路径。

## 计数口径

- `Engine::enable_jit_profile()` 显式启用，普通播放器不建立统计 Map。计数在 `start()` 后保留，便于观察多次启动后变热的 region。
- `native_ops`：native region 实际消耗的 VM 指令（包含委托 helper）。
- `interpreted_ops`：调度器直接执行的 VM 指令。覆盖率为 `native_ops / (native_ops + interpreted_ops)`。
- `delegated_ops`：region 内通过 `h_exec` 执行的指令，是 `native_ops` 的子集。`(native_ops - delegated_ops) / 总指令` 是非通用指令委托比例，仍可能调用 Rust 的数值、列表、实体访问 helper，**不是**全内联机器码比例。
- `node_calls` 与 `helper_reasons`：region 中回调通用表达式 evaluator/指令解释器的次数；reporter 次数不加入指令分母。
- `fallback_reasons`：直接解释指令按冷路径、不支持/不纯、boxed/fuel、后端拒绝、禁用/不可用归因；K4 的 Next 等调度边界有意保留。
- `fallback_inputs`：回退指令子树中静态存在的私有变量、列表、文本、比较或 reporter 过程等候选，每指令每类只计一次；不重新求值，不表示该叶子实际执行次数，可重叠，不能相加当指令总数。

## native 扩展与语义保护

- 不再因存在私有变量声明而整作品关闭 JIT。私有变量数值 helper 每次按 actor 索引访问，保留存活/作用域检查；数值 guard 只接受实际 `Cell::Number`。文本、布尔、Null、列表等保留类型路径；动态克隆编号读取仍用 evaluator。
- 过程数值参数、纯数值 K4 Add 可在 guard 后计算。参数变为文本时慢路径保留 JS 拼接及 typed 比较，不把文本数字当数值比较。
- 常见列表索引读取、长度读取支持 global/local/variable/expression 引用；typed item 赋值保留原 Cell/列表引用，不强转 f64。K4 列表写保留解释器的 splice、负索引和异常规则，不套用 KN 的舍入/append 快路径。
- K4 typed EQ/NE 保留 `NaN == NaN`；普通算术比较和 KN 规则不因此改变。
- 表达式异常在当前指令完成其解释器相同写入后立即退出，不执行后续指令。委托 helper 区分未执行与已执行失败，保留执行后 PC、正确扣除 fuel。
- reporter 过程、clone/split/tell、场景切换等不能绕过纯度检查；可能重分配 native 缓存数组的操作必须退出 region。

## 官方证据与未验证

本次复核本地只读 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`，SHA-256 为 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。以下是 UTF-8 解码后 JS 字符偏移（0-based），不是字节偏移：

| 规则 | 官方源码位置 |
| --- | --- |
| 私有变量缺少实体单元抛错，不回落全局 | `get_var_or_list` 497245、`set_variable` 498099 |
| 索引有限性、0/小数、负索引及缺项错误 | `lists_get_value` 579696 |
| 替换使用 JS splice | `lists_replace` 579506 |
| typed EQ/NE 使用 lodash isEqual，含 NaN 相等 | `oiyH` 1643295，引入 `Y+p1`；`logic_compare` 1646589；另见 [kitten4-runerr2.md](kitten4-runerr2.md) |
| 每解释器循环/调度边界 | `step_iteration_yield` 444876、`OptiRunner.step` 451619；[kitten4-scheduling.md](kitten4-scheduling.md) |

私有继承/删除/原角色与克隆单元隔离沿用 [官方已记录实测](actor-variables-official.json)，没有重新声明全作品官方一致。新增热循环差分是 JIT 与本地解释器的证明，不是独立官方 oracle。未参考或移植 HateNeko。

**已知既存限制／未验证：** K4 私有 `change` 的解释器目前仍直接数值化，而全局 `Kitten4Change` 保留 JS 值类型；官方 `change_variable` 582550、算术 helper 577629 表明文本 Add 可拼接。此次只扩展数值路径，不声称已修复该既存私有文本 change 差异。全语料官方轨迹、像素、真实输入、长时间随机行为及 ARM64 真机执行未验证；ARM64 单元测试只检查后端编译。保留现有不支持积木和真实运行错误，不用 NaN/忽略错误伪造通过。
