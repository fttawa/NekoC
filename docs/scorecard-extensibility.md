# 四维评分卡：可扩展性依据

作者：fttawa；日期：2026-11-12。
基线：`da8dc9c5c414a4b32c9239c33df437d6d8322cf1`（原任务开始时最新 `oc/integrate`）。
本页补充[总评分卡](scorecard.md)的“可扩展性”维度，不改变适配、兼容性、性能三维的证据或历史数字。
第三方与非扩展部分依据为同轮只读源码调查；NekoC 扩展部分另按当前 v2 实现更新，
不把 v2 追记到原测量二进制。接口存在不等于运行通过、生态成熟、安全隔离或平台发布就绪。
不设置缺少权重依据的总分，不把“未验证”当零分，也不宣称 NekoC 四维全面领先。

## 能力矩阵与判断口径

| 对照 | 扩展与创作事实 | 评分时必须保留的边界 |
|---|---|---|
| NekoC | Rust/JS 显式积木契约、v2 schema、reporter/Boolean/hat、云 backend trait、TS→Kitten、CLI、多宿主源码 | v2 向后兼容 v1；capability 非 OS 沙箱；无稳定动态库 ABI、插件 IR 注入或独立进程强抢占；编辑器面板未自动接入 |
| HateNeko 0.4.0 | Lua 原语模块注册、可替换 host、KN→Lua 编译及 `.love` 打包 | 不是“完全不可扩展”；未发现同级版本化第三方契约/云 backend，不证明其他版本不存在 |
| kitten2scratch | Kitten→SB3 CLI，可修改映射源码 | 是转换器而非独立 VM；不能把 TurboWarp 扩展能力当成转换保真 |
| TurboWarp | URL 扩展、metadata、多种积木类型、worker/iframe/unsandboxed、云 provider | 生态和隔离选项仍更宽；Scratch 扩展不自动兼容 Kitten |
| K4-ULTRA | v2 manifest、目录/`.k4ultra`、积木/生成器/runtime 注册 | 应引用实际 v2 loader；旧 K4Ext 扫描入口已禁用；权限 wrapper 不证明强隔离 |
| bcm_convertor | 在线/离线播放器封装与 Android WebView 模板 | 分发平台不等于独立内核、TS 前端或积木插件 ABI |

## 1. NekoC：有明确宿主契约，但不能无条件授予“完整插件生态”

### 自定义积木、表达式与生命周期

