# 离线 Kitten 4 oracle

JIT 覆盖与本地解释器差分可用 `cargo run --release --bin jit-corpus -- <只读语料目录> --out dist/jit3/after.json`；逐作品回退原因、typed Cell/调用栈/列表别名比较、覆盖口径、无统计 release 计时和前后报告命令见 [jit-coverage.md](../../docs/jit-coverage.md)。这不是独立官方 oracle。

仅本地读取第三方 Electron 包；仓库不携带内核、内核片段或作品语料。
只支持该包的 `player_v2` / webpack 4 接口，内核变更会显式失败，不能据此泛称所有版本官方一致。

## 使用

在仓库根目录的 PowerShell 中：

```powershell
$env:K4_PLAYER_DIR = '外部路径\Kitten4播放器\resources\app'
$env:NEKOC_NODE_MODULES = 'D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'

# 输出仍保留 block_data_json 的完整作品；不隐式覆盖输入
node tools/compat/k4-oracle.mjs compile --input input.bcm --out dist/k4-oracle/compiled.bcm4 --diagnostics dist/k4-oracle/compile-log.json

node tools/compat/k4-oracle.mjs run --input input.bcm --frames 60 --seed 1 --channel msedge --out dist/k4-oracle/official.json

# 自动构建本仓库的 k4-trace，逐个筛选 NekoC 能运行的作品
node tools/compat/k4-diff.mjs --corpus dist/kitten4-corpus --frames 60 --out dist/k4-oracle/summary.json

# 没有第三方语料时，可对照仓库自有示例；不是第三方语料的替代验证
node tools/compat/k4-diff.mjs --corpus samples --out dist/k4-oracle/samples.json

# 可选浏览器集成测试；默认 test:tools 不依赖第三方内核
$env:K4_ORACLE_INTEGRATION = '1'
node --test tests/k4-oracle.test.mjs
```

`K4_PLAYER_DIR` 必须指向 app 根目录；工具从 `src/player/page.html` **仅发现资源 URL**，
自行生成极小页面和只绑定 `127.0.0.1` 的临时 HTTP 服务，不执行包装器的 `compile.js/cloud.js`。
`/new/<16 位 hex token>` 的导航返回页面，同路径的 HEAD/XHR 返回作品；token 固定含字母，避免进入数字作品号 API 分支。
静态资源限定于外部 build 目录的直接文件，拒绝路径穿越。
端口随机分配，结束或失败均关闭浏览器和服务。不要给第三方服务传账号凭据。

默认要求外部包保留 `player_v2*.js.orig`，**不回退到含调度优化的 `.js`**。
`.orig` 本身仍有包装器的 DI 暴露点；这里的“官方”意为此离线包中的官方运行时，
没有独立认证它等于线上发布物。每次结果记录资源 SHA-256，便于复验。

## 编译、帧和比较约定

- 编译走外部内核 `JSONEntityCompiler.compile({id, blocksJSON})`，使用内核工具消除循环引用、
  递归规范数字 NUM 参数，再生成运行组归属。场景和角色均编译；缺 workspace 显式报错。
  不使用包装器的代码生成优化。对于空场景角色数组，以图层组补齐，所有适配记入 diagnostics。
- `run` 自带数组型 `compile_result` 时直接加载完整作品（包括合法空数组），不先把它清空再 bootstrap；
  缺失时才用空 AST 初始化原生编译器，然后原生编译并重新加载。
  必须等待应用自身初始化，提前手工创建 Heart 会导致编译/加载假差异。
- `k4-diff` 对仅有发布 AST、无任何 `block_data_json` 的作品跳过双编译比较，使用作品自带的官方
  `compile_result`；`compile.status=skipped` 不表示双编译一致。有工作区的作品仍比较两条编译路径。
- 默认无 DOM 输入事件。可用双方 `--input-script events.json` 在每次 update 前重放输入，
  契约、原创建具与证据边界见 [输入一致性](../../docs/input.md)。第一帧是官方 Start 发出的首次 `RuntimeManager.update` 完成后；
  后续每次执行一批受控 rAF 回调，固定 60 Hz。订阅 `after_update.immediate` 采样，
  不用“睡 1 秒”等价“60 帧”。帧数不符或官方运行错误即失败。
