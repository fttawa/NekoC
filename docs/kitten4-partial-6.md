# K4 partial 第六轮：离线主路径与设备服务分流

## 范围与结果

基线 `d2d277b`（任务开始时最新本地 `oc/integrate`）：95 项 partial、语料加权8420。固定分母保留，不靠改变历史计数制造收益。
A类 **55项**（离线内核可直接验证），B类 **40项**（真实设备/网络/账户/宿主输出）。分类覆盖原95项且互斥；B类的纯本地失败路径仍可离线测试，但不等于服务成功路径。
本轮 **27项**升级为独立的 `main-path-verified`，加权 **4481**。这不是全语义认证，也不把B类改名计入升级。
原95项的partial降为 **68项**，剩余加权 **3939**；这不是作品成功率。所有377项仍有显式映射；B类从“已实现/partial”改为“设备降级/partial”是主状态纠偏，不是新增实现。
`offline-oracle-verified`保留既有积木本体验证含义；新增级别只保证指定原创输入、固定60Hz与已列主路径。覆盖表将未验证边界独立存储，已知求解器/渲染差异仍公开，不用一次终态相同代替逐帧对比。

## A类：按只读语料频率降序

高频优先核验；已有可重复官方证据可以复用，不能因一个罕见宿主边界否定整项主路径。已知主要选项未完成仍保留partial；下表不把零频类型称作语料常用类型。

静态子选项频率另存 `kitten4-partial-6-options.json`（不含作品、UUID、素材）：旧set_actor_as退出959/加入92；现代force关闭232/开启85；现代纹理hard101/soft2。效果set的scope1/2共1006，change共700；但change还含ASCII(scope7)3次、其他空间滤镜，不能把它们都叫作罕见宿主边界。频率只证明语料含此节点，不证明实际执行；本轮不声称对第三方作品做了逐分支动态覆盖。

