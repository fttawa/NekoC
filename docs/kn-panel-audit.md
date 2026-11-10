# KN 第四轮：实际积木面板与候选名称审计

## 结论

官方 KN **0.27.4** 的匿名桌面编辑器实测表明：**不能将运行域 registry 缺失等同于积木下线，也不能把未安装扩展当成不存在**。本轮没有任何一项取得足以认证“非官方”或“已下线”的证据。

300 名称按本轮面板证据互斥分类如下。它是**官方名称/面板可达性分类**，不是 NekoC VM 实现状态，更不是兼容率。

| JSON `typeGroups` 键 | 数量 | 建议中文类别 |
| --- | ---: | --- |
| `panel-default` | 142 | 普通面板配置，默认未隐藏 |
| `panel-configurable-default-hidden` | 52 | 管理面板可配置，默认隐藏 |
| `panel-nested-or-dynamic` | 1 | 面板嵌套/动态块（`get_play_audio`） |
| `registered-not-in-audited-panels` | 41 | 已注册，本次面板未列出；可能为代码视图、上下文或元数据块 |
| `hardware-extension-config-not-installed` | 60 | 官方硬件扩展有面板定义，本次未安装 |
| `code-api-alias-not-block` | 4 | 官方代码 API/声明伪名，不是同名积木 |

完整、可直接交给覆盖生成器的 `type[]` 位于 [kn-panel-evidence.json](kn-panel-evidence.json) 的 `typeGroups`，无需从 Markdown 抽取。`notFoundTypes`、`certifiedUnofficialTypes`、`certifiedRetiredTypes` 均为空。**不要把最后两类统一标成已下线，也不要根据这些面板分类改变 VM 支持状态。**

## 方法、身份与复现

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-panel-probe.mjs
node --test tests/kn-panel.test.mjs
```

探针只暴露官方 webpack loader，不替换官方函数实现。新建隔离无头 Edge，选中默认“编程猫”角色，读取 `BlinkInstance.core.mainWorkspace.toolbox_` 的实际类别节点及 flyout XML 的**类型名称**；打开管理面板，逐个选择普通和 AI 类别，读取实际渲染 SVG 的类型 class。接着打开硬件页，只读取卡片和官方模块导出的面板配置，不点“添加”，不连接硬件，不调用任何运行域函数。构造/销毁 300 项时临时禁用 Blockly 编辑事件，避免裸函数定义块触发编辑器项目管理器断言；结束后恢复。

原始 bundle、截图、现场 JSON 只保留在忽略目录 `dist/kn-panel/`。tracked JSON 只含名称、数量、分类、散列、定位与原创转换样例的结果元数据；不含官方函数体、SVG、图像或 XML。`checkedAt=2026-11-10T17:57:30.164Z` 是机器实际 UTC 时间，约为北京时间 11 月 11 日凌晨，未手工改写。

| 官方文件 | SHA-256 |
| --- | --- |
| `main.8ccf2442.js` | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| `8011.ffdc9c7e.chunk.js`（管理面板） | `c8e17b0fa395887ebad9e8effae35c73ef11b6fd318e3b6aabc7dd6ac5f9c8b8` |
| `entry_hardware.481194e4.chunk.js` | `7259df6bc25c81905028a569ca5e99fba5091ca4fbddd29c2ec92ac15c75842d` |

URL 与原始 UTF-8 零基字节位置见 JSON。定位用完整模块 ID 加实际工厂匹配，避免把 `636` 误匹配到 `31636` 一类 ID 后缀；测试还核对下载散列和位置。

## 普通及扩展类别

初始侧栏实测 13 类：事件 `events`、控制 `control`、动作 `actions`、外观 `appearance`、特效 `animation`、界面 `interaction`、声音 `audio`、画笔 `pen`、侦测 `sensing`、运算 `operator`、变量 `variables`、列表 `list`、函数 `procedure`。后三类用动态回调，不能把空项目 flyout 无实例当成积木不存在。

普通管理页另外列出“联机” `online`，默认未添加。AI 页实际列出摄像 `camera`、认知 AI `cognitive`、AI 对话 `aiChat`、分类 AI `aiClassify`、文本识别 `aiText`，五类默认均隐藏。内部配置还有 `judge`，但它在 `invisibleToolboxs` 内，不算实际显示类别，也不在 300 名称中。管理页共实际渲染 **19** 类；函数类是“全部显示/隐藏”开关，明确不支持逐块配置，因此该页无单个函数块不构成缺失。

配置名与实际块型也不能混用：`controls_if_else` 渲染为 `controls_if`；`self_move_specify_sprite` 为 `self_move_specify`；`self_face_to_sprite` 为 `self_face_to`；`orientation_of_sprite` 为 `appearance_of_sprite`。JSON 同时保留配置类型和这一差异。因此 `panel-default` 的严谨含义是“面板配置存在且默认未隐藏”，不是“每个配置名都逐字实例化”。

`get_play_audio` 不在顶层配置清单，却出现在初始声音 flyout 的嵌套块内。相反 `calculate`、`get_timer`、`reset_timer`、`controls_while`、对象/数组/赋值、`parseInt`、`setTimeout` 等共 41 项可构造注册但不在本轮普通/AI顶层配置及初始嵌套节点中。这里仅标“本次面板未列出”，不推定它们全局不可见。

## 点名候选的证据与类别建议

| 名称/集合 | 现场官方证据 | 建议 |
| --- | --- | --- |
| `global_animation` | 初始特效 flyout、管理页“全局特效 礼炮”实际 SVG 均为此型；构造注册成功；域索引 189 | 普通默认面板积木，**不是下线项**。是否本地 VM 缺失由主会话另判 |
| `set_system_preset` | AI 对话配置和实际“设置 提示词”SVG；注册成功；域索引 229；默认隐藏 | AI 可配置积木，**不是非官方或下线项** |
| `get_sprite_property` | 同名无定义、构造拒绝、无域索引、无本次面板；原创 API `get_sprite_property('--self','x')` 转为 `coordinate_of_sprite`，`'color'` 转为 `effect_of_sprite` | 代码 API，不虚构同名 VM 积木 |
| `script_variables_set` | 同名不注册，原创 API 转为 `variables_set` | 代码 API |
| `change_script_variables` | 同名不注册，API 当前反向转换也产出 `variables_set` | 代码 API；保留官方已知反向转换缺陷，不认证增减语义 |
| `__break__` | 同名不注册/无面板；`break_loop()` 实际转为 `break`；前轮官方声明定位明确 `#blockName break` | 声明伪名；沿用 [kncat-official-evidence.md](kncat-official-evidence.md) 的声明证据，不宣称同名积木 |
| `wand_*` 五项 | 管理硬件页实际有“魔法棒”；模块 32990 导出 `wand_event` 的五个面板类型；本次未安装，构造不注册 | 官方硬件扩展配置，**不能宣称旧类型已下线** |
| 14 个 `robot/robot2_master` 类型 | 实际有 TUDAO Master/Lite 卡片；模块 92782、636 有动力/显示/侦测面板定义 | 官方硬件扩展配置；未验证安装后或真实硬件行为 |
| `catbit_usb_button_when` | 模块 11441 仍导出面板定义；卡片登记存在，但此普通桌面选择器过滤 USB 卡片 | 精确表述为“有官方定义、当前卡片不展示”，不是完全无注册/无面板证据 |

