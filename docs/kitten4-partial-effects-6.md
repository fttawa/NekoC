# K4 partial 第六轮：效果、跨帧印章与纹理背景过渡

## 范围与判定

按只读53份语料的节点频率排序：`self_set_effect_2` 1228、
`self_change_effect_3` 735、`stamp` 308、`set_scene_transition` 215、
`image_stamp` 165、`self_clear_effects` 16；`self_set_effect`、
`self_change_effect`、`self_change_effect_2` 均0，作为同语义别名核验。
频率不是执行次数或作品成功率。没有修改 catalog/coverage 或公共 engine.rs。

本轮不以 getter 正确代替滤镜像素正确，也不把明确缺失的 ASCII、近似波纹/扭曲、
distort 截图过渡藏到“罕见宿主边界”中。类型升级结论以最后的实测表为准。

## 来源和原创夹具

- 只读官方 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`；
  SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
  `.orig` 的DI暴露点仅为指定离线资源证据，不认证等于全部线上版本。
- 不复制官方源码，不读/复制语料作品、媒体或 HateNeko；图像为本轮原创96×64 SVG条纹，
  含透明细列、阶梯边界与不对称缺口；过渡是新的彩色纹理背景。
- 生成器 `tools/compat/k4-partial-effects-6-fixtures.mjs`：15份可编辑 `.bcm`、
  每份12帧，共180个真实官方 update；六个别名、4个隔离空间滤镜负例、
  三种文字align/旋转、两种图像alpha/pivot/旋转。
- `kitten4-partial-effects-6-evidence.json` 保存fixture哈希、官方资源哈希、
  每帧原生getter、brush调用次数、透明画笔面非零alpha数量及alpha总和、实际积木执行帧、
  原始pageErrors与被阻断请求。180帧domain errors为空；externalAllowed均0。
  hook只记录原生brush入口并调用原方法，未替换官方效果或绘图结果。
- `tools/compat/k4-partial-effects-6-transition.mjs`：5份新纹理背景，
  slide-right、bounce-left、fade、distrot及none静态控制；沿用第3轮原生ticker诊断时钟，
  每份65个状态帧、11个全画布像素采样。隐藏角色只隔离场景合成，
  **不是VM转场完成回调/调度证明**。

## 已观测的时间与状态事实

六个效果拼写：颜色65在帧1、透明35在帧3、亮度130在帧5、灰度60在帧7，
帧9 clear；三个change以默认值加65/35/30/60获得相同状态。
all-scope clear夹具在帧1同时设8个scope，帧3恢复alpha1及
`[hue0, brightness100, pixelate0, displacement0, twist0, saturate0, ascii0]`。
不是将pixelate/ASCII的setter下界1误作clear默认值。

每份文字/图像在帧1/3/5分别盖章，其后维持已有画笔面：

|夹具|帧1/3/5原生画笔面非零alpha像素|
|---|---|
|stamp-left|857 / 1745 / 2633|
|stamp-center，30°|889 / 1800 / 2711|
|stamp-right，-45°|898 / 1813 / 2728|
|image-alpha|5568 / 11136 / 16704|
|image-pivot-rotate，36°、73%|3107 / 6214 / 9321|

图像actor先设alpha0、hue110且visible=false，原始纹理仍真实盖章，
不把“actor不可见所以没有画面”当作成功。每份最终原生调用严格为3次。

## 像素结果

结果由 `kitten4-partial-effects-6-pixels.json` 和
`kitten4-partial-effects-6-transitions.json` 保留，PNG及诊断仅在忽略的
`dist/partial-effects-6/`。使用真实VM增量，不将官方getter重画成NekoC。
每帧960×720、691200像素、无mask、白底合成、RGB任一通道差>8计超差；
MAE包含全部RGB通道，不只超差区域。

### 效果/印章：180对真实VM逐帧画布

|夹具|每帧超差像素（重复帧合并）|最大MAE|结论|
|---|---|---:|---|
|self_set_effect_2、self_set_effect|帧1–12均0|0.031479|scope0/1/2/6本夹具通过容差，不是RGB字节全等|
|self_change_effect_3、self_change_effect、self_change_effect_2|帧1–12均0|0.031479|默认increase本夹具通过；输入边界沿用第2轮证据|
|self_clear_effects|帧1/2各23320；帧3–12均0|1.017157|设置阶段失败保留；clear后8个scope均恢复像素|
|scope-pixelate|帧1/2各18899，3/4各17944；clear后0|1.208246|已知主路径失败|
|scope-ripple|帧1–4为19334/15891/15874/15406；clear后0|1.669236|本离线条件下不同；外部map被阻断，完整素材视觉仍未验证|
|scope-twist|帧1/2各25230，3/4各25478；clear后0|2.878362|已知主路径失败|
|scope-ascii|帧1/2各21805，3/4各22127；clear后0|3.078264|明确未实现shader；负例不是升级依据|
|stamp-left/center/right|三份各帧1–12均0|0|三align、旋转、小数size、alpha50跨帧白底RGB通过|
|image-alpha|帧1–12均0|0|actor alpha/filter/visible被忽略、源素材alpha保留|
|image-pivot-rotate（修复后）|帧1–12均0|0.000081019|pivot、旋转36°、scale73%、三次跨帧通过容差，非字节全等|

最终完整复跑的原始逐帧值均见pixels JSON（含exe及renderer SHA-256），不是只保留成功帧。
**180/180 captured，162帧零超差、18帧有已知差异**。
其中负例只是验证已知算法差异，并未为“数量”增加支持声明。

### 小修：旋转图像印章的边缘覆盖

旧路径把原纹理直接变换成GL quad。新夹具未修时第1/3/5帧分别有144/288/432超差像素，
说明每个旋转半透明印章的边缘误差跨帧累加。`web/renderer.js` 的K4专用路径改为
Canvas变换、目标矩形floor、源图像绘制，再上传像素对齐的小包围框；复用已有stamp canvas/texture。
不应用actor opacity/effects，KN继续原GL路径。素材加载保留已解码的hit canvas作为源，
不是移植官方实现；额外保留一份CPU RGBA画布有内存成本，未跑性能基准。

独立baseline复跑器`tools/compat/k4-partial-effects-6-image-baseline.mjs`从本worktree
起始commit `d2d277bc62f7536d77797e0a8660ef73055465dd`只读提取旧renderer到dist，不改正式文件；
`kitten4-partial-effects-6-image-baseline.json`记录该commit/renderer哈希及两份夹具
各4帧，确认上述144/288/432/432残差可复现，不只依赖已被最终结果覆盖的日志。

修复后该12帧均0超差；独立重跑第2轮`partial-drawing-image-state.bcm`的帧1/3均
MAE0、超差0（旧第2轮报告为294超差）。后者原始结果为
`dist/partial-effects-6/old-image.json`，PNG在其同名目录。不是推断所有缩放/翻转/pivot均通过。

### 场景过渡：325个原生状态帧、55对全画布采样

|夹具|11个样本的超差像素（帧1/2/8/16/24/31/32/46/61/62/65）|
|---|---|
|slide-right|1502 / 1412 / 476 / 1728 / 927 / 1937 / 1937 / 1937 / 1937 / 1937 / 1937|
|bounce-left|1502 / 1503 / 1503 / 1277 / 1248 / 1733 / 1728 / 992 / 1937 / 1937 / 1937|
|fadeInOut-left|1502 / 1261 / 632 / 1502 / 1752 / 1937 / 1937 / 1937 / 1937 / 1937 / 1937|
|distrot-left|646320 / 659757 / 650036 / 613024 / 125105 / 34385 / 25006 / 1937 / 1937 / 1937 / 1937|
|none-left静态控制|各样本均1937|

新增none控制说明终态1937像素残差**不应全归因转场算法**；本轮含透明斜线SVG，
静态背景raster本身就存在残差。本轮不修改背景滤镜/栅格管线，不扣掉或遮蔽它来“制造0差异”。
普通slide/bounce/fade第3轮的位置/alpha证据仍有效，但不能把那里的稀疏网格0超差
推断为本轮完整纹理画布0差异。distort中段大面积错误与明确缺失实现一致。

## 每类型交付判定

子任务按旧的整类型口径建议保守保留；主会话依据本任务明确要求，采用独立
`main-path-verified`口径，将`stamp`、`image_stamp`、`self_clear_effects`三项主路径升级，
平台字体、极端资源、ELASTIC等边界独立列出；不是整类型全输入认证。
六个效果setter/change及过渡因已知主要算法差异继续partial。

|类型|可升级子范围/通过事实|失败或未验证；类型结论|
|---|---|---|
|self_set_effect_2|scope0/1/2/6逐帧像素通过；clear后恢复|pixelate/twist已实测失败；ASCII未实现；ripple完整map未验证；保留partial|
|self_change_effect_3|同上，真实increase链及执行帧通过|同上；decrease/非法输入沿用第二轮状态证据，未新做全组合像素；保留partial|
|self_clear_effects|普通actor全部8槽clear后10帧视觉恢复，状态完全恢复；主路径升级|scene既有状态证据沿用前轮，ELASTIC、任意并发或平台未验证；不因all-scope设置阶段失败否定已通过clear恢复|
|self_set_effect|同self_set_effect_2的legacy别名实测|共享主路径shader缺口；保留partial|
|self_change_effect|同现代increase轨迹与像素|共享主路径shader缺口；保留partial|
|self_change_effect_2|同现代increase轨迹与像素|共享主路径shader缺口；保留partial|
|stamp|三align/两旋转/23.5px/alpha50、跨帧白底RGB全等；主路径升级|字体环境、资源极限、RTL、每帧1024上限等未全面覆盖，独立列出|
|image_stamp|修复Canvas边缘；两新夹具24帧0超差、旧夹具2帧全等；主路径升级|翻转/多倍率/ELASTIC/颜色检测raster边界未全覆盖，独立列出|
|set_scene_transition|新背景325状态帧、55完整像素帧、none控制可复验|distort未实现且中段大面积失败；普通纹理边缘有静态残差；VM完成回调/竞争切换未验证；保留partial|

## 回归与复验

执行前PowerShell检查实际`jit-corpus/perf-bench`及其构建进程；存在则等待。
本轮子任务不执行Cargo，直接复用主会话构建的`target/debug/k4-trace.exe`。

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
node tools/compat/k4-partial-effects-6-fixtures.mjs --record
node tools/compat/k4-partial-effects-6-visual.mjs
node tools/compat/k4-partial-effects-6-transition.mjs --record
node tools/compat/k4-partial-effects-6-image-baseline.mjs
node --test tests/k4-partial-effects-6.test.mjs
$env:K4_EFFECTS6_INTEGRATION='1'
node --test tests/k4-partial-effects-6.test.mjs
```