| 类型 | 频率 | 本轮结果 | 证据/未验证边界 |
| --- | ---: | --- | --- |
| `get_3` | 2049 | main-path-verified | 未验证边界：删除竞争/悬空UUID、异步资源加载、非有限几何、iOS/ASCII与复杂对象输入；不是全属性平台全集认证 |
| `self_set_effect_2` | 1228 | partial | 存在字段、效果、渲染或平台子选项边界；映射存在不能证明全语义一致；8 种 scope、严格 number、别名增减、纹理尺寸 clamp、场景及小数 reporter 经 11 份原创夹具/1794 状态观察实测；ASCII 状态已支持但像素渲染、ELASTIC 与 iOS 仍未验证，见 kitten4-partial-effects.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `set_actor_as` | 1051 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `self_change_effect_3` | 735 | partial | 存在字段、效果、渲染或平台子选项边界；映射存在不能证明全语义一致；8 种 scope、严格 number、别名增减、纹理尺寸 clamp、场景及小数 reporter 经 11 份原创夹具/1794 状态观察实测；ASCII 状态已支持但像素渲染、ELASTIC 与 iOS 仍未验证，见 kitten4-partial-effects.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `physics2_enable_force` | 317 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；第二轮 7 份原创物理夹具/210 帧官方实测：旧 exit 即时 static 清速、新 forceable/ticker 延迟和禁用动态体保速已修正；不声明跨求解器等价，见 kitten4-physics-partial.md；第三轮 11 份原创夹具/660 帧官方轨迹：首次世界初始化、自由落体积分、20px/tick 向量限速、边界摩擦与全不透明矩形轮廓已修正；接触仍有误差，复杂轮廓/软体未对齐，见 kitten4-physics-trajectory-3.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `stamp` | 308 | main-path-verified | 未验证边界：平台字体/RTL、极端资源、翻转/多倍率、ELASTIC、颜色检测raster与任意并发；不是所有字体/纹理及滤镜shader认证 |
| `set_velocity` | 250 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `set_scene_transition` | 215 | partial | 存在字段、效果、渲染或平台子选项边界；映射存在不能证明全语义一致；第二轮 18 份原创夹具官方实测：严格尺寸/10000 上限、场景错误、原图无角色滤镜/alpha、目的矩形 floor、过渡别名与任意 direction 已补齐；字体/像素、颜色 raster 与真实过渡动画仍有限制，见 kitten4-partial-drawing.md；第三轮 12 份原创夹具/780 帧：slide/bounce/fade 位置与 alpha、非法名称显示已回归；distort 截图扭曲与完成回调调度未对齐，见 kitten4-partial-transition-3.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `physics2_set_actor_as` | 173 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；第二轮 7 份原创物理夹具/210 帧官方实测：旧 exit 即时 static 清速、新 forceable/ticker 延迟和禁用动态体保速已修正；不声明跨求解器等价，见 kitten4-physics-partial.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `image_stamp` | 165 | main-path-verified | 未验证边界：平台字体/RTL、极端资源、翻转/多倍率、ELASTIC、颜色检测raster与任意并发；不是所有字体/纹理及滤镜shader认证 |
| `get_clone_index_property` | 162 | main-path-verified | 未验证边界：删除竞争/悬空UUID、异步资源加载、非有限几何、iOS/ASCII与复杂对象输入；不是全属性平台全集认证 |
| `physics2_set_texture` | 103 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `self_enable_physics` | 95 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `self_set_friction` | 93 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `self_set_boundary` | 92 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `self_set_restitution` | 91 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `physics2_set_speed` | 77 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `physics2_set_boundary` | 67 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；第三轮 11 份原创夹具/660 帧官方轨迹：首次世界初始化、自由落体积分、20px/tick 向量限速、边界摩擦与全不透明矩形轮廓已修正；接触仍有误差，复杂轮廓/软体未对齐，见 kitten4-physics-trajectory-3.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `set_entity_show_hide` | 64 | partial | 第五轮17份原创夹具408官方帧：渐变尾部update相位、竞争alpha斜率叠加、取消调用方冻结、隐藏清理held指针、零/负/NaN/Infinity时长已实测；逐帧/像素结果见 kitten4-partial-visibility-5.md。克隆删除仍有一帧生命周期差异，场景/悬空UUID/非60Hz与完整手势边界保留partial；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `physics2_set_force` | 43 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `physics2_forbid_bump_with` | 33 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `physics2_set_resilience` | 27 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `physics2_set_roughness` | 20 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `physics2_allow_rotate` | 18 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `self_clear_effects` | 16 | main-path-verified | 未验证边界：平台字体/RTL、极端资源、翻转/多倍率、ELASTIC、颜色检测raster与任意并发；不是所有字体/纹理及滤镜shader认证 |
| `physics2_set_gravity` | 14 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `self_shake` | 10 | partial | 5 单位四方向逐更新抖动、阻塞及归位已有源码推导回归；与官方任务队列的逐帧相位/结束续接、物理刚体受力、竞争移动及取消未验证；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `physics2_set_flexibility` | 3 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `physics2_set_force_in_time` | 2 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `self_disable_physics` | 2 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `allow_rotate` | 0 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `change_volume_or_rate` | 0 | partial | legacy 音频已回归：动态目标及有符号增量已纠偏；严格 ID、非有限增量、内部 lock/improvise、微信录音分支仍有限制，见 kitten4-audio-aliases.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `get` | 0 | main-path-verified | 未验证边界：删除竞争/悬空UUID、异步资源加载、非有限几何、iOS/ASCII与复杂对象输入；不是全属性平台全集认证 |
| `get_2` | 0 | main-path-verified | 未验证边界：删除竞争/悬空UUID、异步资源加载、非有限几何、iOS/ASCII与复杂对象输入；不是全属性平台全集认证 |
| `get_physics_property` | 0 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `midi_get` | 0 | partial | 媒体/设备 host 契约：MIDI 时长、阻塞请求、完成结果与显式事件已有回归；viewer 尚未接入摄像头/录音/语音识别/MIDI/设备硬件，不能宣称实际设备效果；现有 TTS language 已接线但音色不等价，翻译仅离线失败 fallback，见 kitten4-third-media.md；第二轮原创官方离线实测默认 voice/scan、falsy translate 与 midi 对象最终值；异步帧相位、在线及实际设备未验证，见 kitten4-partial-text-2.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `midi_wait` | 0 | partial | 媒体/设备 host 契约：MIDI 时长、阻塞请求、完成结果与显式事件已有回归；viewer 尚未接入摄像头/录音/语音识别/MIDI/设备硬件，不能宣称实际设备效果；现有 TTS language 已接线但音色不等价，翻译仅离线失败 fallback，见 kitten4-third-media.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `physics2_get_property` | 0 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `physics2_set_mass` | 0 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `play_audio` | 0 | partial | legacy 音频已回归：动态目标及有符号增量已纠偏；严格 ID、非有限增量、内部 lock/improvise、微信录音分支仍有限制，见 kitten4-audio-aliases.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `play_audio_and_wait` | 0 | partial | legacy 音频已回归：动态目标及有符号增量已纠偏；严格 ID、非有限增量、内部 lock/improvise、微信录音分支仍有限制，见 kitten4-audio-aliases.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `self_change_effect` | 0 | partial | legacy alias 归一化；继承目标积木的字段、子选项与运行时限制；存在字段、效果、渲染或平台子选项边界；映射存在不能证明全语义一致；8 种 scope、严格 number、别名增减、纹理尺寸 clamp、场景及小数 reporter 经 11 份原创夹具/1794 状态观察实测；ASCII 状态已支持但像素渲染、ELASTIC 与 iOS 仍未验证，见 kitten4-partial-effects.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `self_change_effect_2` | 0 | partial | legacy alias 归一化；继承目标积木的字段、子选项与运行时限制；存在字段、效果、渲染或平台子选项边界；映射存在不能证明全语义一致；8 种 scope、严格 number、别名增减、纹理尺寸 clamp、场景及小数 reporter 经 11 份原创夹具/1794 状态观察实测；ASCII 状态已支持但像素渲染、ELASTIC 与 iOS 仍未验证，见 kitten4-partial-effects.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `self_set_density` | 0 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `self_set_effect` | 0 | partial | legacy alias 归一化；继承目标积木的字段、子选项与运行时限制；存在字段、效果、渲染或平台子选项边界；映射存在不能证明全语义一致；8 种 scope、严格 number、别名增减、纹理尺寸 clamp、场景及小数 reporter 经 11 份原创夹具/1794 状态观察实测；ASCII 状态已支持但像素渲染、ELASTIC 与 iOS 仍未验证，见 kitten4-partial-effects.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |
| `self_set_mass` | 0 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `self_texture` | 0 | partial | 刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `set_costume_by_id` | 0 | main-path-verified | 未验证边界：删除竞争/悬空UUID、异步资源加载、非有限几何、iOS/ASCII与复杂对象输入；不是全属性平台全集认证 |
| `set_force` | 0 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `set_force_by_vector` | 0 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `set_gravity` | 0 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `set_velocity_by_vector` | 0 | main-path-verified | 未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同；已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容；未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界 |
| `set_volume_or_rate` | 0 | partial | legacy 音频已回归：动态目标及有符号增量已纠偏；严格 ID、非有限增量、内部 lock/improvise、微信录音分支仍有限制，见 kitten4-audio-aliases.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `stop_all_audios` | 0 | partial | legacy 音频已回归：动态目标及有符号增量已纠偏；严格 ID、非有限增量、内部 lock/improvise、微信录音分支仍有限制，见 kitten4-audio-aliases.md；静态分派证据；未逐字段、错误路径、时序与官方差分验证 |
| `text_indexOf` | 0 | partial | 第二轮原创离线实测验证 FIRST/LAST、空 needle 的 1-based UTF-16 位置、FIND 转型、数组 VALUE 严格搜索和非字符串/非数组错误；孤立 surrogate、无效 END 与 nullish 参数未验证，见 kitten4-partial-text-2.md；已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致 |

