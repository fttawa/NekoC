# PICKCAT Rust 播放器扩展

在 PICKCAT 作品页或论坛帖子内使用 **本机 Rust VM + WebGL2** 替换 Kitten N 原播放器。支持 Chrome / Edge 的 Manifest V3 扩展。

## 安装与使用

1. 双击仓库根目录的 `start-rust-backend.cmd`，保持窗口打开。默认后端为 `http://127.0.0.1:4173`。
   - 首次没有可执行文件时，脚本会调用 Cargo 编译；源码更新后执行 `cargo build --release --bin web`。
   - 分发包 `dist/neko-pickcat-windows.zip` 已包含 Windows 后端，解压后运行其中的 `start-rust-backend.cmd` 即可。
2. Edge 打开 `edge://extensions`，Chrome 打开 `chrome://extensions`，开启「开发人员模式」。
3. 点击「加载解压缩的扩展」，选择 **`E:\nekoc\dist\pickcat-rust`**；分发包用户选择解压目录内的 **`extension`**。
4. 打开或刷新作品页：
   <https://pickcat.dao3.fun/works/01a19bd8-7eaf-70e4-be3d-88f123fbc029>
5. 登录并满足网站的播放条件。原播放器正常取得作品资源后，扩展自动替换为 Neko 播放器。
6. 「衛星 ASCII PV」显示初始化 100% 后，**点击画面，按 Enter** 播放；作品内 **Q** 停止。

播放器右上角显示连接状态与「切回原版 / 切换 Rust」。播放器内保留导入、性能设置、FPS、暂停、重玩、全屏。离线时提示启动后端，点击「重连」重试。

**0.1.3 资源与论坛修复**：支持官方详情中的 `source_urls`（`bcm_url` 可能为空），自动识别普通 JSON 与 Kitten N 编码文件；支持 `/forum/post/...` 文章中的懒加载、sandbox 内嵌播放器。提前点击「切换 Rust」会继续等待资源并接管；详情不含可用资源时显示明确状态。

**0.1.2 提示与 FPS**：进入作品页会短暂显示「Neko 扩展已植入」；连接成功并开始播放后显示「Rust 已接管播放器」，约 4 秒后消失。已接管播放器的游戏区域右下角常驻 `RUST · 数值 · 绘制 FPS`，全屏时也可见，暂停显示 `—`；浮层不拦截游戏点击。

同时修复 iframe 尚未完成导航时的 `postMessage` 来源不匹配报错；在原播放器已经加载完成后启用扩展，也能从缓存详情中接管。

扩展工具栏弹窗可关闭自动替换或设置本机端口。更换端口时也需要用 `web.exe --port 端口号` 启动后端。

## 实现

- PICKCAT 顶层 content script 只接管已经出现的 `https://kn.codemao.cn/player?...&workId=...` iframe；网站的登录、实名与游玩时段提示保持由网站处理。
- 官方 Kitten N iframe 内的 MAIN-world 脚本观察其**已成功返回**的公开作品详情响应，优先读取可用的 `source_urls`，再回退到 `bcm_url`。官方请求自行完成签名和账号处理，扩展不重建签名，也不保存凭据。
- 顶层脚本检查消息来源、实际 iframe 窗口、作品编号和 CDN 域名，然后导航同一个 iframe 到扩展打包的播放器；切回时恢复原始 URL，因此不会同时播放两套运行时。
- 请求缓存资源的探测消息只携带类型和作品编号，允许发送给导航中的窗口；在 iframe 加载完成后再次探测。官方脚本只接受 PICKCAT 父窗口且编号匹配的请求，资源回复仍限定 PICKCAT 域名；顶层仍严格校验官方来源，不放宽资源消息验证。
- 扩展页面下载 `.bcmkn`，识别 JSON 或官方编码格式，交给 `/api/import-player` 验证，再通过 `/api/player-private` WebSocket 发送自己的完整项目快照。编码格式按官方 `BcmHelpers.toDecryptBcmString` 对齐：倒序 Base64、12 字节 IV、AES-GCM，格式密钥由字节 0–30 的 SHA-256 派生。每个连接有独立 VM，导入不会改变编辑器的当前项目。
- 后端仅监听 `127.0.0.1`。扩展 ID 固定为 `aghbhbjmpgklpbgoeopacommcdjmeghj`，跨源仅允许该扩展访问三个播放器端点；网页 Origin 和其他扩展不获授权。
- 项目 UTF-8 / WebSocket 首包上限为 64 MiB，随后帧请求限制为 64 KiB，维持一问一答的有界传输。这份作品为 24,289,660 个 JS 字符，实际 UTF-8 文件 **45,249,638 字节（43.15 MiB）**。
- 新增文本拆分与表达式列表操作，保持数字 token 转换、空白字符串与深复制；音频命令按 VM 执行顺序传到浏览器，暂停保留播放位置，重玩/退出停止声音。