`get_sprite_property(..., 'size')` 是特意保留的失败对照：官方转换器报不支持属性，并残留一个同名 XML type。**转换器输出某个 type 不等于它已注册**；两个有效属性样例与实际注册查询才支持 API 分类。

硬件集合共 60 项：catbit 三项、wand 五项、robot/robot2 十四项、microbit 三十八项。这里只采面板/定义元数据，microbit 离线行为由另一任务负责。硬件模块位置见 JSON `hardwareCatalogConfigs` / `sourceLocations`，没有进行传感器读取、通信或执行器调用。

## 注册不等于面板，更不等于运行

236 项有同名官方定义且构造成功；64 项没有同名注册，其中恰为四个 API/声明伪名与六十个未安装硬件扩展。所有查询的定义表存在性与构造结果相符，无 page error、无销毁异常。

注册但无普通域索引的 18 项包括 `repeat_forever`、`on_keydown`、`controls_while`、`warp` 等控制、事件或过程类型。它们直接反证“无域索引就不是官方积木”这种规则。完整名单在 JSON `registration.registeredWithoutDomainIndex`。本轮未运行作品，也不据此认证其原生播放语义。

## 未验证与主会话接线建议

- 只审计一个匿名桌面构建及默认角色，未验证登录、课堂、移动、kids、所有角色/屏幕和历史版本。没有官方历史证据，故**已下线认证为 0，非官方认证为 0**。
- 动态变量/列表/函数内容随项目变化；上下文参数块可能由父块或定义器产生。41 项“本次面板未列出”不得升级为永久隐藏。
- 60 项硬件只证明官方扩展配置仍存在；未安装，不证明安装后注册成功，更不证明连接、传感器和执行器工作。
- API 转换仅为原创有限样例；`change_script_variables` 缺陷、非法 `size` 属性均保留，不当成可执行积木支持。
- 建议覆盖表新增独立 `officialCategory`/`panelEvidence` 维度，直接读取 `typeGroups`；把“VM缺失”与“清单别名”“默认隐藏”“扩展未安装”分开。不要直接从面板分类推断 VM 的“已支持”。
- 本任务只新增探针、元数据证据、本文和 JS 回归；未修改 coverage 生成器、既有状态测试或 Rust。未跑 Cargo、未提交、未生成 OC 报告。
