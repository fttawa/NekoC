# Kitten 4 调度对齐记录

离线 coverage/trace 的固定时间和确定性预算后续改动见 [kitten4-runerr2.md](kitten4-runerr2.md)。正常播放器仍使用墙钟预算；虚拟时间不是官方原生时间行为的声明。

## 证据边界

本次只读检查外部播放器 `resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，通过 webpack 模块 ID 定位原始实现；没有移植第三方内核。资源路径及 SHA-256 见 [kitten4-scheduling-evidence.json](kitten4-scheduling-evidence.json)。外部作品不属于回归夹具，也没有加入仓库。

最小夹具由 `tools/compat/k4-scheduling-fixtures.mjs` 生成。设置 `K4_PLAYER_DIR` 为外部播放器 app 路径后，执行：

```powershell
node tools/compat/k4-scheduling-fixtures.mjs --record
cargo test --test kitten4_scheduling
```

`--record` 在官方 OptiRunner 上记录六个 update 的变量值与执行边界，不把官方实现当作 NekoC 的运行依赖。普通 Rust 回归离线读取已记录证据，同时检查解释器和默认 JIT 路径。热循环测试另行反复进入 Repeat，超过 JIT 阈值 500；单元测试直接断言确有 native region 生成，避免把“启用了 JIT”误当作“执行过 JIT”。

## 已实施规则

| 规则 | 官方定位/最小实测 | NekoC 策略 |
|---|---|---|
| 脚本次序 | `mXOY/ScriptStoreImpl` 保留加载顺序；`iNFq/create_singleton_entity_instances` 遍历 typeclass；`order` 为 `AB`，`entities` 在图层顺序相反时仍为 `AB` | JSON 保留插入顺序，K4 脚本按源实体和源根顺序建立；不按随机 block ID 排序 |
| 排序方向 | `iNFq/get_interpreter_sorters` 返回 listener、frame_created、responder_priority、负 creation_counter；`step_code` 倒序遍历 | 已处理广播 listener 优先、较新 update 优先、同批按创建顺序。其余 responder priority 和鼠标事件的完整顺序**未验证** |
| 广播 | `iNFq/spawn_interpreter` 运行时先入 `interpreters_needing_spawn`；update 在 `step_code` 前统一加载 | 广播不把新任务追加进当前 ready；`broadcast` 的日志依次 `AB, ABC, ABCD` |
| 广播并等待 | `iNFq/update_broadcaster_await`、`broadcast_responder_unbind_broadcaster` | 等待接收任务结束后下一个 update 恢复；夹具为 `A, AB, AB, ABCD`。无监听器/重复广播等扩展情形尚不能据此声称完全一致 |
| 克隆 | `iNFq/create_entity_instance`、延迟 spawn；最小实测 `AB, ABC, ABCD` | 克隆脚本下一次 scheduler pass 执行，不抢入当前 ready；实例属性复制和不可自我克隆旧测试相应多推进一帧 |
| 初始场景 | `Tn6a` 的播放器启动路径选择 `scenes_order[0]`；`initial` 特意令编辑器 current_scene 不同，仍记录 `A` | K4 从第一个场景启动，而不是编辑器当前选中场景 |
| 场景切换 | `iNFq/step_code` 在每个解释器前检查 running group；`scene` 为 `AB, ABC` | 全局启动线程切换后继续本轮；新场景激活线程下一轮启动 |
| wait 0 | `K9+f/task_update` 初次只设置 start/previous tick，后续到期标记 dispose；`update_dispose` 下一轮移除 blocker；`wait` 为 `AB, AB, ABC` | 显式记录等待创建的 scheduler tick、到期与下一轮解除，不用写死的 1/60 秒补偿；零 dt 与不同 dt 回归亦跳过完整一轮 |
| 循环末次 yield | `inF4` 循环语义、官方 OptiRunner 最小实测：`loop` 为 `AB, ABA, ABAC` | yielding Repeat/Range 最后一轮也结束当前 pass；warp/non-yielding 循环不额外挂起 |
| 小数 repeat | `inF4/eval_repeat_n_times` 用整数计数与原始次数比较；`fractional` 1.5 次为 `A, AA, AAC` | K4 取 ceil，解释器和 native helper 一致；KN 仍取 floor |
| 默认参数类型 | `oiyH/default_value` 执行 Number(TEXT)，仅 NaN 保留字符串；`defaults` 中 `-1` 与数字 `-1` 相等，日志 `AB` | K4 专用 literal lowering 保留官方数值类型，不改变普通 text 和 KN |

KN 在编译前递归恢复原来的对象键排序；K4 的等待、排序、repeat、广播和克隆改动受 RuntimeSemantics 限定。保留列表越界异常，不以返回空值或忽略错误掩盖调度差异。

## 追踪契约与限制

```powershell
target/debug/k4-trace.exe <外部作品.bcm> --frames 3 --blocks
node tools/compat/k4-oracle.mjs run --input <外部作品.bcm> --frames 3 --blocks --out dist/local-official.json
```

- 双方记录 `start/resume/block/yield/finish`，包含 frame、entity、hat；NekoC 另有 PC 和源 block ID。过程调用不会改写冻结的 hat 身份。
- NekoC 的 block 是 lowered VM 指令边界（包括 reporter 过程内部），官方 block 是 `before_expression` 边界（也包含输入 reporter、重复求值）；原始数组不能直接按事件序号逐项相等比较。
- NekoC list 事件只记录全局列表长度变化；相同长度替换、仅实体列表与临时列表变化不全。官方记录原生 list notification（含长度相同的通知）。两者都不是完整的列表写日志。
- 官方积木事件最多 500000 条，超出后只设置 `traceTruncated`，不抛异常、不干预作品执行。截断后的“没有看到某积木”不能证明它未执行。
- `--blocks` 强制解释器，不代表 JIT 行为；`--interpreter` 可在不生成海量事件时单独对照。异常保留已完成帧、events、error，并附失败时快照 `failedFrame`。
- 官方 PCG 与 NekoC 的随机序列不同；相同 seed 不等于相同抽样。随机作品的轨迹差异必须标“未验证”，不能宣称调度不一致。coverage 默认使用时钟种子；现在可用 `--seed <u64>` 固定。专项诊断可用 oracle `--random-source nekoc` 仅替换随机积木的抽样输入，见 [运行错误记录](kitten4-run-errors.md)，不是官方默认 PRNG。
- `advance_with` 是 NekoC 的多 pass 扩展，不是官方一帧一 update 模式；没有官方逐项对照，不声称兼容。

## 五个原越界作品

本地详细输出位于不跟踪的 `dist/sched/`；最终数量和逐作品前后帧见根目录未提交的 `OC-REPORT.md`。

| 作品 | 基线失败积木 | 已确认的分歧/状态 |
|---|---|---|
| 186831447 | `obGQB27D7BnDSbrVSFEe`，第 2 项/长度 1 | 初始场景先分歧：编辑器选中 `9ac58d19-f411-4a83-9f66-6ff29cd7a21a`，官方从 `b5e60282-a2d1-478b-802d-a30e77d67e6b` 启动；修正启动场景后早期越界消失 |
| 267573240 | `iXVCPckSmyRG7ipzEw9C`，第 426 项/长度 425 | 官方首帧像素列表 442，原 VM 425，源于 17×26 与 17×25 的 repeat 差异；正小数向上取整修正后不再出现该越界 |
| 332140513 | `kWoZ1lHIoiT234X0UwC9`，第 2 项/长度 1 | 基线克隆进入当前 ready，早于后续启动脚本的列表初始化；改为下一轮克隆启动后越界消失。完整作品状态仍须另看差异报告，不等于已完全兼容 |
| 305999424 | `xeM3wrVyL1eRfXmDXORq`，空列表/无有效索引 | 初始化 hat `oH4j734B3Tpy4g3N0vV5` 在双方均先于失败 hat `liunvhDthdi1RbN0iRJv` 运行；不能再归咎于启动顺序。已定位默认参数 `BaXyEer7G1TV9lJJauL4` 的 `-1` 被误作字符串，`ukKWHQANYPOUn35IRzp0` 的比较分支错误，跳过晶格初始化；最小 defaults 官方实测和源码共同证明类型规则。完整作品的最早值级分歧顺序仍受官方事件截断限制 |
| 335327306 | `r5WpFLApOFAOR67chKu2`，第 2 项/长度 1 | seed 1 的解释器/JIT 前 60 帧均成功；seed 6 双方执行模式同在第 5 帧失败。不是已证明的 JIT 特有错误；官方同 seed 不同 PRNG，根因和首个同输入分歧尚**未验证** |

未解决项应保留错误与证据，不把 coverage 偶发成功记作修复。

### 未完成的自动让出上限

只读源码还确认 `Lcae/OptiRunner.step` 每步最多进行 `max_procedure_calls_per_interpreter_step` 次程序调用；`step_iteration_yield` 对 warped 迭代检查 `n_warp_iterations > max_warp_iterations_per_interpreter_step`，非 deterministic 模式还受墙钟限制。`TGGv/ConfigImpl` 的默认值分别是 50000、30000 和 4 ms。

NekoC 当前只有全帧的指令/墙钟预算，没有完整重现上述**每解释器**上限。尤其很大的 warp 初始化可能过早越过其他线程应获得执行机会的位置。此项尚无可提交的独立最小实测与 JIT 实现，不宣称已经对齐，也不把它当成两个剩余作品错误的已证实根因。

`305999424` 修正默认参数类型后不再首先失败于 `xeM3wrVyL1eRfXmDXORq`，而在 `N9k3sQ5kpqHqqlImQIA6` 从空的“树木模版”列表取随机项时失败。后续专项修复与新的证据见 [运行错误记录](kitten4-run-errors.md)；本页上表保留调度任务当时的观察，不作为最新状态。
