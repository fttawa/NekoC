# KN 摄像头与语音：离线子集及接线边界

## 交付状态

新增自足辅助模块 `src/engine/kn_capture.rs`，主会话已通过 `kn_panel` 模块接入 KN 指令分派。五个命令仅覆盖下述离线子集，**音量 reporter 默认仍 unsupported**，不能把 coverage 标成完整支持。`tests/kn_panel_capture.rs` 锁定 helper，`tests/kn_panel_services.rs` 另测实际 VM 输入副作用、共享 alpha、命令续行和拒绝开启/音量。

| 六项类型 | 本次可验证实现 | 刻意不实现 |
| --- | --- | --- |
| `set_camera_alpha` / `set_webcam_alpha` | 共享摄像头 alpha 状态，初始 0.6；严格 Number 检查、NaN 忽略、夹取 0..100 后除 100 | 实际视频画面、宿主渲染 |
| `open_hide_camera` / `open_close_webcam` | 已关闭/从未打开 profile 下的 `turn_off`；保留 alpha；异步完成契约 | `turn_on` 明确返回 CameraBackendRequired，不伪装成功；真实设备关闭及 alpha 重置分支 |
| `voice_recognition` | 未登录提前返回 LoginRequired；显式 record-disabled 提前返回 RecordBusy；不改答案缓存 | 登录后权限、录音、识别结果、识别对话框线程锁 |
| `get_voice_volume` | 仅显式 record-disabled profile 的异步 NaN 分支 | 默认 profile 返回 MicrophoneBackendRequired；不把普通无权限或无设备结果写成 0/NaN |

`Profile::default()` 是 `record_enabled=true, authenticated=false`。**无后端不等于 record-disabled**，不可为了让音量块编译而默认关闭该标志。前轮官方普通桌面音量调用 3 秒未决的事实仍成立，本次没有将其改写为成功/失败值。

## 官方来源与复现

只使用 `https://kn.codemao.cn/editor` 官方 **0.27.4** 编辑器及发布 bundle，不以 HateNeko 作为证据，没有打开用户作品、申请权限或接入真实设备。

原始第三方 bundle 仅存于忽略目录 `dist/kn-panel-capture/`，不复制源码入库。主 bundle：

- URL：`https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`
- SHA-256：`58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`
- 可提交证据：`docs/kn-panel-capture-evidence.json`（typed 调用参数/结果、字段、Promise 观察、UTF-8 零基字节偏移及摘录 hash，不含第三方函数体）

```powershell
node tools/compat/kn-panel-capture-probe.mjs --record
node --test tests/kn-panel-capture-source.test.mjs
# 不跑全量 Cargo，helper 直接作为独立 Rust 测试编译：
rustc --edition 2024 --test tests/kn_panel_capture.rs -o dist/kn-panel-capture/helper-tests.exe
./dist/kn-panel-capture/helper-tests.exe
```

探针新建无登录 Edge context。它只暴露 webpack loader，不替换域函数。被动包装实际 `rawCamera.set_alpha`：记录数值后**原样转交官方 setter**，因此能确认副作用，即使官方 raw camera 没有公开 alpha getter。没有以“返回 undefined”推测 setter 未改变状态。所有块现场构造读取字段后 dispose；不生成/修改 `.bcmkn`，故没有虚构 editor-compat 工程检查。

麦克风占用分支通过官方 runtimeStore 的 recordEnable 状态显式选择，之后恢复原值；这不是权限拒绝模拟。未登录识别调用只走登录前置条件；既不登入账户，也不发起语音后端请求。

## 插槽、字段、位置

下列偏移均是主 bundle 的原始 UTF-8 字节偏移。

| 类型 | 精确输入 | 输出/连接 | 字节位置 |
| --- | --- | --- | --- |
| `open_hide_camera` | field `camera_status`: `turn_on`（默认）/`turn_off` | previous/next，无 output | 1669074 |
| `open_close_webcam` | 同上 | previous/next，无 output | 1693796 |
| `set_camera_alpha` | value **`camera_alpha`** | previous/next，无 output | 1670712 |
| `set_webcam_alpha` | value **`camera_alpha`**（不是 webcam_alpha） | previous/next，无 output | 1695192 |
| `get_voice_volume` | 无字段、无 value socket | reporter output | 1578597 |
| `voice_recognition` | field **`type`**: **`zh`**（默认）/`en` | previous/next，无 output | 1642591 |

语音字段不是 K4 的 `lang`/`zh-hans`。不要把 `open_hide_camera` 名字中的 hide 解读为另一组 `show/hide` 字段：官方菜单确实是开启/关闭。

摄像头统一单例是 main module **42305** 的 `HS.getInstance()`，不是每角色或每面板各一份。初始 alpha 为 0.6（1522464），setter 转交 camera.set_alpha（1533237）。

## 现场观察

共 **28** 条真实 registry 调用，`pageErrors=[]`。registry 使用 args 对象而非位置参数；原函数结果保持不变。

