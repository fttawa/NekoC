# 自定义积木扩展 API v2（向后兼容 v1）

这是 **NekoC 自有接口**，不是 Kitten N / Kitten 4 官方扩展格式。作品只携带调用数据，
不能自动载入 Rust 动态库、URL、JS 文本或授予网络权限。默认注册表为空，不改变已有作品行为。
本实现没有移植 HateNeko；下述约定是本项目设计，不声称官方私有积木兼容。

## Schema 与版本协商

`API_VERSION = 2`，`SUPPORTED_API_VERSIONS = [2, 1]`；v1 命令契约继续有效。
每个 opcode 单独注册一个 `BlockSchema`，v2 示例：

```json
{
  "api_version": 2,
  "opcode": "demo.double",
  "kind": "reporter",
  "metadata": {"name": "翻倍", "category": "示例"},
  "parameters": [{"name": "n", "value_type": "number"}],
  "returns": "number",
  "blocking": true,
  "network": false
}
```

- `kind` 可选，省略按 `command` 处理；v2 可选值为 `command/reporter/boolean/hat`。
  `metadata` 也可省略；提供时必须包含非空 `name/category`，各最多 128 UTF-8 字节。
  v1 不接受这两个 v2 字段，不会把 v2 schema 自动改写为 v1。
- `parameters` 保持原有 `{name, value_type}` 结构，不增加参数级 metadata。
  参数按 schema 顺序传递，按名字从积木 `inputs` 读取；不能缺少或多传。
  最多 32 个参数，名字非空、唯一且最多 64 字节。编译检查结构，运行时严格检查值，不隐式转型。
- opcode 必须带命名空间（含 `.`），只含 ASCII 字母、数字、`._-`，最长 128 字节。
  不覆盖内置积木；重复注册报错，最多注册 256 个积木。
- 类型为 `number`（有限数）、`string`、`boolean`、`list`、`any`。
  `any` 是上述类型加 null；列表可以嵌套。**不支持对象、undefined、NaN/Infinity、循环列表**。
  JSON null 是真实值，不是字符串。值最多 32 层、每列表最多 4096 项、单值 JSON 最多 64 KiB；
  VM 参数转换另有每次调用 64 KiB 工作量预算。
- `command` 可声明返回类型，或用 `returns: null` 表示只返回 JSON null；
  `reporter` 必须声明返回类型，`boolean` 必须 `returns: "boolean"`。
  `hat` 必须无参数、`returns: null`、`blocking: false`，不注册调用 handler。

Rust `negotiate_version` 与 JS `negotiateVersion` 选择**最高共同版本**，无交集即报错。
Web 私有播放器保留 `nekoc_extension_handshake: 1` 封套（不是把封套版本改为 2）：

```json
{"nekoc_extension_handshake":1,"extension_api_versions":[2,1],"extensions":[],"project":{}}
```

服务端缺省版本列表按 `[1]` 处理，ready 消息以 `extension_api_version` 返回协商结果。
schema 的版本不得高于协商版本；包含 v2 schema 时不会静默降级。`PlayerConnection` 有 v2
schema 时发送 `[2,1]` 并要求 ready 确认 v2；纯 v1 注册保留原握手路径。

## 作品调用与异步表达式

v1/v2 命令继续使用 `nekoc_extension_call`：

```json
{
  "id": "parse-1",
  "type": "nekoc_extension_call",
  "fields": {"opcode": "example.json.parse", "result": "existing-global-variable-id"},
  "inputs": {"text": {"type": "text", "fields": {"TEXT": "[1,true,\"猫\",null]"}}}
}
```

省略 `fields.result` 或设空字符串即忽略返回值。显式结果目标只接受已声明的全局变量 ID，
不提供任意角色私有/用户局部变量写入；`returns: null` 的命令不能指定结果目标。
未注册 opcode、缺参数、未知结果目标均编译失败，不静默 no-op。

v2 reporter / Boolean 的 canonical type 分别为 `nekoc_extension_reporter` /
`nekoc_extension_boolean`，使用 `fields.opcode` 与按 schema 命名的 `inputs`，不指定 `result`。
编译器通过**异步 lowering** 把调用拆为 `Op::Extension` 和任务局部结果读取，不是同步重试整个表达式。
嵌套表达式按原求值顺序保存同级操作数；后续操作数挂起、修改变量或带副作用时，不会重读之前的值，
也不会重复调用先前的 reporter。Rust handler 可返回 Ready/Pending；JS 远程调用必须 blocking。
**仍不支持 reporter procedure 内执行扩展调用**，命令或嵌套 reporter 均不能绕过该限制。

## Hat 与宿主事件

hat 的 canonical 数据为 `{"type":"nekoc_extension_hat","fields":{"opcode":"demo.event"},...}`；
脚本体接 `next` 或 `statements.DO`（存在对象形式的 `DO` 时优先）。hat 自身无 inputs。

- Rust 用 `registry.register_hat(hat_schema)` 注册，无 handler。
- `Engine::emit_extension_event(opcode, payload: serde_json::Value) -> Result<usize>`
  验证已注册的 hat 与 payload，返回排队的接收任务数；不在调用内部执行脚本。