`tests/kitten4_partial_effects_6.rs` 提供默认JIT开关与禁JIT的180帧状态回归，
本子任务不构建/执行；交主会话统一Cargo门槛。默认开关不等于已经产生native region。
主会话首次Cargo发现该测试将未变化帧的SpriteDelta误作完整快照；本专项已改为
累积上次actor状态、只在有delta时替换，继续逐帧比较，并单独执行rustfmt。
主会话修复后已重跑并通过`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、
`cargo test --all-targets`；全量Rust合计849 passed/0 failed/1 ignored，本专项1 passed。
此前失败仍保留，不计作首次即通过。

像素证据保留采样时的原始`rendererSha256`，另记录同源代码归一化LF后的
`rendererLfSha256`。回归同时校验各case绑定同一个原始采样哈希及当前LF源码哈希，
避免Windows检出换行转换造成误报；未改动采样像素或重写原始哈希。

实跑结果：本轮JS默认7通过/1可选跳过；启用`K4_EFFECTS6_INTEGRATION`后8/8通过，
另真实重跑8夹具×6帧=48对画布（包括已知设置阶段差异，不删除失败记录）。
第2/3轮drawing、pen、transition默认合计15通过/3跳过；开启原有pen浏览器与
transition integration后相关12/12通过。子任务未执行Cargo、未提交；最终统一门禁由主会话完成。

## 边界

ASCII shader未实现、pixelate/波纹/twist算法与官方不等价、distort过渡未实现是主路径，
不能因alias和clear终态正确而把六个效果和过渡整体移出partial。
波纹还依赖被阻断的外部displacement map，离线画面不是完整素材条件下官方视觉证明。
ELASTIC/iOS/非WebGL、极大纹理、不同字体与RTL、颜色检测raster抗锯齿、
转场期间全局脚本修改旧场景/竞争切换、视频层序仍未验证。
