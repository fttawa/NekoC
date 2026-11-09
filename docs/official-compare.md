# Kitten 4 官方播放器数据对比

```powershell
cargo build --release --bin web
$env:NEKOC_NODE_MODULES = 'D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compare-kitten4-official.mjs dist/official-compare dist/kitten4-corpus --seconds 4
```

也可逐个指定文件；文件名须为已发布作品 ID（例如 `172532205.bcm`）。作品、截图、JSON 和拼图只保存在忽略的 `dist/` 中，不要入库。

## 采样定义

- **第 0 帧**：开始初始化完毕、首次 VM 调度 tick **之前**，尚未执行任何脚本指令。不是“等待 0 毫秒后再 evaluate”，也不是“运行第一个 tick 后”，更不等于“所有开始脚本已运行至首个等待”。后者含随机、循环和跨线程调度，不能自动视为稳定初态。
- 官方播放器：注入一个 webpack 观察模块，在含 `get_actor_by_id` 的模块中寻找 `.a()` 返回的舞台；从角色 getter 读状态，从 `KmiX.b().get_runtime_manager().get_global_variable()` 读全局值。一次性包裹 `manager.update`，在第一次调用前复制状态并立即还原、转发原方法。要求 `get_elapsed_frames() === 0`，否则报错。
- NekoC：`/play?compare=1` 在连接 ready、第一次帧请求之前，发送只读 `debug_snapshot` WebSocket 消息。要求 `sequence === 0`。完整快照不是增量绘图帧，不会遗漏隐藏或非活动场景的角色。
- **延时参考**：两边分别在确认零帧后等待 N 秒，再读当前状态。加载、编译、网络、随机、输入和运行速度不同；延时差异不是逐帧一致性的判定。

## 字段与单位

按原始角色 ID 比较 x/y（舞台坐标）、角度、visible、两个轴的缩放百分比、当前造型 ID；按变量 ID 比较全局变量与列表，保留字符串、布尔和列表结构，不把数字字符串强制转成数字。默认数值容差 `1e-6`，角度使用模 360 的最短有向差。差值始终为 NekoC 减官方。

Kitten 4 角度逆时针、从右开始；原始 VM heading 顺时针、从上开始，转换为 `90 - direction`。`src/kitten4.rs` 的导入转换和 `Program::costume_turn` 是不同层次；二进制帧为渲染已减 `costume_turn`，不能再当作原始 heading。官方 `get_scale()` 是比例，乘 100；VM `scale` 是百分比，并乘上 `size_x/size_y` 百分比。

严格匹配范围为原作中的角色（跨场景）与全局变量/列表。克隆 ID 不可跨运行时直接对应，NekoC 原始快照仍保留克隆。未加载的角色明确作为缺失项报告，不会用作品存档的值冒充运行时状态。云变量也会采集，但官方未连接云服务时可能为 undefined，NekoC 本地降级值不应解释为离线即可实现云一致性。

## 启动与安全

服务使用 `--port 0` 由 OS 原子分配端口，从该子进程的标准输出解析实际地址，再验证 `/api/health`；不会扫描固定端口、误连别的作品实例或在 readiness 超时后继续导航。保留 stdout/stderr，检测进程提前退出，每次结束等待子进程回收。每个作品、每侧使用独立浏览器 context，不复用 localStorage、运行设置和网络连接，作品顺序执行。

大作品的逐脚本导入诊断可能接近交互页面的 60 秒 fetch 上限。工具在导航前以 240 秒上限获取 `/api/import-player` 的原始报告，并通过一次性浏览器路由交给页面的同一导入流程；验证请求作品相同才复用，不修改作品或运行时。输出 `importMs` 保留该耗时。

调试消息沿用当前 VM 所属的 `/api/player[-private]` 连接，无全局 VM 混用。服务只能绑定 `127.0.0.1`，沿用 Host/Origin 检查；快照不执行 tick、不处理附带输入、不清除脏标记或增量。前端只在快照消息期间串行化帧请求，避免响应错配。没有新增可写的调试命令。

## 输出

- `<id>-official.png` / `<id>-nekoc.png`：舞台截图。
- `<id>.json`：输入 hash、边界定义、两次状态、VM 原始快照、官方模块/脚本证据、错误与字段级差异（含数值 delta）。
- `summary.json` / `summary.md`：差异计数及各字段最大绝对 delta。
- `montage.png`：全部作品双列拼图。

工具使用官方内部模块（不是稳定公共 API）。官方 bundle 改版可能需要更新 `KmiX` 或 getter；签名/边界不符合时应报错，不应静默回退成读取存档。输出中的 `downloads` 记录实际执行输入的 hash 与 theatre 是否匹配。

为避免作者更新在线作品导致假差异，工具保留官方项目下载的在线 hash（`official.publications.liveSha256`），并将该 JSON 响应替换为本地 corpus 的原始内容，再由官方播放器正常加载执行。`sameBytes` 指替换前的在线内容是否与 corpus 相同；`downloads` 是替换后实际执行输入的证据。官方 bundle、资源和运行时保持不变；若没有截获作品响应则明确失败，不把不同输入的差异冒充运行时差异。
