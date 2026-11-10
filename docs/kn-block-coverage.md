# KN 300 项积木编译／运行覆盖审计

> 审计口径：原生 `.bcmkn` → `Program::compile` → engine VM；不是 TS API 发射清单，也不是官方行为全兼容认证。

## 结论与统计

清单共 **300 项**，**116 项缺失**，其余 184 项只有执行路径或元数据证据。**本报告认证完整语义支持的项数为 0**；不能将显式分派数当作兼容率。大量硬件、AI、网络、账户、摄像头后端仍未完成。

| 分类 | 项数 | 含义 |
| --- | ---: | --- |
| 有执行路径／未完整验证 | 176 | 代码存在；未逐字段、选项、异常与官方差分 |
| 部分语义 | 5 | 有路径且已识别具体限制/近似 |
| 固定值占位 | 1 | 返回固定值，不代表设备能力 |
| 元数据 | 2 | 由其他编译环节消费，不独立执行 |
| 缺失 | 116 | 无对应执行路径；不是 stub 支持 |

分类互斥且加总 300。`部分语义` 并非只有这几项存在风险；其余有路径项同样没有完整语义保证。

## 清单、证据与复现边界

- 外部清单：`E:/nekoc-wt/_ref/hateneko/player/kn_spec/block_catalog.json`（300 个类型名）；仅转录名称/事件标记，不把第三方作品或运行时内核复制入库。
- 清单文件 SHA-256：`7fc0f41daf559baa6bab970607fc37e6109e359f947c314b1d2621f42ca3b535`。本地名称快照在 [kn-catalog-manifest.mjs](../tools/compat/kn-catalog-manifest.mjs)，传外部路径运行时会校验哈希和全量集合。
- HateNeko **仅是实现参考和清单来源，非官方语义证据**。官方来源、下载哈希和小段定位见 [kncat-official-evidence.md](kncat-official-evidence.md)。
- 最新集成基线另有 [kn-semantics.md](kn-semantics.md) 的官方 KN 原创夹具实测，覆盖有限调度、列表读取与转换样例；它不把本表升级成全类型/全字段认证。
- 官方 bundle：`https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`；SHA-256 `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`。`_execute` byte 2962264 是空函数；`_array_literal` byte 2962446 使用 `Object.values`。空函数不等于输入不求值，执行管线仍需单独验证。
- 导入层 `src/bcmkn_compiler.rs::build_nested_block` 泛型保留 type/fields，再按连接重建 inputs/statements/next；这只能说明能装配/读取，不能证明 VM 支持。`tests/kn_gap.rs::workspace_compiler_preserves_unknown_types_without_claiming_vm_support` 专门覆盖此区别。
- 实现定位只扫描 value_one、expression_one、scripts、chain 的类型分派，排除注释、字段选项、expression_inputs 遍历提示和游离根忽略名单。元数据单独列出。此静态审计不能证明每条 guard 在 KN 模式均可达，也不能替代运行测试。
- 表中缺失项的 `—` 表示四处执行分派及两处元数据均无匹配；当前表达式/指令/根事件分别进入 unsupported 诊断。游离或未执行代码被忽略不算运行支持。
- 该 300 项清单不是官方全集；例如基础阴影/过程类型可能不在此清单，不能据此推断它们缺失。

## 测试证据与未验证项

- 工具回归：`npm run -s test:tools`；Rust 全量回归：`cargo test --all-targets`。最终执行结果及失败后重跑记录见 worktree 根目录未提交的 `OC-REPORT.md`，这里不固化随测试环境变化的历史失败数。防漂移测试校验 300 名称、互斥统计、保守状态、真实类型分派过滤和文档 300 行；可选外部清单校验由工具完成。
- 本次 `tests/kn_catalog.rs` 含 **9 个测试**，覆盖 **12 个新增类型**：`script_variables_set`、`change_script_variables`、`controls_while`、`__break__`、`_break_statement`、`_continue_statement`、`_return_statement`、`_execute`、`_array_literal`、`calculate`、`get_timer`、`reset_timer`。这不是 300 项逐项运行认证。
- `tests/kn_catalog.rs` 覆盖 while 前测/重测、内层 break、continue 的 repeat/range/while 与 warp、脚本变量、返回及输入副作用、数组键顺序/类型、公式、独立计时器；部分测试请求 JIT 开关，不表示每个分支都实际进入热 JIT。
- `tests/kn_gap.rs` 有 16 个前序代码视图类型的执行、数值/Latin-1 边界、严格 Number 谓词、热循环侧退出及未知类型导入/拒绝测试。
- 下表 `Tn` **仅表示测试源码直接引用该类型名**（动态构造、辅助函数或间接覆盖可能未计；同样可能只是错误测试），不表示所有字段/子选项已测。`未定位` 也不等于没有任何测试。已过滤 Kitten4 专属与 `kitten_n_compat.rs`；余下文件可能包含旧 runtime/导入层测试，源码引用仍不能直接当作 engine 行为证据。
- 未完成：300 项分别构造原生工程编译/执行、每个 dropdown/socket 与 malformed input、官方编辑器差分、跨平台硬件/AI/网络后端、渲染和音频最终输出的全量验证。没有新增/交付 `.bcmkn` 作品，因此本报告不声称编辑器检查通过。