- 每种 alpha 块各 11 次：`-10,0,37.5,100,150,+Infinity,-Infinity` 分别写入 `0,0,0.375,1,1,1,0`；`NaN,"25",true,null` 均没有调用底层 setter。无效参数官方收集 Ignored Execution 错误，辅助模块以 `Notice::IgnoredAlpha` 交给主调度器处理，不静默丢失错误分类。
- 两次 `turn_off` 发生在 cameraStatus 已为 turn_off 时，都未写 alpha，并返回 Promise→undefined。源码 1532744 的 turnOff 仅在状态不是 turn_off 时做实际关闭及默认重置 alpha；**不能无条件在 close 时设置 0.6**。辅助模块只建模从未开启的状态，不声称覆盖真实运行设备关闭。
- recordEnable=false：`get_voice_volume` 返回 Promise→**number NaN**，`voice_recognition` 返回 Promise→undefined。前者源码先 await stopListening，后者直接提前返回。
- recordEnable=true 且未登录：中/英识别均 Promise→undefined，loginDialogVisible=true，无 alpha 写入。未登录检查位于权限申请之前，源码足以解释本次为何不访问设备。
- 本次不调用任何 camera_status=turn_on，也不调用 recordEnable=true 的音量块；真实设备/权限分支不能用上述提前返回证据代替。

## 异步与调度（主会话接线要求）

六种域函数均由 async/generator 包装，实测都是 Promise。即便 alpha 或已关闭分支在函数体内立即产生副作用，其完成回调也在当前 JS 栈之后：探针顺序均为 `returned → after-register → settled`。**这不是原生 KN 工程脚本交织的差分证据，也不证明一帧等于 microtask。**

辅助模块返回 `Deferred<T>`；已接线命令通过现有 wait_started/调度 tick 机制在后续轮恢复，不在当前调用栈直接续行。此 tick 延迟是本地调度选择，**不是官方原生调度差分认证**。`take_kn_panel_notices()` 暴露 IgnoredCameraAlpha/RecognitionLoginRequired 等可恢复提示，viewer 尚未显示登录 UI。保持以下顺序：

1. 编译只在 `RuntimeSemantics::KnCurrent` 分派。`block(type)` 提供六项枚举分类；未知仍返回 None。
2. 两个 alpha 块必须正常编译并求值 `inputs.camera_alpha` 一次，保留表达式副作用/异常。建议 instruction 保存 `ValueExpr` 索引而不是 `Expr`：运行后仅 `Cell::Number(n)` 传 `Some(n)`，其他 Cell 传 None；**不可提前走 `.number()`**，否则错误接受字符串/布尔。
3. `Engine` 增加一个共享 `OfflineCapture` 字段，两个面板使用同一份；不要放在 Sprite/clone。调用 `set_alpha` 即刻写状态，随后把其完成及 Notice 放进异步恢复队列，下一轮恢复发起线程。该队列延迟是本地调度选择，不能称为已验证官方帧时序。
4. close 的字段静态解析用 `CameraSwitch::parse`；默认缺省值应依官方 schema 为 turn_on，而不是自动 close。On 目前必须维持显式 unsupported。若主会话不支持运行时按字段报 unsupported，编译期直接拒绝 On，只纳入 Off 子集。
5. 识别字段用 `Language::parse`，在显式未登录 profile 下调用 `recognize` 并异步完成；把 LoginRequired 交给宿主提示，但**不自动发起真实登录、不产生空识别结果、不清除 get_voice_answer 旧缓存**。
6. 音量默认 profile **不接 kn_services 常量路径**。只有产品真的维护 recordEnable=false 占用状态且活动监听器为空，才允许调用 `voice_volume` 得到 Deferred NaN；若存在活动监听器，必须真正执行 stopListening 再完成。当前普通音量块仍 unsupported。
7. 将来接入登录/设备后端，必须取消对应提前返回 profile；真实识别会创建 thread lock，submit 写答案并解锁，close 解锁但不写答案（1645355）。本次没有实现该对话框路径，也没有验证并发识别、取消、stop/restart 或实际转录。

实际指令为 `Op::KnPanel(Command::{CaptureAlpha,CaptureClose,Recognize})`，共享状态与重启清理放在 `kn_panel::State`；没有扩展 `kn_services.rs` 常量表。默认音量不新增 reporter。

## 验证范围

- Rust helper：7 项独立测试，锁定六项分派、字段、共享状态/无效类型保留、Infinity、close 不重置、open unsupported、默认音量不伪造、识别提前返回优先级。
- Node：4 项证据门禁（3 项始终离线校验归档，1 项可选复算 dist 官方字节/hash）。
- 全量门禁最终结果见根目录未提交的 `OC-REPORT.md`。没有构造官方原生工程，也没有集成后官方调度差分，不把 helper/VM 测试冒充官方工程结果。
