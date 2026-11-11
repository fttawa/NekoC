# K4 partial 第七轮：剩余A类主路径

基线 `693c7fe`：原95项中已升级27项，剩余A类28项、B类40项；partial 68项，加权3939。冻结频率分母不变。

本轮升级 **12项**，加权 **589**；partial剩余 **56项**，加权 **3350**。只认证下述主路径，不是作品成功率或全语义认证。

已消除：克隆删除早一帧、forceable关闭少一次积分与持续力ticker相位。滤镜/接触、软体等不因少量样例通过而默认认证。

## 全部28项（按冻结语料频率降序）

| 类型 | 频率 | 本轮结果 | 主路径证据/剩余部分 |
| --- | ---: | --- | --- |
| `self_set_effect_2` | 1228 | partial | 见 [滤镜专项](kitten4-partial-effects-7.md)：保留未对齐的主要算法/像素分支，不用常用scope通过代替全setter主路径 |
| `self_change_effect_3` | 735 | partial | 见 [滤镜专项](kitten4-partial-effects-7.md)：保留未对齐的主要算法/像素分支，不用常用scope通过代替全setter主路径 |
| `physics2_enable_force` | 317 | main-path-verified | 动态禁用/恢复、static同批速度写入忽略、双false保速；第六轮漏积分输入原样严格重放；[证据](kitten4-partial-physics-7.md)；未验证：软体/复杂轮廓、拖拽、角冲量、多场景与非60Hz；已知接触求解器差异仍在，bounce 2.797382832px、friction .703993056px；本轮边界接触最大1.815104166666856px，不是完整轨迹等价 |
| `set_scene_transition` | 215 | partial | 未验证：distort截图扭曲、完成回调调度和多场景组合；沿用第三轮，不升级 |
| `physics2_set_actor_as` | 173 | main-path-verified | collidable开关、sensor自由运动、双false禁用/恢复；不附带旧版清速；[证据](kitten4-partial-physics-7.md)；未验证：软体/复杂轮廓、拖拽、角冲量、多场景与非60Hz；已知接触求解器差异仍在，bounce 2.797382832px、friction .703993056px；本轮边界接触最大1.815104166666856px，不是完整轨迹等价 |
| `physics2_set_texture` | 103 | partial | 仅hard/硬体adapter已实测；soft形变/重建未实现，见 [物理专项](kitten4-partial-physics-7.md) |
| `self_set_boundary` | 92 | partial | 四菜单边界存在/移除控制已实测；主要接触轨迹仍有最大1.815104166666856px误差，仅有界回归，保留partial，见 [物理专项](kitten4-partial-physics-7.md) |
| `physics2_set_boundary` | 67 | partial | 四菜单边界存在/移除控制已实测；主要接触轨迹仍有最大1.815104166666856px误差，仅有界回归，保留partial，见 [物理专项](kitten4-partial-physics-7.md) |
| `set_entity_show_hide` | 64 | main-path-verified | 有效UUID角色/组瞬时与渐变显隐，含删除调用克隆；408帧状态与408对零超差画布；[证据](kitten4-partial-lifecycle-7.md)；未验证：场景隐藏/悬空UUID、畸形mode、同帧restart/stop-all、嵌套tell、多点拖拽、跨场景/slot复用竞争、非60Hz |
| `physics2_forbid_bump_with` | 33 | main-path-verified | 指定右边缘/独立角色禁碰穿越与恢复允许调用；不认证恢复接触冲量/克隆组；[证据](kitten4-partial-physics-7.md)；未验证：软体/复杂轮廓、拖拽、角冲量、多场景与非60Hz；已知接触求解器差异仍在，bounce 2.797382832px、friction .703993056px；本轮边界接触最大1.815104166666856px，不是完整轨迹等价 |
| `self_shake` | 10 | partial | 新增三件负例证实帧尾update/结束续接未对齐，见 [数据专项](kitten4-partial-data-7.md) |
| `physics2_set_flexibility` | 3 | partial | 仅hard/硬体adapter已实测；soft形变/重建未实现，见 [物理专项](kitten4-partial-physics-7.md) |
| `physics2_set_force_in_time` | 2 | main-path-verified | 新建/运行中world、1秒非零力、正负角度、0/负整数阻塞、小数忽略和完成续接；[证据](kitten4-partial-physics-7.md)；未验证：软体/复杂轮廓、拖拽、角冲量、多场景与非60Hz；已知接触求解器差异仍在，bounce 2.797382832px、friction .703993056px；本轮边界接触最大1.815104166666856px，不是完整轨迹等价 |
| `change_volume_or_rate` | 0 | partial | 未验证：旧音频严格ID、非有限增量、内部lock/improvise、真实音频时钟及停止竞态；沿用audio-aliases专项，不升级 |
| `get_physics_property` | 0 | main-path-verified | 五个合法菜单、材质/密度改变、动态与静态质量、运动与零速；[证据](kitten4-partial-physics-7.md)；未验证：软体/复杂轮廓、拖拽、角冲量、多场景与非60Hz；已知接触求解器差异仍在，bounce 2.797382832px、friction .703993056px；本轮边界接触最大1.815104166666856px，不是完整轨迹等价 |
| `midi_get` | 0 | main-path-verified | 字符串/数组有效搜索、MIDI id对象与纯等待调度，144个官方update全变量逐帧双模式对比；[证据](kitten4-partial-data-7.md)；未验证：孤立surrogate、无效END/nullish、宿主对象identity、非有限与精确截止浮点相位、非60Hz；不含MIDI发声 |
| `midi_wait` | 0 | main-path-verified | 字符串/数组有效搜索、MIDI id对象与纯等待调度，144个官方update全变量逐帧双模式对比；[证据](kitten4-partial-data-7.md)；未验证：孤立surrogate、无效END/nullish、宿主对象identity、非有限与精确截止浮点相位、非60Hz；不含MIDI发声 |
| `physics2_get_property` | 0 | main-path-verified | 六个合法菜单、方向/零速/static质量/硬体柔软度元数据；不代表软体认证；[证据](kitten4-partial-physics-7.md)；未验证：软体/复杂轮廓、拖拽、角冲量、多场景与非60Hz；已知接触求解器差异仍在，bounce 2.797382832px、friction .703993056px；本轮边界接触最大1.815104166666856px，不是完整轨迹等价 |
| `play_audio` | 0 | partial | 未验证：旧音频严格ID、非有限增量、内部lock/improvise、真实音频时钟及停止竞态；沿用audio-aliases专项，不升级 |
| `play_audio_and_wait` | 0 | partial | 未验证：旧音频严格ID、非有限增量、内部lock/improvise、真实音频时钟及停止竞态；沿用audio-aliases专项，不升级 |
| `self_change_effect` | 0 | partial | 见 [滤镜专项](kitten4-partial-effects-7.md)：保留未对齐的主要算法/像素分支，不用常用scope通过代替全setter主路径 |
| `self_change_effect_2` | 0 | partial | 见 [滤镜专项](kitten4-partial-effects-7.md)：保留未对齐的主要算法/像素分支，不用常用scope通过代替全setter主路径 |
| `self_set_density` | 0 | main-path-verified | 有限非负2.5/0/.125/1、质量重算、两位reporter舍入、匀速保持；[证据](kitten4-partial-physics-7.md)；未验证：软体/复杂轮廓、拖拽、角冲量、多场景与非60Hz；已知接触求解器差异仍在，bounce 2.797382832px、friction .703993056px；本轮边界接触最大1.815104166666856px，不是完整轨迹等价 |
| `self_set_effect` | 0 | partial | 见 [滤镜专项](kitten4-partial-effects-7.md)：保留未对齐的主要算法/像素分支，不用常用scope通过代替全setter主路径 |
| `self_texture` | 0 | main-path-verified | origin/iron/wood/elastic四种旧刚体材质预设及属性联动、速度保持；不是现代soft模拟；[证据](kitten4-partial-physics-7.md)；未验证：软体/复杂轮廓、拖拽、角冲量、多场景与非60Hz；已知接触求解器差异仍在，bounce 2.797382832px、friction .703993056px；本轮边界接触最大1.815104166666856px，不是完整轨迹等价 |
| `set_volume_or_rate` | 0 | partial | 未验证：旧音频严格ID、非有限增量、内部lock/improvise、真实音频时钟及停止竞态；沿用audio-aliases专项，不升级 |
| `stop_all_audios` | 0 | partial | 未验证：旧音频严格ID、非有限增量、内部lock/improvise、真实音频时钟及停止竞态；沿用audio-aliases专项，不升级 |
| `text_indexOf` | 0 | main-path-verified | 字符串/数组有效搜索、MIDI id对象与纯等待调度，144个官方update全变量逐帧双模式对比；[证据](kitten4-partial-data-7.md)；未验证：孤立surrogate、无效END/nullish、宿主对象identity、非有限与精确截止浮点相位、非60Hz；不含MIDI发声 |

## 认证与边界

- B类40项仍全部设备/服务降级与partial，不调用账户、付费或设备服务。
- 边界/过滤控制认证不等于接触轨迹相同；已知求解器误差独立保留。
- 非有限几何、多场景、软体、复杂轮廓和非60Hz均未验证，不做全平台一致声明。
- 官方来源、资源hash、完整帧与复现命令见各专项；未移植官方源码或HateNeko。
- 第六轮文档冻结历史统计，当前覆盖表由catalog重建；本轮测试同时检查28项分区与未验证边界。

```powershell
node tools/compat/k4-partial-7-scope.mjs --write
node --test tests/k4-partial-7-scope.test.mjs
```

全部门禁、语料三seed及风险详见根目录不提交的 OC-REPORT.md。
