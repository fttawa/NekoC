# K4 visual3：介绍弹窗、气泡与选择框

本轮修改 `web/overlay.js`；原创生成器为
`tools/compat/k4-visual-overlay-fixtures.mjs`，测试为
`tests/k4-visual-overlay.test.mjs`。没有修改 `renderer.js`、Rust、公共像素测试工具，
没有运行 Cargo 或提交。监视框只有主会话要求的 `monitorCanvas?.(m)` 接点与 K4 容器原点；
其 canvas 绘制不属于本轮。

## 官方证据与边界

只读来源：`K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
下列位置是单行文件的 **0 起始 JavaScript 字符偏移**，不是 UTF-8 字节偏移。
没有复制第三方作品或内核到跟踪路径，也没有参考 HateNeko。

|位置/符号|官方行为|
|---|---|
|897769 附近，`tn` / `draw_dialog_basis`|介绍框边距 12、图形高 180、描边 2、圆角 4；PIXI 描边向路径两侧扩展，因此实际包围高为 182|
|`tn.set_component_size_and_position`|角色预览最大边 100、左侧 20，按原图宽高比缩放；姓名 x=132、y=20；场景不画预览，姓名 x=42|
|`Ze/Qe/$e`，`tn.update_next_text_position`|姓名/提示为微软雅黑 21px，正文 22px；姓名纹理高 26、正文局部 y=52；提示文本“点击继续”，局部 y=145；图标在右侧 20px 预留区|
|603256，`create_stage_dialog` / `set_next_text`|提示使用本地化 next 文案，不随 printing/more 切换“显示全部/下一页”|
|871xxx–875xxx，`re` / `se` / `oe`|气泡 26px、36px 行高、208px 文本宽度、108–248px 框宽；说话尾巴 25px，思考为两枚椭圆；无描边，WebGL 阴影 alpha=.15、distance=3、rotation=45|
|`re.update_dialog_position/calibrate_edge_detection`|从角色顶缘向上放完整气泡，右侧溢出翻转但文字不翻转；顶部溢出钳到舞台顶部|
|904xxx 附近，`cn` / `show` / `pop_selection`|选择框行高 stageHeight×.0888，外边距10；横屏一行两格；每 update 滑入 ceil(distance/4)，Start第1帧尚未推进|
|`cn.draw_header` / `on_stage_resize`|该离线包先创建宽600的标题图形，resize后选项重排，但标题背景没有随之重绘；因此1280舞台标题仍宽600、选项格宽630，不是整宽问答卡片|

官方逐帧实测的 JSON 与 PNG 保存在 ignored 的
`dist/visual3-overlay/oracle/<case>/`、`<case>-regression/`。
探针默认禁止外部网络，官方 next 图标资源因此未加载（1×1 空纹理）；实际语料允许声明素材时
319595457 的图标加载成功。实现用原创 CSS 三角形近似图标，不复制官方图片。

## 修复

- 介绍弹窗改为舞台坐标单位，不再按宽度估算字体/百分比 grid；恢复场景/角色的不同左边距。
- 预览按原图比例设显式宽高；overlay 包装其 renderer 实例的 `load(project)`，在真实渲染器加载后
  为 K4 图像预解码 DOM 预览，避免第1帧截图图片仍为空。保留原 load 返回值、错误传播和 renderer 资产报错。
- “点击继续”始终相同，保留打印补全/下一页/关闭的 VM 输入行为；文本只用 textContent。
- 文本以独立合成获得灰度抗锯齿，使 DOM 避开 LCD 彩色边缘，匹配 PIXI 的 canvas 字体纹理；没有替换系统字体。
- 仅 K4 气泡启用新尺寸、颜色、尾巴、思考圆点、阴影、边缘翻转与角色几何；KN 仍走原气泡路径。
- 333231321 是 `ask_and_choose`，不是介绍弹窗。为它增加 K4 选择框布局、标题和逐 update 滑入；
  不在 Start 第1帧提前推进。阻止面板指针/键盘事件冒泡，原 answer/choice 协议不变。

## 原创夹具和像素回归

全部夹具从仓库原创 `visualFixtures().upright` 派生，不读取语料。七个 editable workspace
覆盖角色介绍、场景介绍、620×900竖屏/纵向预览、说话、思考、右上边缘、隐藏角色的一项选择。
图片均为原创内联双色 SVG；无第三方网络素材或 compile_result。

同 seed=1、虚拟时钟、RGB 容差8、固定帧1/30/60，通过真实 `visualWork` 的 VM deltas 与 DOM 截图：

|夹具后缀|帧1|帧30|帧60|
|---|---:|---:|---:|
|actor|0.02503%|0.02503%|0.02503%|
|scene|0.01204%|0.01204%|0.01204%|
|portrait|0.03100%|0.03100%|0.03100%|
|say|0.05223%|0.05223%|0.05223%|
|think|0.09838%|0.09838%|0.09838%|
|say-edge|0.05454%|0.05454%|0.05454%|
|choice|0.00749%|0.45334%|0.45334%|

完整指标：`dist/visual3-overlay/real-vm.json`；PNG/状态：`dist/visual3-overlay/real-vm/`。
另有独立官方组件状态驱动的 DOM 对照，不依赖 Rust binary：介绍三例要求差异<0.05%，
气泡三例<0.16%。真实 VM 对照要求介绍/气泡<0.2%、选择<0.8%，不是放宽到“面板存在”即通过。
选择框剩余主要在两种栅格器的圆角/边线、字体与阴影，未声称像素完全一致。

初次尝试720×960竖屏时，官方归一化为620×900，工具正确返回 size mismatch/unverified；
将原创夹具改为官方原生620×900后重跑通过，没有缩放截图掩盖该差异。

## 语料前后对照

基线使用主会话冻结后的 `dist/visual3/before-frames/`；最终独立回归在
`dist/visual3-overlay/final-corpus.json` 与 `final-corpus/`。第三方作品仅用于诊断，未跟踪。

|作品|帧1 前→后|帧30 前→后|帧60 前→后|
|---|---:|---:|---:|
|319595457|1.9861% → **0.6542%**|2.5255% → **0.6542%**|3.1221% → **0.6542%**|
|333231321|12.4519% → **1.3175%**|7.4621% → **1.5457%**|7.4621% → **1.5457%**|

这些是完整画面指标，不把所有残差归因于 DOM 或字体；主会话同时在改 renderer/监视框，
最终全语料统一结果应以其冻结批次为准。本任务已按通知冻结 `overlay.js`。

## 复验

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-visual-overlay-fixtures.mjs --write
node tools/compat/k4-visual-overlay-fixtures.mjs --record --compare
$env:K4_ORACLE_INTEGRATION='1'; $env:K4_VISUAL_INTEGRATION='1'
node --test tests/k4-visual-overlay.test.mjs
```

最后一次完整集成测试：**4/4通过，0跳过**，另有真实DOM测试验证纯文本安全、同状态重复点击门控、
更新后允许下一次点击、指针/键盘/点击不冒泡，以及reset清理。
`node --check` 与 scoped `git diff --check` 通过。
无 binary 时实际VM测试显式失败；不会构建、等待或轮询。

## 未验证/剩余限制

- 未验证系统字体不同、浏览器不同、缩放/DPR不同情况下的精确字体像素；当前为 Windows Edge，CSS canonical 1:1截图。
- 正文分页仍由既有 VM 近似；长比例字体、emoji、强制换行、连续空白的完整 PIXI 拆页未修复。
- 气泡多行文字精确 PIXI 高度、透明/缩放为0角色、非中心pivot、相机变换、复杂旋转与越界场景未穷举。
- 选择框只回归1280×720的一项、隐藏角色、无输入路径；竖屏、多选项、角色可见时的提问气泡、hover与真实点击完整语义未专项穷举。
- CSS next图标仅几何近似；关闭外部资源时官方缺图而NekoC仍画图，会保留少量稳定残差。
- 官方包保留离线包装的DI暴露点，未独立认证与线上发布物相同；没有把短探针冒称热JIT验证。
