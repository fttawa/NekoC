# KN convert_type 局部语义削减：循环列表与对象

## 状态

**仍保留部分语义，不提升为完整实现。** 本轮完成官方原生项目实测、编辑器兼容检查和两项针对性修复；主会话已运行 Rust 全量门禁，新增3项转换回归全部通过。使用本worktree构建的 `target/debug/kn-trace.exe` 实际配对，三个工程 `equal: true`、双方 `done: 1`，归档 `nativeDifferentialVerified: true`。配对记录包含 UTC 时间、二进制路径及 SHA-256；不宣称其余对象模型已完整支持。

## 官方证据

- 证据：[kn-partial-conversion.json](kn-partial-conversion.json)。匿名在线编辑器 **0.27.4**，Edge 157.0.4341.42；时间使用工具实际记录的 UTC，不手工调整。
- 独立工具 `tools/compat/kn-partial-conversion-probe.mjs` **import 并实际调用** `tools/semantics-kitten-n.mjs` 导出的 `probe`，不修改原工具、不替换官方转换函数。
- 3 个原创、无外部素材的原生项目，共 **51 个 number/string/boolean 转换结果**，3 个 `done` 均为 1，官方运行 `pageErrors` 均为空。
- 同一官方页面另外直接调用未改动的注册域函数，**15 种输入 × 3 个目标 = 45 次**，含预期抛错；调用函数体与第三方运行时代码均未入库。
- 3 个项目的 `editor-compat` 均 `ok: true`、`issues: []`、`pageErrors: []`，检查的项目 SHA-256 与运行证据一致。总计 302 个积木。
- 官方主包 `main.8ccf2442.js` SHA-256：`58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`；runtime 包 `crc_libs.8196dbd1.js` SHA-256：`462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7`。

| 输入 | number 结果（注明类型） | string 结果 | boolean |
| --- | --- | --- | --- |
| 自引用 `[self]` | 数字 0 | 空文本 | true |
| `[1, self]` | 文本 `1,` | `1,` | true |
| 互引用 `a=[1,b]; b=[2,a]`，转换 a | 文本 `1,2,` | `1,2,` | true |
| 共享但不循环 `[[7], sameChild]` | 文本 `7,7` | `7,7` | true |
| 普通对象自引用属性 | 文本 `[object Object]` | `[object Object]` | true |
| 包含循环对象的列表 | 文本 `[object Object]` | `[object Object]` | true |
| 普通对象自有非函数 valueOf / constructor | 文本 `[object Object]` | `[object Object]` | true |
| 127 / 128 / 129 / 256 层 `[...[7]...]` | 数字 7 | `7` | true |
| `[null, undefined]` | 文本 `,` | `,` | true |
| `[[null]]` | 数字 0 | 空文本 | true |
| `["NaN"]` / `[numeric NaN]` | **文本** `NaN` | `NaN` | true |
| 空对象 / 含普通 toJSON、valueOf 数据属性的对象 | 文本 `[object Object]` | `[object Object]` | true |
| 自有非函数 toString（直接对象 / 列表内对象，局部调用） | 抛 TypeError | 抛 TypeError | true |
| 自有非函数 toString 与 valueOf（局部调用） | 抛 TypeError | 抛 TypeError | true |
| 自有可调用 valueOf 返回 17（仅局部调用） | 数字 17 | `[object Object]` | true |

## 修复范围

