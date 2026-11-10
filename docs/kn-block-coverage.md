# KN 300 项积木编译／运行覆盖审计

> 审计口径：原生 `.bcmkn` → `Program::compile` → engine VM；不是 TS API 发射清单，也不是官方行为全兼容认证。

## 结论与统计

清单共 **300 项**，**55 项缺失**，其余 245 项只有执行路径或元数据证据。**本报告认证完整语义支持的项数为 0**；不能将显式分派数当作兼容率。大量硬件、AI、网络、账户、摄像头后端仍未完成。

| 分类 | 项数 | 含义 |
| --- | ---: | --- |
| 有执行路径／未完整验证 | 180 | 代码存在；未逐字段、选项、异常与官方差分 |
| 部分语义 | 62 | 有路径且已识别具体限制/近似 |
| 固定值占位 | 1 | 返回固定值，不代表设备能力 |
| 元数据 | 2 | 由其他编译环节消费，不独立执行 |
| 缺失 | 55 | 无对应执行路径；不是 stub 支持 |

分类互斥且加总 300。`部分语义` 并非只有这几项存在风险；其余有路径项同样没有完整语义保证。

## 清单、证据与复现边界

- 外部清单：`E:/nekoc-wt/_ref/hateneko/player/kn_spec/block_catalog.json`（300 个类型名）；仅转录名称/事件标记，不把第三方作品或运行时内核复制入库。
- 清单文件 SHA-256：`7fc0f41daf559baa6bab970607fc37e6109e359f947c314b1d2621f42ca3b535`。本地名称快照在 [kn-catalog-manifest.mjs](../tools/compat/kn-catalog-manifest.mjs)，传外部路径运行时会校验哈希和全量集合。
- HateNeko **仅是实现参考和清单来源，非官方语义证据**。官方来源、下载哈希和小段定位见 [kncat-official-evidence.md](kncat-official-evidence.md)。
- 最新集成基线另有 [kn-semantics.md](kn-semantics.md) 的官方 KN 原创夹具实测，覆盖有限调度、列表读取与转换样例；它不把本表升级成全类型/全字段认证。
- 第二轮对象、定时器及离线服务降级的证据和未验证范围见 [kn-objects.md](kn-objects.md)、[kn-async-services.md](kn-async-services.md)、[kn-timers.md](kn-timers.md)；无设备降级路径不代表真实设备、AI 或账户后端。
- 第三轮常用外观/对白与鼠标目标的修复见 [kn-appearance-dialog.md](kn-appearance-dialog.md)、[kn-pointer.md](kn-pointer.md)；新增 AI/OCR/检测查询仅是 [kn-offline-round3.md](kn-offline-round3.md) 的官方空缓存分支，不实现获取命令或实际后端。microbit map 的无连接 NaN 分支见 [kn-microbit-map.md](kn-microbit-map.md)，不能把它当作无条件数学映射。
- 第四轮常用类型转换的63条官方带类型观测及边界见 [kn-conversion.md](kn-conversion.md)；完整工程警告 UI、自定义原型和循环值仍未验证。
- 第四轮6个新增microbit同步查询只覆盖 [kn-hardware.md](kn-hardware.md) 的官方无连接分支；37条官方局部调用含已有map，不代表真实硬件或完整原生工程调度支持。
- 第四轮已逐项核对300名称的官方面板/注册/扩展配置，见 [kn-panel-audit.md](kn-panel-audit.md) 和 [kn-panel-evidence.json](kn-panel-evidence.json)。普通默认配置142、可配置默认隐藏52、嵌套动态1、已注册但本次面板未列出41、硬件扩展定义60、官方代码API/声明别名4；本轮没有足够证据认证任何名称为“非官方/已下线”（两者均0）。这套分类独立于VM状态：缺失包含1个非同名积木API，不把它伪造为可执行入口，也不拿面板分类减少VM缺失计数。
- 第五轮只处理上述两类面板可达缺失项；官方取证与严格离线/宿主边界见 [kn-panel-services.md](kn-panel-services.md)、[kn-panel-capture.md](kn-panel-capture.md)、[kn-panel-ai.md](kn-panel-ai.md)。新增分派统一保留部分语义，不把无后端早退当作成功请求；默认音量仍缺失。
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
- 未完成：300 项分别构造原生工程编译/执行、每个 dropdown/socket 与 malformed input、官方编辑器差分、跨平台硬件/AI/网络后端、渲染和音频最终输出的全量验证。原创 KN 夹具的编辑器检查以对应证据文档和带 SHA-256 的记录为准，不能推广到全部积木。

