# KN partial 静态频率与非硬件优先级

> static, not execution：这是静态积木节点频率，不是执行频率、作品通过率或完整语义认证。

## 固定任务基线与语料

- partial 身份和历史限制来自提交 `e63147f259abb65bfca69887d12324b1b09e1c95` 的 `docs/kn-block-coverage.md`，固定 **117 类型（57 非硬件、60 硬件）**，不跟随当前覆盖升级。历史 VM 行号/限制不是当前缺陷断言。
- 文件由当前 `git ls-files -z -- '*.bcmkn'` 与基线 `git ls-tree` 交集确定；读取当前工作区文件，JSON 保存各文件 SHA-256。排除所有基线后新加作品（包括本轮 partial 新夹具），避免回归探针反向制造需求。未跟踪作品永不计入。
- 只统计 actors/scenes/procedures 的 `nekoBlockJsonList`，沿 `next / inputs / statements` 递归；不把 `fields.type`、变量声明、XML shadow 文本当积木。保留游离根和 callback 输入；不是可达性分析。
- HateNeko 仅是可选名称核对/实现函数检索参考，不是官方语义证据；默认无需外部文件。JSON 保留 117 个逐类型行和逐节点位置。

| 分组 | 文件数 | 全部积木节点 | partial 类型 | partial 节点 |
| --- | ---: | ---: | ---: | ---: |
| projects | 16 | 40421 | 2 | 4 |
| samples | 9 | 14132 | 1 | 3 |
| fixtures | 39 | 2037 | 4 | 43 |
| other | 0 | 0 | 0 | 0 |

全部 partial **50 次**；非硬件零频率 **52 类型**；硬件 60 类型共 **0 次**。

## 非零类型：样例与夹具分开

| 类型 | projects 次/文件 | samples 次/文件 | fixtures 次/文件 | 总次数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `convert_type` | 3/3 | 3/1 | 34/7 | 40 |
| `mouse_down` | 1/1 | 0/0 | 0/0 | 1 |
| `get_clone_index_property` | 0/0 | 0/0 | 7/2 | 7 |
| `setInterval` | 0/0 | 0/0 | 1/1 | 1 |
| `setTimeout` | 0/0 | 0/0 | 1/1 | 1 |

### 重复版本、游离与字段误计

- PENCRAFT 三个版本的 convert_type 各 1 次，是相同 b29 转换逻辑，不是三个独立需求。样例/项目共 6 次转换，但只有两个作品系列来源。
- `samples/我的作品-原生.bcmkn` 的 3 次转换：1 个在 self_listen 事件树内，1 个是游离 reporter，1 个在游离 variables_set 根栈下。不能把全部 3 次当运行需求；定义树中的节点也未必被调用。
- Fangjie 的 mouse_down 仅 1 次，down、空目标（屏幕）；不能把此频率推广成命名角色/克隆拾取需求。
- 克隆属性夹具 7 次集中于私有变量 UUID，不是数字特效码/宽高属性的频率证据。timer 的两次注册只来自专门夹具，callback 节点即使静态计入也不表示执行。
- input-kn.bcmkn 有 sprite_on_tap 的 fields.type=mouse_down；这不是 mouse_down 积木。对所有 JSON 对象泛型递归会多计 1 次，本工具夹具 mouse_down 正确为 0。
- 空模板也在文件分母中；未按作品家族自动去重。逐文件频率和节点根类型可在 JSON 中复核。

## 非硬件可修建议（历史候选，不自动认定当前仍有缺陷）

1. **convert_type**：优先完整原生工程差分、数组/对象字符串化及 UTF-16 边界；已有 63 条官方带类型观测，不重复声称缺失基础转换。候选 `src/engine/kn_conversion.rs::convert`、`src/engine/value.rs`、`tests/kn_conversion.rs`、`tools/compat/kn-conversion-probe.mjs`；见 `docs/kn-conversion.md`。本轮并行修复后先核对新证据。
2. **mouse_down**：局部验证非法目标的错误时机（历史编译拒绝 vs 官方诊断后 false）、拖出抬起/场景切换/克隆删除。候选 `src/engine.rs` 的 mouse_down 分派、`src/engine/input.rs::kn_pointer_state`/`pointer_target_matches`、`tests/kn_pointer.rs`；见 `docs/kn-pointer.md`。
3. **get_clone_index_property**：补属性码、严格索引类型与失效目标矩阵；不要按私有变量频率推导所有属性需求。候选 `src/engine/kn_appearance.rs::kn_clone_property`/`eval_kn_clone_property`/`kn_property`、`tests/kn_appearance_dialog.rs`；本轮已修复的数字码和索引缺口见 `docs/kn-partial.md`，剩余边界按新证据记录。
4. **timer 生命周期**：取消、stop/restart、scene/clone 生命周期的局部差分；不是实现通用闭包。官方当前原生 callback statement 被丢弃，不能据 JS 常识改成执行。候选 `src/engine/kn_async.rs`、`tests/kn_async.rs`；见 `docs/kn-timers.md`。
5. **零频率局部项**：气泡并发取消、文本 costume 缩放可后续小范围取证，候选 `src/engine/kn_appearance.rs::kn_dialog`/`kn_property` 及 engine 对白 lowering；不因零频率而宣称无用户价值。
6. **暂后**：AI、账户、榜单、翻译成功路径、摄像、全局动画宿主和真实硬件后端在本语料无频率依据，成本/外部依赖高；不把离线 fallback 升级为真实支持。

