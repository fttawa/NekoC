# K4 固定帧像素验证

> 下文分布为首轮 visual 任务的历史记录。后续 K4 克隆层序链、画笔跨层与阻塞介绍弹窗已在
> [kitten4-layer-dialog.md](kitten4-layer-dialog.md) 专项修正；最新配对分布见该专项 worktree 的 `OC-REPORT.md`。

## 范围与采样约定

工具：`tools/compat/k4-visual.mjs`，入口/参数见同目录 README。固定 update 1/30/60、60 Hz、seed 1；
只筛选 `k4-diff` 的非随机 `equal/different`。运行包为本地只读 `player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
这个 `.orig` 仍保留包装器 DI 暴露点；没有独立认证其与线上内核完全相同。

官方原始画布 backing pixels 和真实 VM 增量驱动的 NekoC `StageRenderer` 比较。
RGB 每通道容差 8/255，任一通道超差的像素计入百分比；另输出 MAE/RMSE/PSNR。
这里的“零超差”并不等于 RGBA 字节完全相同。不同 VM 状态、克隆和图层差异可能改变画面，不能都归因于渲染器。
计时器仍读官方 wall clock，转换/动画不在本次时钟控制范围内。

所有第三方作品、截图、诊断和批次分布仅在本 worktree `dist/k4-visual/` 中，不入库。
首次尝试使用 `app.render()` 得到的全白截图已经作废；有效基线一律直接绘制官方 app.stage。

## 官方证据与修正

以下位置均在上述 `.orig` 的单行 minified 源码内；字符偏移仅帮助定位，以类/方法名为准。
未复制官方实现，按 API 与行为重新实现；未参考或移植 HateNeko。

|问题|官方源码位置|修正/验证|
|---|---|---|
|旋转模式被导入丢失|`Lt.set_rotation`，约 824299；`Ot.e`（ALL=0、LEFT_RIGHT=1、NONE=2），约 1663793|`rotation_type` ↔ canonical `rotationType`；保留 roundtrip，VM 首帧测试|
|左右镜像边界错用 KN 角度|`Lt.set_rotation`：原始角度 `>= π/2 || < -π/2`|K4 wire 角度是负 heading，故翻转区间为 `<= -90 || > 90`；KN 不变|
|文字印章旋转反向|domain `stamp` 约 638000：传 `-a.get_rotation()`；`Rt.draw_text_stamp` 约 812970|直接使用 K4 wire direction，Canvas 在旋转后栅格化，而不是旋转已经栅格化的字形纹理|
|文字二次采样模糊|`Rt.draw_text_stamp`：`bold … Arial , Microsoft YaHei`、middle baseline、旋转上下文后 fillText|只上传像素对齐包围盒，避免 WebGL 再插值旋转字形；保留 KN 旧缓存路径|
|背景被独立拉伸|`St.update_transform_pivot` 约 803000；`It.update_adaptive_scale` 约 800694；Stage `set_style` 约 1016500|K4 默认 COVER；adaptive=false 使用 TilingSprite 的原尺寸重复，不拉伸|
|背景忽略运行时大小|`It.set_scale` 约 798600；`St` 的 tileTransform|保留 VM 舞台实体的 scale/size_x/size_y/opacity/effects，缩放 tile 而不是舞台矩形|
|官方首次 update 的画笔未上传|`Ct.on_tick` 约 803550；`App.get_screenshot` 约 766328|采样时只 flush brush texture，再直接 renderer.render；不执行额外 VM/ticker update|

## 自有夹具

`tools/compat/k4-visual-fixtures.mjs` 生成 `tests/fixtures/kitten4/visual-*.bcm`，只有自绘 inline SVG 和自有工作区。
覆盖：原始/旋转/非零造型中心、125% 缩放、左右翻转边界、禁止旋转、背景 cover/非 adaptive 重复、
双角色层序、画笔、旋转中英混合文字印章。无需第三方素材或 CDN。

`tests/k4-visual.test.mjs`：普通工具测试覆盖指标/分类/夹具可复现；`K4_VISUAL_BROWSER=1` 跑真正 WebGL 像素、hit-test 与独立 Canvas 参考图；
`K4_VISUAL_INTEGRATION=1` 对外部官方内核逐帧回归。不同 probe 使用明确的小容差，绝不把大面积画面差异作为通过。

## 最终前后分布

53 个作品全部遍历：28 个随机候选排除，1 个分类阶段超时；5 个可见视频标为未验证。
修前成功 17 个作品，修后成功 16 个；只取双方均成功的 **15 个作品、45 帧**：

|RGB 超差像素比例统计|修前|修后|
|---|---:|---:|
|零超差帧|3/45|4/45|
|低于 1%|12/45|15/45|
|低于 5%|27/45|30/45|
|中位数|3.2645%|2.5795%|
|P90（排序后 floor((n-1)×0.9)）|33.3834%|32.7349%|
|均值|15.0527%|8.2111%|
|最大值|97.8390%|35.4196%|

共同子集和逐作品前后值为 `dist/k4-visual/final-common.json`。修后新增成功的 `329639937` 不进入前后配对；
`278906793` 修后 watchdog、`307503868` 修后素材超时亦不进入配对；`318245206` 两侧 watchdog。
主要改善由 `318958419` 的背景大小修复贡献，不代表所有作品都有改善。
`335017543` 第 60 帧从 32.8071% 到 33.5798%，官方播放进度与填充轮廓在重采间变化（52 → 58），
说明固定 VM update 不等于固定 wall-clock 内容；此项保留差异，不声称已修复或完全确定性。

## 最大差异归因与未完成项

- **219930972**：修前约 33.37% 超差。官方 `get_actor_ids()` 显示背景克隆在蒙版上方，NekoC 的 VM `frame.order` 却把蒙版放在克隆上方，
  导致白板/模糊图覆盖关系不同。已经通过官方运行时原始层序确认，不是推测色彩/透明度错误。
  此项需要 VM 层/clone 移层专项修正，本次不改 `src/engine.rs` 调度/表达式/chain，不伪造渲染排序掩盖错误。
- **267573240**：约 3.26% 主要是官方画布左下角变量面板；两侧核心图形吻合，另有画笔边缘差异。
  NekoC 面板在 DOM，纯 canvas 采样无法覆盖，属于工具范围限制；面板字体/布局仍未对齐。
- **149268571**：有效基线约 0.0056%，主要是图片/亚像素采样；没有把首次全白的 100% 假差异计入。
- **172532205**：各帧约 0.0004–0.0263%，主要是画笔边缘；没有调整实例化 capsule 算法掩盖差异。
- **318958419**：修前 97.84%，官方背景设置 700% 大小；NekoC 曾忽略舞台实体的大小。修正后约 0.7322%，剩余为放大图片采样差异。
- **319595457**：约 33–35%，官方停在 `create_stage_dialog` 的介绍弹窗，NekoC 已进入聊天室并印章输出。
  已检查作品 AST 使用此积木，截图证实两侧界面/运行进度不同。该阻塞对话框语义未修复，不归因文字纹理。
- **331465353**：第 60 帧的“对战”按钮在 NekoC 中明显更大，遮住相邻按钮；配对采样约 17.30%。截图能确认大小不一致，但尚未确定是 VM 状态、造型尺寸还是渲染变换的根因，不作无证据修正。
- **335017543**：配对采样第 60 帧官方有大块白色填充轮廓，NekoC 是黑底；不是只有左上角变量面板不同。填充绘图/执行进度的根因未验证，本次未修复。
- **332389949/332484473/332550028/332740251/335013226**：大面积原始差异来自可见 MP4，官方媒体时钟独立运行，NekoC 未绘制对应视频。
  没有受控媒体时钟就不能称为同一视觉帧，最终分布排除它们，保留诊断截图并标为未验证。
- 最终作品逐帧结果及失败原因为 `dist/k4-visual/final-{before,after}.json`，原始配对批次另存 `paired-{before,after}.json`。
  最终前后分布仅比较双方均 captured 的相同非视频作品，不直接比较成功样本数不同的分布；任何缺图/素材超时/watchdog 都是未验证，不能计为像素相同。
- 色相、亮度、像素化、扭曲、饱和度等原有 shader 并未逐项宣称官方一致。官方 `jt` 的 hue/brightness/saturate/pixelate/twist/ascii
  和现有 renderer 的近似效果并不全面等价，本次没有无证据大改；完整特效与对话框仍未验证。
- 背景的位置/旋转/自定义 pivot、初始场景属性（VM 舞台实体默认值）、动态舞台尺寸、跨场景 transition、动画/GIF/视频时钟、高 DPI 字体差异未完整覆盖。
- “equal” 只是现有状态字段在采样时相同，不覆盖 effects、alpha、order、monitor 和所有渲染状态。

批次最终统计、测试原文摘要和提交范围记录在不提交的根目录 `OC-REPORT.md`。