- **T1**：[tests/actor_variables.rs](../tests/actor_variables.rs)（源码引用，执行状态见上文）
- **T2**：[tests/audio.rs](../tests/audio.rs)（源码引用，执行状态见上文）
- **T3**：[tests/bcmkn_web.rs](../tests/bcmkn_web.rs)（源码引用，执行状态见上文）
- **T4**：[tests/depth.rs](../tests/depth.rs)（源码引用，执行状态见上文）
- **T5**：[tests/engine.rs](../tests/engine.rs)（源码引用，执行状态见上文）
- **T6**：[tests/extensions.rs](../tests/extensions.rs)（源码引用，执行状态见上文）
- **T7**：[tests/import_performance.rs](../tests/import_performance.rs)（源码引用，执行状态见上文）
- **T8**：[tests/input.rs](../tests/input.rs)（源码引用，执行状态见上文）
- **T9**：[tests/jit_differential.rs](../tests/jit_differential.rs)（源码引用，执行状态见上文）
- **T10**：[tests/kn_catalog.rs](../tests/kn_catalog.rs)（源码引用，执行状态见上文）
- **T11**：[tests/kn_gap.rs](../tests/kn_gap.rs)（源码引用，执行状态见上文）
- **T12**：[tests/mvp.rs](../tests/mvp.rs)（源码引用，执行状态见上文）
- **T13**：[tests/nonfinite.rs](../tests/nonfinite.rs)（源码引用，执行状态见上文）
- **T14**：[tests/pack.rs](../tests/pack.rs)（源码引用，执行状态见上文）
- **T15**：[tests/studio.rs](../tests/studio.rs)（源码引用，执行状态见上文）
- **T16**：[tests/video.rs](../tests/video.rs)（源码引用，执行状态见上文）

## 全量逐项表（300 行）

所有行的导入层均为上文 `build_nested_block` 泛型路径；只在“VM/编译位置”列有路径时才有进一步实现证据。行号随源码演化变化，可用下述命令重新生成。