- **T1**：[tests/actor_variables.rs](../tests/actor_variables.rs)（源码引用，执行状态见上文）
- **T2**：[tests/audio.rs](../tests/audio.rs)（源码引用，执行状态见上文）
- **T3**：[tests/bcmkn_web.rs](../tests/bcmkn_web.rs)（源码引用，执行状态见上文）
- **T4**：[tests/depth.rs](../tests/depth.rs)（源码引用，执行状态见上文）
- **T5**：[tests/engine.rs](../tests/engine.rs)（源码引用，执行状态见上文）
- **T6**：[tests/extensions.rs](../tests/extensions.rs)（源码引用，执行状态见上文）
- **T7**：[tests/import_performance.rs](../tests/import_performance.rs)（源码引用，执行状态见上文）
- **T8**：[tests/input.rs](../tests/input.rs)（源码引用，执行状态见上文）
- **T9**：[tests/jit_differential.rs](../tests/jit_differential.rs)（源码引用，执行状态见上文）
- **T10**：[tests/kn_appearance_dialog.rs](../tests/kn_appearance_dialog.rs)（源码引用，执行状态见上文）
- **T11**：[tests/kn_async.rs](../tests/kn_async.rs)（源码引用，执行状态见上文）
- **T12**：[tests/kn_catalog.rs](../tests/kn_catalog.rs)（源码引用，执行状态见上文）
- **T13**：[tests/kn_conversion.rs](../tests/kn_conversion.rs)（源码引用，执行状态见上文）
- **T14**：[tests/kn_gap.rs](../tests/kn_gap.rs)（源码引用，执行状态见上文）
- **T15**：[tests/kn_hardware.rs](../tests/kn_hardware.rs)（源码引用，执行状态见上文）
- **T16**：[tests/kn_microbit_map.rs](../tests/kn_microbit_map.rs)（源码引用，执行状态见上文）
- **T17**：[tests/kn_objects.rs](../tests/kn_objects.rs)（源码引用，执行状态见上文）
- **T18**：[tests/kn_offline_services.rs](../tests/kn_offline_services.rs)（源码引用，执行状态见上文）
- **T19**：[tests/kn_panel_ai.rs](../tests/kn_panel_ai.rs)（源码引用，执行状态见上文）
- **T20**：[tests/kn_panel_capture.rs](../tests/kn_panel_capture.rs)（源码引用，执行状态见上文）
- **T21**：[tests/kn_panel_services.rs](../tests/kn_panel_services.rs)（源码引用，执行状态见上文）
- **T22**：[tests/kn_pointer.rs](../tests/kn_pointer.rs)（源码引用，执行状态见上文）
- **T23**：[tests/mvp.rs](../tests/mvp.rs)（源码引用，执行状态见上文）
- **T24**：[tests/nonfinite.rs](../tests/nonfinite.rs)（源码引用，执行状态见上文）
- **T25**：[tests/pack.rs](../tests/pack.rs)（源码引用，执行状态见上文）
- **T26**：[tests/studio.rs](../tests/studio.rs)（源码引用，执行状态见上文）
- **T27**：[tests/video.rs](../tests/video.rs)（源码引用，执行状态见上文）

## 全量逐项表（300 行）

所有行的导入层均为上文 `build_nested_block` 泛型路径；只在“VM/编译位置”列有路径时才有进一步实现证据。行号随源码演化变化，可用下述命令重新生成。

