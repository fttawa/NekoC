# 《衛星》ASCII PV — Kitten N 移植

项目：[eisei_pv.bcmkn](eisei_pv.bcmkn) · 播放积木源码：[eisei_pv.ts](eisei_pv.ts)

## 使用

1. 在 Kitten N 中打开 `eisei_pv.bcmkn`，等待编辑器载入素材。
2. 点击 **开始**。初始化会遍历造型索引、显示准备进度，并预热内嵌音频。
3. 出现 **准备完成 · 按 Enter 开始** 后，按回车。经过 3 秒静音前导后开始正片。
4. 播放中按 **Q** 停止并返回待机；按 **Enter** 从头播放。播放结束也可按 Enter 重播。

若键盘没有响应，先点击舞台，让输入焦点离开编辑框。音乐、造型均嵌入项目文件，无须提供本地素材路径。

## 规格与实现

| 项目 | 值 |
|---|---|
| 正片时长 | 143.5 秒 |
| 素材分辨率 | 480×270 |
| 素材帧率 | 10 FPS |
| 造型数量 | 1435 |
| 音频 | MP3，192 kbit/s，额外 3 秒静音前导 |
| 文件大小 | 约 27.3 MiB |

转换器以完整工程中已经渲染的 `out/eisei_ascii_pv_1080p30.mp4` 为母版，缩小、抽帧后封装成原生角色造型；音轨取自同一母版，保留原片的音频剪辑位置。标题、歌词、场景和后期效果随图像保留，但小字号和快速运动的清晰度、流畅度会低于原始 1080p30。

播放积木以原生计时器计算 `floor(正片时间 × FPS) + 1`，直接切换到对应造型。卡顿时跳过过期帧，不用累计等待来推进播放。原生计时器约 50ms 的更新粒度及音频启动延迟仍可能带来小幅同步误差；这不是音频播放位置驱动的逐采样同步。

Kitten N 在执行积木前就会载入所有造型，因此初始化百分比表示**造型索引准备进度**，不是图片下载进度。音频预热使用带 3 秒静音前导的同一音轨：播放约 2 秒后停止，再等待用户启动。原生积木没有在本移植中使用可读的音频解码就绪状态，因此该预热是固定时长准备。

全部 480×270 帧的一份 RGBA 数据约 **709 MiB**；编辑器、浏览器图像缓存和显存还会产生额外占用。不要用压缩后的 27.3 MiB 文件大小估计运行内存。选择 10 FPS 是为控制完整项目的素材数量和内存开销。

## 重新构建

依赖：Python 3.10+、FFmpeg（包含 libmp3lame）、Node.js、本仓库的 npm 依赖及 Rust 编译链。

在仓库根目录执行：

```powershell
cargo build
python tools/build-eisei-pv.py --source E:/test/eisei_pv --out samples/eisei_pv.bcmkn
```

可用 `--fps`、`--width` 指定素材规格，或用 `--duration 6` 制作短片探针。输出旁的 `.build.json` 记录母版 SHA-256、帧数、规格与文件大小。

构建器会从 `samples/eisei_pv.ts` 读取播放器逻辑，并将实际规格替换进对应初始化积木。修改源码后必须重新运行构建器；只用普通编译命令不会打包 PV 素材。

验证命令：

```powershell
npx tsc --noEmit --strict --lib es2020 ts/nekoc.d.ts samples/eisei_pv.ts
node --test tests/resource-inputs.test.mjs tests/constant-folding.test.mjs
# 需要 Playwright 与 Edge；依赖不在本仓库时可设置 NEKOC_NODE_MODULES。
node tools/editor-compat.mjs samples/eisei_pv.bcmkn --channel msedge --out samples/eisei-verification/compat.json
node tools/verify-eisei-pv.mjs
```

浏览器验证会检查初始化、真实按键、动态帧选择、原生音频播放和音画时钟，并等待完整片尾，再验证重播与停止。验证脚本中的浏览器观测代码不属于交付项目。

### 本次验证结果

2026-11-01，官方 Kitten N 0.27.4、Headless Edge：

- 185 个积木通过格式兼容检查，无字段或连接变化。
- 完整 143.5 秒播放、片尾状态、Enter 重播及 Q 停止通过。
- 30 / 60 / 90 / 120 秒采样中，画面时钟领先原生音频约 0.12 秒，未观察到累积漂移。
- 本机从页面打开至素材和编辑区就绪约 3.3 秒；随后约 8.3 秒完成初始化。设备性能会影响耗时。
- 无页面脚本异常、无积木执行警告。编辑器自身的部分在线服务返回了 401/403，记录保留在报告中。
- TypeScript 类型检查及 17 项工具测试通过。

报告和场景截图见 [`eisei-verification/`](eisei-verification/)。

## 来源与署名

- 原 ASCII PV 项目：<https://github.com/fttawa/eisei-ascii-pv>
- 完整场景工程：用户提供的 `E:\test\eisei_pv`。
- 音乐、作词、作曲及封面：**柿崎ユウタ**。
- 原项目为非商业同人作品；原仓库关于素材、音乐与对齐模型的权利说明继续适用。此移植不另行授予原素材的使用权。
