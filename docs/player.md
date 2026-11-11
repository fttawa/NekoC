# Web 纯播放器

## 启动与导入

```powershell
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_TEST_DEBUG = '0'
$env:CARGO_INCREMENTAL = '0'
cargo run --bin web -- 'tests/fixtures/kitten4/visual-stamp.bcm' --port 3456
```

访问 `http://127.0.0.1:3456/play`。服务只监听本机；浏览器需支持 WebGL 2。
点击「导入作品」选择 `.bcmkn`、`.bcm` 或 JSON，也可以拖入文件。导入只改变当前播放器的私有作品，不替换编辑器中的作品。
首次打开等待用户点击开始；手动导入成功后自动开始。`/play?app` 是导出应用使用的自动开始、舞台填窗模式，隐藏普通网页工具栏。

### 加载和失败反馈

- 读取文件、检查兼容性、连接运行时时显示不定进度；没有伪造下载百分比。
- 图片和视频按**已处理资源数 / 总资源数**显示进度（成功或失败均完成计数），不是下载字节数，也不是播放准备率。
- 每项图片 / 视频等待最多 15 秒；网络 API 最多等待 60 秒，运行时握手最多 30 秒。
- 素材失败显示资源名称和原因，多项错误聚合，不用最后一条覆盖前面的错误。缺图仍可启动，但画面可能不完整，不能认为作品通过兼容性验证。
- 音频沿用按需加载：实际播放时报告失败或提示点击以启用声音，**不包含在初始图片 / 视频进度里**。
- JSON 错误包含文件名；服务端拒绝、HTTP 失败和运行中断都有可见提示。失败后可以再次导入；若导入请求未成功，报告仍属于上一份已导入作品。
- 提示可关闭；资源错误仍留在本次作品报告。重启重试图片 / 视频；重新导入会清空上一作品的错误。

## 操作、显示与输入

| 操作 | 行为 |
| --- | --- |
| 开始 / 继续 | 连接当前作品的私有运行时，或从暂停位置继续；焦点交给舞台（若有问答则交给问答控件）。 |
| 暂停 | 停止请求新更新，暂停音视频并释放按住的输入；保留进度。已发出的一个更新可能仍会完成。 |
| 重玩 | 关闭旧运行时，重新加载素材并从头启动，不是继续。 |
| 全屏 | 用户点击后请求浏览器全屏；再次点击或 Escape 退出。浏览器 / iframe 不允许全屏时显示提示，不强制锁定屏幕方向。 |
| 切换后台 | 自动暂停；回来后手动继续，不自动抢回键盘焦点。 |
| FPS | 「绘制 FPS」是每秒收到且画面变化的更新数；「更新」是收到的运行更新数，不等于完整作品帧数。 |

舞台按可用区域与作品原始宽高的最小比例缩放，居中、完整显示、不拉伸、不裁切，剩余区域为纯黑。
窗口大小、全屏与屏幕方向变化都会重新适配；「渲染精度」独立于 CSS 显示尺寸。
手机竖屏按单列显示，短横屏保留舞台与操作栏，隐藏性能面板以免挤压舞台。刘海屏使用浏览器安全区。

舞台采用 Pointer Events，支持触摸点击、拖动和已有四向滑动输入；坐标从缩放后舞台映射回作品坐标。
仅舞台禁用默认触摸滚动，工具栏 / 设置和页面其他部分仍可滚动。旋转、失焦、暂停释放按住的输入。
没有把滑动伪装成方向键；仅支持键盘的作品仍需物理键盘或宿主提供的虚拟键盘，本次未新增网页虚拟按键。

键盘仅在舞台获得焦点时传给作品；Tab 可以离开舞台进入按钮和设置。按钮、选择框、报告与问答输入不会把打字透传给作品。
开始 / 继续会恢复作品输入；调整设置不再强制抢回舞台焦点。问答和介绍对话在舞台原本持有焦点时接管焦点，移除后归还舞台，不抢工具栏或报告的焦点。

## 兼容性 / coverage 报告

点击「兼容性 / coverage 报告」可查看和下载当前作品的导入诊断，包括结构检查、积木类型、编译是否就绪、脚本诊断及图片 / 视频失败。
报告使用文本呈现，下载不附带完整作品或素材；诊断本身可能包含作品名、脚本内容或资源名，分享前请自行检查。

**页面报告是静态导入诊断，不是实际运行 coverage，更不是官方一致性的证明。** 页面提供本地运行入口说明：

```powershell
cargo run -- coverage '作品路径.bcm' --frames 60 --seed 1
```

只运行可信作品。固定 seed、60 帧仅覆盖该次执行；未运行到的脚本、不同输入、随机路径和外部媒体仍可能失败。
官方对比和证据口径见 [compat 工具](../tools/compat/README.md)、[调度说明](kitten4-scheduling.md)。