- 心跳开启原生 deterministic 配置；原生 Clock 每 update 递增 `1000/60` ms。
  播放器 domain `random` 实际调用 `Math.random`，所以运行前将它指向另一个按参数固定种子的
  **内核自带 PCG** 实例。两个 PRNG 都用明确的 seed/inc 高低位；不是对积木结果硬编码。
  NekoC PRNG 算法不同，相同 seed 不保证跨内核随机序列一致。
- 注意：以上 `Clock` 只固定调度/任务时钟。4.1.1 之前的 `get_timer` 读 RuntimeManager
  的 `new Date()`；新版读需显式启动、16 ms 采样的组件计时器。默认仍是墙钟。
  `--virtual-time` 用整毫秒虚拟 Date，并在每个 update 前执行一次 16 ms interval；这是诊断替换，
  不代表浏览器实际 interval 相位。`k4-visual` 自动启用它以匹配 NekoC 的离线时钟。
  版本边界、实测和限制见 [kitten4-fixes.md](../../docs/kitten4-fixes.md)。
- 输出 `nekoc-k4-trace-v1`：`frames[]` 每帧含 `frame/current_scene_id/actors/variables/entity_variables`。
  云变量和云列表也纳入 `variables`，启动经过播放器云初始化入口；匿名/断网规则与本地后端见 [kitten4-cloud.md](../../docs/kitten4-cloud.md)。
  `current_scene_id` 读取舞台实际当前场景，不是切换后仍保留加载值的编辑器 store；
  场景选择、离场脚本和自制探针见 [kitten4-scenes.md](../../docs/kitten4-scenes.md)。
  每个角色含 x、y、原始角度（度）、current_style_id、scale、scale_y（百分比）、visible。
  数值、字符串、布尔和列表保留类型；列表逐帧深拷贝。未变化的角色也逐帧输出。
  这是配套 `k4-trace` / `k4-diff` 可直接读取的契约，**不是**原有 coverage 的聚合输出。
- `cargo run --bin k4-trace -- input.bcm --frames 60` 使用真实 fast VM。
  `--seed <u64>`（默认 1）固定随机输入，错误追踪也记录 seed；
  `nekoc coverage <文件...> --frames 60 --seed <u64>` 固定 coverage 的种子，省略仍用时钟。
  `--compiled` 删除内存副本里的 workspace 强制官方 AST 路径；`--lowered` 输出 VM 输入树；
  `--program` 输出完整 Program 的诊断文本，包括操作、表达式、脚本、常量和源 ID，非稳定存储格式。
- 比较容差 `1e-6`；角色按 ID、字段按固定顺序比较，记录首次差异。
  **不**将 -180/180 或 0/360 合并：这里只报告原值，视觉等价与否另行判断。
  克隆 ID 不进行猜测性配对，因此跨内核克隆命名差异会报告 presence，不能直接推断语义错误。
- 双编译路径同时比较 VM 输入树、完整 VM Program 和 60 帧轨迹；结构不同不是行为不同。
  报告 `compile.details/blockTypes` 是局部节点/连接不同的候选类型，不把祖先全算根因。
  即使 60 帧相同，也不证明所有输入和运行时间等价。
- 静态扫描 `random` 积木，以及 `self_face_to/self_move_specify` 的 `__random` 目标，写入
  `randomness`（候选可能未执行）；这类作品有轨迹差异时标为
  `unverified` / `random-sequence`，保留首次差异及两边值，不计为 `different`。这也可能保守地隐藏
  与随机无关的差异，必须另行分析，不能称为一致。

`k4-diff` 保留逐作品双方轨迹和 lowered 输入树于 `dist/k4-oracle/diff/`；
有工作区时另存 `official.bcm4` 和双方 VM 程序；仅发布 AST 的作品不生成或复制另一份作品。
报告 JSON 和 Markdown 含跳过原因。不同/未验证/不支持时返回非零，空语料或缺目录不是通过。
构建内存紧张时先设置 `$env:CARGO_BUILD_JOBS='1'`；不要同时开启多个 Cargo 构建。

