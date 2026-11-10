# KN 面板 AI：14 项官方行为与离线拒绝策略

## 交付结论与边界

官方 **KN 0.27.4** 已实测 14 个定义、19 次实际域函数调用，`ok=true`、零 page error。新增 `src/engine/kn_ai.rs` 实现 **显式离线＋匿名桌面 profile 的拒绝策略**，含 12 个命令的原因/参数求值/缓存影响，以及两个分类 reporter 的 typed NaN。它不是模型、识别、账户或聊天后端。

主会话已将策略通过 `kn_panel` 接入 VM。**必须显式调用 `Engine::set_kn_offline_anonymous(true)`**，默认不启用 AI 拒绝 profile；未启用时执行会报缺少 profile/backend，而不是静默成功。14 项均只能计“部分语义”，不是 AI 后端实现。`take_kn_panel_notices()` 暴露 offline/login/missing-model 拒绝原因；没有移植 HateNeko，也没有把它作为官方证据。

## 官方来源与可复现取证

- 编辑器：`https://kn.codemao.cn/editor`，新建匿名隔离无头 Edge。
- 原始 main：`https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`。
- SHA-256：`58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`。
- 跟踪元数据：`docs/kn-panel-ai-evidence.json`；原始 bundle/完整现场报告只在忽略目录 `dist/kn-panel-ai/`。
- 本轮聊天/认知/分类域 factory 为 main module **46501**；OCR 实际实现位于后部独立工具包 module **79812**，使用 adapter 注册到相同 registry。registry 函数的字符串是统一包装器，因此其 hash 相同并不意味着各域实现相同；独立源码定位才是函数体证据。
- `byteOffset` 为原始 UTF-8 **零基字节偏移**。JSON 记录每段 600 字符片段的 hash，不复制第三方函数体。

```powershell
$env:NEKOC_NODE_MODULES='<已有 playwright 的 node_modules 路径>'
node tools/compat/kn-panel-ai-probe.mjs --record
node --test tests/kn-panel-ai.test.mjs
rustc --edition 2024 --test tests/kn_panel_ai.rs -o dist/kn-panel-ai/kn-panel-ai-tests.exe
& dist/kn-panel-ai/kn-panel-ai-tests.exe
```

仅暴露 webpack loader，不替换官方函数。读取实际 workspace 块定义后，**封锁所有后续 HTTP 和 WebSocket，并 `context.setOffline(true)`**，再用官方 registry 的 args 对象调用。聊天/OCR 仅测离线、认知仅测匿名、分类分别测 `model_id="?"` 与原创非模型 ID；后者在联网检查处退出，绝不加载模型。arbitrary-data getter/setter 只加被动转发记录，并最终恢复。未使用账户、未拍照、未申请付费 AI、未模拟成功服务响应。原生作品的编译、调度和 UI 弹窗不属于这次直接域调用证据。

## 完整输入、返回和异步边界

全部 12 个命令均有 previous/next、无 output；实际调用返回 **Promise，完成值 undefined**。两个 reporter 也返回 Promise，不是同步纯缓存读取。动态下拉是 **fields**，不能误作 value socket。`sprite` 默认 `--self`、`model_id` 默认 `?`。下面的结果均为本次**匿名＋浏览器离线**条件。

| type | value sockets / fields | 官方结果及副作用 | main 字节位置 |
| --- | --- | --- | ---: |
| `ai_chat_ask` | value `text`，String shadow `limit_length_text` | 离线拒绝；写 `_ai_chat_answer_ = ""`；undefined | 1680805 |
| `new_conversation` | 无 | 离线拒绝；**不清空**回答、没有开始新对话；undefined | 1682653 |
| `set_system_preset` | value `text`，String shadow `multiline_text` | 离线拒绝；**不保存本地提示词**；undefined | 1681813 |
| `ai_text_actor` | field `sprite` | 先检查网络；写 `ai_text_result = Number(NaN)`；undefined | 5277509 |
| `ai_text_photo` | 无 | 同上，尚未走到摄像头；undefined | 5278928 |
| `enable_face_detect_by_actor` | field `sprite` | 先检查登录；不改已有 face 缓存；undefined | 1675077 |
| `enable_face_detect_by_photo` | 无 | 同上，尚未走到摄像头；undefined | 1676481 |
| `enable_object_detect_by_actor` | field `sprite` | 先检查登录；不改已有 object 缓存；undefined | 1678066 |
| `enable_object_detect_by_photo` | 无 | 同上，尚未走到摄像头；undefined | 1679438 |
| `evaluate_actor_style` | fields `model_id`, `sprite` | 支持设备检查后，`?` 报缺模型；其他 ID 离线拒绝；undefined | 1683759 |
| `evaluate_camera` | field `model_id` | 同上；未读取 camera frame/模型 | 1687942 |
| `evaluate_photo` | field `model_id` | 同上；未打开拍照/模型 | 1686279 |
| `get_evaluate_class_accuracy` | field `model_id`；可选 value `index` | 声明 Number；离线/缺模型为 **Number NaN** | 1691671 |
| `get_evaluate_class_name` | field `model_id`；可选 value `index` | 声明 String，但离线/缺模型为 **Number NaN**，不是空串 | 1689530 |

