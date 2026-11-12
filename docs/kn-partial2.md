# KN partial 第二轮：主路径范围与服务跳过清单

## 结果与口径

基线 `a397128`（任务开始时的 `oc/integrate`）：115 个 partial = 55 个非硬件 + 60 个硬件。
固定频率报告仍以历史 117 项为分母，不修改历史统计来制造收益；鼠标与克隆属性已在上一轮升级。

本轮将 **8 个**本地项从部分语义升级为**有执行路径／未完整验证**，partial **115 → 107**。
**未达到至少 15 项升级的目标**：其余 47 个非硬件项需要在线/账户/检测/设备后端，或尚未接入的全局特效宿主。
按任务要求写清无设备行为后跳过，不把未登录、空缓存或失败路径冒充完整主路径，也不把一个类型拆成多个选项计数。
60 个硬件项全部保留部分语义。完整语义支持认证仍为 0；JIT 开启不等于每个 helper 都进入 native 热路径。

## 8 项主路径与独立未验证边界

- 官方 KN 0.27.4 原创夹具、同 SHA-256 的 editor-compat 检查与配对变量见 [定时器/转换](kn-partial2-timers.md) 和 [外观/属性/气泡](kn-partial2-appearance.md)。
- 转换沿用 [63 条带类型观测](kn-conversion.md) 与 [51 条原生结果、45 次局部调用](kn-partial-conversion.md)；新配对不把局部调用混称原生工程。
- 原生 timer callback 被丢弃是本版本官方行为，不是 NekoC 假称实现了 JS 闭包；见 [定时器边界](kn-timers.md)。

| 类型 | 已验证主路径 | 未验证边界 |
| --- | --- | --- |
| `convert_type` | number/string/boolean，常见文本、空值、越界数值、列表与普通对象；沿用已有官方原生及带类型证据 | callable原型、Symbol、稀疏数组、孤立UTF-16及错误UI |
| `setTimeout` | 原生 statement callback 被官方编译丢弃；注册不阻塞，delay 求值一次，不擅自执行 callback | 墙钟精度、后台节流及跨场景生命周期 |
| `setInterval` | 原生 statement callback 被官方编译丢弃；注册不阻塞，不擅自执行 callback | 墙钟精度、后台节流及跨场景生命周期 |
| `clearTimeout` | 原生语句取消数字句柄；不存在的句柄不阻塞后续脚本 | 浏览器句柄数值一致性及真实function回调竞争 |
| `clearInterval` | 原生语句取消数字句柄；不存在的句柄不阻塞后续脚本 | 浏览器句柄数值一致性及真实function回调竞争 |
| `appearance_of_sprite` | 普通图像角色横纵缩放读取与两位舍入，当前/指定角色 | 文本costume特殊缩放、全部错误及渲染路径 |
| `get_sprite_property` | 官方代码 API 到原生属性积木的映射；不是同名注册积木 | 全部错误、文本造型及跨场景 |
| `self_dialog_wait` | 官方原生非阻塞、无限时气泡；常见内容、空内容与可见性 | 跨场景、并发timed气泡取消及像素排版 |

## 47 项跳过清单（保留部分语义）

下列为既有实现/官方证据的降级摘要，**不是本轮新增官方成功实测**。各项真实服务成功路径均未实现/未验证。
没有调用在线 AI、登录账号、请求摄像头或付费接口；没有移植 HateNeko 或官方源码。

