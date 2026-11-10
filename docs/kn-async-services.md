# KN 异步 timer 与离线设备/账户证据

官方编辑器 `https://kn.codemao.cn/editor`，版本 **0.27.4**，检查日期 **2026-11-10**。只采用官方发布代码与隔离官方编辑器调用，不以 HateNeko 为官方证据。原始第三方文件、完整现场报告仅在忽略目录 `dist/kn-async-services/`。

## 复现与来源

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/editor-compat.mjs tests/fixtures/kn-async-services/timers.bcmkn --channel msedge --out dist/kn-async-services/editor-compat.json
node tools/compat/kn-async-services-probe.mjs --record --trace
node --test tests/kn-async-services-source.test.mjs
```

探针暴露 webpack loader；服务通过官方 registry 的实际域函数调用。timer 原生作品运行阶段只包装 registry/browser timer 来被动记录参数，再转交原函数，不补 callback、不替换返回值。原创 fixture 现保存为 `tests/fixtures/kn-async-services/timers.bcmkn`，探针直接读取其原始字节，临时由 previewUrl 提供，没有修改用户编辑器项目。`--record` 要求先取得同一 fixture hash 的 editor-compat 成功报告；`--trace` 同时调用已构建的 `target/debug/kn-trace`（Windows 为 `.exe`），不自行构建。

可提交归档为 **`docs/kn-async-services-evidence.json`**：包含官方 URL/hash、源码字节位置/摘录 hash、注册/转换观察、typed service 结果、原生运行观察、editor-compat 和本地 trace 对照。**不包含第三方模块/函数体/源码摘录**。完整第三方源码与冗余现场信息仍只在 dist。离线测试始终核验 tracked JSON，不依赖本地 dist；只有源码字节核验那一个测试可 skip。

fixture SHA-256：`e90a01823eccd9ea6273f10164b67e440698df208d69135c785964f76f3f50bb`。官方 editor-compat：**ok=true，13 blocks，issues=[]，pageErrors=[]**；编辑器版本 0.27.4。归档中的 compat project hash、probe fixture hash、本地 trace fixture hash 均绑定该值；修改 fixture 后必须重跑，不能沿用本报告。

官方发布前缀 `https://creation.bcmcdn.com/neko/web/release/static/js/`：