1. `src/engine/kn_conversion.rs` 新增 KN 转换专用显式工作栈及活动路径集合。取消通用显示的 128 层截断，保留循环边为空、兄弟共享引用重复输出的规则。**不修改通用 `Cell::text()`、K4 或 JSON 字符串化**。
2. 普通对象存在自有 `toString` 数据属性时，KN number/string 转换不再伪装成功返回 `[object Object]`，而是经现有 `value_error` 通道报告 `TypeError: Cannot convert object to primitive value`。本地 `Cell` 对象只保存数据，不具备 JS 可调用属性模型；不假装实现可调用 valueOf。
3. `src/engine.rs` 仅将 KN 转换调用转接到 `self.eval_kn_conversion(v, number)`。boolean 仍走原有 truthiness，不执行对象字符串化。
4. `tests/kn_partial_conversion.rs` 覆盖三套完整项目的 **51 个类型和值**，JIT 开/关两种配置；另测自有非函数 toString 的错误及 boolean 不触发字符串化。没有声称 JIT 开启即所有转换都已进入 native 机器码。
5. 修复深列表 fixture 的运行窗问题：原来的四个普通循环合计 640 次逐帧让出，`kn-trace` 仅执行 180 帧，因此仅完成 127 层用例及下一轮 53 次循环，`done` 仍为 0，后续结果是初始化值 0。不是深度 128 的数字解析失败；列表 number 转换已经使用 `parse(&text)`。现将四段构造循环分别置于官方 `warp`，重新取得官方观测与 editor-compat，通过现有二进制实测三项配对全真，不修改转换源码或延长通用 trace 运行窗。
6. `tests/kn-partial-conversion.test.mjs` 验证 **51 个具体类型/值**、**45 个局部调用的完整 15×3 矩阵（含错误）**、确定性 fixture 字节与 hash、三项逐一匹配的 editorCompat、配对变量及二进制来源记录，并测试归档拒绝伪成功、缺项、陈旧哈希和不匹配编辑器记录。`node --test tests/kn-partial-conversion.test.mjs` **3 项全部通过**。

## 复现与主会话门禁

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
# 官方运行；主会话已有新构建时加 --nekoc <kn-trace.exe 路径>
node tools/compat/kn-partial-conversion-probe.mjs --out dist/kn-partial-conversion/report.json
node tools/editor-compat.mjs tests/fixtures/kn-partial-conversion/graphs.bcmkn tests/fixtures/kn-partial-conversion/deep.bcmkn tests/fixtures/kn-partial-conversion/values.bcmkn --channel msedge --out dist/kn-partial-conversion/editor-compat.json
node tools/compat/kn-partial-conversion-probe.mjs --archive dist/kn-partial-conversion/report.json --editor-check dist/kn-partial-conversion/editor-compat.json

# 不重复启动官方页面，给已归档的官方观测补新二进制配对结果
node tools/compat/kn-partial-conversion-probe.mjs --compare docs/kn-partial-conversion.json --nekoc target/debug/kn-trace.exe --out dist/kn-partial-conversion/paired.json --archive
# --archive 仅在全部匹配且工程/hash/editorCompat验证通过后更新 docs；沿用已归档 editorCompat，也可传 --editor-check 替换
node --test tests/kn-partial-conversion.test.mjs

# 仅由主会话统一执行，不运行 Cargo 全量
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo test --test kn_partial_conversion --test kn_conversion
```

## 未验证边界

- 三套原生工程配对差分和Rust回归均已通过；最终全量门禁摘要见未提交的`OC-REPORT.md`。配对与Cargo测试仍是不同证据。
- 错误输入仅完成官方局部域调用与本地回归用例编写，未完成原生工程错误 UI/线程停止行为差分；本地报告错误不等于复现官方警告 UI。
- 自定义可调用 valueOf/toString、Symbol.toPrimitive、原型链、getter/setter、Proxy、稀疏数组、数组 expando 属性、宿主对象均没有完整模型。局部观测到 callable valueOf 返回数字，不代表本地支持。
- 官方运行管线会对某些 null 参数/变量赋值进行规范化；本轮不据有歧义的 null 单值工程作更广承诺。已有 63 次局部调用的 null 转换证据与回归继续保留。
- 孤立 UTF-16 代理项仍未验证；大于 256 层的官方极限、内存/栈极限也未验证。移除本地 128 层截断不是承诺无限深。
- `convert_type` 的 number/string/boolean 目标不等同当前面板所有选项审计。本轮没有更改覆盖状态生成器或删除剩余部分语义说明。
