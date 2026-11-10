# Kitten 4 常见积木的 VM 映射依据

本轮只修改运行前的副本；原生积木和导出内容仍保留。测试使用手工构造的最小 `compile_result`，不包含线上作品。

## 官方证据

字段和普通菜单编码首先核对 `docs/kitten4-block-schema.json`（官方 4.11.20 编辑器观测）。该文件只展开菜单顶层，不能据此认为 `get_3` 只有四个属性。

2026-11-09 从官方编辑器首页引用的下列 bundle 核对实现：

<https://creation.codemao.cn/kitten/build/kitten.99f88a64d495cf0e79d0.js>

SHA-256：`1ffbfced591fd00d2ad604a00211cfcbd1a35e6ad3fcbe6ff7107a3ba76daaa2`。
以下位置为该文件的 **JavaScript 字符串字符偏移（从 0 开始）**，不是 UTF-8 字节偏移；也可搜索右列符号。文件仅下载到被忽略的 `dist/kitten4-official.js`，不入库。

| 位置 | 官方符号 / 结论 |
| --- | --- |
| 464794 附近、2502726 附近 | 属性枚举 `_e` / `C`：0 X、1 Y、2 造型编号、3 方向、4 造型名称、5 大小、6 音量、7 色相、8 透明度、9 亮度、10 像素化、11 位移、12 扭曲、13 灰度、14 ASCII、15 速度、16 宽度、17 高度 |
| 654460 | `get_3` 的嵌套菜单另含外观、特效和角色变量组；角色变量选项是变量 UUID |
| 2495438 | `convert_type`：数字使用 lodash `toNumber`；非数值且不是 NaN 时回退为 `String(i)`；字符串用 `String`；布尔用 `Boolean` |
| 328790 | `javascript_generator_shadow` 的 `logic_empty` 生成 `false` |
| 2495258 | `check_running_device` 分别调用 `is_phone` / `is_pc` / `is_tablet`；本地 VM 固定为电脑，不按浏览器 UA 模拟设备 |
| 2507073 | `self_set_rotation_type` 使用 0 自由旋转、1 左右翻转、2 不旋转 |
| 2524104、2526194 | `self_change_layer` 转给 `set_theatre_layer` 的 `layer=n` 分支：目标层为当前层加 n，再夹紧到允许范围；正数向前 |
| 2528395 | `get_clone_index_property`：0 号为原角色；其余编号查克隆；属性可为普通枚举或角色变量 UUID |
| 2534379 | `self_distance_to`：坐标差的 `Math.hypot`，用 `O` 保留两位小数 |
| 2534808 | `get_3`：`__self` 是当前运行实体（包含克隆）；变量 UUID 走带实体 ID 的变量读取 |
| 2581511 | `get_scene_or_actor_property`：造型编号从 1 开始、造型名称是文本、大小/宽度读 X 缩放百分比、高度读 Y 缩放百分比；隐藏角色的透明度为 100；数值用 `O` 保留两位小数 |
| 2535228 附近 | `get_stage_info` 读取舞台 view 的 width / height |
| 2496537 | `lists_get_value`：只有 `TYPE=last` 特别处理为列表长度，其余按 INDEX；顶层 schema 的 `first` 表示“第 INDEX 项”，不是固定首项；官方允许负下标 |
| 2497166 附近 | `show_hide_list` 获取列表监视器，并按 FUNC 显示/隐藏；变量监视器同理 |
| 2570414 | `sprite_on_tap.trigger_function`：`__scene` 解析当前屏幕，映射现有 VM `--screen` 指针目标；原生 `DO` 为事件体 |
| 4767764 | `is_ranking_show_hide` 比较 VAL 与排行榜显示状态；本地排行榜不显示，show 返回 false、hide 返回 true |

这是官方源码证据，**不是本轮官方浏览器端到端实测**。没有参考或移植 HateNeko。

## 本轮映射和边界

- 连接类型转换、三种旋转模式、带符号层级移动、克隆数量和已有克隆属性、距离、舞台宽高、运行设备、空布尔、列表/变量/云列表监视器。
- `get_3` 支持 0–5、7–13、16–17；造型名称不再误报为造型编号，自己克隆的属性读取不回落到原角色。
- `lists_get_value` 的 `first`、`last` 已由原有适配支持；补接缺失 TYPE 的已发布作品（官方实现只有 last 分支特殊处理，因此按 INDEX 读取），以及旧式 `nth`（兼容推断，**未验证**官方编辑器会生成此编码）。未知选择器保持报错，不静默变成首项。第二轮补充的负数、越界和非整数处理见下文。
- `get_3` / `get_clone_index_property` 的角色变量 UUID 现已接入按实体/克隆隔离的变量存储，复制、读写和官方实测依据见 [actor-variables.md](actor-variables.md)；不映射为全局变量。
- 6 音量、14 ASCII、15 速度没有现有相应 VM 属性实现，保持不支持；ASCII 不作为无效果的数值属性伪装支持。
- `show_ranking`、`hide_ranking`、`is_ranking_show_hide` 明确列为 stub：没有云排行榜服务及对应 UI，显示/隐藏无效果，状态查询固定为隐藏。
- `play_video`、`play_video_until_end`、`continue_pause_video`、`show_hide_video` 明确列为 stub：不播放、不显示、不暂停视频；等待播完的指令也立即继续，可能影响作品时序。
- 云数据及云监视器仅使用现有本地模拟，不同步云端，不提供多人或排行榜语义。
- 层级移动依赖现有 VM 绘制顺序；官方画笔目标造成的层级分区尚未实现（**未验证**），不在本任务扩展画笔功能。
- 现有 VM 的特效存储/修改逻辑仍有官方差异（例如默认亮度范围）；本轮接通报告值不等于完整特效一致性。宽高报告值需要区分绝对轴缩放，故将 K4 的轴设置、统一缩放和缩放增减限定在 K4 provenance 下修正，KN 路径保持原语义。