| 文件 | SHA-256 |
| --- | --- |
| `main.8ccf2442.js` | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| `main-vendors.07f7dd7e.js` | `38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68` |
| `crc_libs.8196dbd1.js` | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` |

下列位置是原始 UTF-8 文件**零基字节偏移**，不是字符偏移；`report.json.locations` 记录 anchor、文件 hash、偏移以及 500 字符摘录 hash，不在跟踪文件中复制第三方函数体。

## timer：块、转换、运行时不是同一件事

| 类型 | 插槽 | 连接/类型声明 | main 源码位置 |
| --- | --- | --- | --- |
| `setTimeout` | statement `callback`；value `delay` | previous/next，无 output；Callable/Number → void | 2952116 |
| `setInterval` | statement `callback`；value `delay` | previous/next，无 output；Callable/Number → void | 2952514 |
| `clearTimeout` | value `timeoutId` | previous/next，无 output；Number → void | 2952277 |
| `clearInterval` | value `intervalId` | previous/next，无 output；Number → void | 2952678 |

域函数在 main module **65191**。实际调用签名是一个 args 对象，不是两个位置参数。`setTimeout({callback,delay})`/`setInterval({callback,delay})`：callback 必须已经是 JS function，才原样交给 `window.setTimeout`/`window.setInterval`；其他值改为空函数；delay 原样传递给浏览器，单位毫秒。成功返回浏览器 numeric ID；catch 返回 0。clear 使用上述精确输入名、调用对应 browser clear、catch 吞异常，返回 undefined。

直接调用官方 registry 的实测：timeout 真函数执行一次；interval 多次，clear 后计数不再增加；取消的 timeout 未执行；string callback 不执行、不 eval，但仍返回 numeric ID。ID 是当次浏览器生成的句柄，不应固定为某个数字。计数依赖运行速度，探针只断言单次/增长/稳定，不锁定 interval 次数。

### 官方转换器

- `setTimeout(() => { get_timer(); },100)` / interval 转为同名块，body 放在 `<statement name="callback">`，delay 放在 `<value name="delay">`；XML→JS 恢复 arrow。示例 body 的未知函数调用转为 `function_call_noreturn`，`SIGNATURE` 为 `get_timer`。
- `setTimeout(handler,100)` 和 `setTimeout('text',100)` 的 **JS→XML 丢掉 callback**，无转换 error；往返变为 `setTimeout(() => {},100)`。不能声称函数引用/text 是受支持的 callback 插槽。
- `const id=setTimeout(()=>{...},100)` 转换器能生成嵌套同名块并往返；但该块真实注册 **无 output，声明 returnType=void**，且反向转换报告“不支持的表达式类型: setTimeout” warning。尚未证明这个嵌套块能被 workspace 正常连接/原生执行。

### 原生 callback statement 的重要缺口（已端到端确认）

保存的原创作品 JSON 结构：开始事件 next 依次设置 ready、`setTimeout`、`setInterval`、设置 after。两种 timer 块均为 `inputs:{delay:math_number(137),callback:variables_set(fired,...)}`，每个节点有唯一 id。这里使用原生工程的 **`inputs.callback`，不是 XML 的 statement 节点，也不是 NekoC 内部的 `statements.callback`**。官方 workspace importer 将它正确导入 statement socket：现场 `get_input_target_block("callback")` 分别取得原始子块 ID `kn-services-6` / `kn-services-10`、type `variables_set`、variable `fired`，input type 均为 3；编辑器兼容检查同时验证全部 13 块与连接。**callback 在 importer 阶段没有被丢失**。

官方 Start 一秒后：`ready=1, after=1, fired=0`，运行仍进行，控制台无提示、`pageErrors=[]`。被动记录的两次官方域函数调用均为 **args.keys=["delay"]，callbackType="undefined"**；browser timeout 收到官方替代的空函数。即这条原生路径没有把 statement body 转为 JS function/script，也没有执行 callback。

主会话构建的 `target/debug/kn-trace.exe` 对同一保存 fixture 执行 180 个虚拟帧，最终 `{after:1,fired:0,ready:1}`，与官方三个变量一致。归档保存 binary/source hash 与实际输出，仅证明此 fixture 的最终变量；没有把它扩大为通用 callback、取消/重启或完整 scheduler 等价证明。

这不是“所有 timer 不可用”：真实 JS function 域调用已工作。也不能凭有 statement socket 就在 NekoC 中擅自执行其 body，称之为官方等价语义。官方通用编译位置另见 crc `compile_domain_functions` **941381**、`compile_params` **945923**；本次未找到其他成功的原生 callback→script 路径。scheduler 可独立准备，但接入原生 timer body 须明确与此官方缺口的取舍。

## 可实装的离线设备/账户 profile

新模块 `src/engine/kn_services.rs` 提供显式无后端 profile 的辅助函数，已由 `src/engine.rs` 接入 KN 分派（接线边界见下文）。这不是联网/识别/账户后端。所有纳入 reporter 都没有 value socket，不会吞掉输入表达式副作用。

| reporter/command | 官方无后端结果（保留类型） | main 源码位置 |
| --- | --- | --- |
| `get_orientation` | desktop 直接 numeric 0 | 1578032 |
| `username_get` | 未登录 string `未登录用户` | 1702404 |
| `user_id_get` | 未登录 **string** `0`，不是 Number | 1702789 |
| `get_voice_answer` | 未开始识别/结果未设时 string 空串 | 1645843 |
| `recognize_body_part` | boolean false | 1671326 |
| `bump_into_body_part` | 无检测 points 时 boolean false | 1671471 |
| `recognize_gesture` | 无检测 gesture 时 boolean false | 1674435 |
| `check_tilt_direction_of_face` | 无 tilt 时 boolean false | 1674160 |
| `get_position_of_body_part` | 无 centralPoint 时 numeric NaN | 1673206 |
| `get_appearance_of_part` | 无尺寸时 numeric NaN | 1673529 |
| `get_tilt_angle_of_face` | 无 tilt 时 numeric NaN | 1674031 |
| `move_to_body_part` | 无 centralPoint 时 return undefined、不移动 | 1672115 |
| `face_to_body_part` | 无 centralPoint 时 return undefined、不转向 | 1672645 |

以上均实际调用官方函数确认；async reporter 等待真实 Promise。body 默认 face、坐标 x、appearance scale、gesture Victory；其他 dropdown 无检测分支由源码佐证，未逐个现场遍历。move/face 原函数返回 undefined，缺 centralPoint 的不操作由源码确认，未逐帧测 actor transform。`get_voice_answer` 是任意数据未设分支，不能用于覆盖未来实际语音结果。

### VM 离线 profile 接线

1. `src/engine.rs` 已接入 `kn_services`，只在 `RuntimeSemantics::KnCurrent` 使用。当前 VM 没有 KN 账户/识别 backend，因此该路径明确采用无后端 profile。
2. value lowering 将 `OfflineValue::{Number,Boolean,Text}` **分别**送入 `Cell::{Number,Bool,Text}` 常量路径；未知类型保留 unsupported。不把 `user_id_get` 数值化、NaN 改 0、bool 改 number。
3. numeric/boolean expr lowering 经过 `ExprOp::Value(self.value(b)?)`，可用于比较、数值与条件输入。已有 `get_orientation` desktop 0 路径不变。
4. `no_detection_command` 在无检测 profile 下不改 actor，但继续后续语句；这两块无 value sockets。未来增加检测 backend 后，不得继续走离线捷径。
5. 没有 AI/网络批量分派。helper 对未知、AI、权限和网络类型返回 None；`tests/kn_offline_services.rs` 锁定 typed reporter、命令继续及 unsupported 边界。

## 刻意未实装

- `get_voice_volume` 官方函数会进入麦克风权限/监听路径；本次无权限隔离页面 Promise **3 秒未完成**，不能据此编造 0。源码 1578597 的 record-disabled 分支返回 NaN，但不是所有无设备情况。
- face/object/OCR/classifier 未初始化 reporter 有部分 NaN/false；`ai_chat_answer` 初始空串。只证明初始缓存，不证明网络请求失败、登录拒绝或完整后端。**全部维持缺失，不纳入 helper**。
- `check_gender/check_emotion/check_face_shape` 未初始化时实际 **NaN 而非 false**，尤其不能批量 stub 为 false。
- 排行榜默认 `ranking=?` 的 NaN 不能证明真实 leaderboard 的离线行为；排名、翻译、AI 问答/新对话、拍照、开摄像头、语音识别等命令未实装。没有为取证发起 AI 付费调用。
- 无硬件、登录用户、权限允许、触屏、后台节流、timer stop/restart 清理、clone/局部闭包捕获、不同 script 作用域的验证。

### microbit / catbit / wand / robot：不能从 common helper 编造块返回值

补查官方 main module **87282**：

| symbol | UTF-8 字节偏移 | 已确认行为 |
| --- | --- | --- |
| `getHardwareCoreAndCheck` | **2178339** | 查硬件并检查 isConnected；缺失/不连接分支返回 undefined，并按 runtimeId 去重显示硬件未连接提示；异常被该 helper 捕获 |
| `getHardware` | **2178176** | 硬件 Map 中缺 id 时抛 `Error("No hardware of id …")`；不直接提供数值/布尔默认值 |
| 硬件块→代码 callee 映射 | **2771511** | 如 wand_coordinate→get_wand_coordinate、microbit_button_is_pressed→is_microbit_button_pressed；只证明转换映射，不证明后端行为 |

在此次**无硬件连接的普通编辑器**实际调用 `getHardwareCoreAndCheck`：microbit、catbit、wand、tudao（TUDAO Master）、tudao2（TUDAO Lite）全部返回 **typeof undefined**，未抛到调用方。这只能证明 common helper，不能把 undefined 当作具体块的数值/布尔降级。

同一现场 registry 查询的 15 个真实积木都没有域函数索引：`microbit_button_is_pressed/light_level/temperature/get_volume/led_clear`、`catbit_button_is_pressed`、`wand_button_is_pressed/coordinate/rotation/reset_position`、`get_robot_master_motor_power`、`get_robot_master_infrared_sensor_distance`、`stop_robot_master_motor`、`get_robot2_master_motor_power`、`stop_robot2_master_motor`。因此探针没有伪装成已调用这些块，也没有虚构 typed result。registry 中带相关名称的只有 `math_number_with_tudao3_slider` 和四个 microbit shadow 类型，不能作为真实硬件执行路径证据。

本次未取得相应硬件扩展加载后的 command/reporter 域函数体或完整原生作品错误轨迹，故**没有证明**它们抛 `block_device_not_connected`、返回 Promise、返回 undefined 或 numeric 0。保留缺失的精确原因是“硬件扩展实际域函数/无连接端到端语义未取得”，而不是“官方等价 no-op”。没有为这些块给 `kn_services.rs` 增加常量/空命令，也没有动主会话添加的集成测试。相应 observations 与三处源码 hash/位置已进入 tracked JSON。

## 验证范围

`tests/kn_offline_services.rs` 包含四个 helper/集成/unsupported 边界测试，`tests/kn_async.rs` 包含五个 timer 集成测试，均纳入全量 Rust 门禁。`tests/kn-async-services-source.test.mjs` 四项测试中，前三个始终校验 tracked 证据、fixture/compat hash、原生 importer 与 runtime 区别、typed service 结果、硬件调查边界和本地 fixture 对照；第四个可选核验 dist 中三个官方 bundle hash 与 **24** 个摘录 hash（本次有源码，未 skip）。最后一次探针 `report.ok=true`、全部 checks=true、零 uncaught page error；editor-compat ok=true；同 fixture `kn-trace` 最终变量与官方一致。最终全量门禁、集成后重跑和语料统计见 worktree 根目录未提交的 `OC-REPORT.md`。
