# 离线 Kitten 4 oracle

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
- 无 DOM 输入事件。第一帧是官方 Start 发出的首次 `RuntimeManager.update` 完成后；
  后续每次执行一批受控 rAF 回调，固定 60 Hz。订阅 `after_update.immediate` 采样，
  不用“睡 1 秒”等价“60 帧”。帧数不符或官方运行错误即失败。
- 心跳开启原生 deterministic 配置；原生 Clock 每 update 递增 `1000/60` ms。
  播放器 domain `random` 实际调用 `Math.random`，所以运行前将它指向另一个按参数固定种子的
  **内核自带 PCG** 实例。两个 PRNG 都用明确的 seed/inc 高低位；不是对积木结果硬编码。
  NekoC PRNG 算法不同，相同 seed 不保证跨内核随机序列一致。
- 注意：以上 `Clock` 只固定调度/任务时钟。该包 `get_timer` 经 RuntimeManager 的
  `get_timer_elapsed_s()` 仍直接读 `new Date()`；本工具不替换 Date，也不改写官方计时器。
  因此依赖计时器的作品不能保证重复运行轨迹相同，其差异须单独归因，不能直接判为 VM 算术错误。
- 输出 `nekoc-k4-trace-v1`：`frames[]` 每帧含 `frame/current_scene_id/actors/variables/entity_variables`。
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
不提供截图一致性或绘图像素比较。外部 `_k4probe.json` 是带实体工作区的作品探针，不是完整积木规范，
也不是独立官方证据；未复制或用于本次测试数据。
