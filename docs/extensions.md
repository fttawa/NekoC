# 自定义积木扩展 API v1

这是 **NekoC 自有接口**，不是 Kitten N / Kitten 4 官方扩展格式。作品只携带调用数据，
不能自动载入 Rust 动态库、URL、JS 文本或授予网络权限。默认注册表为空，不改变已有作品行为。
本实现没有移植 HateNeko；下述约定是本项目设计，不声称官方一致。

## 最小契约

每个 opcode 单独注册一个 `BlockSchema`，版本固定为 `api_version: 1`：

```json
{
  "api_version": 1,
  "opcode": "example.json.parse",
  "parameters": [{"name": "text", "value_type": "string"}],
  "returns": "any",
  "blocking": true,
  "network": false
}
```

- opcode 必须带命名空间（含 `.`），只含 ASCII 字母、数字、`._-`，最长 128 字节。
  不覆盖内置积木。重复注册报错，不采用“最后一个获胜”。
- 参数按 schema 顺序传递，按名字从积木 `inputs` 读取；不能缺少或多传。
  最多 32 个参数，名字唯一。编译检查参数结构，运行时严格检查值，不隐式转型。
- 类型：`number`（有限数）、`string`、`boolean`、`list`、`any`。
  `any` 是上述类型加 null；列表可以嵌套。**不支持对象、undefined、NaN/Infinity、循环列表**。
  JSON null 是真实值，不是字符串。值最多 32 层、每列表最多 4096 项、单值 JSON 最多 64 KiB；
  VM 参数转换另有每次调用 64 KiB 工作量预算，防止循环或膨胀列表失控。
- `returns: null` 表示命令，只能返回 JSON null；其余表示返回值类型。
- v1 扩展是命令积木，不是嵌套 reporter。返回值可写入显式声明的全局变量，或忽略。
  不支持直接写角色私有变量/局部变量。先调用，再用普通变量积木读取结果。
  这让同步、异步和 JS 桥接共用一个契约，不会在表达式重试时重复副作用。

作品调用数据示例（规范 KN 树；宿主负责把它接到事件脚本链）：

```json
{
  "id": "parse-1",
  "type": "nekoc_extension_call",
  "fields": {"opcode": "example.json.parse", "result": "existing-global-variable-id"},
  "inputs": {"text": {"type": "text", "fields": {"TEXT": "[1,true,\"猫\",null]"}}}
}
```

省略 `fields.result` 或设空字符串即忽略返回值。不接受不存在的变量 ID；命令不能指定结果变量。
未注册 opcode、缺参数、未知返回目标均编译失败，不静默 no-op。
编辑器没有自动生成扩展积木面板，第三方宿主目前须自行提供 UI 或构造调用树。

## Rust 注册

```rust
use std::rc::Rc;
use nekoc::{engine::{Engine, Program}, extensions::{ExtensionRegistry, JsonParse}};
fn run(project: &serde_json::Value) -> anyhow::Result<()> {
let mut registry = ExtensionRegistry::new();
registry.register(JsonParse::schema(false), Rc::new(JsonParse))?;
let program = Program::compile_with_extensions(project, &registry)?;
let mut engine = Engine::new(program);
engine.start();
Ok(())
}
```

自定义实现 `Extension: Debug` 的 `call(&self, &ExtensionRequest) -> anyhow::Result<CallResult>`：

- `Ready(serde_json::Value)`：立即返回，VM 验证返回类型再写变量。
- `Pending`：仅 `blocking: true` 允许。宿主保存 request ID，通过
  `engine.complete_extension(id, Ok(value))` / `Err(String)` 结束调用。
  不要在 `call` 里做阻塞 I/O；可通过宿主队列启动工作，在 VM 所在线程交付完成值。
- 实例经 `Rc` 共享，方法用 `&self`，需要内部状态可用 `RefCell`；不要求 Send/Sync，
  不提供 VM 裸指针或让插件直接修改引擎。注册表在编译时快照化，后续注册不会改变已有 Program。
- `ExtensionRequest` 包含 `id/opcode/arguments/actor`，参数是与 VM 列表脱离的 JSON 数据。
- 实现返回错误、返回类型错误、nonblocking 返回 Pending，均作为显式运行错误传播。
  Rust 宿主收到错误应中止运行；接口不会吞掉错误或擅自写默认值。不捕获插件 panic。

`JsonParse` 示例无需网络，解析 JSON 标量和数组，包含对象的输入显式报错。
默认并不自动启用示例；上面的注册动作就是 opt-in。

## Web / JavaScript 注册

Web 播放器是 JS 渲染 + Rust VM，不是 JS 解释器。注册可信 JS 处理器，
schema 随私有播放器的握手发送给 VM，调用及返回通过现有逐帧 WebSocket 传递。

