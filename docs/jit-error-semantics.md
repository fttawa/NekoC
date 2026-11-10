# jit4 合并后的赋值错误边界

## 历史与冲突

基于 `7194bf0`（`oc/jit4` 合入 `oc/integrate`）。对 `src/engine/jit.rs`
使用 `git blame`、`git show 0e08fbf -- src/engine/jit.rs` 确认：

- numeric SetValue 在 `assign_number` 前检查错误；
- `h_assign_item` 在 `value_error` 存在时跳过 `engine.assign`；

两处均来自 `0e08fbf864191630d5477a818882c205af618311`，即 k4partial2，
不是 `3ca5fac` 的 KN 面板补全。原意是修复错误 reporter 覆盖赋值目标的副作用，
证据为 [text_indexOf 六组官方错误探针](kitten4-partial-text-2.md#非字符串非数组-value6-个错误组)：
失败时 `before=1`，`result`、`after` 均保留 `"unexecuted"`。

`59bda85`（jit4）新增的
`numeric_writes_observe_a_pending_error_from_an_early_returning_helper`
却期待 `Move` 出错后仍执行下一条赋值、再报告错误。它固化了本地提前返回漏洞，
不是官方行为证据。旧的 `Some(2)`、目标 `2.0`、PC 2 均应修正为
`Some(1)`、目标不变、PC 1，不能为了通过旧断言删除 k4partial2 的写前保护。

## 只读官方源码证据

本次只读核实外部 `resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
重新计算 SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
未复制内核代码；以下偏移为 UTF-8 解码后的 JS 字符下标（0-based，非字节）：

| 模块 / 函数 | 偏移 | 结论 |
| --- | ---: | --- |
| `LmbJ/prototype.compile_params` | 476694 | 输入积木先执行表达式前缀，结果再放入参数对象 |
| `LmbJ/prototype.compile_domain_functions` | 472533 | 全部输入求值语句在当前 domain function 调用之前 |
| `LmbJ/prototype.compile_statement` | 463029 | 当前积木之后才拼接 next，不吞异常后继续 |
| `oiyH/variables_set` | 1647283 | 接收已求好的 VALUE，再调用运行库 set_variable |
| `Tn6a/change_variable` | 582550 | 接收已求好的 n，再读取旧值、计算并写回 |
| `Tn6a/lists_get_value` | 579696 | 非数组、非有限索引、0 索引或缺项抛错；不会返回 NaN 占位值继续赋值 |
| `Lcae/prototype.step_call_domain_function` | 446362 | 同步输入抛错后补注解并重新抛出，不写表达式结果 |
| `Lcae/prototype.do_step` | 451891 | script 抛错后补执行栈并重新抛出 |
| `iNFq/prototype.update` | 1179866 | step_code 抛错后 report_error_and_stop 并返回 |
| `iNFq/prototype.report_error_and_stop` | 1192742 | 发出运行错误并停止 |

播放器 `Tn6a/Xt`（666978）经 `Wt`（666274）注册列表实现，
`tVdx/RegistryImpl.register`（1680440）覆盖相同 domain ID；不应误用
`oiyH` 基础 lists_get_value 中的 legacy 容错分支判断播放器行为。

所以 **RHS 同步抛错 → 外层 set/change 尚未调用 → next 未执行 → 报错停止**。
已经完成的积木、或表达式内在抛错前已发生的副作用不回滚。这里限定输入错误，
不推断“写入完成后通知回调再抛错”也会撤销写入。

本次另在本地 `dist/jitfix/official-probe.mjs` 构造十组原创 workspace，交给
官方 JSONEntityCompiler 编译并运行：列表 `[2]` 读取索引 0 或 `0/0`，分别用作 set、
乘 2 后的 numeric-set、increase、decrease、move 的输入。每组先令 before=1，
result 初值为 7，失败积木之后令 after=1。在原 `report_error_and_stop` 调用前
只读采样，再转调原函数，十组都观察到 `before=1, result=7, after=0`。
十组均完成 0 帧；索引 0 错误为 `HEART.CLIENT/lists_get_value_bad_index`，
非有限索引错误为 `invaild_list_index`（官方拼写）。全部 `block_type=lists_get_value`，
没有 pageErrors，外部请求全部 blocked。
这直接确认失败赋值与 next 没有执行，不从“0 帧”单独推断。
完整诊断及资源 hash 保存在本 worktree 忽略目录 `dist/jitfix/official-probe.json`，
生成器与诊断不含外部作品或内核代码；此前六组 text_indexOf 实测仍保留。

`.orig` 含包装器 DI 暴露点，未独立认证等于线上发布物；离线内核证据不能
泛称所有官方版本一致。新增实测没有覆盖私有变量组合，私有输入错误规则仍
依据上述源码控制流及本地回归。

## 修复范围

- `Move`：合法 NaN/Infinity 仍为 no-op，但不再从 `exec` 提前返回，必须经过
  当前指令的错误检查；因此输入错误不会泄漏到下一积木。
- `Kitten4Change`：解释器和 native 数值路径均在写入前检查输入错误，避免
  Null/NaN 错误占位值覆盖旧值或参与文本拼接。
- `Set/SetLocal` 和私有变量 set/change：K4 模式下同样写前检查。真实编译器会
  将数值 RHS 降为 Set/SetLocal，不能只修 SetValue；KN 的这些路径保持原规则。
- 保留 SetValue 的 numeric 和 typed-item 写前保护、原错误探针测试、jit4 的
  原测试名与场景；扩展直接 native/解释器回归，覆盖 global/local、数值/文本
  初值、直接 item/数值表达式输入、set/increase/decrease；热差分另覆盖私有目标。
- 热差分在第 851 次输入失败，比较完整错误状态、PC/调用栈快照，明确检查
  失败目标保留原值、后续 sentinel 不执行；不仅检查错误字符串一致。

## 边界

本修复没有全局改变所有指令的异常副作用，也未完成私有变量 change 的 typed
语义重构。KN、其他 helper、过程调用/列表写入的既有错误副作用不能由本次
赋值规则直接推广；完整官方兼容性仍未验证。未参考或移植 HateNeko。
