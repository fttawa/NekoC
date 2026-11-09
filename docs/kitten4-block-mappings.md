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
- `lists_get_value` 的 `first`、`last` 已由原有适配支持；补接缺失 TYPE 的已发布作品（官方实现只有 last 分支特殊处理，因此按 INDEX 读取），以及旧式 `nth`（兼容推断，**未验证**官方编辑器会生成此编码）。未知选择器保持报错，不静默变成首项。负数/越界/非整数下标的完整官方异常语义不在本轮实现范围。
- `get_3` / `get_clone_index_property` 的角色变量 UUID **仍未实现**：VM 没有对应的按实体/克隆隔离的变量存储，不能安全映射为全局变量。保留显式编译错误。
- 6 音量、14 ASCII、15 速度没有现有相应 VM 属性实现，保持不支持；ASCII 不作为无效果的数值属性伪装支持。
- `show_ranking`、`hide_ranking`、`is_ranking_show_hide` 明确列为 stub：没有云排行榜服务及对应 UI，显示/隐藏无效果，状态查询固定为隐藏。
- `play_video`、`play_video_until_end`、`continue_pause_video`、`show_hide_video` 明确列为 stub：不播放、不显示、不暂停视频；等待播完的指令也立即继续，可能影响作品时序。
- 云数据及云监视器仅使用现有本地模拟，不同步云端，不提供多人或排行榜语义。
- 层级移动依赖现有 VM 绘制顺序；官方画笔目标造成的层级分区尚未实现（**未验证**），不在本任务扩展画笔功能。
- 现有 VM 的特效存储/修改逻辑仍有官方差异（例如默认亮度范围）；本轮接通报告值不等于完整特效一致性。宽高报告值需要区分绝对轴缩放，故将 K4 的轴设置、统一缩放和缩放增减限定在 K4 provenance 下修正，KN 路径保持原语义。
