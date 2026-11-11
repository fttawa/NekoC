# K4 partial 云类别第二组离线证据

本轮按语料频次优先检查 `cloud_variables_get` (296)、`cloud_variables_set` (159)、
`change_cloud_variable` (114)，并扩展云列表。数字是任务提供的优先级，不是本轮重新生成的覆盖统计。
**保留 partial；不改既有云夹具或证据。覆盖表由主会话统一更新。**

## 官方只读定位

读取外部 `K4_PLAYER_DIR=E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app` 的
`src/player/build/player_v2.2d180c468559fbd29528.js.orig`。
SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
下列均为解码后 JS 字符串偏移，不复制内核实现：

| 偏移（约） | 观察 |
| --- | --- |
| 554022，TL4g/R | 标量与列表项校验只接受 string/number；按 UTF-16 截为 1024/128 |
| 555027，cloud_variables_set | 非法标量写入不改变原值；未登录本地即时更新 |
| 555381，change_cloud_variable | 增加使用 JS `+`；减少使用 JS 数值转换。公共数值分支会选择增量协议，私有为赋值协议；本轮不测试发送协议 |
| 557063，cloud_lists_get_value | 非 number/非有限/非正索引返回空字符串；正小数按截断、低于 1 钳到 1；nullish 项返回空字符串 |
| 564951，K.update_list_by_action | 离线列表为原地数组更新；无效列表项保留 undefined（JSON 导出表现为 null），非 NaN |

`.orig` 含包装器 DI 暴露点，未独立认证为线上发布版本。本轮不改外部内核，不加载/复制第三方语料。

## 原创夹具与结果

生成器：`tools/compat/k4-partial-cloud-2-fixtures.mjs`。
保存夹具：`tests/fixtures/kitten4/partial-cloud-2-*.bcm`。
离线实测：`docs/kitten4-partial-cloud-2-evidence.json`。
每组调用真实 `runOracle`，经官方 Start，8 帧；7 组共 56 帧。
最终录制全部 `errors=[]`、`pageErrors=[]`，每组 16 个外部请求全部 `blocked`；无账号、无凭据、无放行素材。

| 组 | 原创验证点 |
| --- | --- |
| change | 公共/私有各自检查数值、左右字符串、布尔、数组增加、数组减少、非数值减少、Infinity、NaN、文本 0 减少；每次变化立即读出。非有限值另转字符串观察，避免 JSON null 把 Infinity/NaN 混淆 |
| limits | 写/增加上限 1024 UTF-16、完整 emoji 边界、非法 bool/array 标量赋值保留旧值、列表项 128 UTF-16 |
| list | 空/末项、严格类型搜索、fraction/zero/negative/infinity、越界 splice、replace-last、delete-last |
| list-get | 返回活列表别名；原地 append 后别名长度为 2；云变量 `12 + ["first","second"]` 得字符串 `"12first,second"` |
| typed-index | 字符串 `"2"` 读为 `""`；字符串 `"1"` 插入忽略，长度仍为 2 |
| invalid-list-value | bool 插入/替换产生 undefined 项，length=1，读项与整表转字符串均为 `""`；底层 JSON 为 `[null]` |
| frames | 两次 wait 跨帧后云标量/列表保留会话状态，后续增减/清表生效 |

这里的夹具为 K4 原生 `.bcm`，没有生成或修改 `.bcmkn`。`tools/editor-compat.mjs`
面向另一种 `.bcmkn` 编辑器契约，不作为 K4 `.bcm` 验证器；K4 夹具通过官方 JSONEntityCompiler
和 runOracle 执行验证。未把错误格式的编辑器调用当成功证据。

## 本轮实现修复

云专属模块 `src/engine/cloud.rs`：

- JS 增加先把数组/对象转 primitive，再判断字符串连接；修复 `12 + ["a","b"]`
  从 NaN 变成 `"12a,b"`。同时正确处理 JS null 的连接文本，不改 VM 公共加法。