- [`BlockSchema` / `API_VERSION=2`](../src/extensions.rs#L7-L175) 向后兼容 v1，增加可选 `kind`（command/reporter/boolean/hat）
  与 `metadata {name,category}`；`parameters` 仍为 `{name,value_type}`。`SUPPORTED_API_VERSIONS=[2,1]`
  协商最高共同版，v2 字段不会静默降级到 v1。[`Extension::call`](../src/extensions.rs#L214-L225)
  返回 `Ready(Value)` 或 `Pending`；请求包含 ID、参数和 actor。
- [`ExtensionRegistry`](../src/extensions.rs#L242-L302) 显式注册、拒绝重复、限制容量，remote command/reporter/boolean 必须 blocking；
  `register_hat` 注册无 handler 的 hat。
  [`Program::compile_with_extensions`](../src/engine.rs#L913-L945) 在编译时快照注册表；默认编译使用空表，作品不能自行加载 URL/动态库。
- v1 命令仍可把返回值写入已声明全局；v2 reporter/Boolean 的 canonical type 是
  `nekoc_extension_reporter`/`nekoc_extension_boolean`，通过异步 lowering 写任务局部值，
  保留嵌套同级操作数执行顺序且不重复执行。仍不提供 reporter procedure 内扩展调用。
- hat 使用 `nekoc_extension_hat` 的 `opcode` 字段及 `next`/`statements.DO` 体；
  [`Engine::emit_extension_event`](../src/engine/extensions.rs#L105-L132) 只向 active scene（含克隆）排队，
  payload 通过 `self_listen_value` 暴露，任务上限 4096。
- [`complete_extension` / `prune_extensions`](../src/engine/extensions.rs#L269-L332) 校验完成结果、清理停止任务，
  [`State::clear`](../src/engine/extensions.rs#L26-L30) 保留递增 ID，防旧回包污染重启后的调用。
- `Op::Extension` 是 reentrant 尾部 helper：经 `exec` 执行后离开 native region，不再因 Program 含扩展而整体禁用 JIT；
  Ready 非 blocking、blocking、Pending 的调度与指令预算仍保留。
- 值契约限 JSON 标量/列表：[`schema 校验`](../src/extensions.rs#L65-L211)、[`cell_json`](../src/engine/extensions.rs#L345-L382)
  拒绝对象、undefined、非有限数和循环/过深列表；深度、列表长度和字节预算有上限。

### 调用策略与安全边界

- [`CallPolicy`](../src/extensions.rs#L35-L63) timeout 默认 1s，范围 1ms..60s；`Propagate` 是默认且保留 v1 fail-fast，
  `Report` 记录 logs 仅结束调用任务，`DefaultValue` 记录 logs 并以 typed neutral result 继续。
  Rust 同步 handler 捕获 unwind panic，并在返回后检测超时，但不能强杀不返回的函数。
- Pending 使用 `Instant` 的 wall timeout，即使 virtual clock 存在也按墙钟处理。JS 使用 AbortSignal/timer、
  忽略迟到 Promise，无法抢占同步 JS；Web v2 默认 Report 不关闭连接，v1 Propagate 保留关闭行为。

### JS 桥与安全

- [`web/ExtensionRegistry`](../web/extensions.js#L22-L72) 的可调用积木只接受 blocking、拒绝声明 network；
  hat 以 `registry.register(hatSchema)` 注册且不带 handler。`palette()` 按 metadata 自动生成面板描述，
  **捆绑编辑器 UI 尚未自动接入**，宿主仍须自行接线。
  [`ExtensionSession`](../web/extensions.js#L74-L123) 提供 Promise、去重、AbortSignal、结果复制及错误回传。
- [`PlayerConnection`](../web/player.js#L6-L65) 用私有项目快照握手并在后续帧回送结果；
  保留封套 `nekoc_extension_handshake:1`，增加 `extension_api_versions`，ready 返回 `extension_api_version`；
  `player.emitExtension` 随后续帧发送 hat 事件。
  [`player_socket`](../src/bin/web.rs#L547-L578) 只接 schema 和调用数据，不执行作品携带的 JS 文本。
- **无不可信插件沙箱**：[`set_allow_network` 注释](../src/extensions.rs#L255-L258) 明确是 capability policy，非 OS 隔离。
  可信 Rust/JS handler 仍有宿主权限；`network=false` 不阻止 handler 自行使用网络。
- [接口限制](extensions.md#安全边界与未验证范围)：capability 不是 OS 沙箱；无独立进程强抢占、稳定动态库 ABI 或插件 IR 注入。
  JS 取消需 handler 配合，不能强杀；官方播放器及真实第三方编辑器对私有积木的处理未验证。
- `ts/` 调查未找到此私有调用的 DSL 注册入口，不能声称 TS 已能自动声明上述插件。

## 2. 云后端：可替换，不等于官方联网云

- [`CloudBackend`](../src/cloud.rs#L8-L27) 提供 `load/store/lock_frame`，以 project/variable/本地 user profile 为键。
  [`MemoryCloudBackend` / `FileCloudBackend`](../src/cloud.rs#L29-L143) 是内存和本机文件实现，不是官方账号登录或远端云协议。
- [`Engine::set_cloud_backend`](../src/engine/cloud.rs#L71-L111) 接入宿主 backend；文件 sidecar 锁支持跨进程帧级排他视图。
  [`flush_cloud`](../src/engine/cloud.rs#L234-L254) 逐 key 写入，不能把单文件替换夸大成多 key 全有或全无事务。
- [`CloudOptions`](../src/cloud.rs#L145-L168) 由宿主 flags 选择文件/内存、namespace、user；
  [`Web CloudSession`](../src/bin/web.rs#L790-L814) 和 [`k4-trace`](../src/bin/k4-trace.rs#L8-L19) 接入，普通 CLI `run` 没有同组参数。
- [`cloud.rs` 契约](../src/cloud.rs#L15-L17) 不提供 HTTP 客户端、凭据或隐式网络；外部实现 trait 的可能性不是已验证官方云兼容。
  [`CloudUi`](../src/engine/cloud_ui.rs#L1-L18) 只是显示载荷，不是远端榜单。
- [`kn_hardware`](../src/engine/kn_hardware.rs#L1-L8) 是未连接硬件 profile，不是真实驱动；不能把设备降级计为硬件后端已接通。

## 3. TS 子集、CLI 与多宿主

- [`ts_frontend`](../src/ts_frontend.rs#L17-L47) 调 Node 前端输出 workspace；
  [`compile_ts_bcmkn` / `compile_workspace_bcmkn`](../src/bcmkn_compiler.rs#L34-L131) 基于模板装配作品，
  [`compile_ts_kitten4`](../src/kitten4_compiler.rs#L16-L77) 再适配原生 `.bcm`。
- **TS 是 DSL 子集，不是完整 JS/TS 语义**：[`loadImports` 等](../ts/compile-ts.mjs#L150-L240) 限相对 named imports、导出函数且拒绝循环依赖；
  [`compileClassDeclaration`](../ts/compile-ts.mjs#L294-L305) 不实现实例模型，[`await` 分支](../ts/compile-ts.mjs#L3085-L3086) 不提供 Promise 调度。
- [`Command`](../src/main.rs#L17-L158) 有编译、反编译、检查、场景、watch、pack 等工具；
  **[`nekoc run`](../src/main.rs#L397-L413) 使用 `runtime::run_project`，不是 Web/性能套件的 `engine::Engine`**，不可混用 JIT 结论。
- Web 是[仅 loopback 的 Rust 服务](../src/bin/web.rs#L615-L626)加前端；[每个 socket 独立 VM](../src/bin/web.rs#L537-L578)，不是纯浏览器 WASM 或已验证公网多租户服务。
- [`desktop`](../src/bin/web.rs#L628-L765) 是 wry/tao WebView 加同一服务，附加 JSON 导出不等于积木 AOT 机器码；
  [`studio`](../src/bin/studio.rs#L19-L52) 是另一条 early-development eframe 编辑器，两者不能混写。
- Android 的[`构建脚本`](../tools/build-android.mjs#L10-L24)把 Rust 可执行服务命名为 `libnekoweb.so`；
  [`MainActivity`](../android/app/src/main/java/com/nekoc/player/MainActivity.kt#L333-L400) 启动子进程，再用 WebView 加载 loopback，不是 JNI VM。
- [`PICKCAT MV3 manifest`](../extension/manifest.json#L2-L15) 是播放器接管/资源桥，与自定义积木 API 是两回事。
  **本轮未构建或运行 desktop/Android/插件宿主**；ABI、JIT、真机限制、插件跨宿主注册均未认证。

## 4. 第三方固定源码对照

### HateNeko 0.4.0

只读快照为原任务获准的 `E:/nekoc-wt/_ref/hateneko`，`VERSION:1=0.4.0`；未获得固定远端 commit，不杜撰 GitHub 永久链接。
`player/rt/registry.lua:M.build`（10–56行）有 providers/冲突检查；`rt/init.lua:rt.build_f/rt.set_host/rt.load`（113–179行）提供原语与宿主组装。
`player/tools/kn.py:150–239` 有 KN→Lua 编译和 `.love` 打包，`rt/host/love.lua:15–33` 有 Android/iOS mobile 分支。
因此不能判“无扩展/无 CLI”；但这些证据不认证版本化插件 ABI、移动包发布或云后端，其他版本也不在此结论内。

### kitten2scratch 与 TurboWarp 分开评价

- 固定转换器的 [`cli.js`](https://github.com/CodeManTeam/kitten2scratch/blob/3b2dc03044e958b8052e947eebae09f2ec24ed5c/cli.js#L132-L164) 输出 SB3；
  [扩展映射说明](https://github.com/CodeManTeam/kitten2scratch/blob/3b2dc03044e958b8052e947eebae09f2ec24ed5c/README.md#L68-L75) 是修改源码，不是独立执行插件契约。
- TurboWarp [`ExtensionManager`](https://github.com/TurboWarp/scratch-vm/blob/0cb82afe62506f3d9f2ff849c95593f0473b5d2c/src/extension-support/extension-manager.js#L161-L254)
  提供内建/URL 注册及 worker、iframe、unsandboxed 分支；[`BlockType`](https://github.com/TurboWarp/scratch-vm/blob/0cb82afe62506f3d9f2ff849c95593f0473b5d2c/src/extension-support/block-type.js#L5-L57)
  包含 reporter/Boolean/hat/event/loop 等；NekoC 当前 v2 已补 reporter/Boolean/hat，
  但这不等于对齐 TurboWarp 的全部积木类型、生态或隔离选项。
- [`SecurityManager`](https://github.com/TurboWarp/scratch-vm/blob/0cb82afe62506f3d9f2ff849c95593f0473b5d2c/src/extension-support/tw-security-manager.js#L36-L50)
  默认 worker、拒绝作品自动加载；不可把 URL 能力说成默认任意执行，也不可把 unsandboxed 叫强隔离。
- [`Cloud.setProvider`](https://github.com/TurboWarp/scratch-vm/blob/0cb82afe62506f3d9f2ff849c95593f0473b5d2c/src/io/cloud.js#L68-L111) 是明确云边界，非 Kitten 云协议证明。
  [历史14项转换诊断](performance.md#同类项目对比)的不可比结论不因插件能力而改变。

### K4-ULTRA：纠正旧扫描路径，实际依据是 v2

- 固定 [`index.html:154–156`](https://github.com/JXW666NB/K4-ULTRA/blob/e6465b1c23479bde68b5811b8f8f27fb26724053/resources/app/build/index.html#L154-L156) 引入 `extension-loader-v2.js`。
  旧 bundle [`_loadExtensions:116–118`](https://github.com/JXW666NB/K4-ULTRA/blob/e6465b1c23479bde68b5811b8f8f27fb26724053/resources/app/build/kitten.822d814413fb10654fde.js#L116-L118) 已立即 `return`。
  **此前 `performance.md` 引用旧178–200行动态执行代码不能证明旧扫描入口实际执行，现已补充纠正。**
- 实际 build 版 [`loadExtension:170–271`](https://github.com/JXW666NB/K4-ULTRA/blob/e6465b1c23479bde68b5811b8f8f27fb26724053/resources/app/build/extension-loader-v2.js#L170-L271)
  读取 manifest、注册积木/工具栏、generator/runtime；241、253行确有 `new Function`。
  [`scanExtensions:292–346`](https://github.com/JXW666NB/K4-ULTRA/blob/e6465b1c23479bde68b5811b8f8f27fb26724053/resources/app/build/extension-loader-v2.js#L292-L346) 支持 `.k4ultra` ZIP；目录模式须 `devMode=true`，不是默认任意目录扫描。
- 其 UI→生成器→domain 插件链仍比 NekoC 当前宿主 schema/palette 描述更完整；权限 wrapper 在执行代码之后包装函数，不证明顶层代码隔离。
  未运行 loader/桌面壳、未验证权限安全或插件随作品分发；不要混用 `dev/` 同名文件的行号。

### bcm_convertor：封装与分发不重复计为内核

- 固定[在线适配器](https://github.com/sf-yuzifu/bcm_convertor/blob/7c88ead2757f36d571ec1b212e234d8b99e6bdd6/src/services/templates/adapters/onlineTemplateAdapter.js#L52-L57)选官方 URL；
  [离线 preload](https://github.com/sf-yuzifu/bcm_convertor/blob/7c88ead2757f36d571ec1b212e234d8b99e6bdd6/src-tauri/convert/kitten4/main/preload.js#L6-L21)注入作品 JSON。
- [Android `loadWork`](https://github.com/sf-yuzifu/bcm_convertor/blob/7c88ead2757f36d571ec1b212e234d8b99e6bdd6/src-tauri/convert/android/shell/app/src/main/java/moe/yzf/bcm/shell/MainActivity.java#L153-L188)加载 assets 页面；与 NekoC Rust 子进程方案不同。
  这证明模板路径，不证明独立运行内核、积木 ABI、官方云可用或新性能倍数。

## 验证边界

本页仅整理静态依据：未运行测试、构建、性能任务或第三方代码，未新增通过计数、兼容率或速度比。
扩展验收结果见 `OC-REPORT.md`；本页不把接口存在写成验收通过。
现有[扩展测试入口](../tests/extensions.rs)与[JS 测试入口](../tests/extensions.test.mjs)是可复核线索，不是本轮通过记录。
最终判断：NekoC 已有向后兼容 v1 的 v2 可组合创作/宿主接口，但插件契约、沙箱、联网服务、编辑器往返和平台验证仍有限；不能由接口数量推出四维全面领先。