| # | 类型 | 状态 | VM/编译位置 | 测试源码线索 | 限制／未验证 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `__break__` | 有执行路径／未完整验证 | `src/engine.rs:4025` | T10 | 官方类型声明/API 伪名；编辑器实际积木为 break。此分派仅为兼容输入，非同名积木支持 |
| 2 | `_array_literal` | 有执行路径／未完整验证 | `src/engine.rs:1772`<br>`src/engine.rs:2420` | T10 | 官方 Object.values 与 items0… 已核实；NekoC 保留输入顺序/类型，完整参数绑定差分未验证 |
| 3 | `_break_statement` | 有执行路径／未完整验证 | `src/engine.rs:4025` | T10 | 官方注册/JS 转换已验证；KN 原生播放中的嵌套退出与调度差分未验证 |
| 4 | `_continue_statement` | 有执行路径／未完整验证 | `src/engine.rs:4033` | T10 | 官方注册/JS 转换已验证；KN 原生播放中的作用域与调度差分未验证 |
| 5 | `_execute` | 有执行路径／未完整验证 | `src/engine.rs:3067` | T10 | 官方域函数空体；NekoC 先求值 action 再丢弃结果，完整官方输入求值管线差分未验证 |
| 6 | `_object_get` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 7 | `_object_literal` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 8 | `_object_set` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 9 | `_return_statement` | 有执行路径／未完整验证 | `src/engine.rs:3731` | T10 | 官方注册/JS 转换已验证；NekoC 复用过程返回，KN 原生播放差分未验证 |
| 10 | `_variable_get` | 有执行路径／未完整验证 | `src/engine.rs:1883`<br>`src/engine.rs:2420` | T10, T11 | 有路径；完整语义未验证 |
| 11 | `_variable_set` | 有执行路径／未完整验证 | `src/engine.rs:3161` | T10, T11 | 有路径；完整语义未验证 |
| 12 | `add_width_height_scale` | 有执行路径／未完整验证 | `src/engine.rs:3320` | T12 | 有路径；完整语义未验证 |
| 13 | `ai_chat_answer` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 14 | `ai_chat_ask` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 15 | `ai_text_actor` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 16 | `ai_text_photo` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 17 | `ai_text_result` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 18 | `ai_text_result_check` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 19 | `appearance_of_sprite` | 部分语义 | `src/engine.rs:2498` | T5, T12 | width/height/scale 均映射 ExprOp::Scale；不能代表独立宽高百分比 |
| 20 | `ask_and_choose` | 有执行路径／未完整验证 | `src/engine.rs:3642` | T3, T5, T12 | 有路径；完整语义未验证 |
| 21 | `atob` | 有执行路径／未完整验证 | `src/engine.rs:1887`<br>`src/engine.rs:2420` | T11 | 有路径；完整语义未验证 |
| 22 | `btoa` | 有执行路径／未完整验证 | `src/engine.rs:1888`<br>`src/engine.rs:2420` | T11 | 有路径；完整语义未验证 |
| 23 | `bump_into` | 有执行路径／未完整验证 | `src/engine.rs:2512` | T5, T12 | 有路径；完整语义未验证 |
| 24 | `bump_into_body_part` | 缺失 | — | T12 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 25 | `bump_into_color` | 有执行路径／未完整验证 | `src/engine.rs:2532` | T5, T12 | 有路径；完整语义未验证 |
| 26 | `calculate` | 有执行路径／未完整验证 | `src/engine.rs:1769`<br>`src/engine.rs:2420` | T4, T10 | 复用现有官方来源公式求值器；KN 官方域函数有限样例已测，全公式语言与异常集未验证 |
| 27 | `catbit_button_is_pressed` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 28 | `catbit_button_when` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 29 | `catbit_usb_button_when` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 30 | `change_robot2_master_motor_power` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 31 | `change_robot_master_motor_power` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 32 | `change_script_variables` | 有执行路径／未完整验证 | `src/engine.rs:3118` | T10 | 官方代码 API，非注册积木；官方 JS→XML 存在赋值转换异常，本地兼容别名未模拟该缺陷 |
| 33 | `change_variables` | 有执行路径／未完整验证 | `src/engine.rs:3118` | T1, T4, T5, T9, T10, T12 | 有路径；完整语义未验证 |
| 34 | `check_emotion` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 35 | `check_face_shape` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 36 | `check_gender` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 37 | `check_key` | 有执行路径／未完整验证 | `src/engine.rs:2453` | T5, T12 | 有路径；完整语义未验证 |
| 38 | `check_tilt_direction_of_face` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 39 | `clearInterval` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 40 | `clearTimeout` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 41 | `clear_all_effects` | 有执行路径／未完整验证 | `src/engine.rs:3316` | T12 | 有路径；完整语义未验证 |
| 42 | `clear_drawing` | 有执行路径／未完整验证 | `src/engine.rs:3795` | T5, T12 | 有路径；完整语义未验证 |
| 43 | `close_self_dialog` | 有执行路径／未完整验证 | `src/engine.rs:3487` | T12 | 有路径；完整语义未验证 |
| 44 | `console_log` | 有执行路径／未完整验证 | `src/engine.rs:3930` | T2, T4, T5, T10, T11, T12 | 有路径；完整语义未验证 |
| 45 | `controls_while` | 有执行路径／未完整验证 | `src/engine.rs:3967` | T10 | 官方注册/JS 转换已验证；NekoC 前测循环有回归，KN 原生播放调度差分未验证 |
| 46 | `convert_type` | 部分语义 | `src/engine.rs:2037`<br>`src/engine.rs:2420` | T4, T5, T12 | KN 只允许 number/string，其他转换报错；未验证全部强制转换边界 |
| 47 | `coordinate_of_sprite` | 有执行路径／未完整验证 | `src/engine.rs:2485` | T5, T12 | 有路径；完整语义未验证 |
| 48 | `create_stage_dialog` | 有执行路径／未完整验证 | `src/engine.rs:3461`<br>`src/engine.rs:3469` | T12 | 有路径；完整语义未验证 |
| 49 | `delete_list_item` | 有执行路径／未完整验证 | `src/engine.rs:3801` | T5, T12 | 有路径；完整语义未验证 |
| 50 | `dispose_clone` | 有执行路径／未完整验证 | `src/engine.rs:3688` | T1, T5, T12 | 有路径；完整语义未验证 |
| 51 | `distance_to` | 有执行路径／未完整验证 | `src/engine.rs:2510` | T12 | 有路径；完整语义未验证 |
| 52 | `divisible_by` | 有执行路径／未完整验证 | `src/engine.rs:2614` | T5, T12 | 有路径；完整语义未验证 |
| 53 | `effect_of_sprite` | 有执行路径／未完整验证 | `src/engine.rs:2592` | T12 | 有路径；完整语义未验证 |
| 54 | `enable_face_detect_by_actor` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 55 | `enable_face_detect_by_photo` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 56 | `enable_object_detect_by_actor` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 57 | `enable_object_detect_by_photo` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 58 | `evaluate_actor_style` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 59 | `evaluate_camera` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 60 | `evaluate_photo` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 61 | `face_to_body_part` | 缺失 | — | T12 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 62 | `get_answer` | 有执行路径／未完整验证 | `src/engine.rs:1950`<br>`src/engine.rs:2441` | T5, T12 | 有路径；完整语义未验证 |
| 63 | `get_appearance_of_part` | 缺失 | — | T12 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 64 | `get_choice_and_index` | 有执行路径／未完整验证 | `src/engine.rs:1973`<br>`src/engine.rs:2441` | T5, T12 | 有路径；完整语义未验证 |
| 65 | `get_clone_index_property` | 部分语义 | `src/engine.rs:1974`<br>`src/engine.rs:2566` | T1, T4, T12 | KN 仅部分属性码和角色变量；其他属性显式报错 |
| 66 | `get_clone_num` | 有执行路径／未完整验证 | `src/engine.rs:2511` | T5, T12 | 有路径；完整语义未验证 |
| 67 | `get_current_clone_index` | 有执行路径／未完整验证 | `src/engine.rs:2565` | T1, T5, T12 | 有路径；完整语义未验证 |
| 68 | `get_evaluate_class_accuracy` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 69 | `get_evaluate_class_name` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 70 | `get_face_detection_result` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 71 | `get_mouse_info` | 有执行路径／未完整验证 | `src/engine.rs:2396` | T5, T12 | 有路径；完整语义未验证 |
| 72 | `get_object_detection_result` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 73 | `get_orientation` | 固定值占位 | `src/engine.rs:2497` | T5, T12 | ExprOp::Constant(0.0)，未接入设备倾斜；固定值不算传感器支持 |
| 74 | `get_play_audio` | 有执行路径／未完整验证 | `src/engine.rs:1825` | T5 | 有路径；完整语义未验证 |
| 75 | `get_position_of_body_part` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 76 | `get_robot2_master_motor_power` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 77 | `get_robot_master_infrared_sensor_distance` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 78 | `get_robot_master_motor_power` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 79 | `get_sprite_property` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 80 | `get_stage_info` | 有执行路径／未完整验证 | `src/engine.rs:2570` | T5, T12 | 有路径；完整语义未验证 |
| 81 | `get_tilt_angle_of_face` | 缺失 | — | T12 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 82 | `get_time` | 有执行路径／未完整验证 | `src/engine.rs:2028`<br>`src/engine.rs:2578` | T12 | 有路径；完整语义未验证 |
| 83 | `get_timer` | 有执行路径／未完整验证 | `src/engine.rs:2484` | T4, T10 | 独立 block timer；官方用墙钟，NekoC 用 VM 仿真时间，暂停/节流和精度一致性未验证 |
| 84 | `get_voice_answer` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 85 | `get_voice_volume` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 86 | `global_animation` | 缺失 | — | T12 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 87 | `image_stamp` | 有执行路径／未完整验证 | `src/engine.rs:3542` | T5, T12 | 有路径；完整语义未验证 |
| 88 | `isFinite` | 有执行路径／未完整验证 | `src/engine.rs:1901`<br>`src/engine.rs:2420` | T11 | 有路径；完整语义未验证 |
| 89 | `isNaN` | 有执行路径／未完整验证 | `src/engine.rs:1900`<br>`src/engine.rs:2420` | T11 | 有路径；完整语义未验证 |
| 90 | `list_append` | 有执行路径／未完整验证 | `src/engine.rs:3810` | T1, T5, T9, T10, T12 | 有路径；完整语义未验证 |
| 91 | `list_copy` | 有执行路径／未完整验证 | `src/engine.rs:3828` | T5, T12 | 有路径；完整语义未验证 |
| 92 | `list_get` | 有执行路径／未完整验证 | `src/engine.rs:1902` | T12 | 有路径；完整语义未验证 |
| 93 | `list_index_of` | 有执行路径／未完整验证 | `src/engine.rs:1797`<br>`src/engine.rs:2420` | T5, T12 | 有路径；完整语义未验证 |
| 94 | `list_insert_value` | 有执行路径／未完整验证 | `src/engine.rs:3814` | T5, T12 | 有路径；完整语义未验证 |
| 95 | `list_is_exist` | 有执行路径／未完整验证 | `src/engine.rs:1797`<br>`src/engine.rs:2420` | T5, T12 | 有路径；完整语义未验证 |
| 96 | `list_item` | 有执行路径／未完整验证 | `src/engine.rs:1912`<br>`src/engine.rs:2472`<br>`src/engine.rs:2475` | T1, T5, T9, T12, T14 | 有路径；完整语义未验证 |
| 97 | `list_length` | 有执行路径／未完整验证 | `src/engine.rs:2469` | T5, T9, T10, T12 | 有路径；完整语义未验证 |
| 98 | `logic_boolean` | 有执行路径／未完整验证 | `src/engine.rs:1832`<br>`src/engine.rs:2378` | T4, T5, T10, T12 | 有路径；完整语义未验证 |
| 99 | `logic_compare` | 有执行路径／未完整验证 | `src/engine.rs:1849`<br>`src/engine.rs:2441` | T1, T5, T9, T10, T12 | 有路径；完整语义未验证 |
| 100 | `logic_negate` | 有执行路径／未完整验证 | `src/engine.rs:1838`<br>`src/engine.rs:2441` | T4, T5, T12 | 有路径；完整语义未验证 |
| 101 | `logic_operation` | 有执行路径／未完整验证 | `src/engine.rs:1844`<br>`src/engine.rs:2441` | T5, T12 | 有路径；完整语义未验证 |
| 102 | `logic_ternary` | 有执行路径／未完整验证 | `src/engine.rs:1839`<br>`src/engine.rs:2441` | T9 | 有路径；完整语义未验证 |
| 103 | `logic_to_boolean` | 有执行路径／未完整验证 | `src/engine.rs:1885`<br>`src/engine.rs:2420` | T11 | 有路径；完整语义未验证 |
| 104 | `math_add_assign` | 有执行路径／未完整验证 | `src/engine.rs:3166` | T11 | 有路径；完整语义未验证 |
| 105 | `math_arithmetic` | 有执行路径／未完整验证 | `src/engine.rs:1763`<br>`src/engine.rs:2636` | T1, T4, T5, T9, T11, T12, T13 | 有路径；完整语义未验证 |
| 106 | `math_decrement` | 有执行路径／未完整验证 | `src/engine.rs:3166` | T11 | 有路径；完整语义未验证 |
| 107 | `math_div_assign` | 有执行路径／未完整验证 | `src/engine.rs:3166` | T11 | 有路径；完整语义未验证 |
| 108 | `math_function` | 有执行路径／未完整验证 | `src/engine.rs:2684` | T5, T12 | 有路径；完整语义未验证 |
| 109 | `math_increment` | 有执行路径／未完整验证 | `src/engine.rs:3166` | T11 | 有路径；完整语义未验证 |
| 110 | `math_mod_assign` | 有执行路径／未完整验证 | `src/engine.rs:3166` | T11 | 有路径；完整语义未验证 |
| 111 | `math_modulo` | 有执行路径／未完整验证 | `src/engine.rs:2636` | T12 | 有路径；完整语义未验证 |
| 112 | `math_mul_assign` | 有执行路径／未完整验证 | `src/engine.rs:3166` | T11 | 有路径；完整语义未验证 |
| 113 | `math_number_property` | 有执行路径／未完整验证 | `src/engine.rs:1773`<br>`src/engine.rs:2615` | T4, T5, T12 | 有路径；完整语义未验证 |
| 114 | `math_round` | 有执行路径／未完整验证 | `src/engine.rs:2684` | T5, T12 | 有路径；完整语义未验证 |
| 115 | `math_sub_assign` | 有执行路径／未完整验证 | `src/engine.rs:3166` | T11 | 有路径；完整语义未验证 |
| 116 | `math_trig` | 有执行路径／未完整验证 | `src/engine.rs:2684` | T5, T12 | 有路径；完整语义未验证 |
| 117 | `math_trig_rad` | 有执行路径／未完整验证 | `src/engine.rs:2669` | T5 | 有路径；完整语义未验证 |
| 118 | `microbit_accelerometer` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 119 | `microbit_button_is_pressed` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 120 | `microbit_button_when` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 121 | `microbit_change_bpm` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 122 | `microbit_compass_heading` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 123 | `microbit_get_volume` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 124 | `microbit_is_gesture` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 125 | `microbit_led_clear` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 126 | `microbit_led_is_plot` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 127 | `microbit_led_plot` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 128 | `microbit_led_plot_graph` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 129 | `microbit_led_show_custom` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 130 | `microbit_led_show_icon` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 131 | `microbit_led_show_number` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 132 | `microbit_led_show_text` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 133 | `microbit_led_toggle` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 134 | `microbit_led_unplot` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 135 | `microbit_light_level` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 136 | `microbit_logo_is_pressed` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 137 | `microbit_logo_when` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 138 | `microbit_magnetometer` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 139 | `microbit_math_map` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 140 | `microbit_pause_by_beats` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 141 | `microbit_pin_analog_read` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 142 | `microbit_pin_analog_write` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 143 | `microbit_pin_digital_read` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 144 | `microbit_pin_digital_write` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 145 | `microbit_pin_set_touch_mode` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 146 | `microbit_pin_when` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 147 | `microbit_play_melody` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 148 | `microbit_play_tone_by_beats` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 149 | `microbit_rotation` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 150 | `microbit_servo_set_angle_270` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 151 | `microbit_set_bpm` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 152 | `microbit_set_volume` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 153 | `microbit_sound_level` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 154 | `microbit_stop` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 155 | `microbit_temperature` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 156 | `mirror` | 有执行路径／未完整验证 | `src/engine.rs:3429` | T1, T5, T9, T12 | 有路径；完整语义未验证 |
| 157 | `mouse_down` | 部分语义 | `src/engine.rs:2597` | T8, T12 | 只读取 mouse_event_type/type，忽略 catalog 的 sprite 目标字段 |
| 158 | `move_to_body_part` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 159 | `new_conversation` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 160 | `on_bump_actor` | 有执行路径／未完整验证 | `src/engine.rs:2790` | T5, T12 | 有路径；完整语义未验证 |
| 161 | `on_bump_actor_value` | 有执行路径／未完整验证 | `src/engine.rs:1956`<br>`src/engine.rs:2566` | T5, T12 | 有路径；完整语义未验证 |
| 162 | `on_keydown` | 有执行路径／未完整验证 | `src/engine.rs:2782` | T2, T3, T5, T12 | 有路径；完整语义未验证 |
| 163 | `on_running_group_activated` | 有执行路径／未完整验证 | `src/engine.rs:2756` | T1, T2, T3, T4, T5, T6, T7, T9, T10, T11, T12, T13, T14, T15 | 有路径；完整语义未验证 |
| 164 | `on_swipe` | 有执行路径／未完整验证 | `src/engine.rs:2772` | T5 | 有路径；完整语义未验证 |
| 165 | `open_close_webcam` | 缺失 | — | 未定位 | 缺少摄像头后端及对应执行路径；不是 stub 支持 |
| 166 | `open_hide_camera` | 缺失 | — | 未定位 | 缺少摄像头后端及对应执行路径；不是 stub 支持 |
| 167 | `out_of_boundary` | 有执行路径／未完整验证 | `src/engine.rs:2548` | T5, T12 | 有路径；完整语义未验证 |
| 168 | `parseFloat` | 有执行路径／未完整验证 | `src/engine.rs:1889`<br>`src/engine.rs:2420` | T11 | 有路径；完整语义未验证 |
| 169 | `parseInt` | 有执行路径／未完整验证 | `src/engine.rs:1890`<br>`src/engine.rs:2420` | T11 | 有路径；完整语义未验证 |
| 170 | `play_audio` | 有执行路径／未完整验证 | `src/engine.rs:3796` | T2, T3, T5, T12 | 有路径；完整语义未验证 |
| 171 | `play_audio_and_wait` | 有执行路径／未完整验证 | `src/engine.rs:3558` | T2, T5 | 有路径；完整语义未验证 |
| 172 | `play_word_audio_wait` | 有执行路径／未完整验证 | `src/engine.rs:3567` | T2 | 有路径；完整语义未验证 |
| 173 | `play_words_audio` | 有执行路径／未完整验证 | `src/engine.rs:3567` | 未定位 | 有路径；完整语义未验证 |
| 174 | `procedures_2_actor_param` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 175 | `procedures_2_defnoreturn` | 元数据 | `src/engine.rs:1108 (compiler metadata)` | T5, T9, T10 | 非独立指令；由过程/循环编译消费 |
| 176 | `random_num` | 有执行路径／未完整验证 | `src/engine.rs:2405` | T4, T5, T12 | 有路径；完整语义未验证 |
| 177 | `received_broadcast` | 有执行路径／未完整验证 | `src/engine.rs:1793`<br>`src/engine.rs:2420` | T5, T12 | 有路径；完整语义未验证 |
| 178 | `recognize_body_part` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 179 | `recognize_gesture` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 180 | `repeat_forever` | 有执行路径／未完整验证 | `src/engine.rs:3967` | T5, T10, T12, T15 | 有路径；完整语义未验证 |
| 181 | `repeat_forever_until` | 有执行路径／未完整验证 | `src/engine.rs:3967` | T5, T12 | 有路径；完整语义未验证 |
| 182 | `repeat_n_times` | 有执行路径／未完整验证 | `src/engine.rs:3967` | T1, T4, T5, T9, T10, T11, T12, T15 | 有路径；完整语义未验证 |
| 183 | `replace_list_item` | 有执行路径／未完整验证 | `src/engine.rs:3819` | T5, T9, T12 | 有路径；完整语义未验证 |
| 184 | `reset_timer` | 有执行路径／未完整验证 | `src/engine.rs:3068` | T10 | 只重置独立 block timer，不改变舞台计时器；官方墙钟与 VM 仿真时钟差异未验证 |
| 185 | `restart` | 有执行路径／未完整验证 | `src/engine.rs:3428` | T5, T12 | 有路径；完整语义未验证 |
| 186 | `script_variables` | 有执行路径／未完整验证 | `src/engine.rs:3054` | T5, T10, T12 | 有路径；完整语义未验证 |
| 187 | `script_variables_set` | 有执行路径／未完整验证 | `src/engine.rs:3072` | T10 | 官方代码 API，非注册积木；原生作品用 variables_set + 脚本变量 JSON。兼容别名参照 HateNeko |
| 188 | `script_variables_value` | 有执行路径／未完整验证 | `src/engine.rs:1881`<br>`src/engine.rs:2395` | T5, T10, T12 | 有路径；完整语义未验证 |
| 189 | `self_appear` | 有执行路径／未完整验证 | `src/engine.rs:3264` | T5, T12 | 有路径；完整语义未验证 |
| 190 | `self_appear_animation` | 有执行路径／未完整验证 | `src/engine.rs:3506` | T5, T12 | 有路径；完整语义未验证 |
| 191 | `self_ask` | 有执行路径／未完整验证 | `src/engine.rs:3641` | T5, T12 | 有路径；完整语义未验证 |
| 192 | `self_bounce_off_edge` | 有执行路径／未完整验证 | `src/engine.rs:3488` | T5, T12, T13 | 有路径；完整语义未验证 |
| 193 | `self_broadcast` | 有执行路径／未完整验证 | `src/engine.rs:3889` | T5, T12 | 有路径；完整语义未验证 |
| 194 | `self_broadcast_and_wait` | 有执行路径／未完整验证 | `src/engine.rs:3889` | T5, T12 | 有路径；完整语义未验证 |
| 195 | `self_broadcast_with_param` | 有执行路径／未完整验证 | `src/engine.rs:3889` | T5, T12 | 有路径；完整语义未验证 |
| 196 | `self_change_coordinate_x` | 有执行路径／未完整验证 | `src/engine.rs:3249` | T5, T12 | 有路径；完整语义未验证 |
| 197 | `self_change_coordinate_y` | 有执行路径／未完整验证 | `src/engine.rs:3249` | T12 | 有路径；完整语义未验证 |
| 198 | `self_change_effect` | 有执行路径／未完整验证 | `src/engine.rs:3297` | T5, T12 | 有路径；完整语义未验证 |
| 199 | `self_change_pen_color_property` | 有执行路径／未完整验证 | `src/engine.rs:3839` | T5, T12 | 有路径；完整语义未验证 |
| 200 | `self_change_pen_size` | 有执行路径／未完整验证 | `src/engine.rs:3334` | T12 | 有路径；完整语义未验证 |
| 201 | `self_change_scale` | 有执行路径／未完整验证 | `src/engine.rs:3317` | T5, T12 | 有路径；完整语义未验证 |
| 202 | `self_dialog` | 有执行路径／未完整验证 | `src/engine.rs:3469` | T5, T12 | 有路径；完整语义未验证 |
| 203 | `self_dialog_wait` | 部分语义 | `src/engine.rs:3469` | T12 | 只有 Op::Dialog，timed 分支仅匹配 self_dialog；没有显式等待/关闭 |
| 204 | `self_face_to` | 有执行路径／未完整验证 | `src/engine.rs:3343` | T5, T12 | 有路径；完整语义未验证 |
| 205 | `self_face_to_sprite` | 有执行路径／未完整验证 | `src/engine.rs:3343` | T12 | 有路径；完整语义未验证 |
| 206 | `self_glide_coordinate_x` | 有执行路径／未完整验证 | `src/engine.rs:3374` | T12 | 有路径；完整语义未验证 |
| 207 | `self_glide_coordinate_y` | 有执行路径／未完整验证 | `src/engine.rs:3374` | T12 | 有路径；完整语义未验证 |
| 208 | `self_glide_to` | 有执行路径／未完整验证 | `src/engine.rs:3374` | T5, T12 | 有路径；完整语义未验证 |
| 209 | `self_go_forward` | 有执行路径／未完整验证 | `src/engine.rs:3243` | T5, T12, T15 | 有路径；完整语义未验证 |
| 210 | `self_gradually_show_hide` | 有执行路径／未完整验证 | `src/engine.rs:3413` | T5, T12 | 有路径；完整语义未验证 |
| 211 | `self_listen` | 有执行路径／未完整验证 | `src/engine.rs:2752` | T5, T12 | 有路径；完整语义未验证 |
| 212 | `self_listen_value` | 有执行路径／未完整验证 | `src/engine.rs:1787`<br>`src/engine.rs:2420` | T5, T12 | 有路径；完整语义未验证 |
| 213 | `self_listen_with_param` | 有执行路径／未完整验证 | `src/engine.rs:2752` | T5, T12 | 有路径；完整语义未验证 |
| 214 | `self_move_specify` | 有执行路径／未完整验证 | `src/engine.rs:3346` | T12 | 有路径；完整语义未验证 |
| 215 | `self_move_specify_sprite` | 有执行路径／未完整验证 | `src/engine.rs:3346` | T12 | 有路径；完整语义未验证 |
| 216 | `self_move_to` | 有执行路径／未完整验证 | `src/engine.rs:3244` | T5, T6, T12 | 有路径；完整语义未验证 |
| 217 | `self_pen_down` | 有执行路径／未完整验证 | `src/engine.rs:3791` | T4, T5, T12 | 有路径；完整语义未验证 |
| 218 | `self_pen_up` | 有执行路径／未完整验证 | `src/engine.rs:3792` | T5, T12 | 有路径；完整语义未验证 |
| 219 | `self_point_towards` | 有执行路径／未完整验证 | `src/engine.rs:3262` | T5, T12 | 有路径；完整语义未验证 |
| 220 | `self_prev_next_style` | 有执行路径／未完整验证 | `src/engine.rs:3290` | T5, T12 | 有路径；完整语义未验证 |
| 221 | `self_rotate` | 有执行路径／未完整验证 | `src/engine.rs:3261` | T12 | 有路径；完整语义未验证 |
| 222 | `self_rotate_around` | 有执行路径／未完整验证 | `src/engine.rs:3354` | T5, T12 | 有路径；完整语义未验证 |
| 223 | `self_set_draggable` | 有执行路径／未完整验证 | `src/engine.rs:3539` | T5, T12 | 有路径；完整语义未验证 |
| 224 | `self_set_effect` | 有执行路径／未完整验证 | `src/engine.rs:3297` | T5, T12 | 有路径；完整语义未验证 |
| 225 | `self_set_pen_color` | 有执行路径／未完整验证 | `src/engine.rs:3871` | T5, T12 | 有路径；完整语义未验证 |
| 226 | `self_set_pen_color_property` | 有执行路径／未完整验证 | `src/engine.rs:3839` | T5, T12 | 有路径；完整语义未验证 |
| 227 | `self_set_pen_size` | 有执行路径／未完整验证 | `src/engine.rs:3870` | T5, T12 | 有路径；完整语义未验证 |
| 228 | `self_set_position_x` | 有执行路径／未完整验证 | `src/engine.rs:3245` | T4, T5, T7, T9, T12 | 有路径；完整语义未验证 |
| 229 | `self_set_position_y` | 有执行路径／未完整验证 | `src/engine.rs:3246` | T5, T12 | 有路径；完整语义未验证 |
| 230 | `self_set_role_camp` | 有执行路径／未完整验证 | `src/engine.rs:3489` | T5, T12 | 有路径；完整语义未验证 |
| 231 | `self_set_rotation_type` | 有执行路径／未完整验证 | `src/engine.rs:3337` | T5, T12 | 有路径；完整语义未验证 |
| 232 | `self_stress_animation` | 有执行路径／未完整验证 | `src/engine.rs:3494` | T5, T12 | 有路径；完整语义未验证 |
| 233 | `self_text_effect_color` | 有执行路径／未完整验证 | `src/engine.rs:3533` | T5, T12 | 有路径；完整语义未验证 |
| 234 | `self_text_effect_size` | 有执行路径／未完整验证 | `src/engine.rs:3532` | T5, T12 | 有路径；完整语义未验证 |
| 235 | `self_text_effect_text` | 有执行路径／未完整验证 | `src/engine.rs:3531` | T5, T12 | 有路径；完整语义未验证 |
| 236 | `setInterval` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 237 | `setTimeout` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 238 | `set_camera_alpha` | 缺失 | — | 未定位 | 缺少摄像头后端及对应执行路径；不是 stub 支持 |
| 239 | `set_pen_layer` | 有执行路径／未完整验证 | `src/engine.rs:3756` | T5, T12 | 有路径；完整语义未验证 |
| 240 | `set_robot2_master_motor_power_rotation` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 241 | `set_robot2_master_motor_power_rotation_duration` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 242 | `set_robot_master_light_color` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 243 | `set_robot_master_light_color_duration` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 244 | `set_robot_master_motor_power_rotation` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 245 | `set_robot_master_motor_power_rotation_duration` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 246 | `set_scale` | 有执行路径／未完整验证 | `src/engine.rs:3263` | T5, T12 | 有路径；完整语义未验证 |
| 247 | `set_screen_transition` | 有执行路径／未完整验证 | `src/engine.rs:3444` | T5, T12 | 有路径；完整语义未验证 |
| 248 | `set_sprite_style` | 有执行路径／未完整验证 | `src/engine.rs:3289` | T5, T12 | 有路径；完整语义未验证 |
| 249 | `set_system_preset` | 缺失 | — | 未定位 | 没有对应可执行分派；连到事件体/表达式时不支持（导入或游离忽略不算支持） |
| 250 | `set_timer_state` | 有执行路径／未完整验证 | `src/engine.rs:3833` | T5, T10, T12 | 有路径；完整语义未验证 |
| 251 | `set_top_bottom_layer` | 有执行路径／未完整验证 | `src/engine.rs:3690` | T5, T12 | 有路径；完整语义未验证 |
| 252 | `set_webcam_alpha` | 缺失 | — | 未定位 | 缺少摄像头后端及对应执行路径；不是 stub 支持 |
| 253 | `set_width_height_scale` | 有执行路径／未完整验证 | `src/engine.rs:3320` | T5, T12 | 有路径；完整语义未验证 |
| 254 | `show_hide_list` | 有执行路径／未完整验证 | `src/engine.rs:3587` | T12 | 有路径；完整语义未验证 |
| 255 | `show_hide_ranking` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 256 | `show_hide_timer` | 有执行路径／未完整验证 | `src/engine.rs:3832` | T5, T12 | 有路径；完整语义未验证 |
| 257 | `show_hide_variables` | 有执行路径／未完整验证 | `src/engine.rs:3587` | T4, T5, T12 | 有路径；完整语义未验证 |
| 258 | `sound_color` | 有执行路径／未完整验证 | `src/engine.rs:3570` | T2 | 有路径；完整语义未验证 |
| 259 | `sprite_on_tap` | 有执行路径／未完整验证 | `src/engine.rs:2805` | T5, T12 | 有路径；完整语义未验证 |
| 260 | `stamp` | 有执行路径／未完整验证 | `src/engine.rs:3860` | T5, T12 | 有路径；完整语义未验证 |
| 261 | `start_as_a_mirror` | 有执行路径／未完整验证 | `src/engine.rs:2771` | T1, T5, T9 | 有路径；完整语义未验证 |
| 262 | `start_on_click` | 有执行路径／未完整验证 | `src/engine.rs:2756` | T4, T5, T7, T12, T16 | 有路径；完整语义未验证 |
| 263 | `stop` | 有执行路径／未完整验证 | `src/engine.rs:3900` | T2, T5, T6, T10, T12 | 有路径；完整语义未验证 |
| 264 | `stop_audio` | 有执行路径／未完整验证 | `src/engine.rs:3796` | T2, T5, T12 | 有路径；完整语义未验证 |
| 265 | `stop_robot2_master_motor` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 266 | `stop_robot_master_light` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 267 | `stop_robot_master_motor` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 268 | `style_of_sprite` | 有执行路径／未完整验证 | `src/engine.rs:2506` | T12 | 有路径；完整语义未验证 |
| 269 | `switch_to_screen` | 有执行路径／未完整验证 | `src/engine.rs:3435` | T5, T12 | 有路径；完整语义未验证 |
| 270 | `sync_tell` | 有执行路径／未完整验证 | `src/engine.rs:3743` | T1, T5, T9, T12 | 有路径；完整语义未验证 |
| 271 | `tell` | 有执行路径／未完整验证 | `src/engine.rs:3743` | T12 | 有路径；完整语义未验证 |
| 272 | `temporary_list` | 有执行路径／未完整验证 | `src/engine.rs:1920` | T5, T12 | 有路径；完整语义未验证 |
| 273 | `text_contain` | 有执行路径／未完整验证 | `src/engine.rs:1794`<br>`src/engine.rs:2420` | T5, T12 | 有路径；完整语义未验证 |
| 274 | `text_join` | 有执行路径／未完整验证 | `src/engine.rs:1920`<br>`src/engine.rs:2420` | T5, T12 | 有路径；完整语义未验证 |
| 275 | `text_length` | 有执行路径／未完整验证 | `src/engine.rs:2404` | T5, T12 | 有路径；完整语义未验证 |
| 276 | `text_select` | 有执行路径／未完整验证 | `src/engine.rs:2009`<br>`src/engine.rs:2420` | T5, T12, T13 | 有路径；完整语义未验证 |
| 277 | `text_split` | 有执行路径／未完整验证 | `src/engine.rs:1828` | T5, T12 | 有路径；完整语义未验证 |
| 278 | `timer` | 有执行路径／未完整验证 | `src/engine.rs:2483` | T5, T10, T12 | 有路径；完整语义未验证 |
| 279 | `translate` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 280 | `translate_result` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 281 | `traverse_number` | 有执行路径／未完整验证 | `src/engine.rs:3994` | T5, T10, T12 | 有路径；完整语义未验证 |
| 282 | `traverse_number_param` | 元数据 | `src/engine.rs:1633 (compiler metadata)` | T5, T10, T12 | 非独立指令；由过程/循环编译消费 |
| 283 | `traverse_number_value` | 有执行路径／未完整验证 | `src/engine.rs:2462` | T3, T5, T12 | 有路径；完整语义未验证 |
| 284 | `update_ranking` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 285 | `user_id_get` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 286 | `user_info_of_th` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 287 | `user_ranking_info` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 288 | `username_get` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 289 | `variables_get` | 有执行路径／未完整验证 | `src/engine.rs:1861`<br>`src/engine.rs:2381` | T1, T4, T5, T6, T9, T10, T11, T12 | 有路径；完整语义未验证 |
| 290 | `variables_set` | 有执行路径／未完整验证 | `src/engine.rs:3072` | T1, T3, T4, T5, T9, T11, T12, T13, T14 | 有路径；完整语义未验证 |
| 291 | `voice_recognition` | 缺失 | — | 未定位 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 292 | `wait` | 有执行路径／未完整验证 | `src/engine.rs:3887` | T1, T5, T9, T10, T12, T13 | 有路径；完整语义未验证 |
| 293 | `wait_until` | 有执行路径／未完整验证 | `src/engine.rs:3888` | T5, T12 | 有路径；完整语义未验证 |
| 294 | `wand_button_is_pressed` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 295 | `wand_coordinate` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 296 | `wand_direction_when` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 297 | `wand_reset_position` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 298 | `wand_rotation` | 缺失 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 299 | `warp` | 有执行路径／未完整验证 | `src/engine.rs:3952` | T1, T4, T5, T9, T10, T11, T12, T15 | 有路径；完整语义未验证 |
| 300 | `when` | 有执行路径／未完整验证 | `src/engine.rs:2749`<br>`src/engine.rs:3734` | T5, T12 | 有路径；完整语义未验证 |

## 复现与更新

```powershell
# 无外部依赖：用仓库内名称快照重新扫描当前 engine 并生成文档
node tools/compat/kn-catalog-status.mjs --snapshot docs/kn-block-coverage.md
# 校验外部原始清单并输出带参考函数位置的 JSON（可选）
node tools/compat/kn-catalog-status.mjs E:/nekoc-wt/_ref/hateneko/player
npm run -s test:tools
```

统计和逐项表由工具生成；新增执行分派、清单变更、测试引用或风险分类变化后应重生成并人工复审，不能只将状态批量改成“已实现”。
