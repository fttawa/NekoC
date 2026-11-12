# KN partial2：convert_type 与四项 timer 主路径

## 范围与结论

本专项只验证 `convert_type`、`setTimeout`、`setInterval`、`clearTimeout`、`clearInterval` 的明确主路径，**不是完整兼容认证**。没有复制官方或第三方源码，timer/转换的本地语义实现无需修改；全任务的属性getter修复、覆盖工具与分类更新见 [kn-partial2.md](kn-partial2.md)。

Timer 的重要契约不变：**官方 KN 0.27.4 原生编译丢弃 callback statement**。NekoC 不应按 JavaScript 常识执行可见 C 槽；真实 JS function 的局部 domain 调用可执行，与原生工程是两种证据。

## convert_type：复用已有证据与回归

- 常用 `number` / `string` / `boolean` 目标、数字/文本/布尔输入：复用 [kn-conversion.md](kn-conversion.md) 的 63 次带类型官方 domain 调用与 `tests/kn_conversion.rs`；现有 [kn-semantics-official.json](kn-semantics-official.json) 另有原生 conversion / conversion-boolean 工程证据。
- 空值：domain 观察 `null → 0 / "null" / false`，`undefined → "undefined" / "undefined" / false`。**这不是原生 null 赋值管线的普遍承诺**；官方参数/变量的 null 规范化须和域函数结果分开。
- 普通列表与对象：空列表、单元素/嵌套列表、多元素列表、空对象、普通对象复用上述 63 次证据；[kn-partial-conversion.md](kn-partial-conversion.md) 和 [kn-partial-conversion.json](kn-partial-conversion.json) 提供三套原生工程的 51 个类型和值配对及 editor-compat，含列表/对象/空值组合。
- `tests/kn_conversion.rs`、`tests/kn_partial_conversion.rs` 已分别覆盖 JIT 开/关。开启 JIT 不表示每个新分支都执行了 native 机器码。本轮不重复采集罕见转换边界。
- 未验证：可调用对象属性、Symbol.toPrimitive、原型链、getter/setter、Proxy、宿主对象、稀疏数组、孤立 UTF-16 代理项、原生错误 UI/线程停止差分；既有深度/循环观察不能推广成无限对象模型。

## Timer 原生工程与局部调用

工具：`tools/compat/kn-partial2-timers-probe.mjs`，复用并实际调用共享 `probe`；归档：`docs/kn-partial2-timers-official.json`。

| 证据 | 主路径 | 不代表什么 |
| --- | --- | --- |
| `partial2-timers-main.bcmkn` | timeout/interval 各测 0、20、150 毫秒及文本变量 `"25"`；脚本立即继续，等待后 done=1，callback_hits=0 | 不证明 JS function/闭包受支持，不承诺逐毫秒一致 |
| `partial2-timers-clear.bcmkn` | 两种注册及两种 clear；clear 精确输入名 `timeoutId` / `intervalId`，数值 0、缺失句柄 999999999、文本变量句柄不阻断后续脚本 | 原生 timer 无 output，工程没有捕获有效 browser ID；不能据此声称有效取消已由原生工程直接证明 |
| 第二次原生 Start 的被动观察 | 四项注册域函数均调用原函数、透传参数/返回；set 只有 delay 参数，无 callback；clear 参数与返回单独记录 | 不改原函数体，不把观测包装当无插桩的首次配对；首次共享 probe 独立取得工程变量 |
| 真实 function 的局部 domain 调用 | timeout 单次、interval 重复；clear 后计数稳定；2×2 注册/clear 组合使用真正返回的 browser ID，均取消未派发工作 | 本地没有通用 JS callable Cell 模型；不作为其实现证据 |
| 非函数 callback 的局部调用 | timeout/interval 的文本 callback 不作为代码执行 | 不扩展为任意 JS 对象/异常/闭包契约 |

原生项目始终经官方在线编辑器 0.27.4 加载与 Start。首次运行全部变量与本 worktree `kn-trace.exe` 比较，绑定项目 SHA-256、二进制 SHA-256、官方主包/runtime SHA-256、真实 UTC 时间、浏览器版本。另有逐项目、同 hash 的 `editor-compat ok`（41 + 29 = 70 块）。归档验证拒绝缺项、伪成功、过期 fixture/editor hash、配对不一致与 callback 契约改变。

