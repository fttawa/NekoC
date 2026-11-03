# 《衛星》原生画笔字符版

项目：[eisei_pen.bcmkn](eisei_pen.bcmkn) · 播放源码：[eisei_pen.ts](eisei_pen.ts)

**当前推荐：[eisei_pen_128_fixed.bcmkn](eisei_pen_128_fixed.bcmkn)**（43.1 MiB，128×36、完整 10 FPS 素材），修复旧版本逐行擦除失效导致的残影。

高分辨率版：[eisei_pen_128.bcmkn](eisei_pen_128.bcmkn)，使用 **128×36 字符、1280×720 舞台**，字符格数量为基础版的 1.78 倍。建议放大舞台观看；编辑器的小预览会把文字缩得很小。

| 版本 | 字符网格 | 舞台尺寸 | 完整文件大小 |
|---|---|---|---|
| 基础版 | 96×27 | 960×540 | 35.9 MiB |
| 高分辨率版 | 128×36 | 1280×720 | 54.9 MiB |
| 高分辨率精简版（5 FPS 素材） | 128×36 | 1280×720 | 29.6 MiB |
| 高分辨率紧凑版（10 FPS 素材） | 128×36 | 1280×720 | 43.1 MiB |

这里的 720p 指舞台画布；画面细节由 128×36 字符网格决定。各版均为 143.5 秒，包含音乐与初始化；精简版为 5 FPS 素材采样，其余为 10 FPS。

### 本地导入问题与精简版

用户反馈 54.9 MiB 高分辨率整片在本地导入时出现“新作品创建失败”，同分辨率的 255 KiB 两秒探针可成功打开。官方本地导入流程还包含上传文件与创建云端作品；此前预览播放验证不覆盖这些步骤。

后续网络截图确认 `upload.qiniup.com` 返回 HTTP **413（请求体过大）**。具体字节上限尚未确认。

[eisei_pen_128_compact.bcmkn](eisei_pen_128_compact.bcmkn) 将完整 1435 帧、10 FPS 素材和音轨降至 43.1 MiB。优化仅改变归档分隔符并省去重复的固定字号列；与旧完整版的 8610 个帧数据列逐项解码比较一致，内嵌音频一致。用户已确认可以导入运行，随后反馈画面残影；请改用上面的 `fixed` 修复版。

为此提供 [eisei_pen_128_lite.bcmkn](eisei_pen_128_lite.bcmkn)：分辨率、完整音轨、初始化和控制保持一致，素材采样降为 5 FPS，718 帧，文件约 29.6 MiB。用户已确认该精简整片可导入。官方编辑器预览验证也通过完整播放、重播与停止，本次完成 626 帧，平均约 4.36 FPS。

## 使用

1. 在 Kitten N 打开项目，点击 **开始**，等待初始化 100%。
2. 点击舞台后按 **Enter**，经过 3 秒静音前导开始播放。
3. **Q** 停止并返回待机；**Enter** 从头播放，片尾同样可以重播。

音乐和字符数据均已内嵌。初始化建立行缓存并播放约两秒静音进行音频预热；百分比表示准备阶段，不是音频解码进度。

## 渲染方式

- 直接解码原工程的 ANSI 字符流，保留字符位置、日文宽字符与颜色。
- 舞台 960×540，字符网格 96×27，正片 143.5 秒，素材采样 10 FPS。
- 原生画笔文字打印固定使用 Arial／微软雅黑，不能设置终端等宽字体。构建器测量字宽，用多种 Unicode 空格补齐绝对网格位置，再把一行中同色字符合并打印。字体采用 14px；字形和空格可能随系统字体发生变化。
- 颜色量化为 RGB 32 级步长，使用预计算 HSV 设置原生画笔颜色。
- 行内容使用去重 ID 判断变化；变化行用背景色画笔擦除后重画，跳帧时可直接恢复目标画面。
- 数据以按帧字符串列存入列表，播放时通过原生文字拆分、列表复制展开当前帧。避免几十万条独立列表元素被编辑器观测面板重复深拷贝。
- 原生计时器选择目标帧，落后时跳过过期素材帧。10 FPS 是素材帧率，实际完成帧率取决于场景和设备。
- 音轨为内嵌 192 kbit/s MP3，末尾补静音至正片长度，前置 3 秒静音。

字符版使用原项目的终端构图，与 [视频造型版](eisei_pv.md) 的完整视频后期效果有所差异。

## 本次实测

2026-11-01，官方 Kitten N 0.27.4、Headless Edge：

- 完整 143.5 秒播放、片尾、Enter 重播、Q 停止通过；338 个积木通过官方格式、字段和连接检查。
- 全片完成 803 帧，平均约 **5.6 FPS**；各采样区间平均约 **4.0–10.0 FPS**。高密度场景仍有跳帧，逐行刷新可能显示新旧帧混合的过渡画面。
- 30 / 60 / 90 / 120 秒采样点，音频时间减去最近完成画面的时间分别约 **−0.02 / +0.26 / +0.14 / +0.17 秒**，未观察到累积漂移。这些是采样值，不是整片最大误差。
- 文件约 **35.9 MiB**，无逐帧图片纹理；初始化约两秒。页面脚本错误和积木执行警告均为零。
- ANSI 增量流、宽字符、清屏和同色层网格位置回归测试，以及 TypeScript 类型检查通过。