## B类：保持设备/服务降级，不虚构成功

以下行为来自已有源码定位与回归（不是本轮新增真实服务成功实测）；每项都保留partial，主状态明确设备降级。未调用账号、摄像头、付费或在线翻译服务。

| 分组 | 类型 | 频率 | 无设备时行为 | 证据 |
| --- | --- | ---: | --- | --- |
| 云/账户/排行榜 | `cloud_variables_get` | 296 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_variables_set` | 159 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `change_cloud_variable` | 114 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_get_value` | 110 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_append` | 83 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_delete` | 32 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_length` | 28 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_replace` | 24 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `show_hide_cloud_list` | 13 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `show_hide_cloud_variable` | 13 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_is_exist` | 11 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `show_ranking` | 10 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_index_of` | 3 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `is_ranking_show_hide` | 1 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_get` | 0 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `cloud_lists_insert_value` | 0 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 云/账户/排行榜 | `hide_ranking` | 0 | 只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。 | kitten4-cloud.md、kitten4-partial-cloud-2.md |
| 相机/扫码 | `display_recognition_result` | 0 | camera默认false，打开相机走能力失败不锁；识别结果初始空串。结果展示仍排队阻塞；宿主未完成不得自动成功，viewer未接扫码UI。 | kitten4-third-media.md |
| 相机/扫码 | `get_recognition_result` | 0 | camera默认false，打开相机走能力失败不锁；识别结果初始空串。结果展示仍排队阻塞；宿主未完成不得自动成功，viewer未接扫码UI。 | kitten4-third-media.md |
| 相机/扫码 | `turn_on_the_camera` | 0 | camera默认false，打开相机走能力失败不锁；识别结果初始空串。结果展示仍排队阻塞；宿主未完成不得自动成功，viewer未接扫码UI。 | kitten4-third-media.md |
| 相机/扫码 | `turn_on_the_qrcode_camera` | 0 | camera默认false，打开相机走能力失败不锁；识别结果初始空串。结果展示仍排队阻塞；宿主未完成不得自动成功，viewer未接扫码UI。 | kitten4-third-media.md |
| 麦克风/语音/录音 | `get_voice_answer` | 0 | 语音答案初始空串；识别、问答和录音请求排队，未收到宿主完成就阻塞；无token不播录音，语言仅设置请求，音色/权限/服务未验证。 | kitten4-third-media.md |
| 麦克风/语音/录音 | `play_ask_record` | 0 | 语音答案初始空串；识别、问答和录音请求排队，未收到宿主完成就阻塞；无token不播录音，语言仅设置请求，音色/权限/服务未验证。 | kitten4-third-media.md |
| 麦克风/语音/录音 | `self_ask_listen` | 0 | 语音答案初始空串；识别、问答和录音请求排队，未收到宿主完成就阻塞；无token不播录音，语言仅设置请求，音色/权限/服务未验证。 | kitten4-third-media.md |
| 麦克风/语音/录音 | `self_ask_record` | 0 | 语音答案初始空串；识别、问答和录音请求排队，未收到宿主完成就阻塞；无token不播录音，语言仅设置请求，音色/权限/服务未验证。 | kitten4-third-media.md |
| 麦克风/语音/录音 | `set_speaking_language` | 0 | 语音答案初始空串；识别、问答和录音请求排队，未收到宿主完成就阻塞；无token不播录音，语言仅设置请求，音色/权限/服务未验证。 | kitten4-third-media.md |
| 麦克风/语音/录音 | `voice_recognition` | 0 | 语音答案初始空串；识别、问答和录音请求排队，未收到宿主完成就阻塞；无token不播录音，语言仅设置请求，音色/权限/服务未验证。 | kitten4-third-media.md |
| 手机/方向/震动 | `on_mobile_click_btn` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| 手机/方向/震动 | `on_mobile_shake` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| 手机/方向/震动 | `on_mobile_slide` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| 手机/方向/震动 | `on_mobile_slope` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| 手机/方向/震动 | `on_shake` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| 手机/方向/震动 | `on_tilt` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| 手机/方向/震动 | `shock_duration` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| 手机/方向/震动 | `shock_for_n_times` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| 手机/方向/震动 | `set_gravity_by_orientation` | 0 | 没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。 | kitten4-third-media.md、kitten4-third-physics.md |
| MIDI发声 | `midi_play_note` | 0 | VM输出钢琴键索引和时长，保留等待；没有接音源的viewer/headless不发声，不伪造采样音色一致。midi_get/midi_wait的纯数据/调度属于A。 | kitten4-third-media.md |
| MIDI发声 | `midi_play_num_note` | 0 | VM输出钢琴键索引和时长，保留等待；没有接音源的viewer/headless不发声，不伪造采样音色一致。midi_get/midi_wait的纯数据/调度属于A。 | kitten4-third-media.md |
| 在线翻译 | `translate` | 0 | 不访问翻译服务；translate只走失败释放，result取输入前200 UTF-16单位（falsy为空）。成功UI、缓存与在线译文未实现/未验证。 | kitten4-third-media.md、kitten4-partial-text-2.md |
| 在线翻译 | `translate_result` | 0 | 不访问翻译服务；translate只走失败释放，result取输入前200 UTF-16单位（falsy为空）。成功UI、缓存与在线译文未实现/未验证。 | kitten4-third-media.md、kitten4-partial-text-2.md |

## 证据与复现

- 物理控制：[逐帧命令主路径](kitten4-partial-physics-6.md)，与接触求解器误差分开。
- 属性、克隆与显隐：[专项](kitten4-partial-properties-6.md)。
- 效果与绘图：[专项](kitten4-partial-effects-6.md)。
- 指定官方包与线上身份关系：[只读取证](compatibility/k4-online-vs-offline.md)。不移植官方源码或HateNeko。

```powershell
node tools/compat/k4-partial-6-scope.mjs --write
node --test tests/k4-partial-6-scope.test.mjs
```

完整门禁、三seed语料、失败探针与风险记录见根目录不提交的 `OC-REPORT.md`。