专项根因诊断：双方 `--blocks --block-filter id,id` 保留任务边界并限制积木事件；
官方另记录指定 domain block 的输入/输出。双方事件上限 500000，`traceTruncated` 表示已截断。
oracle `--random-source nekoc` 仅在 random 积木调用内注入 NekoC xorshift64 抽样，
排除 UUID/绘图等其他随机调用；这是同输入诊断，不是官方默认随机序列的证明。
默认 `pcg` 不变；随机位置/朝向目标不受此选项覆盖。
详细证据、夹具和多 seed coverage 命令见 [kitten4-run-errors.md](../../docs/kitten4-run-errors.md)。

K4 partial 第二轮的 41 份仓库原创离线探针与保留边界：
[物理控制](../../docs/kitten4-physics-partial.md)、
[云变量/列表](../../docs/kitten4-partial-cloud-2.md)、
[印章/画笔尺寸/过渡](../../docs/kitten4-partial-drawing.md)、
[文本搜索/媒体默认值](../../docs/kitten4-partial-text-2.md)。
有限分支实测不等于完整兼容；这些类型仍保留 partial。

## 联网、安全与未验证范围

默认外部 HTTP、WebSocket、Service Worker 均禁用；记录所有外部请求的方法、URL、类型和动作。
可显式 `--allow-assets`：仅对白名单 CDN 的素材扩展名执行无凭据 Node GET，禁止重定向，
不转发浏览器 Cookie/Authorization/Referer；统计 POST、IP 探测、云数据和其他地址仍拦截。
作品 `theatre.styles/videos` 或 `audio` 中声明的 `url/cdn_url` 也可放行（同样限白名单 HTTPS CDN），
支持发布作品的无扩展名 base64 素材键及播放器追加的 `imageView2` 查询；不泛化放行无扩展名 API。
旧素材 CDN `static.codemao.cn` 和新素材 CDN `creation.bcmcdn.com` 仅允许作品声明的资源，
即使 URL 带 `.json` 等扩展名也不会因此放行其他端点。
`diagnostics.localRequests` 记录本地请求的导航/XHR 类型和状态，`failedRequests` 记录浏览器失败原因；
配合 `externalRequests`、`console`、`pageErrors`、失败时的 `lastState` 区分初始化与素材加载失败。
素材加载失败不伪造图片；角色缺失或运行失败会报错。有外部素材依赖时，离线失败不能算兼容性差异。

本工具不覆盖音视频实际时钟、云端结果、网络传感器、物理引擎确定性或浏览器外独立时钟。
原生变量局部作用域/克隆变量读取已经导出，但 NekoC `entity_variables` 目前为空；复杂局部变量/克隆作品仍需专项验证。
非有限数按 JSON 的 null 序列化，不能据此验证 NaN/Infinity；页面 errors 和启动失败另存诊断。
逐帧截图/像素比较使用下节的独立工具。外部 `_k4probe.json` 是带实体工作区的作品探针，不是完整积木规范，
也不是独立官方证据；未复制或用于本次测试数据。

## 固定帧画布像素对比

```powershell
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_TEST_DEBUG = '0'
$env:CARGO_INCREMENTAL = '0'
node tools/compat/k4-visual.mjs --corpus 'E:\nekoc\dist\kitten4-corpus' --frames 1,30,60 --allow-assets --out dist/k4-visual/report.json
# 可复用 k4-diff JSON 的 works 分类；只纳入非随机 equal/different
node tools/compat/k4-visual.mjs --classification dist/k4-oracle/summary.json --allow-assets --out dist/k4-visual/report.json
# 仓库自有夹具，不需要任何 CDN
node tools/compat/k4-visual.mjs --input tests/fixtures/kitten4/visual-stamp.bcm --out dist/k4-visual/stamp.json
$env:K4_VISUAL_BROWSER = '1'     # Canvas/WebGL 像素回归，无第三方内核
$env:K4_VISUAL_INTEGRATION = '1' # 自有夹具逐帧对照外部内核
node --test tests/k4-visual.test.mjs
```

- 画面来自 **真实** `k4-trace --render` VM 帧增量（包括画笔、印章、克隆和图层顺序），
  交给同一份 `web/renderer.js`；不是把 oracle 位置重画成 NekoC。
  内置 CLI 另传 `--render-only`，省略重复的全变量 trace，避免大列表的帧输出超过 Node 字符串上限；
  实际 Frame 与绘图增量不变。自定义 `--nekoc` 兼容旧二进制，不自动追加该新参数。