- 云减少的数组输入使用 JS 数值转换（通过数组字符串），不把一切数组无条件当 NaN。
- 原值对象与列表一样，不允许 `change_cloud_variable` 操作；保持官方 object guard。

主会话另集成了下述公共层修复，并执行完整云专项回归。

## 公共层已修复的三个缺口

以下三个缺口在初始 oracle 对比时复现，现已修复、移除 known-gap ignore，
7 个专项测试全部实际运行默认 JIT 与禁用 JIT，通过；不是依靠忽略测试取得绿色结果。

1. **cloud_lists_get 丢 ID**：`src/kitten4.rs::cloud_list`（原约 459 行）无区别地给所有 reporter
   合成 `inputs.VAR`。当 native 为 `lists_get` 时，其 translate 要求 `fields.VAR`，此时已被删除，
   最终编译报 `unknown list ""`。现已在 helper 开头判断 native == `lists_get`，直接输出
   `pure_list_get`、`fields.list = 原 VAR` 并 return；不要走普通列表操作的 input 适配。
   对应 `list_get_matches_offline_oracle_in_both_modes`。
2. **索引类型丢失**：`ValueExpr::CloudItem` 当前是 `Option<Expr>`，编译 `self.arg`、执行 `eval`；
   `Op::CloudList` 同样。提前数值化让 `"2"`/bool 变成合法索引。
   现已让 cloud-only 索引使用 `Option<usize>` typed value 索引（编译 `self.value`、执行 `eval_value`），
   有值时仅 `Cell::Number(n)` 且 n finite > 0 可继续；其余忽略/读 `""`。
   `None` 继续保留 last/all 等语义。需要同步 `src/engine/value.rs`、深 value 依赖遍历
   （原 `ValueExpr::Item | CloudItem` 联合处理）与 cloud_list 参数类型；不要改变普通列表索引规则。
   对应 `typed_indices_match_offline_oracle_in_both_modes`。
3. **非法列表项**：云模块 `cloud_list` 校验失败现为 `Cell::Undefined`，不再用 `Number(NaN)`；
   同时 `CloudItem` 读项时把 `Undefined/Null` 映射为 `""`。
   对应 `invalid_list_values_match_offline_oracle_in_both_modes`。

## 回归状态和命令

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-cloud-2-fixtures.mjs --record
node --test tests/k4-partial-cloud-2.test.mjs

# 由主会话统一执行；不要与其他 Cargo 并发
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:CARGO_BUILD_JOBS='1'
cargo test --test kitten4_partial_cloud_2 -- --nocapture
cargo test --test kitten4_cloud
```

- JS 专项 2/2 通过，包含夹具重新生成一致性、56 帧证据完整性及网络拦截、关键语义断言。
- Rust 测试每个 case 都循环默认 JIT 与 `disable_jit()`。
  早期基线已实际运行：frames 两种模式通过；其他早期夹具因 cloud_lists_get 丢 ID 编译失败。
  最终 change/limits/list 已移除 getter 依赖，把 getter 单独保留为 known-gap。
  **最终版已由主会话统一执行**：`kitten4_partial_cloud_2` 为 `7 passed; 0 failed; 0 ignored`，
  `kitten4_cloud` 为 `11 passed; 0 failed; 0 ignored`。
- 全量测试结果见本 worktree 未提交的 `OC-REPORT.md`。

## 不声称完整的边界

匿名离线结果不验证在线服务端值、登录身份、权限、增量协议、限速/队列、跨客户端并发、
断线/超时/重连、排行榜内容与 UI。没有移除任何 partial 标记。
UTF-16 完整 emoji 上限已验证，切断代理对生成孤立 surrogate 仍未验证。
底层云列表的 undefined 项在可选本地文件后端的 JSON null 持久化协议中不能区分 NaN；
该明确选择的模拟后端不属于官方匿名离线行为等价声明。
