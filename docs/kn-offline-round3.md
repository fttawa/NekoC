# KN 第三轮：AI / 检测缓存、摄像头权限与硬件边界

仅使用官方编辑器 **0.27.4** 的发布代码与隔离官方 registry 调用；不引用 HateNeko。检查日期见 `docs/kn-offline-round3-evidence.json.checkedAt`。没有生成作品。官方证据采集与本地实现分开；最终 Cargo/工具测试结果见未提交的 `OC-REPORT.md`。

## 复现与证据身份

```powershell
# 可使用已有 Playwright 安装；未设置时探针读取本 worktree dist 下的安装。
npm install --prefix dist/kn-offline-round3/deps --no-package-lock --no-save playwright
node tools/compat/kn-offline-round3-probe.mjs --record
node --test tests/kn-offline-round3-source.test.mjs
```

官方 URL：`https://kn.codemao.cn/editor`。源码：

`https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`

SHA-256：`58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`。

原始 bundle、函数体及完整报告只在忽略目录 `dist/kn-offline-round3/`；可提交 JSON **不含第三方函数体/摘录**。其 `sourceLocations` 保存 21 个原始 UTF-8 **零基字节偏移**、摘录字符长度和 SHA-256；可选源码测试逐一复算，不能拿字符下标冒充字节位置。离线测试不依赖 dist 的四项归档验证也始终执行。

探针只对 main 暴露 webpack loader，不替换服务实现。新建 reporter 读取 socket/field 后立即销毁；实际域调用都传 args 对象。为证明缓存键与参数适配，暂时包装 runtime `get_arbitrary_data`，原样调用原方法并记录键；随后通过真实 `set_arbitrary_data` 写入原创样本，调用原 reporter，再清除。没有发起 AI 请求、模型加载、开摄像头或麦克风请求。`pageErrors=[]`。

## 可以接入的 7 项：严格限定为空结果缓存 profile

这些 reporter 全部**只有字段、没有 value/statement socket**，原函数直接读已有缓存，不请求权限、不登录、不联网。它们是“未启动对应后端且结果缓存为空”的真实分支，不是完整后端或网络失败兜底。

| block | 字段 | 空缓存结果（JS 实际类型） | main byte offset |
| --- | --- | --- | --- |
| `ai_chat_answer` | 无 | string `""` | 1681731 |
| `ai_text_result` | 无 | **number NaN**，虽然声明 string | 5280063 |
| `get_face_detection_result` | `type`: `age/emotion/gender/faceShape` | number NaN | 1677266 |
| `get_object_detection_result` | 无 | number NaN | 1680231 |
| `check_gender` | `gender`，默认 `male` | **number NaN**，不是 bool false | 1677718 |
| `check_emotion` | `emotion`，默认 `happy` | **number NaN**，不是 bool false | 1677544 |
| `check_face_shape` | `face_shape`，默认 `square` | **number NaN**，不是 bool false | 1677889 |

上述 7 项已加入 `src/engine/kn_services.rs::reporter` 及 engine 的值/数值回落分派，仍只走 `RuntimeSemantics::KnCurrent` 的无后端 profile。NaN 进入 `Cell::Number(f64::NAN)`，不因块形状改为 false/0/空串；`ai_chat_answer` 进入 `Cell::Text`。`tests/kn_offline_services.rs` 覆盖这些实际执行路径及未知服务仍 unsupported。

### 不只是错误调用得到“默认值”

- 现场记录的真实缓存键分别是 `_ai_chat_answer_`、`ai_text_result`、`_neko_cognitive_face_result_`、`_neko_cognitive_object_result_`。
- 向 AI 缓存写入 `"probe chat"` 后返回该字符串；object `{keyword:"probe object"}` 返回 `"probe object"`。
- face `{age:12,gender:"male",emotion:"happy",faceShape:"square"}` 在相应 `type` 字段下分别返回 number 12 / string `男生` / `高兴` / `方脸`；对应三个判断均返回 bool true。这证明字段和缓存路径确实生效，空缓存 NaN 不是传错参数的假象。
- face 五种初始调用（含无效 type）均 NaN；只承诺合法字段的空缓存分支，不由此扩展非法字段规范。
- OCR result 在 undefined、空字符串或 NaN 缓存时均 number NaN；有效缓存 `"cat"` 返回 string `"cat"`。

缓存被填充后绝不能继续走这些离线常量。当前对应识别/聊天命令仍 unsupported，所以正常成功执行路径没有 producer。未来接入 producer 时，应实现真实共享缓存或取消常量捷径。

## 第 8 项有证据，但有输入副作用接线要求：`ai_text_result_check`

官方 socket 是 **value `text`**，字段是 **`options`**（`include` / `exclude`）。原 extension 函数是位置参数 `(options,text)`，但 registry adapter 接收 args 对象，按生成的参数名列表取值，再调用原函数（main **5319963**，本次 hash 覆盖 1300 字符）。因此不能直接把 args 对象当第一个位置参数调用 extension 函数，也不能少传 text 后声称验证了包含逻辑。

真实 registry 调用的结果：