| # | 类型 | VM状态 | 官方面板证据类别 | VM/编译位置 | 测试源码线索 | 限制／未验证 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `__break__` | 有执行路径／未完整验证 | 官方代码API／非同名积木 | `src/engine.rs:4486` | T12 | 官方类型声明/API 伪名；编辑器实际积木为 break。此分派仅为兼容输入，非同名积木支持 |
| 2 | `_array_literal` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:1916`<br>`src/engine.rs:2689` | T12, T13 | 官方 Object.values 与 items0… 已核实；NekoC 保留输入顺序/类型，完整参数绑定差分未验证 |
| 3 | `_break_statement` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:4486` | T12 | 官方注册/JS 转换已验证；KN 原生播放中的嵌套退出与调度差分未验证 |
| 4 | `_continue_statement` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:4494` | T12 | 官方注册/JS 转换已验证；KN 原生播放中的作用域与调度差分未验证 |
| 5 | `_execute` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3446` | T12 | 官方域函数空体；NekoC 先求值 action 再丢弃结果，完整官方输入求值管线差分未验证 |
| 6 | `_object_get` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:1918`<br>`src/engine.rs:2689` | T13, T15, T16, T17, T18, T21 | KN 共享引用对象；属性缺失保留 undefined，完整 JS 原型链及特殊键未验证 |
| 7 | `_object_literal` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:1917`<br>`src/engine.rs:2689` | T13, T17 | KN 共享引用对象；官方字面量/属性读写有限样例有证据，完整 JS 原型链及全部 JSON 边界未验证 |
| 8 | `_object_set` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:1919`<br>`src/engine.rs:2689`<br>`src/engine.rs:3447` | T13, T15, T16, T17, T18, T21 | KN 共享引用对象；赋值返回值及副作用有限样例有证据，完整 JS 原型链未验证 |
| 9 | `_return_statement` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:4166` | T12 | 官方注册/JS 转换已验证；NekoC 复用过程返回，KN 原生播放差分未验证 |
| 10 | `_variable_get` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2076`<br>`src/engine.rs:2689` | T12, T14 | 有路径；完整语义未验证 |
| 11 | `_variable_set` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3541` | T12, T14 | 有路径；完整语义未验证 |
| 12 | `add_width_height_scale` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3703` | T10, T23 | 有路径；完整语义未验证 |
| 13 | `ai_chat_answer` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18, T19, T21 | 仅未启动聊天后端、结果缓存为空时的空文本；聊天请求与真实答案未实现 |
| 14 | `ai_chat_ask` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T18, T19, T21 | 仅显式离线匿名 profile 的拒绝/空缓存失效与提示；真实聊天后端未实现 |
| 15 | `ai_text_actor` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的拒绝/NaN 缓存；OCR/角色图像识别未实现 |
| 16 | `ai_text_photo` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的拒绝/NaN 缓存；拍照/OCR 未实现 |
| 17 | `ai_text_result` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18, T19, T21 | 仅 OCR 缓存为空时的 numeric NaN；OCR 获取与真实结果未实现 |
| 18 | `ai_text_result_check` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1897`<br>`src/engine.rs:2610` | T18 | 仅 OCR 缓存为空时求值 text 后返回 boolean false；OCR 获取与有效缓存未实现 |
| 19 | `appearance_of_sprite` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:2783` | T5, T10, T23 | 已实现独立横纵百分比与官方两位舍入；文本 costume 特殊缩放及全部错误路径未验证 |
| 20 | `ask_and_choose` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4045` | T3, T5, T23 | 有路径；完整语义未验证 |
| 21 | `atob` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2080`<br>`src/engine.rs:2689` | T9, T14 | 有路径；完整语义未验证 |
| 22 | `btoa` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2081`<br>`src/engine.rs:2689` | T9, T14 | 有路径；完整语义未验证 |
| 23 | `bump_into` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2805` | T5, T23 | 有路径；完整语义未验证 |
| 24 | `bump_into_body_part` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18, T23 | 仅无检测结果时 false；检测后端未实现 |
| 25 | `bump_into_color` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2825` | T5, T23 | 有路径；完整语义未验证 |
| 26 | `calculate` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:1913`<br>`src/engine.rs:2689` | T4, T12 | 复用现有官方来源公式求值器；KN 官方域函数有限样例已测，全公式语言与异常集未验证 |
| 27 | `catbit_button_is_pressed` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 28 | `catbit_button_when` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 29 | `catbit_usb_button_when` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 30 | `change_robot2_master_motor_power` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 31 | `change_robot_master_motor_power` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 32 | `change_script_variables` | 有执行路径／未完整验证 | 官方代码API／非同名积木 | `src/engine.rs:3498` | T12 | 官方代码 API，非注册积木；官方 JS→XML 存在赋值转换异常，本地兼容别名未模拟该缺陷 |
| 33 | `change_variables` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3498` | T1, T4, T5, T9, T12, T17, T23 | 有路径；完整语义未验证 |
| 34 | `check_emotion` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现 |
| 35 | `check_face_shape` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现 |
| 36 | `check_gender` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅人脸缓存为空时 numeric NaN，不是 false；检测后端未实现 |
| 37 | `check_key` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2737` | T5, T23 | 有路径；完整语义未验证 |
| 38 | `check_tilt_direction_of_face` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅无检测结果时 false；检测后端未实现 |
| 39 | `clearInterval` | 部分语义 | 已注册／本次面板未列出 | `src/engine.rs:3413` | T11 | 取消尚未派发的定时器；浏览器 timer ID 数值不保证相同 |
| 40 | `clearTimeout` | 部分语义 | 已注册／本次面板未列出 | `src/engine.rs:3413` | T11 | 取消尚未派发的定时器；浏览器 timer ID 数值不保证相同 |
| 41 | `clear_all_effects` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3699` | T23 | 有路径；完整语义未验证 |
| 42 | `clear_drawing` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4230` | T5, T23 | 有路径；完整语义未验证 |
| 43 | `close_self_dialog` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3878` | T10, T23 | 有路径；完整语义未验证 |
| 44 | `console_log` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4391` | T2, T4, T5, T10, T11, T12, T13, T14, T15, T16, T18, T21, T22, T23 | 有路径；完整语义未验证 |
| 45 | `controls_while` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:4428` | T9, T12 | 官方注册/JS 转换已验证；NekoC 前测循环有回归，KN 原生播放调度差分未验证 |
| 46 | `convert_type` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:2240`<br>`src/engine.rs:2689` | T4, T5, T13, T23 | 已按63条官方观测补齐列表/null/undefined/普通对象与boolean目标；警告UI、自定义原型及循环值未验证 |
| 47 | `coordinate_of_sprite` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2770` | T5, T23 | 有路径；完整语义未验证 |
| 48 | `create_stage_dialog` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3852`<br>`src/engine.rs:3860` | T23 | 有路径；完整语义未验证 |
| 49 | `delete_list_item` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4236` | T5, T23 | 有路径；完整语义未验证 |
| 50 | `dispose_clone` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4123` | T1, T5, T23 | 有路径；完整语义未验证 |
| 51 | `distance_to` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2803` | T23 | 有路径；完整语义未验证 |
| 52 | `divisible_by` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2927` | T5, T23 | 有路径；完整语义未验证 |
| 53 | `effect_of_sprite` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2896` | T23 | 有路径；完整语义未验证 |
| 54 | `enable_face_detect_by_actor` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的登录拒绝；人脸检测未实现 |
| 55 | `enable_face_detect_by_photo` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的登录拒绝；拍照/人脸检测未实现 |
| 56 | `enable_object_detect_by_actor` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的登录拒绝；物体检测未实现 |
| 57 | `enable_object_detect_by_photo` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的登录拒绝；拍照/物体检测未实现 |
| 58 | `evaluate_actor_style` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的缺模型/离线拒绝；模型预测未实现 |
| 59 | `evaluate_camera` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T18, T19, T20, T21 | 仅显式离线匿名 profile 的缺模型/离线拒绝；摄像/模型预测未实现 |
| 60 | `evaluate_photo` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的缺模型/离线拒绝；拍照/模型预测未实现 |
| 61 | `face_to_body_part` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3423` | T18, T23 | 仅无检测结果时不修改方向；检测后端未实现 |
| 62 | `get_answer` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2143`<br>`src/engine.rs:2725` | T5, T23 | 有路径；完整语义未验证 |
| 63 | `get_appearance_of_part` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18, T23 | 仅无检测结果时 NaN；检测后端未实现 |
| 64 | `get_choice_and_index` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2167`<br>`src/engine.rs:2725` | T5, T23 | 有路径；完整语义未验证 |
| 65 | `get_clone_index_property` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:2168`<br>`src/engine.rs:2859` | T1, T4, T10, T23 | 已补命名宽高/方向/造型属性；历史数字属性码与特效重叠及其他属性未完整验证 |
| 66 | `get_clone_num` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:2804` | T5, T23 | 有路径；完整语义未验证 |
| 67 | `get_current_clone_index` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:2858` | T1, T5, T23 | 有路径；完整语义未验证 |
| 68 | `get_evaluate_class_accuracy` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1834`<br>`src/engine.rs:2601` | T19, T21 | 仅显式离线匿名 profile 的 numeric NaN，保留可选 index 求值；模型预测未实现 |
| 69 | `get_evaluate_class_name` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1834`<br>`src/engine.rs:2601` | T19, T21 | 仅显式离线匿名 profile 的 numeric NaN，保留可选 index 求值；模型与标签后端未实现 |
| 70 | `get_face_detection_result` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18, T19 | 仅人脸缓存为空时 NaN；字段对应的真实检测结果未实现 |
| 71 | `get_mouse_info` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2665` | T5, T23 | 有路径；完整语义未验证 |
| 72 | `get_object_detection_result` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18, T19 | 仅物体缓存为空时 NaN；检测后端未实现 |
| 73 | `get_orientation` | 固定值占位 | 普通面板配置／默认未隐藏 | `src/engine.rs:2782` | T5, T18, T23 | 官方 desktop 无设备分支实测为 numeric 0；仍未接入移动端设备倾斜，固定值不算传感器支持 |
| 74 | `get_play_audio` | 有执行路径／未完整验证 | 面板嵌套／动态块 | `src/engine.rs:2012` | T5 | 有路径；完整语义未验证 |
| 75 | `get_position_of_body_part` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅无检测结果时 NaN；检测后端未实现 |
| 76 | `get_robot2_master_motor_power` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 77 | `get_robot_master_infrared_sensor_distance` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 78 | `get_robot_master_motor_power` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 79 | `get_sprite_property` | 缺失 | 官方代码API／非同名积木 | — | T10 | 官方未注册同名积木；这是转换到 coordinate/style/appearance/effect 等积木的代码 API，不伪造 VM 入口 |
| 80 | `get_stage_info` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2864` | T5, T23 | 有路径；完整语义未验证 |
| 81 | `get_tilt_angle_of_face` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18, T23 | 仅无检测结果时 NaN；检测后端未实现 |
| 82 | `get_time` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2231`<br>`src/engine.rs:2882` | T23 | 有路径；完整语义未验证 |
| 83 | `get_timer` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2768` | T4, T12 | 独立 block timer；官方用墙钟，NekoC 用 VM 仿真时间，暂停/节流和精度一致性未验证 |
| 84 | `get_voice_answer` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18, T20, T21 | 仅未开始识别的初始空文本；麦克风、权限与识别后端未实现 |
| 85 | `get_voice_volume` | 缺失 | 普通面板配置／默认未隐藏 | — | T18, T20, T21 | 缺少 AI/识别/账户/网络服务及对应执行路径；不是 stub 支持 |
| 86 | `global_animation` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:3383` | T21, T23 | 仅阻塞式宿主请求/完成回调；viewer 的 SVGA/全局音频/滤镜未实现，未接宿主会等待，官方像素与时序未验证 |
| 87 | `image_stamp` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3945` | T5, T23 | 有路径；完整语义未验证 |
| 88 | `isFinite` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2094`<br>`src/engine.rs:2689` | T9, T14 | 有路径；完整语义未验证 |
| 89 | `isNaN` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2093`<br>`src/engine.rs:2689` | T9, T14 | 有路径；完整语义未验证 |
| 90 | `list_append` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4245` | T1, T5, T9, T12, T17, T23 | 有路径；完整语义未验证 |
| 91 | `list_copy` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4263` | T5, T23 | 有路径；完整语义未验证 |
| 92 | `list_get` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2095` | T23 | 有路径；完整语义未验证 |
| 93 | `list_index_of` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:1979`<br>`src/engine.rs:2689` | T5, T23 | 有路径；完整语义未验证 |
| 94 | `list_insert_value` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4249` | T5, T23 | 有路径；完整语义未验证 |
| 95 | `list_is_exist` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:1979`<br>`src/engine.rs:2689` | T5, T23 | 有路径；完整语义未验证 |
| 96 | `list_item` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2105`<br>`src/engine.rs:2756`<br>`src/engine.rs:2759` | T1, T5, T9, T23, T25 | 有路径；完整语义未验证 |
| 97 | `list_length` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2753` | T5, T9, T12, T23 | 有路径；完整语义未验证 |
| 98 | `logic_boolean` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:2019`<br>`src/engine.rs:2647` | T4, T5, T9, T12, T13, T23 | 有路径；完整语义未验证 |
| 99 | `logic_compare` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2042`<br>`src/engine.rs:2725` | T1, T5, T9, T12, T15, T18, T23 | 有路径；完整语义未验证 |
| 100 | `logic_negate` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2031`<br>`src/engine.rs:2725` | T4, T5, T15, T23 | 有路径；完整语义未验证 |
| 101 | `logic_operation` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2037`<br>`src/engine.rs:2725` | T5, T23 | 有路径；完整语义未验证 |
| 102 | `logic_ternary` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2032`<br>`src/engine.rs:2725` | T9 | 有路径；完整语义未验证 |
| 103 | `logic_to_boolean` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2078`<br>`src/engine.rs:2689` | T9, T14 | 有路径；完整语义未验证 |
| 104 | `math_add_assign` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3546` | T14 | 有路径；完整语义未验证 |
| 105 | `math_arithmetic` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:1891`<br>`src/engine.rs:2949` | T1, T4, T5, T9, T13, T14, T15, T17, T18, T21, T23, T24 | 有路径；完整语义未验证 |
| 106 | `math_decrement` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3546` | T14 | 有路径；完整语义未验证 |
| 107 | `math_div_assign` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3546` | T14 | 有路径；完整语义未验证 |
| 108 | `math_function` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2997` | T5, T23 | 有路径；完整语义未验证 |
| 109 | `math_increment` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3546` | T14 | 有路径；完整语义未验证 |
| 110 | `math_mod_assign` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3546` | T14 | 有路径；完整语义未验证 |
| 111 | `math_modulo` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2949` | T23 | 有路径；完整语义未验证 |
| 112 | `math_mul_assign` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3546` | T14 | 有路径；完整语义未验证 |
| 113 | `math_number_property` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:1941`<br>`src/engine.rs:2928` | T4, T5, T23 | 有路径；完整语义未验证 |
| 114 | `math_round` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2997` | T5, T23 | 有路径；完整语义未验证 |
| 115 | `math_sub_assign` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3546` | T14 | 有路径；完整语义未验证 |
| 116 | `math_trig` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2997` | T5, T23 | 有路径；完整语义未验证 |
| 117 | `math_trig_rad` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2982` | T5 | 有路径；完整语义未验证 |
| 118 | `microbit_accelerometer` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 119 | `microbit_button_is_pressed` | 部分语义 | 官方硬件扩展定义／未安装 | `src/engine.rs:1843`<br>`src/engine.rs:2610` | T15 | 仅无microbit连接时boolean false；真实设备按键未实现 |
| 120 | `microbit_button_when` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 121 | `microbit_change_bpm` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 122 | `microbit_compass_heading` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 123 | `microbit_get_volume` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 124 | `microbit_is_gesture` | 部分语义 | 官方硬件扩展定义／未安装 | `src/engine.rs:1843`<br>`src/engine.rs:2610` | T15 | 仅无microbit连接时boolean false；真实设备手势未实现 |
| 125 | `microbit_led_clear` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 126 | `microbit_led_is_plot` | 部分语义 | 官方硬件扩展定义／未安装 | `src/engine.rs:1857`<br>`src/engine.rs:2610` | T15 | 仅无microbit连接时顺序求值x/y后boolean false；真实LED查询未实现 |
| 127 | `microbit_led_plot` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 128 | `microbit_led_plot_graph` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 129 | `microbit_led_show_custom` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 130 | `microbit_led_show_icon` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 131 | `microbit_led_show_number` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 132 | `microbit_led_show_text` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 133 | `microbit_led_toggle` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 134 | `microbit_led_unplot` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 135 | `microbit_light_level` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 136 | `microbit_logo_is_pressed` | 部分语义 | 官方硬件扩展定义／未安装 | `src/engine.rs:1843`<br>`src/engine.rs:2610` | T15 | 仅无microbit连接时boolean false；真实设备logo触摸未实现 |
| 137 | `microbit_logo_when` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 138 | `microbit_magnetometer` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 139 | `microbit_math_map` | 部分语义 | 官方硬件扩展定义／未安装 | `src/engine.rs:1904`<br>`src/engine.rs:2610` | T15, T16 | 仅无 microbit 连接时求值五个输入后 NaN；官方映射公式本身也检查连接，真实设备分支未实现 |
| 140 | `microbit_pause_by_beats` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 141 | `microbit_pin_analog_read` | 部分语义 | 官方硬件扩展定义／未安装 | `src/engine.rs:1843`<br>`src/engine.rs:2610` | T15 | 仅无microbit连接时numeric NaN；真实模拟引脚未实现 |
| 142 | `microbit_pin_analog_write` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 143 | `microbit_pin_digital_read` | 部分语义 | 官方硬件扩展定义／未安装 | `src/engine.rs:1843`<br>`src/engine.rs:2610` | T15 | 仅无microbit连接时numeric NaN；真实数字引脚未实现 |
| 144 | `microbit_pin_digital_write` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 145 | `microbit_pin_set_touch_mode` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 146 | `microbit_pin_when` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 147 | `microbit_play_melody` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 148 | `microbit_play_tone_by_beats` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 149 | `microbit_rotation` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 150 | `microbit_servo_set_angle_270` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 151 | `microbit_set_bpm` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 152 | `microbit_set_volume` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 153 | `microbit_sound_level` | 缺失 | 官方硬件扩展定义／未安装 | — | T15 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 154 | `microbit_stop` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 155 | `microbit_temperature` | 缺失 | 官方硬件扩展定义／未安装 | — | T15, T18 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 156 | `mirror` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3819` | T1, T5, T9, T10, T22, T23 | 有路径；完整语义未验证 |
| 157 | `mouse_down` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:2022`<br>`src/engine.rs:2901` | T8, T22, T23 | 已区分屏幕/当前实例/命名角色及克隆并保留布尔类型；非法目标编译期拒绝，完整事件顺序未验证 |
| 158 | `move_to_body_part` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3423` | T18 | 仅无检测结果时不修改位置；检测后端未实现 |
| 159 | `new_conversation` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T18, T19, T21 | 仅显式离线匿名 profile 的拒绝且保留缓存；真实新会话后端未实现 |
| 160 | `on_bump_actor` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3116` | T5, T23 | 有路径；完整语义未验证 |
| 161 | `on_bump_actor_value` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2150`<br>`src/engine.rs:2859` | T5, T23 | 有路径；完整语义未验证 |
| 162 | `on_keydown` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3108` | T2, T3, T5, T23 | 有路径；完整语义未验证 |
| 163 | `on_running_group_activated` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3069` | T1, T2, T3, T4, T5, T6, T7, T9, T10, T11, T12, T13, T14, T15, T16, T18, T21, T22, T23, T24, T25, T26 | 有路径；完整语义未验证 |
| 164 | `on_swipe` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3098` | T5 | 有路径；完整语义未验证 |
| 165 | `open_close_webcam` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T20, T21 | 仅从未开启 profile 的 turn_off；turn_on 明确拒绝，摄像设备未实现 |
| 166 | `open_hide_camera` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T20, T21 | 仅从未开启 profile 的 turn_off；turn_on 明确拒绝，摄像设备未实现 |
| 167 | `out_of_boundary` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2841` | T5, T23 | 有路径；完整语义未验证 |
| 168 | `parseFloat` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2082`<br>`src/engine.rs:2689` | T9, T14 | 有路径；完整语义未验证 |
| 169 | `parseInt` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2083`<br>`src/engine.rs:2689` | T9, T14 | 有路径；完整语义未验证 |
| 170 | `play_audio` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4231` | T2, T3, T5, T23 | 有路径；完整语义未验证 |
| 171 | `play_audio_and_wait` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3961` | T2, T5 | 有路径；完整语义未验证 |
| 172 | `play_word_audio_wait` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3970` | T2 | 有路径；完整语义未验证 |
| 173 | `play_words_audio` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3970` | 未定位 | 有路径；完整语义未验证 |
| 174 | `procedures_2_actor_param` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2798` | T10 | 按 mutation 参数 ID 与 Actor 字段实参读属性；clone_index 显式拒绝，完整过程作用域与错误差分未验证 |
| 175 | `procedures_2_defnoreturn` | 元数据 | 已注册／本次面板未列出 | `src/engine.rs:1142 (compiler metadata)` | T5, T9, T10, T12 | 非独立指令；由过程/循环编译消费 |
| 176 | `random_num` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2674` | T4, T5, T23 | 有路径；完整语义未验证 |
| 177 | `received_broadcast` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:1970`<br>`src/engine.rs:2689` | T5, T23 | 有路径；完整语义未验证 |
| 178 | `recognize_body_part` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅无检测结果时 false；检测后端未实现 |
| 179 | `recognize_gesture` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅无检测结果时 false；检测后端未实现 |
| 180 | `repeat_forever` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4428` | T5, T12, T22, T23, T26 | 有路径；完整语义未验证 |
| 181 | `repeat_forever_until` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4428` | T5, T23 | 有路径；完整语义未验证 |
| 182 | `repeat_n_times` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4428` | T1, T4, T5, T9, T11, T12, T13, T14, T15, T16, T17, T18, T21, T23, T26 | 有路径；完整语义未验证 |
| 183 | `replace_list_item` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4254` | T5, T9, T23 | 有路径；完整语义未验证 |
| 184 | `reset_timer` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3448` | T12 | 只重置独立 block timer，不改变舞台计时器；官方墙钟与 VM 仿真时钟差异未验证 |
| 185 | `restart` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3818` | T5, T9, T23 | 有路径；完整语义未验证 |
| 186 | `script_variables` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:3433` | T5, T9, T12, T23 | 有路径；完整语义未验证 |
| 187 | `script_variables_set` | 有执行路径／未完整验证 | 官方代码API／非同名积木 | `src/engine.rs:3452` | T12 | 官方代码 API，非注册积木；原生作品用 variables_set + 脚本变量 JSON。兼容别名参照 HateNeko |
| 188 | `script_variables_value` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2074`<br>`src/engine.rs:2664` | T5, T9, T12, T23 | 有路径；完整语义未验证 |
| 189 | `self_appear` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3644` | T5, T23 | 有路径；完整语义未验证 |
| 190 | `self_appear_animation` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3905` | T5, T23 | 有路径；完整语义未验证 |
| 191 | `self_ask` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4044` | T5, T23 | 有路径；完整语义未验证 |
| 192 | `self_bounce_off_edge` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3879` | T5, T23, T24 | 有路径；完整语义未验证 |
| 193 | `self_broadcast` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4350` | T5, T23 | 有路径；完整语义未验证 |
| 194 | `self_broadcast_and_wait` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4350` | T5, T23 | 有路径；完整语义未验证 |
| 195 | `self_broadcast_with_param` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:4350` | T5, T23 | 有路径；完整语义未验证 |
| 196 | `self_change_coordinate_x` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3629` | T5, T23 | 有路径；完整语义未验证 |
| 197 | `self_change_coordinate_y` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3629` | T23 | 有路径；完整语义未验证 |
| 198 | `self_change_effect` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3680` | T5, T23 | 有路径；完整语义未验证 |
| 199 | `self_change_pen_color_property` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4274` | T5, T23 | 有路径；完整语义未验证 |
| 200 | `self_change_pen_size` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3717`<br>`src/engine.rs:4306` | T23 | 有路径；完整语义未验证 |
| 201 | `self_change_scale` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3700` | T5, T10, T23 | 有路径；完整语义未验证 |
| 202 | `self_dialog` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3860` | T5, T23 | 有路径；完整语义未验证 |
| 203 | `self_dialog_wait` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:3860` | T10, T23 | 官方实际为无限时非阻塞气泡；已补可见性/空文本/截断，跨场景及并发 timed 气泡取消未验证 |
| 204 | `self_face_to` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3728` | T5, T23 | 有路径；完整语义未验证 |
| 205 | `self_face_to_sprite` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3728` | T23 | 有路径；完整语义未验证 |
| 206 | `self_glide_coordinate_x` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3764` | T23 | 有路径；完整语义未验证 |
| 207 | `self_glide_coordinate_y` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3764` | T23 | 有路径；完整语义未验证 |
| 208 | `self_glide_to` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3764` | T5, T23 | 有路径；完整语义未验证 |
| 209 | `self_go_forward` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3623` | T5, T23, T26 | 有路径；完整语义未验证 |
| 210 | `self_gradually_show_hide` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3803` | T5, T23 | 有路径；完整语义未验证 |
| 211 | `self_listen` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3065` | T5, T23 | 有路径；完整语义未验证 |
| 212 | `self_listen_value` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:1964`<br>`src/engine.rs:2689` | T5, T23 | 有路径；完整语义未验证 |
| 213 | `self_listen_with_param` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:3065` | T5, T23 | 有路径；完整语义未验证 |
| 214 | `self_move_specify` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3731` | T23 | 有路径；完整语义未验证 |
| 215 | `self_move_specify_sprite` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3731` | T23 | 有路径；完整语义未验证 |
| 216 | `self_move_to` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3624` | T5, T6, T23 | 有路径；完整语义未验证 |
| 217 | `self_pen_down` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4226` | T4, T5, T23 | 有路径；完整语义未验证 |
| 218 | `self_pen_up` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4227` | T5, T23 | 有路径；完整语义未验证 |
| 219 | `self_point_towards` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3642` | T5, T10, T23 | 有路径；完整语义未验证 |
| 220 | `self_prev_next_style` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3670` | T5, T23 | 有路径；完整语义未验证 |
| 221 | `self_rotate` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3641` | T23 | 有路径；完整语义未验证 |
| 222 | `self_rotate_around` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3739` | T5, T23 | 有路径；完整语义未验证 |
| 223 | `self_set_draggable` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3938` | T5, T23 | 有路径；完整语义未验证 |
| 224 | `self_set_effect` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3680` | T5, T23 | 有路径；完整语义未验证 |
| 225 | `self_set_pen_color` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4332` | T5, T23 | 有路径；完整语义未验证 |
| 226 | `self_set_pen_color_property` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4274` | T5, T23 | 有路径；完整语义未验证 |
| 227 | `self_set_pen_size` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4306`<br>`src/engine.rs:4331` | T5, T23 | 有路径；完整语义未验证 |
| 228 | `self_set_position_x` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3625` | T4, T5, T7, T9, T23 | 有路径；完整语义未验证 |
| 229 | `self_set_position_y` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3626` | T5, T23 | 有路径；完整语义未验证 |
| 230 | `self_set_role_camp` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3880` | T5, T23 | 有路径；完整语义未验证 |
| 231 | `self_set_rotation_type` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3722` | T5, T23 | 有路径；完整语义未验证 |
| 232 | `self_stress_animation` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3893` | T5, T23 | 有路径；完整语义未验证 |
| 233 | `self_text_effect_color` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3932` | T5, T23 | 有路径；完整语义未验证 |
| 234 | `self_text_effect_size` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3931` | T5, T23 | 有路径；完整语义未验证 |
| 235 | `self_text_effect_text` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3930` | T5, T23 | 有路径；完整语义未验证 |
| 236 | `setInterval` | 部分语义 | 已注册／本次面板未列出 | `src/engine.rs:3408` | T11 | 按官方 0.27.4 原生实测丢弃 callback statement，只调度空回调；通用 JS function 回调未实现，墙钟精度未验证 |
| 237 | `setTimeout` | 部分语义 | 已注册／本次面板未列出 | `src/engine.rs:3408` | T11, T18 | 按官方 0.27.4 原生实测丢弃 callback statement，只调度空回调；通用 JS function 回调未实现，墙钟精度未验证 |
| 238 | `set_camera_alpha` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T20, T21 | 仅共享离线 alpha 控制值，严格 Number 与夹取；实际摄像/渲染未实现，异步相位未验证 |
| 239 | `set_pen_layer` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4191` | T5, T23 | 有路径；完整语义未验证 |
| 240 | `set_robot2_master_motor_power_rotation` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 241 | `set_robot2_master_motor_power_rotation_duration` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 242 | `set_robot_master_light_color` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 243 | `set_robot_master_light_color_duration` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 244 | `set_robot_master_motor_power_rotation` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 245 | `set_robot_master_motor_power_rotation_duration` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 246 | `set_scale` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3643` | T5, T10, T23 | 有路径；完整语义未验证 |
| 247 | `set_screen_transition` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3834` | T5, T23 | 有路径；完整语义未验证 |
| 248 | `set_sprite_style` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3669` | T5, T23 | 有路径；完整语义未验证 |
| 249 | `set_system_preset` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T19, T21 | 仅显式离线匿名 profile 的拒绝；不会假称本地保存提示词，真实服务未实现 |
| 250 | `set_timer_state` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4268` | T5, T12, T23 | 有路径；完整语义未验证 |
| 251 | `set_top_bottom_layer` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4125` | T5, T23 | 有路径；完整语义未验证 |
| 252 | `set_webcam_alpha` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T20, T21 | 仅共享离线 alpha 控制值，严格 Number 与夹取；实际摄像/渲染未实现，异步相位未验证 |
| 253 | `set_width_height_scale` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3703` | T5, T10, T23 | 有路径；完整语义未验证 |
| 254 | `show_hide_list` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3990` | T23 | 有路径；完整语义未验证 |
| 255 | `show_hide_ranking` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T21 | 仅本地未发布作品的无榜单提前返回；真实榜单 UI/网络未实现 |
| 256 | `show_hide_timer` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4267` | T5, T23 | 有路径；完整语义未验证 |
| 257 | `show_hide_variables` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3990` | T4, T5, T23 | 有路径；完整语义未验证 |
| 258 | `sound_color` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3973` | T2 | 有路径；完整语义未验证 |
| 259 | `sprite_on_tap` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3131` | T5, T23 | 有路径；完整语义未验证 |
| 260 | `stamp` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4295`<br>`src/engine.rs:4321` | T5, T23 | 有路径；完整语义未验证 |
| 261 | `start_as_a_mirror` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3084` | T1, T5, T9 | 有路径；完整语义未验证 |
| 262 | `start_on_click` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:3069` | T4, T5, T7, T23, T27 | 有路径；完整语义未验证 |
| 263 | `stop` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4361` | T2, T5, T6, T9, T11, T12, T23 | 有路径；完整语义未验证 |
| 264 | `stop_audio` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4231` | T2, T5, T23 | 有路径；完整语义未验证 |
| 265 | `stop_robot2_master_motor` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 266 | `stop_robot_master_light` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 267 | `stop_robot_master_motor` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 268 | `style_of_sprite` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2799` | T23 | 有路径；完整语义未验证 |
| 269 | `switch_to_screen` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3825` | T5, T23 | 有路径；完整语义未验证 |
| 270 | `sync_tell` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:4178` | T1, T5, T9, T23 | 有路径；完整语义未验证 |
| 271 | `tell` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:4178` | T23 | 有路径；完整语义未验证 |
| 272 | `temporary_list` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:2113` | T5, T9, T23 | 有路径；完整语义未验证 |
| 273 | `text_contain` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:1971`<br>`src/engine.rs:2689` | T5, T23 | 有路径；完整语义未验证 |
| 274 | `text_join` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2113`<br>`src/engine.rs:2689` | T5, T23 | 有路径；完整语义未验证 |
| 275 | `text_length` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2673` | T5, T23 | 有路径；完整语义未验证 |
| 276 | `text_select` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2212`<br>`src/engine.rs:2689` | T5, T23, T24 | 有路径；完整语义未验证 |
| 277 | `text_split` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2015` | T5, T23 | 有路径；完整语义未验证 |
| 278 | `timer` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2767` | T5, T12, T23 | 有路径；完整语义未验证 |
| 279 | `translate` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:3383` | T21 | 仅离线传输失败/空白提前返回；成功翻译与对话框未实现，Promise 相位未验证 |
| 280 | `translate_result` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:1834`<br>`src/engine.rs:2601` | T18, T19, T21 | 仅离线失败/空白返回空文本并求值输入；成功翻译后端未实现，Promise 相位未验证 |
| 281 | `traverse_number` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4455` | T5, T9, T12, T23 | 有路径；完整语义未验证 |
| 282 | `traverse_number_param` | 元数据 | 已注册／本次面板未列出 | `src/engine.rs:1701 (compiler metadata)` | T5, T9, T12, T23 | 非独立指令；由过程/循环编译消费 |
| 283 | `traverse_number_value` | 有执行路径／未完整验证 | 已注册／本次面板未列出 | `src/engine.rs:2746` | T3, T5, T23 | 有路径；完整语义未验证 |
| 284 | `update_ranking` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:3383` | T18, T21 | 仅本地未发布作品的无榜单提前返回；真实分数提交/持久化未实现 |
| 285 | `user_id_get` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅无账户后端 profile：官方未登录返回字符串 0；已登录用户未实现 |
| 286 | `user_info_of_th` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1834`<br>`src/engine.rs:2601` | T21 | 仅无 KN 榜单后端的 numeric NaN，order 仍求值；真实用户查询未实现 |
| 287 | `user_ranking_info` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1834`<br>`src/engine.rs:2601` | T18, T21 | 仅无 KN 榜单后端的 numeric NaN；真实排名/分数查询未实现 |
| 288 | `username_get` | 部分语义 | 可配置面板／默认隐藏 | `src/engine.rs:1863`<br>`src/engine.rs:2610` | T18 | 仅无账户后端 profile：官方未登录文本；已登录用户未实现 |
| 289 | `variables_get` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:2054`<br>`src/engine.rs:2650` | T1, T4, T5, T6, T9, T12, T13, T14, T15, T16, T17, T18, T21, T23 | 有路径；完整语义未验证 |
| 290 | `variables_set` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3452` | T1, T3, T4, T5, T9, T13, T14, T17, T23, T24, T25 | 有路径；完整语义未验证 |
| 291 | `voice_recognition` | 部分语义 | 普通面板配置／默认未隐藏 | `src/engine.rs:3383` | T18, T19, T20, T21 | 仅未登录提前返回与宿主提示；真实权限/识别/登录 UI 未实现 |
| 292 | `wait` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4348` | T1, T5, T9, T12, T23, T24 | 有路径；完整语义未验证 |
| 293 | `wait_until` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:4349` | T5, T23 | 有路径；完整语义未验证 |
| 294 | `wand_button_is_pressed` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 295 | `wand_coordinate` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 296 | `wand_direction_when` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 297 | `wand_reset_position` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 298 | `wand_rotation` | 缺失 | 官方硬件扩展定义／未安装 | — | 未定位 | 缺少硬件/连接后端或对应计算实现；不是 stub 支持 |
| 299 | `warp` | 有执行路径／未完整验证 | 可配置面板／默认隐藏 | `src/engine.rs:4413` | T1, T4, T5, T9, T11, T12, T14, T17, T23, T26 | 有路径；完整语义未验证 |
| 300 | `when` | 有执行路径／未完整验证 | 普通面板配置／默认未隐藏 | `src/engine.rs:3062`<br>`src/engine.rs:4169` | T5, T23 | 有路径；完整语义未验证 |

## 复现与更新

```powershell
# 无外部依赖：用仓库内名称快照重新扫描当前 engine 并生成文档
node tools/compat/kn-catalog-status.mjs --snapshot docs/kn-block-coverage.md
# 校验外部原始清单并输出带参考函数位置的 JSON（可选）
node tools/compat/kn-catalog-status.mjs E:/nekoc-wt/_ref/hateneko/player
npm run -s test:tools
```

统计和逐项表由工具生成；新增执行分派、清单变更、测试引用或风险分类变化后应重生成并人工复审，不能只将状态批量改成“已实现”。