目前自动接管范围是 **PICKCAT 内的 Kitten N 官方播放器**。其他编辑器类型仍使用网站原播放器。仍不支持的积木会显示具体兼容诊断。

### 0.1.1：星垒兼容更新

- 支持 `set_pen_layer`（置顶/置底/前后移动/相对角色）、`on_keydown` 的 `up` 事件、`sprite_on_tap`（点击/按下/松开）、`set_sprite_style`（造型 ID 或四舍五入的一基序号，含列表表达式）。
- 补齐星垒用到的鼠标坐标、透明度、随机整数、UTF-16 文字长度及反三角函数。
- 预载当前场景角色的全部造型，按官方前后顺序合成；角色点击考虑位置、缩放、旋转与透明像素，画笔 HUD 不拦截点击。
- `projects/starhold/starhold.bcmkn` 已通过标题、松开 Enter、鼠标选关、点击建塔、升级、开波、暂停/恢复和自然战斗验证；5 秒窗口控制器更新约 60/s，绘制更新率另计。
- 验证命令：`node tools/verify-web-starhold.mjs`，报告见 `docs/starhold-web-verification.json`。

从 0.1.0 升级时请关闭旧后端窗口、重新运行新版启动脚本；从 0.1.1 ~ 0.1.4 升级到 0.1.5，只需替换扩展目录，在浏览器扩展管理页点击扩展的「重新加载」，再刷新作品页和论坛页。直接加载 `E:\nekoc\dist\pickcat-rust` 时该目录已由构建更新。当前扩展版本为 **0.1.5**。

**2026-11-03 Rust 后端兼容更新**：补齐广播/带参数接收/广播并等待、带参数语句过程、四种停止范围、条件等待、列表查找/包含及常用角色查询。此次扩展版本仍为0.1.3，但**必须替换并重启新版后端**，仅重载扩展不会更新VM。详细支持范围、真实作品验证与剩余缺口见 [web-compatibility.md](web-compatibility.md)。当前仓库的 `samples/pen_polyhedron.bcmkn` 已修复前缀取反输入丢失；旧下载文件需要重新导入修正版。

## 构建和验证

```powershell
node tools/build-extension.mjs
cargo build --release --bin web
cargo test --bin web --test engine --test bcmkn_web --test web_kitten4 --target-dir target/web-validation
cargo clippy --all-targets --features studio -- -D warnings
$env:NEKOC_NODE_MODULES='D:\AppData\Local\Temp\opencode\nekoc-kitenn\node_modules'
node tools/verify-extension.mjs
node tools/verify-extension-overlay.mjs
node tools/verify-extension-sources.mjs
# 后端构建完成后，打包扩展与独立 Windows 后端：
pwsh -File tools/package-extension.ps1
```

浏览器验证真实安装 Manifest V3 扩展，使用 Chromium + SwiftShader：

- 真实 PICKCAT 匿名页面仍显示「请先登录」，没有注入播放器。
- 在仿照网站 iframe 容器的测试页面中加载**真实官方播放器**，捕获真实详情响应，下载并运行所给作品。
- 验证 Enter、实际音频进度、暂停继续、重玩、原版切换、离线提示、端口重连、开关设置及 SPA 清理。
- 本次 8 秒实际播放窗口约 **58 次运行更新/秒、10 个完整作品帧/秒**；当前发布项目内部配置为 10 FPS。完整帧依据项目的 `ep_drawn` 计数器测量，与右下角「绘制 FPS」分开记录。
- 已登录的真实 PICKCAT 页面尚未直接验证；`verify-extension.mjs` 不模拟作品执行或资源响应，只模拟网站播放器容器。
- `verify-extension-overlay.mjs` 使用可控页面和资源响应验证导航时序：延迟加载的初始空白 iframe、非官方来源消息拒绝、fetch/XHR 捕获、加载后启用的缓存恢复、原版切换和 SPA 替换；作品仍交给真实 Rust 后端执行。另检查提示自动消失、FPS 右下角定位、点击穿透、暂停显示与全屏可见性。报告见 `docs/pickcat-extension-overlay-verification.json`。
- `verify-extension-sources.mjs` 验证真实发布作品 `335008960`（正多面体）的编码资源下载、解码、旋转、E 切换面数、Space 暂停/恢复；验证真实公开论坛文章 `01a19bdd-b240-7985-a80e-2a753101aaca` 的懒加载内嵌播放器、Enter 启动 ASCII PV 和音频、FPS 与原版恢复。原 iframe 的 sandbox 保留；报告见 `docs/pickcat-extension-sources-verification.json`。正多面体作品页容器使用测试页面，论坛文章直接使用真实页面。

截图和完整测量写入 `D:/AppData/Local/Temp/opencode/neko-extension-validation/`；归档结果见 `docs/pickcat-extension-verification.json`。