报告和截图见 [`eisei-pen-verification/`](eisei-pen-verification/)。

### 高分辨率探针

对源片 60–68 秒的独立短片测试（完整工程的运行开销可能更大）：128×36 在采样区间接近 10 FPS；160×45 约 4.8 FPS，最近完成画面落后音乐约 0.52 秒。因此当前高分辨率整片采用 128×36。

字体测量已覆盖四种源网格的 455 个字符；既有 376 个字符的测量宽度未改变。高分辨率整片验证输出位于 [`eisei-pen-128-verification/`](eisei-pen-128-verification/)。

### 高分辨率整片结果

完整 143.5 秒播放、片尾、Enter 重播和 Q 停止通过，338 个积木兼容检查通过，无页面脚本错误或积木执行警告。本次运行完成 1067 帧，平均约 **7.4 FPS**；60–90 秒高密度区间平均约 **2.65 FPS**，其余采样区间约 5.7–10 FPS。

30 / 60 / 90 / 120 秒采样点，音频时间减去最近完成画面时间分别约 **−0.13 / +0.37 / +0.28 / −0.02 秒**。片尾音频已经停止，音画偏差不再计算。不同运行的设备负载会影响帧率，不能据此推断高分辨率版总是比基础版更快。

### 高分辨率紧凑版结果

完整 143.5 秒播放、初始化、片尾、Enter 重播和 Q 停止均通过；329 个积木兼容检查通过，无页面脚本错误或积木执行警告。本次运行完成 **1205 帧**，全片平均约 **8.4 FPS**，实际帧率随设备负载和场景变化。

30 / 60 / 90 / 120 秒采样点，音频时间减去最近完成画面时间分别约 **−0.133 / −0.016 / −0.017 / +0.201 秒**；这些采样值不代表整片最大误差。报告和截图见 [`eisei-pen-128-compact-verification/`](eisei-pen-128-compact-verification/)。预览验证已通过，用户环境的云端导入仍待确认。

### 2026-11-02 残影修复

旧版擦除起点 `-ep_width / 2 - 12` 中的一元负号被编译成了没有连接操作数的减法积木，导致横坐标无效、画笔沿用上一次的横坐标，擦除无法覆盖整行。此前运行状态与兼容检查没有发现这一视觉错误，旧版帧率数据也不代表正确完成整行擦除时的性能。

已修复编译器的一元负号输入连接并重建 `eisei_pen_128_fixed.bcmkn`（45,246,128 字节）。在官方编辑器运行原生积木前，向行内左右边缘与中间植入旧像素，再检查擦除结果：旧版稳定复现残留，修复版连续 **72 次行擦除残留像素为 0**，起止横坐标均为 −652 / +652。331 个积木兼容检查和 19 项工具测试通过。像素报告位于 [`eisei-brush-verification/`](eisei-brush-verification/)。

修复版整片复验也已通过：初始化、143.5 秒播放、片尾、Enter 重播、Q 停止均正常，无页面脚本错误或积木执行警告。本次完成 **1409 帧，平均约 9.82 FPS**；30 / 60 / 90 / 120 秒采样音画偏差分别约 **−0.130 / +0.091 / −0.018 / −0.017 秒**，不代表整片最大误差或所有设备的性能。报告与截图见 [`eisei-pen-128-fixed-verification/`](eisei-pen-128-fixed-verification/)。

## 构建与验证

依赖 Python 3.10+、FFmpeg、Node.js、本仓库 npm 依赖与 Rust 编译链。字体测量和官方编辑器验证另需 Playwright、Edge。

```powershell
cargo build
node tools/measure-eisei-font.mjs
python tools/build-eisei-pen.py --source E:/test/eisei_pv
python tools/build-eisei-pen.py --cols 128 --out samples/eisei_pen_128.bcmkn
python tools/build-eisei-pen.py --cols 128 --fps 5 --out samples/eisei_pen_128_lite.bcmkn
python tools/build-eisei-pen.py --cols 128 --fps 10 --out samples/eisei_pen_128_compact.bcmkn
python tools/build-eisei-pen.py --cols 128 --fps 10 --out samples/eisei_pen_128_fixed.bcmkn
python -m unittest discover -s tests -p test_eisei_pen.py
npx tsc --noEmit --strict --lib es2020 ts/nekoc.d.ts samples/eisei_pen.ts
node tools/editor-compat.mjs samples/eisei_pen.bcmkn --channel msedge --out samples/eisei-pen-verification/compat.json
node tools/verify-eisei-pv.mjs samples/eisei_pen.bcmkn samples/eisei-pen-verification
```

可用 `--start 60 --duration 8 --out ...` 构建密集片段探针；`--cols` 支持原工程的四种网格，默认 96 列。更大网格需重新评估运行性能。

## 来源与署名

- 原项目：<https://github.com/fttawa/eisei-ascii-pv>
- 完整源工程：用户提供的 `E:\test\eisei_pv`。
- 音乐、作词、作曲及封面：**柿崎ユウタ**。
- 原项目的非商业同人及素材权利说明继续适用。