## 与离线官方 K4 的依据和差异

本次仅**只读静态核查**离线包，没有复制任何官方代码或资源，亦未移植 HateNeko。
以下路径相对于外部 `K4_PLAYER_DIR`；该离线包含包装和调试注入，上游真实性未另行认证，不能代表所有线上版本。

核心依据文件：`src/player/build/player_v2.2d180c468559fbd29528.js.orig`，SHA-256
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
压缩文件用 webpack 模块 ID 和符号定位，不依赖不稳定行号。

| 项目 | 官方来源与可搜索定位 | NekoC 对齐范围 / 差异 |
| --- | --- | --- |
| 加载 | 核心 `dDIS`：`update_progress`、`loading_percent`、`all_images`、`loaded_sounds` | 官方按图片＋声音＋视频数量计算，移动页不计视频；NekoC 沿用数量进度概念，仅提前加载图片 / 视频，音频按需。 |
| 失败 | 核心 `dDIS`：`ON_LOAD_FAIL`、`player_load_error`、`loading_state` | 官方有加载失败状态和通知；NekoC 显式显示可重试错误及聚合资源失败，不仿造官方回退旧版本。 |
| 开始 / 重置 | 核心 `dDIS`：`onPlayBtnClick`、`auto_play`、`mob_icn_reset.png`；`vxpV`：`RESET`、`runtime_manager.restart.immediate.sub(vt)` | 官方开始可等待加载完成；浮动 reset 是停止回封面，内核 restart 是另一条重新启动路径。NekoC「重玩」主动从头运行，不能等同浮动 reset。 |
| 暂停 | 核心 `BCtA`：`kitten/run/set_pause_state`；`vxpV`：`ut`、`lt` | 官方存在独立暂停状态，但未在所查菜单核实通用暂停按钮；NekoC 暂停按钮和后台自动暂停属自身增强。 |
| 缩放 | 核心 `dDIS`：`player_resize`；`view_resize`；CSS `player_v2__3ffeebbd0c789e8d9422.css` 的 `.stage--3F9-U` | 官方按作品比例完整容纳并居中；NekoC 采用同类 fit。 |
| 填边 | 核心 `enable_bg_blur`；上述 CSS `.CUI-player-blur-background-background` | 官方默认可用场景模糊填边。离线壳 `src/player/page.html:13`、`src/main/main.js:130` 另设黑背景。NekoC 固定黑边是本任务要求，不宣称官方始终黑边。 |
| 全屏 | `src/main/main.js:374–377,426–427`；`src/player/preload.js:39–45` | 离线壳调用 Electron 全屏，F11 发 IPC；NekoC 使用浏览器 Fullscreen API，权限和退出行为由浏览器控制。 |
| 触控 | 核心 `a1xw`：`g.DIRECTION_ALL`；`on_swipe_scene`、`send_swipe_action`、`mapPositionToPoint` | 四向滑动与缩放后局部坐标（Y 轴翻转）有源码依据；本次不改既有输入语义。官方虚拟键盘在 `gqQf/OEj6/ypP6`，本次未复制或新增。 |
| 焦点 | 核心 `init_key_event_listeners`、`show_ask_wrap`、`ask_input.focus()`；桌面壳 `src/main/main.js:270–271` | 官方问答主动聚焦，但运行层监听 body；NekoC 仅舞台监听按键，避免工具栏、表单和报告误触作品，是有意的增强。 |

**未验证**：官方完整 UI 动态对照、真机 iOS / Android 软键盘与系统旋转、各浏览器全屏差异、官方失焦清键或后台暂停策略、错误回退是否成功、长时间 FPS / 功耗表现。
本次 E2E 是 NekoC 浏览器回归，不是官方一致性认证。

## 测试

```powershell
npm ci --ignore-scripts
cargo build --bins
$env:NEKOC_NODE_MODULES = 'D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:NEKOC_PLAYER_E2E = '1'
npm run -s test:player
npm run -s test:tools
```

默认使用本机 Edge headless + SwiftShader，不访问官方服务，不需要第三方作品。可用 `NEKOC_BROWSER_CHANNEL` 改变 Chromium channel，`NEKOC_WEB_BIN` 指向配套构建的 web 可执行文件。
测试启动随机本机端口的真实 Rust 后端，使用仓库自有 `visual-stamp.bcm` 的内联素材，覆盖控制状态、焦点、全屏及拒绝路径、导入失败、加载进度、多素材失败、报告下载、横竖屏与触摸。
HTTP 失败场景通过明确的 Playwright route 注入；正常游玩不替换运行时或帧数据。未设置 `NEKOC_PLAYER_E2E` 时，普通工具测试跳过浏览器 E2E。
