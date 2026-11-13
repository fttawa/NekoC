# Kitten 4 第三轮：音频、MIDI、摄像头、手机事件

## 范围与证据口径

本模块覆盖 **24 项**：原指定 16 项，加完整缺失清单末尾的
`set_speaking_language`、`shock_duration`、`shock_for_n_times`、`translate`、
`translate_result`、`turn_on_the_camera`、`turn_on_the_qrcode_camera`、
`voice_recognition`。基础和物理入口分别见同目录第三轮专题。

官方只读位置：`K4_PLAYER_DIR=E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`，
主包 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`。
固定包 SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
位置均为 `tools/compat/k4-block-catalog.mjs` 的 `webpackModules` 提取后的
factory `function` 开头起算、0-based JavaScript UTF-16 字符 offset，
domain 指属性起点；不是字节或整包偏移。调查只读 factory.toString，
不调用官方 factory、不写回官方包、不复制官方源码/作品/音频到跟踪文件。

这是**官方源码推导实现与合成回归**，不是官方浏览器差分结论。
实际相机、麦克风、微信、手机配对、音频资源与在线翻译未实测。

## 每积木位置与实现边界

| 官方积木 | 官方位置 | 本地语义与明确边界 |
| --- | --- | --- |
| `display_recognition_result` | Tn6a@65507 | 结果展示获取阻塞锁；宿主完成一次释放所有并发结果展示锁。不是没有相机就 noop。无官方展示 UI。 |
| `get_recognition_result` | Tn6a@66019 | 初始空文本；成功扫码结果按严格十进制规则转数值，前导零等保留文本。桌面路径；微信载入器未仿真。 |
| `get_voice_answer` | xQfl@29026 | 独立的语音识别答案，不能错误别名到普通问答。严格十进制转数值，否则文本；初始空文本。 |
| `midi_get` | xQfl@28986 | 每次产生新 `{id: midi}` 对象（Cell::Midi），保留字段原类型与对象身份，不用列表或数字代替。 |
| `midi_play_note` | xQfl@28306；Qeyy@1409 | note 用 JS parseInt 风格解析；beats 必须实际 Number、有限且 >0；80 BPM，阻塞相应时长，输出宿主 MIDI 请求。仅 0..87 的整数键有效；不等同官方钢琴采样发声认证，最新证据见 kitten4-audio.md。 |
| `midi_play_num_note` | xQfl@28559 | `{id:...}` 直接取 id；普通输入必须实际 Number，Math.round 后范围 0..100，再夹到 1..88 并减 1。无效值不播放不等待。beats 同上。null 明确运行错误，不用零替代。 |
| `midi_wait` | xQfl@28229；Qeyy@1448 | Number 拍数转 0.75 秒/拍；非 Number 为 0，但仍经过 K4 wait yield。NaN/非有限极端调度未做官方逐帧验证。 |
| `on_mobile_click_btn` | Tn6a@58661；注册元数据 Tn6a@90260 附近 | 状态 reporter：device、btn_event_type 严格文本匹配，type 大写后比较；无事件 false。带 body 的根转既有 K4 when-style 单线程循环，一帧状态需 tick 末清理。与官方 restart_when_finished 的同帧相位仍为 partial。 |
| `on_mobile_shake` | Tn6a@77242 | 显式宿主 device 事件匹配；无事件不启动 body。使用现有 active-scene/clone 规则；官方跨场景/克隆与重入时序未差分验证。 |
| `on_mobile_slide` | Tn6a@76534 | 非空 device 与 type 均严格匹配，不把 LEFT 当 left。只允许静态注册 filter。 |
| `on_mobile_slope` | Tn6a@76888 | 同上，过滤依据是事件 type，不从角色方向/键盘伪造。 |
| `on_shake` | Tn6a@6050、@91185 | responder 路径在显式宿主 shake 时触发，不启动时自动执行。普通 domain 自身返回 true 与 responder 根是不同路径；本实现聚焦 responder 根。 |
| `on_tilt` | Tn6a@6085、@91325 | 显式宿主 tilt 的 type 过滤；不从 sprite.rotation 推断。与 on_shake 相同的 domain/responder 区别。 |
| `play_ask_record` | xQfl@30126 | 无录音 token 不播放；已有 token 输出非阻塞播放请求，与识别答案分离。桌面无效 `undefined`/`null` 字符串被过滤；微信分支未实现。 |
| `self_ask_listen` | xQfl@29180 | 队列化阻塞请求，保留 text、lang，宿主完成后写语音答案。尚未实现“先 TTS 播放问题再显示录音对话”的浏览器过程，不伪造识别成功。 |
| `self_ask_record` | xQfl@29769 | 队列化阻塞请求，注意原 socket 为大写 TEXT；完成写录音 token，不覆写识别答案。TTS、录音格式、权限 UI 留宿主。 |
| `set_speaking_language` | xQfl@31377 | english/en、chinese/zh、french/fra、spanish/spa、japanese/jp，未知默认 en；语言进入 SpeechCommand.language 和 viewer utterance.lang。浏览器离线 TTS 与官方在线音色仍不等价，保留 partial。 |
| `shock_duration` | Tn6a@6320 | 非阻塞输出 duration*1000 毫秒的震动请求；无宿主振动设备时没有物理效果，不产生等待。浏览器 Vibrate API 归一化未仿真。 |
| `shock_for_n_times` | Tn6a@6119 | JS for counter<times，正分数向上计数；每次 100ms 震动+100ms 间隔。安全上限 4096 次，超出明确报错，不截断或假成功。 |
| `translate` | Tn6a@29365 | **只实现已定位的离线请求失败分支**：参数求值后释放，不展示成功对话；不访问网络，不伪造译文。 |
| `translate_result` | Tn6a@29544 | 官方请求失败 fallback 为输入文本前 200 个 UTF-16 code units；falsy 输入空文本。本实现该离线分支，不声称联网翻译/缓存命中/成功 UI 支持。切在代理对中间时 Rust 用替换字符表示，孤立 surrogate 不是精确 JS 字符串。 |
| `turn_on_the_camera` | Tn6a@64227 | 默认无相机，复现官方 PC capability test 失败后不取队列锁；宿主声明有相机才进入独立 scanner 队列并阻塞至完成。无微信/移动端 500ms wrapper。 |
| `turn_on_the_qrcode_camera` | Tn6a@64142 | 官方直接转发 turn_on_the_camera；共用上述路径。 |
| `voice_recognition` | xQfl@29552 | 不读问题文本的识别请求，仍阻塞且按 dialog FIFO 排队。语音服务/权限/实际识别由宿主提供。 |

## 额外官方依据（不含源码摘录）

- `xQfl@22433`：beats_to_duration 的节拍基数 80；数值类型检查；
  `xQfl@22575`：钢琴键采样资源播放，衰减时长至少 200ms。
  本实现输出 **A0=0 到 C8=87 的钢琴键索引**，不是通用 MIDI 音高编号；
  未复制官方采样文件，宿主需自己映射资源。
- `xQfl@25236`：TTS 使用 speaking_language。jp→ja、en→en-UK、
  spa→es-ES、fra→fr；其他语言按文本是否含 U+00FF 外字符选 zh-CN/en-UK。
- `Tn6a@62844`：扫码的数值转换辅助函数；camera test 失败有提示，直接返回。
  `fhSb@2455` 附近的扫描桥接读取 camera_state；`DLGQ@108` 初始 qrscan_result 为空串。
- `Tn6a@25187`：翻译辅助函数含失败回调与 200 UTF-16 截断；
  `at36@2700` 附近为实际翻译网络桥接。此实现不联网。
- `VL4Q@0`：dialog/scanner 两个独立 FIFO，store 取调用线程锁，完成后 release；
  start/stop 重置队列。主引擎请求 ID 跨 start 单调，拒绝迟到回包。
- `Tn6a@90260` 附近 Wt：mobile button 一帧状态与 restart_when_finished 元数据；
  手机动态 responders 的过滤器见上表各 id 位置。无配对消息时不能伪造触发。

## 实现结构与接线合同

新增：

- `src/kitten4/media_devices.rs`：仅 VM lowering；不改 canonical type/fields，
  使 native workspace/published 原样 roundtrip。精确匹配 24 类型，不做前缀兜底。
- `src/engine/k4_media.rs`：Compiler helper、运行时 State、宿主请求/完成 API，
  保留设备能力与阻塞，而非把未知设备功能清零。
- `tests/kitten4_media_devices.rs`：完全合成 workspace/published 双通路探针，
  默认 JIT/禁 JIT 两种运行，原样 roundtrip，数值类型、时序、队列、迟到回复。

另对 `src/engine/value.rs` 增 `Cell::Midi`、typed value reporter variant；
`extensions.rs` 对不支持的对象仍明确拒绝；`jit.rs` 的 Option<Cell> tag 探针补新 variant；
`cloud.rs` 的 object guard 补新 variant。`engine.rs`、`kitten4.rs` 已接入编译、执行、事件与重置。

### 引擎接线

1. `mod k4_media; pub use k4_media::{MediaRequest, MediaOutput, RequestKind};`
2. 在 `Op` **末尾**追加 `K4Media(k4_media::Command)`，ScriptEvent 追加
   `K4Media(k4_media::Event)`；Engine 增 `k4_media: k4_media::State`。
3. Engine 构造默认 State；`start` 调 reset（保留单调请求 ID 与宿主 camera capability）；
   每 scheduler tick **末尾**与 pointer 一帧状态同处调 `clear_frame`。
4. Compiler::value_one 五个 reporter internal type：
   `kitten4_media_midi_get/get_voice_answer/get_recognition_result/on_mobile_click_btn/translate_result`
   → `ValueExpr::K4Media(self.k4_media_reporter(b)?)`。
5. numeric expression 的同五类型 → `ExprOp::Value(self.value(b)?)`。
   `evaluation_children`：
   `ValueExpr::K4Media(r) => children.extend(r.children().into_iter().map(|i| (true,i)))`。
   `eval_value_one`：`ValueExpr::K4Media(r) => self.eval_k4_media(r,actor)`。
6. chain 下列 internal command 类型 → `Op::K4Media(self.k4_media_command(b)?)`：
   midi_wait、midi_play_note、midi_play_num_note、set_speaking_language、self_ask_listen、
   voice_recognition、self_ask_record、turn_on_the_camera、turn_on_the_qrcode_camera、
   display_recognition_result、play_ask_record、shock_duration、shock_for_n_times、translate，
   均带 `kitten4_media_` 前缀。
   exec：`Op::K4Media(c) => return self.exec_k4_media(index,actor,c)`。
7. owner root 五个 internal hat：on_mobile_slide、on_mobile_slope、on_mobile_shake、
   on_shake、on_tilt，均带前缀，→ `ScriptEvent::K4Media(self.k4_media_event(root)?)`；
   body 分派纳入 `DO` 或 next。手机按钮**不是**第六个普通事件。
8. K4 ADD 两个对象字符串化判断加 Cell::Midi；K4Change 中 previous object 排除与
   value object 字符串化判断也加 Midi。保留主会话同时加入的 K4Frames/K4DomainError。
9. 可选 Frame additive 出线：pending_k4_media/take_k4_media_output。
   无这些 JSON 字段时公共 Engine API 仍可直接使用，测试通过 API。
10. SpeechCommand 增可选 language，K4 Speech 调 `k4_speech_language(&text)`，
    前端 utterance.lang 消费此字段；旧帧与 KN 保留原文本检测 fallback。

kitten4.rs 只注册 `mod media_devices` 并在 lower_block early hook 调
`media_devices::lower_media_devices(block)` 即可，不用另加 translate 分派。

### 宿主 API

- `pending_k4_media() -> Vec<MediaRequest>`：dialog/scanner 各头部，及结果展示请求；
  同类排队不暴露后面的请求。
- `complete_k4_media(id, result) -> bool`：成功只完成一次；未知/取消/迟到 id false。
  录音结果是宿主 token，扫码/识别结果是文本；无回复保持阻塞，不假设设备成功。
- `set_k4_camera_available(bool)`：明确能力探测，不默认真实 camera 存在。
- `Frame.k4_media_output`：`advance()` 交付 MIDI/录音播放/震动命令，不包含采样数据；兼容 `take_k4_media_output()` API 保留，但已交付到 Frame 的命令不会重复出队。
- `k4_device_event(action, device, value)`：五个真实事件；动态 slide/slope device/type
  非空且严格匹配；本实现 busy responder 不重复生成线程。
- `k4_mobile_button(device,event,kind)`：一帧按钮状态，不自动映射键盘。
- `k4_speech_language(text)`：查询当前 TTS 语言。

## 测试与未完成

媒体回归包含合成 workspace/published、解释器/默认 JIT 双路径；最终统一验证结果见根目录交付报告。
`tests/project-audio.test.mjs` 另验证 language 消费、旧帧 fallback 与 KN 隔离；不代表真实音色或语音服务实测。

### 当前 viewer 的媒体输出接线

**本轮仍不宣称真实设备全等，但 K4 的媒体输出已经接入 Frame 和 Web viewer。**
媒体输出已接入 Frame；pending 请求仍需宿主按 id 完成，viewer 没有完整请求 UI。现有 TTS 的 language 字段已接入。因此：

- Web viewer 通过 `use_browser_audio()` 使用 frame-only 契约：`Frame.k4_media` 与 `Frame.k4_media_output` 提供相同一批增量，音频宿主仅消费前者的 MIDI，设备宿主仅消费后者的震动；两字段不是应拼接的两个队列。MIDI 使用本地 WebAudio 音源，不等于官方钢琴 MP3 的音色或声学一致性；录音播放尚无 viewer 实现。
- `web/k4-device.js` 已桥接权限探测、真实 motion/orientation 事件和 capability-checked `navigator.vibrate`。缺失/拒绝能力不伪造成功或零值传感数据，真实硬件效果仍未认证，见 `kitten4-device.md`。
- headless `MediaOutput::Midi` 不会自动发声，PlayRecord 不会自行播放，Vibrate 不会振动。
- 默认 camera=false 只复现失败路径；设为 true 后，如无人调用 complete API，脚本将一直等待。
- 语音对话、识别与结果展示请求没有 viewer UI 来完成，仍会阻塞。不得为了让作品跑完自动填空/成功。
- 手机按钮/slide/slope/shake 只由显式 API 输入，viewer 没有手机配对传输；raw motion 不自动伪造 shake/tilt/slide 事件。
- `set_speaking_language` 会设置 viewer 请求语言，但可用音色、发音质量与回调链依赖浏览器，保持 partial。
- 即使 Rust 合成测试全部通过，也只证明 engine 公共 API 合同，不证明设备/browser parity。

仍需后续接入：viewer 显示权限/录音/扫码 UI 并按 id 回包；
MIDI 钢琴键索引接合法自有采样音源；录音 token/URL 接播放；手机控制器配对传输；
现有 TTS 语言字段已接线，不需要再重复添加。

测试包括：MIDI 对象与键边界、invalid/string beats、不等待无效音符、80 BPM 阻塞、
strict voice/scan 结果、录音 token 隔离、无 camera 不锁/有 camera 锁等待、
结果展示阻塞、重启拒绝旧 id、五个设备 hat 初始 dormant 与过滤、按钮类型大小写、
翻译离线截断、language 状态、震动 pattern、dialog FIFO。

未完成/不声称支持：真实采样播放器、录音识别服务、微信扫码、扫码/录音 UI、
联网翻译成功分支和缓存、官方错误提示 UI、TTS 前后回调链、所有跨场景/克隆/取消/
同帧重入差分、无效 filter 动态求值、JS 孤立 surrogate 精确存储。
请求队列上限 256、振动次数上限 4096、未消费输出上限 1024 是本地安全界限，超限报错。
宿主需消费 `advance()` 返回的媒体输出；headless 引擎不会自动执行硬件效果。浏览器无需额外排空旧 take 队列。