| 分组 | 类型 | 无设备/离线行为与剩余限制 | 既有官方证据 |
| --- | --- | --- | --- |
| AI/OCR/聊天 | `ai_chat_answer` | 仅未启动聊天后端、结果缓存为空时的空文本；聊天请求与真实答案未实现 | kn-panel-ai.md、kn-offline-round3.md |
| AI/OCR/聊天 | `ai_chat_ask` | 仅显式离线匿名 profile 的拒绝/空缓存失效与提示；真实聊天后端未实现 | kn-panel-ai.md、kn-offline-round3.md |
| AI/OCR/聊天 | `ai_text_actor` | 仅显式离线匿名 profile 的拒绝/NaN 缓存；OCR/角色图像识别未实现 | kn-panel-ai.md、kn-offline-round3.md |
| AI/OCR/聊天 | `ai_text_photo` | 仅显式离线匿名 profile 的拒绝/NaN 缓存；拍照/OCR 未实现 | kn-panel-ai.md、kn-offline-round3.md |
| AI/OCR/聊天 | `ai_text_result` | 仅 OCR 缓存为空时的 numeric NaN；OCR 获取与真实结果未实现 | kn-panel-ai.md、kn-offline-round3.md |
| AI/OCR/聊天 | `ai_text_result_check` | 仅 OCR 缓存为空时求值 text 后返回 boolean false；OCR 获取与有效缓存未实现 | kn-panel-ai.md、kn-offline-round3.md |
| AI/OCR/聊天 | `new_conversation` | 仅显式离线匿名 profile 的拒绝且保留缓存；真实新会话后端未实现 | kn-panel-ai.md、kn-offline-round3.md |
| AI/OCR/聊天 | `set_system_preset` | 仅显式离线匿名 profile 的拒绝；不会假称本地保存提示词，真实服务未实现 | kn-panel-ai.md、kn-offline-round3.md |
| 检测/模型/身体识别 | `bump_into_body_part` | 仅无检测结果时 false；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `check_emotion` | 仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `check_face_shape` | 仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `check_gender` | 仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `check_tilt_direction_of_face` | 仅无检测结果时 false；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `enable_face_detect_by_actor` | 仅显式离线匿名 profile 的登录拒绝；人脸检测未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `enable_face_detect_by_photo` | 仅显式离线匿名 profile 的登录拒绝；拍照/人脸检测未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `enable_object_detect_by_actor` | 仅显式离线匿名 profile 的登录拒绝；物体检测未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `enable_object_detect_by_photo` | 仅显式离线匿名 profile 的登录拒绝；拍照/物体检测未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `evaluate_actor_style` | 仅显式离线匿名 profile 的缺模型/离线拒绝；模型预测未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `evaluate_camera` | 仅显式离线匿名 profile 的缺模型/离线拒绝；摄像/模型预测未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `evaluate_photo` | 仅显式离线匿名 profile 的缺模型/离线拒绝；拍照/模型预测未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `face_to_body_part` | 仅无检测结果时不修改方向；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `get_appearance_of_part` | 仅无检测结果时 NaN；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `get_evaluate_class_accuracy` | 仅显式离线匿名 profile 的 numeric NaN，保留可选 index 求值；模型预测未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `get_evaluate_class_name` | 仅显式离线匿名 profile 的 numeric NaN，保留可选 index 求值；模型与标签后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `get_face_detection_result` | 仅人脸缓存为空时 NaN；字段对应的真实检测结果未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `get_object_detection_result` | 仅物体缓存为空时 NaN；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `get_position_of_body_part` | 仅无检测结果时 NaN；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `get_tilt_angle_of_face` | 仅无检测结果时 NaN；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `move_to_body_part` | 仅无检测结果时不修改位置；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `recognize_body_part` | 仅无检测结果时 false；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 检测/模型/身体识别 | `recognize_gesture` | 仅无检测结果时 false；检测后端未实现 | kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md |
| 摄像头 | `open_close_webcam` | 仅从未开启 profile 的 turn_off；turn_on 明确拒绝，摄像设备未实现 | kn-panel-capture.md |
| 摄像头 | `open_hide_camera` | 仅从未开启 profile 的 turn_off；turn_on 明确拒绝，摄像设备未实现 | kn-panel-capture.md |
| 摄像头 | `set_camera_alpha` | 仅共享离线 alpha 控制值，严格 Number 与夹取；实际摄像/渲染未实现，异步相位未验证 | kn-panel-capture.md |
| 摄像头 | `set_webcam_alpha` | 仅共享离线 alpha 控制值，严格 Number 与夹取；实际摄像/渲染未实现，异步相位未验证 | kn-panel-capture.md |
| 麦克风/语音 | `get_voice_answer` | 仅未开始识别的初始空文本；麦克风、权限与识别后端未实现 | kn-panel-capture.md、kn-remaining-official.md |
| 麦克风/语音 | `get_voice_volume` | 仅默认权限 pending、拒绝 0、显式停用录音 NaN 与可选浏览器采样；每次读等待下一 update，真实无设备错误与完整平台差异未验证 | kn-panel-capture.md、kn-remaining-official.md |
| 麦克风/语音 | `voice_recognition` | 仅未登录提前返回与宿主提示；真实权限/识别/登录 UI 未实现 | kn-panel-capture.md、kn-remaining-official.md |
| 账户/排行榜 | `username_get` | 仅无账户后端 profile：官方未登录文本；已登录用户未实现 | kn-async-services.md、kn-panel-services.md |
| 账户/排行榜 | `user_id_get` | 仅无账户后端 profile：官方未登录返回字符串 0；已登录用户未实现 | kn-async-services.md、kn-panel-services.md |
| 账户/排行榜 | `show_hide_ranking` | 仅本地未发布作品的无榜单提前返回；真实榜单 UI/网络未实现 | kn-async-services.md、kn-panel-services.md |
| 账户/排行榜 | `update_ranking` | 仅本地未发布作品的无榜单提前返回；真实分数提交/持久化未实现 | kn-async-services.md、kn-panel-services.md |
| 账户/排行榜 | `user_ranking_info` | 仅无 KN 榜单后端的 numeric NaN；真实排名/分数查询未实现 | kn-async-services.md、kn-panel-services.md |
| 账户/排行榜 | `user_info_of_th` | 仅无 KN 榜单后端的 numeric NaN，order 仍求值；真实用户查询未实现 | kn-async-services.md、kn-panel-services.md |
| 联网翻译 | `translate` | 仅离线传输失败/空白提前返回；成功翻译与对话框未实现，Promise 相位未验证 | kn-panel-services.md |
| 联网翻译 | `translate_result` | 仅离线失败/空白返回空文本并求值输入；成功翻译后端未实现，Promise 相位未验证 | kn-panel-services.md |
| 全局特效宿主 | `global_animation` | 仅阻塞式宿主请求/完成回调；viewer 的 SVGA/全局音频/滤镜未实现，未接宿主会等待，官方像素与时序未验证 | kn-panel-services.md |

## 复现

```powershell
node tools/compat/kn-partial2-scope.mjs --write
node tools/compat/kn-catalog-status.mjs --snapshot docs/kn-block-coverage.md
node --test tests/kn-partial2-scope.test.mjs
```

本页由显式范围清单与覆盖工具生成；正文比较统一 CRLF/LF，证据夹具哈希不做换行归一化。
最终全量门禁、三 seed 语料与未完成部分见 worktree 根目录未提交的 `OC-REPORT.md`。