- 只投递当前 active scene 的匹配脚本，包含该角色的现存克隆；每个接收任务取得脱离宿主数据的 payload，
  通过 `self_listen_value` 读取。引擎已停止时返回 0。
- 投递前检查现有任务加接收任务不超过 **4096**，超出报错，不无限创建任务。
- JS 用 `registry.register(hatSchema)`，不能传 handler；`player.emitExtension(opcode, value)`
  排队事件，随下一次 `frame()` 的 `events` 发送 `{"kind":"extension_event","opcode":"demo.event","value":null}`。

## Rust 注册与调用策略

```rust
use std::rc::Rc;
use nekoc::{
    engine::{Engine, Program},
    extensions::{CallPolicy, ErrorPolicy, ExtensionRegistry, JsonParse},
};
fn run(project: &serde_json::Value) -> anyhow::Result<()> {
    let mut registry = ExtensionRegistry::new();
    registry.set_call_policy(CallPolicy {
        errors: ErrorPolicy::Report,
        ..Default::default()
    })?;
    registry.register(JsonParse::schema(false), Rc::new(JsonParse))?;
    let program = Program::compile_with_extensions(project, &registry)?;
    let mut engine = Engine::new(program);
    engine.start();
    Ok(())
}
```

自定义实现 `Extension: Debug` 的 `call(&self, &ExtensionRequest) -> anyhow::Result<CallResult>`：

- `Ready(serde_json::Value)`：立即返回，VM 验证结果类型，再写入全局目标或编译器生成的任务局部值。
- `Pending`：仅 `blocking: true` 允许。宿主保存 request ID，通过
  `engine.complete_extension(id, Ok(value))` / `Err(String)` 结束调用。
  不要在 `call` 里做阻塞 I/O；应由宿主队列启动工作，在 VM 所在线程交付结果。
- 实例经 `Rc` 共享，方法用 `&self`，状态可用 `RefCell`；不要求 Send/Sync，
  不提供 VM 裸指针。注册表及调用策略在编译时快照化，后续注册不会改变已有 Program。
- `ExtensionRequest` 包含 `id/opcode/arguments/actor`，参数是与 VM 列表脱离的 JSON 数据。

`CallPolicy` 是宿主策略，不是作品 schema 字段；`timeout` 默认 **1 秒**，允许 **1 毫秒至 60 秒**。
`errors` 的行为：

| `ErrorPolicy` | 调用失败后的行为 |
|---|---|
| `Propagate`（默认） | 将错误传播给宿主，保留 v1 fail-fast 行为 |
| `Report` | 记录引擎 logs，仅结束调用任务，其他任务继续 |
| `DefaultValue` | 记录 logs，写入中性 typed result 后继续，并保留 blocking 调度边界 |

中性结果为 number `0`、string `""`、boolean `false`、list `[]`、any/null `null`；
扩展 reporter 的任务局部结果和传给下一个扩展的参数保留该类型。后续普通语言操作仍遵守宿主语义，
例如 KN 全局变量赋值/读取会将 null 归一化为数字 `0`，不因使用扩展改变既有变量规则。
不是把任意 VM 错误都吞掉。handler 错误、返回类型错误、nonblocking 返回 Pending 和调用超时等按策略处理。
同步 Rust 调用捕获 **unwind panic**，并在 handler 返回后检查耗时、拒绝超时结果；
**不能强杀始终不返回的函数，也不保证捕获 abort panic**。
Pending 使用 `Instant` 墙钟超时，即使设置 `virtual_clock` 也不是虚拟时间；
超时在引擎推进/清理或完成调用时检查，不是独立抢占线程。

`JsonParse` 示例仍是向后兼容的 v1 命令：无需网络，只解析 JSON 标量和数组，对象显式报错。
默认不自动启用，注册就是 opt-in。

## Web / JavaScript 注册与面板描述

Web 播放器是 JS 渲染 + Rust VM，不是 JS 解释器。可信 JS handler 由宿主注册，
schema 随私有播放器握手发给 VM，调用及返回通过现有逐帧 WebSocket 传递。

```js
import {ExtensionRegistry} from './extensions.js';
import {PlayerConnection} from './player.js';

const registry = new ExtensionRegistry({timeoutMs: 1000});
registry.register({
  api_version: 2, opcode: 'demo.double', kind: 'reporter',
  metadata: {name: '翻倍', category: '示例'},
  parameters: [{name: 'n', value_type: 'number'}],
  returns: 'number', blocking: true, network: false,
}, async ([n], {id, actor, signal}) => {
  if (signal.aborted) throw Error('cancelled');
  return n * 2;
});
registry.register({
  api_version: 2, opcode: 'demo.event', kind: 'hat',
  metadata: {name: '收到示例事件', category: '示例'},
  parameters: [], returns: null, blocking: false, network: false,
});
const palette = registry.palette(); // 面板描述，宿主自行接入 UI
const player = new PlayerConnection(registry);
await player.open(canonicalProject); // 项目快照，使用 /api/player-private
player.emitExtension('demo.event', '猫');
// 按现有播放器方式持续 player.frame({dt, events, ...})。
```