```js
import {ExtensionRegistry, registerJsonParse} from './extensions.js';
import {PlayerConnection} from './player.js';

const registry = registerJsonParse(new ExtensionRegistry());
registry.register({
  api_version: 1, opcode: 'demo.double',
  parameters: [{name: 'n', value_type: 'number'}],
  returns: 'number', blocking: true, network: false,
}, async ([n], {id, actor, signal}) => {
  if (signal.aborted) throw Error('cancelled');
  return n * 2;
});
const player = new PlayerConnection(registry);
await player.open(canonicalProject); // 必须传项目快照，使用 /api/player-private
// 按现有播放器方式持续 player.frame({dt, events, ...})，不要另开完成请求。
```

注册 `playerExtensions` 导出的默认注册表可让捆绑的 `play.js` / `app.js` 使用同一注册：
宿主模块在载入播放器入口之前执行 `registerJsonParse(playerExtensions)` 即可。
`play.js` 会用 `/api/extension-check` 按宿主 schema 检查扩展作品，再连接私有 VM；
普通 `/api/import-player` 的无注册表诊断仍会把这些积木标为不支持，这是预期的安全默认值。
CLI 默认 `Program::compile` 同样不会隐式启用扩展。

JS 处理器可返回值或 Promise；Web schema **必须 blocking=true**，因为桥接至少跨一帧。
JS 与 Rust 都校验参数和结果。错误作为 `extension_result.error` 送回，服务器返回运行错误并关闭连接。
结果在 Promise 完成时深拷贝，避免宿主随后修改返回数组造成竞态。

帧 metadata 中非空时附带：

```json
{"extension_requests":[{"id":1,"opcode":"demo.double","arguments":[2],"actor":"actor-id"}]}
```

下一帧 `events` 追加 `{"kind":"extension_result","id":1,"value":4}`，或 `error` 字符串。
VM 每帧重发仍等待的请求；JS 会按 ID 去重，不重复调用处理器；每次最多 256 个 pending。
连接关闭或请求不再存在时发送 AbortSignal。处理器须主动响应取消；不强杀 JS 代码。
调用永不完成会一直挂起该脚本；v1 不自带超时，宿主应给外部操作设超时。

## 阻塞、生命周期与 JIT 回退

- nonblocking + Ready：同一 scheduler tick 继续后续积木。
- blocking + Ready：先写结果，再让出当前脚本本 tick；下一 tick 继续。
- blocking + Pending：只挂起调用脚本，其他脚本继续；完成值验证后解除其 pending，
  在后续调度时继续。不会忙等或重新执行调用。
- 任务停止/删除或重启后旧完成 ID 无效；重复完成返回 `Ok(false)`。
  请求 ID 跨 `Engine::start` 单调递增，避免旧 Promise 的结果污染新任务。
- 不支持从 reporter procedure 中执行扩展命令，运行时显式拒绝，避免同步求值中产生异步悬挂。
- **凡已编译的 Program 指令包含扩展调用，整体关闭 JIT**。这包括未执行的分支/已引用过程；
  未引用过程与其他内置积木一样不会编译或验证，因而不会触发回退。采用保守策略，
  不让插件持有的回调或异步操作进入 native region。普通无扩展作品保持原 JIT 路径。
  首版不支持插件注入 Cranelift IR；稳定性优先于扩展程序的极限性能。

## 安全边界与未验证范围

注册表是宿主允许列表，不是执行不可信代码的沙箱。默认网络 capability 关闭；Rust 宿主可在注册前
调用 `set_allow_network(true)` 明确开启。Web API 不提供项目可控制的网络开关，拒绝 `network:true`。
**可信 Rust trait/JS 函数本身仍能访问宿主权限（如 std::net/fetch）**，声明不等于 OS 隔离。
需要运行不可信插件时，应在独立进程/Worker 中实施真正的网络和资源隔离；v1 未提供这种沙箱。

未验证：官方播放器如何处理这些 NekoC 私有积木（本接口不承诺官方可运行）、第三方编辑器保存/往返、
动态库 ABI、跨进程插件、浏览器真实网络插件、Android/desktop 特性构建。
不修改官方 KN/K4 编译器来“猜测”官方扩展行为。没有使用 HateNeko 实现或语料作为官方证据。

## 回归入口

- `cargo test --test extensions`：Rust trait、schema、示例、阻塞、严格类型、异步完成、重启去重、默认编译/JIT 回退。
- `cargo test --test web_kitten4 extension_schema_handshake`：真实本地服务和 WebSocket 的 JS 桥协议。
- `node --test tests/extensions.test.mjs`：JS 注册/Promise/取消/错误/PlayerConnection 完成消息。
- 完整检查见仓库通用工作约定。