| OCR cache | query | include | exclude |
| --- | --- | --- | --- |
| undefined | `""` / `"cat"` / number 123 | false | false |
| NaN | `""` | false | false |
| `"cat"` | `"cat"` | true | false |
| `"cat"` | `"dog"` | false | true |
| `"cat"` | `""` | true | false |
| **`""`** | `""` | **true** | false |

源码位置 **5280190**。特别注意空字符串缓存与 undefined 不同；不能从 `ai_text_result` 显示 NaN 推导 predicate 总是 false。认证配置 **5277166** 仅将 `ai_text_actor/ai_text_photo` 列为 needAuthBlocks，两个只读 OCR reporter 不在该列表。

此类型不属于 field-only helper。engine 新增 `ValueExpr::OfflineOcrCheck`，先正常求值 `inputs.text`，再返回 bool false，并保守禁止含该节点的原生树被 JIT 直接提升。`tests/kn_offline_services.rs` 覆盖 include/exclude 两项、对象写入副作用及非法 query 不被吞掉。它仍只支持 absent cache，不能将空字符串缓存或真实 OCR 成功结果也变为 false。

## 必须保留 unsupported 的剩余分支

### 翻译不是初始缓存 reporter

`translate_result` 的字段 `language`、value socket `text`。main **1568646**：先做 `String(text).trim()`，仅空白时直接返回 string `""`；非空会调用网络翻译函数；响应为空时也空串。本轮只调用 `""`、空格、制表换行，三次真实 Promise 均 string 空串。**没有一般离线结果证据**，不能统归空串。没有加入 helper；即使以后只支持空白也要保留 text 求值及 JS String/trim 语义。

### 分类 reporter 会主动初始化模型

`get_evaluate_class_name` / `get_evaluate_class_accuracy`，main **1689530 / 1691671**：检查设备支持、`model_id === "?"`、index 数值、`navigator.onLine`，然后 `initModel`，读取 `getPredictResult`；缺模型/无结果有错误记录及 NaN。字段 `model_id`；index 缺省 1，可由 mutator 增加输入。它们**不是无输入纯缓存读**，不能用前轮默认 `model_id=?` 的 NaN 覆盖有效模型调用。本轮不调用模型函数、不实现。

### 排行榜缺选择不等于真实离线语义

`user_ranking_info`（**1699438**）：字段 `ranking/type`。`user_info_of_th`（**1700796**）：字段 `ranking/type`，value `order`。两者选择 `?` 或不存在的 ranking id 都实测 number NaN。源码的真实 rankingId + workId 分支会请求排行榜，然后检查用户并找结果；这不证明一切未登录、断网或真实排行榜都立即 NaN。`order` 是 value socket，不得吞掉求值。均不加入 helper；排行榜更新、显示命令仍 unsupported。

### 摄像头/麦克风不能当 no-op

- `open_hide_camera`（**1669074**）、`open_close_webcam`（**1693796**），字段都是 `camera_status`，默认 `turn_on`。打开会检查 camera enable，调用真正 `turnOn`，还有移动端/全屏/拍照互斥逻辑；关闭会 `turnOff`。本轮只查注册和源码，不打开真实设备，也没有证明权限拒绝后 complete/throw/pending 语义。
- `set_camera_alpha`（**1670712**）、`set_webcam_alpha`（**1695192**），value **`camera_alpha`**。源码做数值校验、clamp 到 0..100、除 100 后交给摄像头实例，**即使当前没有影像也会改变状态**，不能标为空操作。
- `get_voice_volume`（**1578597**）在 recordEnable=false 时 NaN 并 stopListening；普通 desktop 分支会 `startListening`，读权限和音量。本轮不请求权限。前轮 pending 不能解释成 numeric 0，也不能把 record-disabled 分支当无设备通则。
- AI ask/new conversation、OCR 获取图片、face/object 获取图片、evaluate camera/photo/actor 均仍 unsupported；没有触发任何付费请求。

### 硬件：仍缺实际扩展域函数

本轮普通编辑器中 `microbit_temperature`、`microbit_button_is_pressed`、`catbit_button_is_pressed`、`wand_coordinate`、`get_robot_master_motor_power` 都是 workspace 未注册且 registry 无索引。没有调用不存在函数来伪造 undefined；没有把 common helper 的结果当成 block 的返回值。

main **2178339** 的 `getHardwareCoreAndCheck` 对未连接硬件返回 undefined（前轮实测）；上述其他硬件调用方如何处理仍未知。main 中的代码 callee 映射与类型声明不能替代扩展执行体证据。上述其他硬件加载后的实际函数/完整无设备作品轨迹仍未取得，全部保留 unsupported。另行取得执行体证据的 `microbit_math_map` 见 [kn-microbit-map.md](kn-microbit-map.md)：它有连接前置条件，本地仅实现无连接 NaN 分支，不能称为无条件纯计算。本节也不涉及 `mouse_down`。

## 验证结论

`node tools/compat/kn-offline-round3-probe.mjs --record`：`ok=true`，全部 checks=true，官方版本 0.27.4，零 uncaught page error。归档保留 **46** 条实际调用（含初始、缺 ranking、种子缓存和空缓存边界）；源码锚点 21 个。`tests/kn-offline-round3-source.test.mjs` 锁定初始 typed 值、真实 socket/field、种子缓存反证、未调用服务/硬件边界及可选原始字节校验。