- 浏览器先解码素材，再把尺寸/中心/alpha mask/RGB 通过 `--costumes` 送入 VM，和 web 播放器一样。
   第一次无测量运行只用于取得 canonical project，不作为画面。仅此诊断 CLI 接受 `mask_bytes/rgb_bytes` 数组。
- 默认 trace 另接收官方已解码音频时长 `--audios`，只覆盖内存 canonical 资源，不写回原作品；
  完整测量保存在 `audio-metadata.json`。自定义 `--nekoc` 为兼容旧二进制，须显式加 `--audio-metadata` 才启用。
  音频等待缺少解码时长，或可能在采样虚拟窗口内自然结束时，保守记为 `unverified`；
  本工具不证明自然结束回调与虚拟时钟的边界一致，详见 [音频等待](../../docs/kitten4-visual-audio-waits.md)。
- 官方使用原始画布 backing pixels，在每个指定 update 后触发 `Ct.on_tick` 上传待刷新的画笔纹理，
  再调用官方 `get_screenshot` 同款 `renderer.render(app.stage)`。不增加 VM update，不推进 transition/ticker 时钟。
  `app.render()` 在 ticker 运行时会跳过，不能拿它作截图触发器。
- 画布尺寸必须相同；无浮层时读取画布 backing pixels；有 NekoC 浮层时对原尺寸舞台容器截图，
  不自动 resize 掩盖尺寸差异。两侧透明像素先合成白底。
  默认 RGB 通道容差 8/255，任一通道超差计为一个差异像素；另报全部 RGB 的 MAE、RMSE、PSNR。
  PSNR 为 JSON null 表示零均方误差（无限值），不是未测。此工具不计算 SSIM。
- 输出 JSON、Markdown、每作品每帧双方 PNG、绘图状态及官方资源 SHA-256；CLI 强制输出位于本 worktree 的 `dist/`。
  单作品失败记为 `unverified`，不能算通过；空语料、零有效截图、任何采样失败返回非零。
  差异率不设全语料兼容性通过阈值，`captured` 仅表示完成采样，不表示像素相同。
- 每作品默认 90 秒 watchdog 避免 domain block 卡住无限等待；素材仍沿用原 oracle 的匿名 CDN 白名单策略，
  仅成功素材响应可在本次内存缓存中复用，不缓存错误、不放宽网络权限。
- NekoC 的真实 `StageOverlay`（气泡、变量面板、介绍弹窗）参与截图；帧的 `overlay: true`
   标出 1:1 容器截图。不包含播放器外壳 UI；K4 保存为可见的初始监视框由 VM 输出，common 标量皮肤按保存位置绘制，其他皮肤仍有未验证边界。
- `--renderer-source dist/renderer-before.js --overlay-source dist/overlay-before.js --nekoc dist/k4-trace-before.exe` 可复验旧版本基线。
  两者须配套保存，保持同一固定帧、素材和 oracle 采样方式。

含视频作品逐帧排除双方可见视频矩形的并集（含 1 像素边缘），指标只统计剩余区域；
记录 `pixels/maskedPixels/videoBounds/scope`，不验证视频本身。整屏遮罩或含视频等待的控制流仍为 `unverified`，
不会以零像素宣称通过。视频语义、元数据 CLI、官方证据和回归命令见 [kitten4-video.md](../../docs/kitten4-video.md)。

发现、官方源码定位、分布与未完成项见 [kitten4-visual.md](../../docs/kitten4-visual.md)。
第三轮按最大差异排名、RGB 矩阵特效修复和配对分布工具见 [kitten4-visual3.md](../../docs/kitten4-visual3.md)。

克隆层序链、移层与阻塞介绍弹窗的原创夹具、官方观测和回归见
[kitten4-layer-dialog.md](../../docs/kitten4-layer-dialog.md)。`k4-visual` 的 state JSON
额外记录官方弹窗是否可见/打印中；本轮已把 NekoC DOM 弹窗纳入对比，见
[四项修复记录](../../docs/kitten4-fixes.md)。