## 非硬件零频率全量名单

`ai_chat_answer`、`ai_chat_ask`、`ai_text_actor`、`ai_text_photo`、`ai_text_result`、`ai_text_result_check`、`appearance_of_sprite`、`bump_into_body_part`、`check_emotion`、`check_face_shape`、`check_gender`、`check_tilt_direction_of_face`、`clearInterval`、`clearTimeout`、`enable_face_detect_by_actor`、`enable_face_detect_by_photo`、`enable_object_detect_by_actor`、`enable_object_detect_by_photo`、`evaluate_actor_style`、`evaluate_camera`、`evaluate_photo`、`face_to_body_part`、`get_appearance_of_part`、`get_evaluate_class_accuracy`、`get_evaluate_class_name`、`get_face_detection_result`、`get_object_detection_result`、`get_position_of_body_part`、`get_sprite_property`、`get_tilt_angle_of_face`、`get_voice_answer`、`get_voice_volume`、`global_animation`、`move_to_body_part`、`new_conversation`、`open_close_webcam`、`open_hide_camera`、`recognize_body_part`、`recognize_gesture`、`self_dialog_wait`、`set_camera_alpha`、`set_system_preset`、`set_webcam_alpha`、`show_hide_ranking`、`translate`、`translate_result`、`update_ranking`、`user_id_get`、`user_info_of_th`、`user_ranking_info`、`username_get`、`voice_recognition`

## 硬件逐类型（保留零计数）

| 类型 | 静态次数 |
| --- | ---: |
| `catbit_button_is_pressed` | 0 |
| `catbit_button_when` | 0 |
| `catbit_usb_button_when` | 0 |
| `change_robot2_master_motor_power` | 0 |
| `change_robot_master_motor_power` | 0 |
| `get_robot2_master_motor_power` | 0 |
| `get_robot_master_infrared_sensor_distance` | 0 |
| `get_robot_master_motor_power` | 0 |
| `microbit_accelerometer` | 0 |
| `microbit_button_is_pressed` | 0 |
| `microbit_button_when` | 0 |
| `microbit_change_bpm` | 0 |
| `microbit_compass_heading` | 0 |
| `microbit_get_volume` | 0 |
| `microbit_is_gesture` | 0 |
| `microbit_led_clear` | 0 |
| `microbit_led_is_plot` | 0 |
| `microbit_led_plot` | 0 |
| `microbit_led_plot_graph` | 0 |
| `microbit_led_show_custom` | 0 |
| `microbit_led_show_icon` | 0 |
| `microbit_led_show_number` | 0 |
| `microbit_led_show_text` | 0 |
| `microbit_led_toggle` | 0 |
| `microbit_led_unplot` | 0 |
| `microbit_light_level` | 0 |
| `microbit_logo_is_pressed` | 0 |
| `microbit_logo_when` | 0 |
| `microbit_magnetometer` | 0 |
| `microbit_math_map` | 0 |
| `microbit_pause_by_beats` | 0 |
| `microbit_pin_analog_read` | 0 |
| `microbit_pin_analog_write` | 0 |
| `microbit_pin_digital_read` | 0 |
| `microbit_pin_digital_write` | 0 |
| `microbit_pin_set_touch_mode` | 0 |
| `microbit_pin_when` | 0 |
| `microbit_play_melody` | 0 |
| `microbit_play_tone_by_beats` | 0 |
| `microbit_rotation` | 0 |
| `microbit_servo_set_angle_270` | 0 |
| `microbit_set_bpm` | 0 |
| `microbit_set_volume` | 0 |
| `microbit_sound_level` | 0 |
| `microbit_stop` | 0 |
| `microbit_temperature` | 0 |
| `set_robot2_master_motor_power_rotation` | 0 |
| `set_robot2_master_motor_power_rotation_duration` | 0 |
| `set_robot_master_light_color` | 0 |
| `set_robot_master_light_color_duration` | 0 |
| `set_robot_master_motor_power_rotation` | 0 |
| `set_robot_master_motor_power_rotation_duration` | 0 |
| `stop_robot2_master_motor` | 0 |
| `stop_robot_master_light` | 0 |
| `stop_robot_master_motor` | 0 |
| `wand_button_is_pressed` | 0 |
| `wand_coordinate` | 0 |
| `wand_direction_when` | 0 |
| `wand_reset_position` | 0 |
| `wand_rotation` | 0 |

## 复现

```powershell
# 默认只输出 JSON，不写文件；需要本地 Git 历史中的固定基线提交
node tools/compat/kn-partial-frequency.mjs
# 生成当前 worktree 的两份报告
node tools/compat/kn-partial-frequency.mjs --write
# 可选：校验外部清单并检索 rt/impl/*.lua 的 M.<type> 引用
node tools/compat/kn-partial-frequency.mjs --reference E:/nekoc-wt/_ref/hateneko/player
node --test tests/kn-partial-frequency.test.mjs
```

`--reference` 也接受 block_catalog.json 文件；只校验清单，不扫描函数。缺少基线 Git 对象时明确失败，不回退到实时覆盖表。报告无时间戳；相同跟踪集合和文件字节可确定性重生成。