分类 reporter 初始构造没有 `index` socket；其 mutator（1362172）由 `mutation items="1"` 添加 `index`、Number shadow，约束 `1,,1`；删除该输入后域函数默认 index=1。定义位置 777174，官方转换器也会补此 mutation。不得强制所有裸 reporter 必有 index；也不得把输入表达式吞掉。任意 reporter/命令输入的参数求值发生在域调用前，因此就算下一步拒绝，`text` / 已存在的 `index` 中的副作用仍须执行且只执行一次。

### 有服务时的源码行为（仅源码，未调用）

1. **聊天共同 guard（1601837）**：检查 `navigator.onLine` → 登录 → `block_api` 授权/手机号。失败有 toast、可能停止运行/显示登录或绑定窗口。`set_system_preset` 不是纯本地配置，和 ask/new 一样先过 guard。
2. ask 默认文本 `你好`，preset 默认 `你是一个AI助手`；truthy 且不是正 Infinity 的参数 `String(...)` 后截 **400 UTF-16 code units**，空结果回退默认。ask 取得 thread lock，socket 回调释放锁、删除所有 CR/LF 后写回答。preset 调服务 `setSystemPreset`，new 调服务 `newConversation`。这些都未实现，不能把纯字符串转换称为已支持聊天。
3. **认知共同 guard（1607093）**：未登录先显示登录提示并返回 false，无网络判断。这就是本轮离线时仍标 `LoginRequired` 而非 `Offline` 的依据。已登录 actor 路径再校验 sprite/当前场景/target；不接受 Scene。静态图片取当前造型 URL 并锁线程调用检测接口；照片路径先检查摄像头可用，再锁线程打开识别拍照。文本造型的特殊分支：face 缓存设 null 并提示未检测到人脸；object 缓存写 `{score:0.99,keyword:"文本"}`。**这些依赖已登录和实际造型辨识，当前策略未启用。**
4. **OCR**：网络 → 登录 → actor/图像（或摄像头）检查。请求路径通过 execution lock 包裹，catch 写 NaN，finally 释放锁。离线早退不取得锁，不访问角色或 camera。
5. **分类**：设备支持检查 → 缺模型检查 → index 检查（reporter）→ 联网检查 → initModel。actor 命令再查角色/造型，camera 命令取 224×224 frame，photo 命令检查 camera 并拍照。真正预测阶段有 thread lock / finally 清理；模型初始化阶段本身也异步。两个 reporter 会主动 `initModel` 后读取结果，因此不能归到“空缓存常量 reporter”。名称按 label map 映射；confidence 为 `Number(probability.toFixed(2))`，不是乘 100；index 用 `Math.round(index)-1`，越界/无结果返回 NaN 并报诊断。非法非数字 index 与 index<=0 的细节未现场遍历，不新增猜测。

## 实装的策略 API

`kn_ai::Profile::OfflineAnonymous` **必须由调用方显式选择**，没有 Default。只代表当前匿名、可支持分类的桌面、浏览器离线条件；不是“没安装 AI 后端就等于浏览器离线”，也不能应用于登录/联网播放器。

```rust
command(profile, block_type, model_id) -> Option<RejectedCommand>
// RejectedCommand { value_socket, reason, cache }
// reason: Offline | LoginRequired | MissingModel
// cache: ClearChatAnswer | InvalidateTextResult | Preserve
classifier_reporter(profile, block_type) -> Option<f64>
// 两个指定 reporter 为 Some(NaN)，其余 None。
```

未知类型、现有结果 reporter、翻译、开摄像头、语音等全部返回 None，防止批量空操作扩散。`CacheEffect` 明确保留 ask/OCR 对缓存的失效行为；当前 `kn_services` 使用空缓存 profile 时这些写入不改变其值，但未来有缓存/服务后必须实际写入，不能忽略。`Preserve` 尤其不能解释成“重置全部 AI 状态”。

## 给主会话的具体接线片段