## 第二轮（blocks2）补充证据

本节使用相同 SHA-256 的官方 bundle。偏移仍为 JavaScript 字符偏移。

| 位置 / 可搜索符号 | 核实内容与处理 |
| --- | --- |
| 2536730 `bump_into_color:function` | 对目标组的成员作 `some`；缺失／不可见目标为 false。接通已有颜色碰撞并展开组，不新增像素采样算法。 |
| 2570767 `id:"on_swipe"` | Action responder，按方向过滤；复用 VM swipe 输入，不自动模拟触屏手势。 |
| 2572574 `id:"backdrop_on_change"`、2579573 `send_scene_action` | 实际监听 `scene_on_change`（屏幕激活），不是换背景造型；启动和切屏到匹配屏幕时派发。克隆上的该帽子行为**未验证**，当前仅派发原角色。 |
| 2524870 `self_flip:function`、1326216 `set_flipped` | 0 翻转 X，1 翻转 Y；轴翻转独立于缩放，属性宽高取绝对值。VM 绘制、碰撞几何和图像图章均保留镜像。 |
| 4302975 `terminate:function` | 禁止自动重启并 `dispose_all`；映射全局停止，之后事件不再启动，手动 start 可重启。 |
| 2525065 `set_costume:function`、2515123 附近 helper `d`/`p` | 数字采用 `Math.round(index-1)` 后取模；文本去首尾空白后按造型名查找；无效名称不切换。 |
| 1348561 `set_current_style(e)` | 找不到造型对象返回 ErrorMsg；缺失 UUID 造型对象仍保留显式错误（官方播放器是否忽略该情况**未验证**）。 |
| 2494500 附近 helper `o`、2496537 `lists_get_value` | 非 Array 抛 `only_list_type_supported`。读取支持负下标；0、非整数、越界均不是四舍五入／夹紧后的合法读取。修正 K4 读取并保留第一处列表错误，嵌套列表继续保留引用身份。 |
| 2494500–2496537 `lists_delete` / `lists_insert_value` / `lists_replace` | 写操作使用 JS `splice` 截断／相对负下标；插入 `(-2,-1]` 的特殊边界按源码处理。此处不宣称已覆盖所有类型及非有限值边界，KN 仍使用原索引语义。 |
| 4768429 `cloud_lists_get_value:function` | 云列表与普通列表不同：非正数／无效／越界读取返回空文本，正小数截断（小于 1 时按 1）。单独保留云列表读取路径，避免严格普通列表错误检查误伤现有本地云模拟；不提供云同步。 |
| 3516607 `m`、3521248 `change_volume_or_rate_2`、此前的 `set_volume_or_rate_2` | `all`、名称、UUID、四舍五入的一基数字选择音频；严格数值输入，百分比除 100，增减按 increase；音量夹紧 [0,1]，速率 [.05,4]。VM 输出命令并由 `web/audio.js` 消费，属性命令不停止播放；不再作为 stub。未在官方浏览器实测音频播放。 |
| 2553515 `set_actor_as:function` | 旧物理世界开关，不是普通外观操作；明确归类为物理 stub，不实现物理。 |
| 3517880 `play_words_audio:function` | TTS 调用 `lock:false`；明确为无语音输出、非阻塞 stub，不调用外部 TTS。 |

### 可复现的官方编辑器实测

`tools/semantics-kitten4-blocks2.mjs` 仅生成手写最小工程，未加载第三方语料；导入后先核对工作区的积木类型、字段和每一条连接，再启动运行：

```sh
node tools/semantics-kitten4-blocks2.mjs --out tests/fixtures/kitten4/blocks2-official.json
```

需要与现有探针相同的 Playwright / Edge 环境和官方网络访问。归档包含浏览器版本、实际脚本 URL、每个输入工程 `JSON.stringify` 的 SHA-256、连接校验和运行观测；`tests/kitten4-blocks2.test.mjs` 离线重建输入并核对哈希与关键断言。**归档测试不是每次重新访问官网。**

| 手写探针 | 官方观测 |
| --- | --- |
| 两个造型：依次选 0、3、1.5、missing、` 蓝色方块 ` | 报告编号依次 2、1、2、2、1，无效名称保留上个造型 |
| 逗号分割得到 `[10,20,30]`，读 -1 | 30，后续语句运行 |
| 数值变量接列表 append | 显示“数据类型错误，仅支持列表类型运行”，运行停止，后续标记未设置 |
| 两轴翻转后 set_scale 80 | 两轴翻转标志均 true，宽度报告值仍为 80 |
| 初始屏幕的 backdrop_on_change | 启动时变量设置为 7 |

### 尚未解决的列表语料差异

`267573240` 和 `305999424` 在官方播放器加载同一输入字节、点击运行后 2.5 秒仍为 running；这**不能证明错误被容忍**。播放器 `Tn6a` 的列表检查和 `iNFq.report_error_and_stop` 仍明确会抛错／停止。

VM 的第一失败实际是前面的列表读取越界（分别为第 426 项／长度 425、空列表读取），原先被外层“非列表”错误覆盖。官方与 VM 的初始化列表长度不同，涉及初始化与渲染／广播执行顺序；根积木排序试验也未定位根因。本轮没有修改全局 JSON 顺序或调度器来猜测修复，也没有将非列表强转空列表或吞异常。这两个作品仍属于**未完成兼容**，不能以新映射已接通宣称运行一致。

其余排除项仍为角色私有变量、非有限数值传播、物理、分裂；未参考或移植 HateNeko。