`registry.palette()` 按 metadata 自动生成分类及积木描述；无 metadata 时以 opcode 命名、以其命名空间分类，
v1 注册也可生成描述。**捆绑编辑器 UI 尚未自动接入这些描述**，不能把 palette API 说成已完成面板集成。
Rust `registry.schemas()` 同样可导出脱离注册表的 schema。

宿主可在载入播放器入口前注册导出的 `playerExtensions`，让捆绑 `play.js` / `app.js` 共享注册表。
`play.js` 使用 `/api/extension-check` 按宿主 schema 检查扩展作品；普通 `/api/import-player`
无注册表诊断仍把私有积木标为不支持，这是预期安全默认值。CLI 默认 `Program::compile` 同样不隐式启用扩展。

JS handler 可返回值或 Promise；远程 **command/reporter/boolean 都必须 `blocking: true`**，
hat 不发起调用而为 `blocking: false`。两端均验证参数和结果，结果在 Promise 完成时深拷贝。
错误以 `extension_result.error` 回传；Web 协商 v2 默认用 `Report`，调用错误不因此关闭连接，
v1 默认仍 `Propagate`，传播到服务器的运行错误保留关闭连接行为。握手/协议等错误不属于这种任务级隔离。

帧 metadata 非空时附带：

```json
{"extension_requests":[{"id":1,"opcode":"demo.double","arguments":[2],"actor":"actor-id"}]}
```

后续帧追加 `{"kind":"extension_result","id":1,"value":4}` 或 `error` 字符串。
VM 每帧重发仍等待的请求；JS 按 ID 去重，每次最多 256 个 pending。完成回包与 hat 事件共用帧事件队列，
超出该帧容量的扩展事件保序留待后续帧，不另开完成请求。
JS `timeoutMs` 默认 1000，允许整数 1..60000；timer 到期回报错误并触发 AbortSignal，
忽略迟到 Promise。连接关闭或请求不再存在也会取消。**timer 无法抢占同步 JS**，
异步外部工作是否真正停止仍依赖 handler 响应 signal；JS timer 与服务端墙钟检查是两道独立边界。

## 调度、生命周期与 JIT 边界

- nonblocking + Ready：同一 scheduler tick 继续后续积木。
- blocking + Ready：先写结果，再让出调用脚本本 tick；下一 tick 继续。
- blocking + Pending：只挂起调用脚本，其他脚本继续；完成值验证后解除 pending，
  在后续调度时继续，不忙等、不重新执行调用。
- 任务停止/删除或重启后旧完成 ID 无效；重复或迟到完成返回 `Ok(false)`。
  ID 跨 `Engine::start` 单调递增，防止旧 Promise 污染新任务。
- **不再因 Program 含扩展调用而整体关闭 JIT**。`Op::Extension` 作为 reentrant 尾部 helper
  经通用 `exec` 执行，随后退出 native region，不再读取可能失效的缓存指针。
  调度器保留 Ready 非 blocking、blocking、Pending 的续执行/让出语义和原有指令预算。
  其他指令仍可选择 JIT；这不是把 handler 编成机器码，也不是插件 IR 注入。
- 普通无扩展作品仍走原 JIT 路径；历史无扩展性能基线不因此变成 v2 插件作品的性能证明。

## 安全边界与未验证范围

注册表是宿主允许列表，capability **不是 OS 沙箱**。默认网络 capability 关闭；Rust 宿主可在注册前
调用 `set_allow_network(true)` 明确开启。Web 不提供项目可控制的网络开关，拒绝 `network: true`。
**可信 Rust trait/JS handler 本身仍能访问宿主权限（如 std::net/fetch）**；声明不等于隔离。
当前没有独立进程强抢占、稳定动态库 ABI 或插件 IR 注入。超时/取消/错误策略不能代替资源和权限沙箱。
需要运行不可信插件时，宿主仍须另行设计进程或 Worker 隔离及终止机制。

未验证：官方播放器对这些 NekoC 私有积木的兼容性、真实第三方编辑器保存/往返、
真实浏览器网络插件、desktop/Android 特性构建及 ARM 真机执行。
不修改官方 KN/K4 编译器来“猜测”官方扩展行为，未移植 HateNeko，也不以其实现作为官方证据。

## 回归入口与验收

- `cargo test --test extensions`：Rust schema、注册、类型、调用、调度和生命周期回归入口。
- `cargo test --test web_kitten4 extension_schema_handshake`：本地服务和真实 WebSocket 桥接入口。
- `node --test tests/extensions.test.mjs`：JS 注册、Promise、取消、错误与 PlayerConnection 消息入口。
- JIT 差分及补充 v2 用例以实际验收记录为准；**验收结果见 `OC-REPORT.md`**。
  本页说明当前契约与复核入口，不新增通过数量，也不把本地差分当官方或 ARM 真机认证。
