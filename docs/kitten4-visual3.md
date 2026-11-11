# K4 像素对比第三轮

## 范围与复验

基于 `oc/integrate` 的 `8ba08e5`，只读扫描 `E:/nekoc/dist/kitten4-corpus`。
使用 `tools/compat/k4-visual.mjs`，update 1/30/60、seed 1、60 Hz、虚拟 Date 与 timer interval，RGB 容差 8。
随机候选保守排除；不可运行、素材失败、watchdog 和不可比较的视频范围不算像素相同。
“零超差”不是 RGBA 逐字节相同，“captured”不是官方一致。

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:K4_PLAYER_DIR='外部只读播放器 app 路径'
$env:NEKOC_NODE_MODULES='外部 Playwright node_modules 路径'
node tools/compat/k4-visual.mjs --corpus E:/nekoc/dist/kitten4-corpus --frames 1,30,60 --allow-assets --artifacts-dir dist/visual3/after-frames --out dist/visual3/after.json
node tools/compat/k4-visual-summary.mjs dist/visual3/before.json dist/visual3/after.json dist/visual3/paired.json
node tools/compat/k4-visual-effects-fixtures.mjs
$env:K4_VISUAL_INTEGRATION='1'
node --test tests/k4-visual-effects.test.mjs
```

保存配套旧 VM、renderer、overlay 可以使用 `--nekoc`、`--renderer-source`、`--overlay-source` 重采基线。
本轮为 overlay 增加同样的源码入口，避免旧 VM 搭配新 DOM 造成混合基线。
报告按作品最大差异、均值降序排列；前后分布只取双方 captured 且逐帧尺寸、有效像素数、遮罩像素数、scope 相同的共同子集。
视频遮罩还要求逐帧两边 videoBounds 完全相同；计数相同但区域不同不纳入配对。

## 官方源码依据

以下均为外部 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
字符偏移从 0 开始，按 JavaScript UTF-16 而非 UTF-8 字节计；符号是主要定位依据。此离线包带既有 DI 暴露点，与当前线上发布物是否相同**未验证**。
未参考或移植 HateNeko，未将外部内核、作品或截图加入仓库。

|位置|观察|
|---|---|
|`a1xw/jt`，792253；`get_effect_filter`，793395|按索引排列 hue、brightness、pixelate、displacement、twist、saturate、ascii 滤镜，非调用先后顺序|
|`jt.set_hue`，794724|参数为度，调用 PIXI ColorMatrixFilter.hue，不是 HSV 色相平移|
|`ColorMatrixFilter.hue`，1577304|RGB 围绕灰色轴旋转的矩阵，角度为度|
|`jt.set_saturate`，795108；`ColorMatrixFilter.saturate`，1577692|黑白量映射到负饱和度；满黑白为 RGB 算术均值，不是加权亮度|
|ColorMatrix fragment，1574268|先除 alpha，应用矩阵，再乘回 alpha；各滤镜分别渲染到中间纹理|

`visual3-effects.bcm` 为原创色块：正/负 hue、满/半黑白、亮度、hue+黑白，底部包含半透明色块。
基线 1/30/60 各 **11.388889%** 超差，说明既有 HSV/加权灰度近似并不等于本离线官方行为。
修复后各帧 **0%** 超差。对于半透明颜色，必须在 premultiplied RGBA8 域模拟中间滤镜的截断，
否则亮度探针仍有 960 像素（0.138889%）不同；不能把它当作字体/边缘容差放过。

## 结果与保留范围

完整批次、排名、逐作品诊断与前后分布在本 worktree ignored 的 `dist/visual3/`；
测试结果、最终分布和未完成项汇总在不提交的根目录 `OC-REPORT.md`。
初始变量监视框和介绍弹窗的独立证据见本轮对应专项文档。

## 基线排序与诊断归因

下表按基线作品最大超差排序；百分数为 RGB 单通道容差 8，不是字节差异率。
既不将 VM 状态差异全部归到 renderer，也不从素材画风猜测所需修复。

|作品|基线最大 %|已证实原因 / 剩余边界|
|---|---:|---|
|327790965|13.713831|未知音频 duration 的 headless 降级使等待线程每两帧 restart；官方与 VM block trace 加单变量干预证实。真实时长接口见音频专项，不改 pivot/补间|
|333231321|12.451931|`ask_and_choose` 选择框，而非介绍框；官方布局/逐 update 滑入取证，原创选择探针回归。剩余字体、边线及阴影未穷尽|
|267573240|3.264540|保存 visible 的初始标量监视框原先未输出；官方组件与原创声明探针证实。修后残差集中在 common 皮肤字体、圆角及重叠边缘，不声称具体采样算法已证实|
|319595457|3.122106|介绍框比例、预览、姓名/正文/提示定位不符；源码与原创角色/场景/竖屏探针验证。next 图标仍为原创几何近似|
|335017543|2.615560|有保存 visible 的 common 监视框；修复初始化与皮肤。不能把余下播放进度/fps 的动态值差异一概归于字体|
|331465353|1.793294|截图主体整体几何接近，残差明显在边缘；具体图片/文字采样根因尚未证实，不做无证据全局滤镜更改|
|318958419|0.732205|静态纹理背景的截图主体一致，网格线边缘有采样残差；具体过滤算法根因未证实，保留双方图像与状态，不宣称已修复|
|334677645|0.570023|包含介绍框及特效，使用同一原创回归覆盖对应通路；不能仅凭块存在将全部差异归因色相|
|335950812|0.543369|整体几何接近，仍有图像边缘残差；含音频等待，须用实测时长接口单独复核，不能以诊断常数代替|

其余 7 个 captured 作品基线最大超差 ≤0.030925%，仍保留在完整统计中，未为了改善分布删去小差异样本。
色相/黑白错误由官方矩阵源码与原创色块探针独立证明；不伪称基线高位作品都在使用该错误路径。

修后批次首次捕获的 `307503868` 最大超差 2.757234%，没有成功基线，**不纳入修复收益配对**。
第60帧官方右上有 0.98 秒计时器组件，诊断页面没有，不能全部归为背景纹理误差。
`web/play.js` / `web/app.js` 在播放器外层单独绘制 timer，`StageOverlay` 和当前视觉诊断最小页面没有接入；
这是尚未修复的计时器组件/采样边界，不声称完整 stage UI 对齐。背景仍有图像采样残差，未证实具体算法。

专项证据：[初始监视框](kitten4-visual-monitors.md)、[overlay](kitten4-visual-overlay.md)、
[动画调查](kitten4-visual-animation-investigation.md)、[实测音频时长](kitten4-visual-audio-waits.md)。

## 最终统一结果

53作品均遍历；28为随机候选排除，非随机25项全部尝试。
基线：16 captured/48帧、8 unverified，另有1个初始化超时被旧工具记为excluded；
新工具将这类失败修正为unverified，随机候选数量仍为28。
冻结 renderer/overlay 修后批次 `after.json`：17 captured/51帧、8 unverified。
旧接口的该批次共同15作品/45帧：均值1.812890%→0.886065%，p90 3.264540%→1.545681%，
最大仍13.713831%（音频未注入），不是最终音频修复收益。

最终以 `after-final.json` + `audio-supplement.json` 保留组合 provenance：
对全部已captured且静态含audio wait的作品重采实测时长，并重试329639937的素材超时；
原始before/after批次未覆盖。最终15 captured/45帧、10 unverified、28随机排除。

**严格共同14作品/42帧**（尺寸、帧号、有效像素、遮罩区域和容差一致）：

|指标|前|后|
|---|---:|---:|
|零超差帧|6/42|8/42|
|超差率 <1%|28/42|39/42|
|超差率 <5%|40/42|42/42|
|均值|1.290568%|0.381760%|
|中位数|0.541756%|0.030924%|
|p90（排序索引 floor((n−1)×0.9)）|3.122106%|0.732205%|
|最大|13.713831%|1.793294%|

327790965真实时长15.018666666666666秒，1/30/60均0%超差；
267573240最大3.264540%→0.587891%；319595457最大3.122106%→0.654225%；
335017543最大2.615560%→0.974175%。残余第一名331465353仍1.793294%，未证实具体边缘过滤根因。

### 排除变化与不能隐去的残差

- 284554184、333231321虽然仍取得截图，因声明中有短音频（分别0.4440625秒/1.51速率、0.432秒），
  新工具静态保守扫描无法证明采样窗口内自然完成不影响控制流，转为unverified。
  此扫描可能覆盖无关或未执行资源，**不是发现两者确有新的行为错误**。
  两者从最终配对的前后双方同时剔除，不可将42帧与原始48帧直接比较。
- 333231321的overlay独立修复证据仍有效：12.451931%→1.545681%最大超差；
  但因上述媒体边界不作为最终完整画面已验证项，不隐藏其残差。
- 307503868在冻结批次首次captured，音频补测又遇素材超时，最终unverified；
  仍保留其2.757234%最大残差和计时器缺失发现，不选择成功重试美化总体。
- 322554106修后首次captured（最大0.209852%）无成功基线，未进入收益配对。
- 318245206 watchdog、333226890初始化超时、5个全屏video遮罩没有有效比较区域，全部unverified；
  它们加上上述3个媒体/素材项共10项。未宣称25个非随机作品全部取得有效像素。
- 324380532最大0.007378%→0.011936%，第30帧0→0.011936%、第60帧0.007378%→0；
  未删去这一小幅恶化样本，差异时相/边缘具体来源未证实。

`paired.json`保存逐作品三帧及omitted原因；`paired-renderer.json`保存旧音频接口共同45帧结果。
所有截图、第三方派生输入、工具日志仅在ignored dist，不随提交分发。