实际归档时间为 `2026-11-11T18:34:52.448Z`，Edge `157.0.4341.46`；两项 `equal: true`、双方 `done: 1`，运行与 editor-compat 的 `pageErrors` 均为空。第二次 Start 共记录 16 次原生调用，所有 set 的 callback 类型均为 undefined。局部实测 timeout 触发 1 次，interval 清理前后为 8→8；四个有效句柄取消组合触发均为 0，两个文本 callback 均未执行。计数 8 是本次观察，不是应固定的计时断言。

## 回归及复现

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo build --bin kn-trace
node tools/compat/kn-partial2-timers-probe.mjs --generate
New-Item -ItemType Directory -Path dist/kn-partial2-timers -Force
node tools/editor-compat.mjs tests/fixtures/kn-semantics/partial2-timers-main.bcmkn tests/fixtures/kn-semantics/partial2-timers-clear.bcmkn --channel msedge --out dist/kn-partial2-timers/editor-compat.json
node tools/compat/kn-partial2-timers-probe.mjs --out dist/kn-partial2-timers/report.json
node tools/compat/kn-partial2-timers-probe.mjs --archive dist/kn-partial2-timers/report.json --editor-check dist/kn-partial2-timers/editor-compat.json
node --test tests/kn-partial2-timers.test.mjs tests/kn-conversion.test.mjs tests/kn-partial-conversion.test.mjs
cargo test --test kn_partial2_timers --test kn_async --test kn_conversion --test kn_partial_conversion
```

新增 Rust 测试在 JIT 开/关下核验两套完整工程全部变量、完成标志、被丢弃 callback、最终 interval 数；另用 VM 自己的有效句柄验证 2×2 注册/clear，数字和文本 ID。**该 VM 内部 ID 不与 browser ID 数值相等**。已有 `tests/kn_async.rs` 继续覆盖只求值一次、热循环、stop/restart、资源上限与畸形输入。

本轮实跑上述四套 Rust 测试 **12 项全通过**（新增 2、既有 timer 5、转换 2+3）。共享默认 target 曾因其他进程占用 `nekoc.exe` 导致构建失败；没有清理或终止该进程，改在本 worktree 的 `target/partial2-timers-validation` 完成同一命令。三套 Node 测试 **7 通过、1 可选项跳过、0 失败**；跳过项只在保留官方原始源码字节时额外检查锚点，不影响已归档 typed observation/hash 验证。没有运行全仓门禁、没有提交。

## 未验证边界

- timer ID 的具体数值、浏览器最小延迟、后台节流、真实墙钟精度、逐帧/逐 macrotask 顺序不做等价承诺；interval 次数仅检查重复与 clear 后稳定，不固定次数。
- 原生 timer 没有 output，无法以正常连线捕获有效 ID。本轮有效句柄取消是官方局部域调用 + 本地有效句柄回归，不伪装成完整原生有效取消差分。
- 通用 JS function 值/闭包、捕获、异常/重入、timer callback 内再注册/取消、clone/actor/scene 生命周期均未验证完整兼容。
- VM 每 tick 至多一次 interval、不追赶、4096 上限、stop/restart 清理和句柄分配是本地确定性/安全策略，不因本轮主路径通过就升级为官方完整等价。
- 只覆盖上述五项。本子任务不直接修改覆盖工具；主代理按本轮主路径 scope 将五项升级为“有执行路径／未完整验证”，并纳入 [本轮总范围](kn-partial2.md) 的本地 8 项升级。所有上述未验证边界继续保留，状态升级不表示完整兼容。

原创 fixture 按仓库 `.gitattributes` 的 `tests/fixtures/kn-semantics/partial2-*.bcmkn text eol=lf` 保持 LF；运行证据和 editor-compat 的 SHA-256 始终核验精确字节，不归一化夹具来掩盖过期证据。正文说明文档不作精确字节断言，主范围生成文档的比较由主代理按 CRLF/LF 归一化处理。