下列建议现已由 `Op::KnPanel(Command::AiRejected)` 和 `ValueExpr::KnPanel(Reporter::Classifier)` 落地；保留片段作为边界说明，枚举实际名称以源码为准。当前已有 chat/OCR/face/object reporter 仅暴露空缓存 profile，ask/OCR 的失效写因此幂等，不能在接真实后端后继续复用。命令使用本地调度 continuation 延后续行，reporter 保留 typed ValueExpr；**本地延迟不等于官方微任务/帧时序已验证**。

以下是**建议片段，未代改共享源码**。选择其一：暂时保留全部 VM unsupported（策略/证据先落地），或明确对外公开“离线匿名拒绝 profile”，接拒绝路径而非伪服务成功。

1. `src/engine.rs` 模块列表加 `mod kn_ai;`。为 Program/Engine 增加明确的 profile 选择；仅 KN 且主动选择 `OfflineAnonymous` 时走本模块。当前通用 `KnCurrent` 本身不足以证明浏览器离线。若使用全局固定离线能力档，必须在 API/文档明确这点。
2. `Op` **末尾追加**专属指令，避免改旧判别值：

   ```rust
   KnAiRejected(kn_ai::RejectedCommand, Option<usize>),
   ```

   command lowering 的 12 个精确类型中：

   ```rust
   let rejected = kn_ai::command(profile, kind, field(b, "model_id"))
       .context("unsupported AI command")?;
   let arg = rejected.value_socket
       .map(|name| self.value(input(b, name)?)).transpose()?;
   Op::KnAiRejected(rejected, arg)
   ```

   runtime 先 `if let Some(arg) = arg { self.eval_value(arg, actor); }`，再按 CacheEffect 写空回答/NaN/保留，**记录拒绝诊断**并继续后续语句。没有 UI 诊断接口时可用专属服务拒绝事件；不要用普通 console_log 假装完全等价官方 toast/登录窗口。两者表现差异必须保留在支持说明中。不能把 text 输入直接丢掉，也不能强制解析 sprite 到现存 actor，因为官方早退发生在此验证之前。
3. 两个 reporter 不能直接 lower 为常量（会丢 `index` 副作用）。在 `src/engine/value.rs` 的 ValueExpr 末尾加：

   ```rust
   OfflineAiClassifier(Option<usize>),
   ```

   value lowering：

   ```rust
   let index = b["inputs"].get("index").map(|v| self.value(v)).transpose()?;
   ValueExpr::OfflineAiClassifier(index)
   ```

   eval_value：

   ```rust
   if let Some(index) = index { self.eval_value(index, actor); }
   // 同时记录模型/输入/离线拒绝诊断（官方顺序见上）。
   Cell::Number(f64::NAN)
   ```

   数值/条件 lowering 将这两个精确 type 通过 `ExprOp::Value(self.value(b)?)` 分派；维护 ValueExpr 依赖遍历、JIT eligibility/回退、effect 分析，不要把 reporter 标纯常量。未取得完整诊断/调度支持时宁可保留 unsupported。特别不要在 compiler 中 emit 一次 index Execute 来代替 reporter 每次求值。
4. 官方 Promise 在这些短拒绝路径完成，但本次未证明原生 scheduler 是同帧还是下帧继续。现有 `kn_async` 或服务事件桥若需要 suspend/resume，应保留异步边界；不要无证据硬加固定一帧 yield，也不要声称同步合并严格等价。
5. 接线后需补原生 VM 测试：text/index 嵌 `_object_set` 验证一次副作用、循环重复、名称 NaN 类型比较、命令继续、JIT on/off、未知类型仍报错、离线与在线 profile 隔离。目前 `tests/kn_panel_ai.rs` 是 **5 项独立策略测试**，不是这些待接线的 VM 集成测试。

## 验证与明确未实现

- 本次 Rust 独立测试 **5/5**；Node 证据测试 **4/4**（含实际 dist bundle 的 18 处位置/片段 hash，无 skip）。
- 集成 VM 回归见 `tests/kn_panel_services.rs`：显式 opt-in、全部12命令继续、text/index 副作用、可选 index、数值 NaN、JIT 开关及100次循环；全量门禁结果见未提交的 `OC-REPORT.md`。
- 未实现：联网/登录 AI 请求、socket 连接、对话/提示词服务状态、OCR、face/object 检测、拍照、模型下载/初始化/预测、分类结果排序及 label map、付费/额度/鉴权完整 UI、原生异步 scheduler 等价、登录后的文本造型快捷分支、设备不支持分支的 UI。
- 分类 `model_id="?"` 的源码分支可在联网时提前拒绝，但本轮没独立实测该联网组合；策略只暴露固定 offline profile，不能扩大为通用 classifier 支持。
