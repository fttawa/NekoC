# Kitten 4 在线播放页与指定离线内核取证

## 结论与边界

**不是完整文件等同；已确认指定在线发布物与离线 `.orig` 的核心实现一致，仅有本地暴露/加载路径差异。三份公开作品各 60 个受控 update 的导出状态完全一致。** 没有发现这两个指定主包之间的积木、调度、warp、默认值或配置常量版本差异。

这不是“所有在线 K4/当前编辑器等同”的证明，也不是 NekoC 已完整兼容的证明。在线编辑器构建、真实墙钟帧率、未加载 lazy chunks、登录/云服务、设备、音视频自然时钟、像素和无限运行时间均**未验证**。本任务不修改 NekoC VM 或已有兼容状态分类。

取证日期：2026-11-12 北京时间（执行机器 UTC 为 2026-11-11，逐请求采集时间见证据 JSON）。HTTP Date 是服务器/CDN 返回值，可能为缓存日期，**不是采集时间或产品发布日期**。下载正文由 HTTP 客户端解压后计算 SHA-256，不是 gzip 传输字节 hash。只读参考目录为 `E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`。

## 来源链与 HTTP 证据

入口：`https://player.codemao.cn/new/186831447`。匿名浏览器实际请求以下六个脚本，全部 HTTP 200；响应正文 hash 与独立无凭据 GET 下载一致。未登录、未提交表单、未执行下载的第三方 exe；POST 遥测、第三方 IP 探测和 WebSocket 均拦截。所有证据下载仅在此 worktree 的忽略目录 `dist/k4online/`，不将官方源码或作品入库。

脚本基址：`https://kn-cdn.codemao.cn/kn/build/`。下表路径与基址拼接即完整 URL。

| 路径 | 解压字节数 | HTTP Date（GMT） | Last-Modified（GMT） |
| --- | ---: | --- | --- |
| `player_v2.2d180c468559fbd29528.js` | 1855286 | Tue, 14 Jul 2026 11:17:56 | Wed, 22 Oct 2025 10:34:34 |
| `runtime.f42f527f119e09010b85.js` | 3913 | Wed, 28 Jan 2026 08:28:11 | Tue, 30 Sep 2025 07:53:57 |
| `vendors.d00f4bd454a6352e9d71.js` | 390714 | Fri, 20 Mar 2026 09:14:33 | Wed, 15 Dec 2021 08:34:38 |
| `9.c396696e9dc71e25b012.js` | 13470 | Wed, 10 Dec 2025 20:22:41 | Wed, 20 Sep 2023 07:13:45 |
| `14.c95e6f2ddd61fb701d0e.js` | 15237 | Thu, 02 Apr 2026 12:27:29 | Tue, 30 Sep 2025 07:53:55 |
| `11.477512e6f03fd2f6f3c5.js` | 53610 | Wed, 10 Dec 2025 22:16:10 | Tue, 30 Jul 2024 08:01:56 |

| 文件 | 在线 SHA-256 | 离线 SHA-256 |
| --- | --- | --- |
| 主包 / 离线 `.orig` | `1de76dd2f8462c6ed28ac31924f597960ba9a5fcd8a68f355de4df970fcf41cd` | `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160` |
| runtime | `6b818d09420f97e78373e301187d59697400b6b044d1ecec3946f7201c02427b` | `4164d67795238f64d035f473418236038ae475ae36032a967cba16ede263735f` |
| vendors | `9f484cedbde10bcb82958aaf6cdeb24e40d5b52c3e825e027564402dd7977867` | 同在线，逐字节相同 |
| chunk 9 | `5758343310c47596d56e954aa05fa76a546080c8bf4fefd41cac0042794d6195` | 同在线，逐字节相同 |
| chunk 14 | `d3ce91c9113463db4c0988210caeb1be2ddc508499d5c53a8e73a13b5f440175` | 同在线，逐字节相同 |
| chunk 11 | `e81bfe3462cc3e79a70ba016ddee2a372a31480d3f52964952e1d21f3a490f91` | 同在线，逐字节相同 |

版本身份需区分：

- 文件名中主包 build 标识是 `2d180c468559fbd29528`，不是语义版本号；同名文件并不能代替 hash。
- 两边主包 `HeLV` 的 `@crc/stage` 为 **0.5.6**，`fDvR` 的 `@crc/default-function` 为 **0.5.11**。其 `@crc/heart` 的 `^2.0.2` 是依赖范围，实际 heart 包版本**未验证**。
- 离线 Electron 壳 `package.json` 的 **1.0.0**、壳 `src/main/server.js` 硬编码的 **4.11.20**，都不能用来标识在线内核。公开作品 API 返回的作品版本（例如 186831447 的 **4.11.13**）同样不是加载器构建版本。

本地原始证据：`dist/k4online/http.json`、`comparison.json`、`<作品号>.pair.json`，含采集时间、ETag、HTTP 日期、浏览器请求动作和 hash。HTML 为 1734 字节，SHA-256 `08cec5703a24032869e94e5aad1261ab1ca9038d9f52aa2f27121a03d3a1bf6a`；页面本身可能随服务更新。

配置另经只读 GET 核对：`https://player.codemao.cn/new/client_config.json` 与离线 `src/player/client_config.json` **1822 字节完全相同**，SHA-256 均为 `db9c76391150e7b3f31027a7ce8e8d9e487d41b5bac37bd07541e961cfa3e855`；HTTP Date 为 `Wed, 11 Nov 2026 18:25:52 GMT`，无 Last-Modified。双方 `fps=60`、`enable_test_mode=false`、`platform=player_standard`、`debug=false`。本地配置证据为 `dist/k4online/client-config.http.json`。离线 oracle 为隔离服务仍在内存中重定向 API 端点；不能把此处源配置相同理解成运行时网络环境相同。

## 格式化结构化 diff 与对齐影响

比较器使用 TypeScript AST 静态解析 webpack factory，去注释格式化，**不求值第三方脚本**；变化 factory 的格式化文本和加载器全文仅写 `dist/k4online/`，文档不贴官方实现。

- 主包双方各 **585** 个模块，新增/删除 **0**，格式化相同 **584**；唯一变化 **`6sUU/e.get_instance`**：离线添加 `window.__k4c`（container）、`window.__k4b`（binding）两个检查入口。进一步删去离线这段唯一插入后，**整个主包逐字节等于在线文件**，不仅仅是抽查函数相同。
- `6sUU` 格式化 factory 在线 hash `6069065b5d456e6d7bbec1231dd4ac972ea7a7b2a171acda3902eabf792985d2`，离线 `73ea6786cf6e51137f2cd44c8fae7f9eb986003514bc4df47b22c22116f8722f`。
- runtime 格式化 diff 仅两项：webpack public path 从在线 CDN 改为本地 `/kn/build/`；离线多暴露 `window.__k4wreq`。格式化 hash 在线 `79fc28dfa122200aa70197f242d365a13b34ec670572415601845a0ce5664c95`、离线 `7ebbba37afbd64441808ebb281f5f8df3b7a4d3bf2ea9a0dd1d7ac4e9f25966c`。资源解析路径不同，需要单独校验实际加载 chunk；本次三个 lazy chunks 均字节相同。

| 对齐关注点 | 同一主包中的模块定位 | 本次差异与影响 |
| --- | --- | --- |
| 积木集合/注册链 | `tVdx` 注册器；`tSBa`、`Tn6a`、`TL4g`、`VlbI`、`fhSb`、`xQfl`；`Qeyy` 编译器表 | 全部 factory 相同；既有 377 项清单仍只表示固定主 chunk 注册/结构表并集，不扩展成编辑器全集 |
| 调度/等待/广播/克隆 | `iNFq` RuntimeManager、`mXOY` ScriptStore、`K9+f` TaskManager | 无源码结构差异；不能从相同实现推出 NekoC 已完全对齐 |
| warp/过程上限 | `Lcae` OptiRunner、`inF4` DebugRunner、`TGGv` Config、`KmiX` 启动配置 | 全相同；内核默认 50000 次过程调用、30000 warp、4 ms；播放器覆盖 warp **10000 / 100 ms**，不是默认的 30000 / 4 ms |
| 帧率/时钟 | `vxpV` 帧循环、`VPQ7` Clock | 全相同；原生 update 后申请下一次 rAF。配置的 `fps:60` 不是强制 60 FPS 的证据；oracle 固定 60 Hz 为测试条件 |
| 默认值 | `oiyH/default_value`、`Tn6a` 域表 | 全相同；已有 Number(TEXT)、NaN 回退字符串依据可继续限定到该发布物 |

**不能误用普通 `.js`**：离线同名非 `.orig` 文件 hash 为 `f97ac5c6320bf18e6334f423103aebdd0c48975daca6e1b88407447a7238f3c2`，相对 `.orig` 改了 `Lcae`、`inF4`、`O8fc`、`Tn6a`、`VPQ7` 五个模块，涉及 warp 时间检查、Promise 判定、列表缓存、原生 Number 快路径/舍入和时钟捕获。不是仅包装改动，不能纳入上述核心一致结论；既有 oracle 继续拒绝回退。

## 三份公开语料的逐 update 状态

入口分别为 `https://player.codemao.cn/new/<作品号>`。在线适配器使用真实页面，不替换官方脚本、作品或 client_config 的正文；网络由无 Cookie jar 的 Node GET/HEAD 代理，拒绝重定向，删除 Set-Cookie，不转发浏览器凭据。通过独立 webpack inspection chunk 暴露 require，复用已有 oracle 原生 Heart/Start 和采样逻辑，不依赖离线 DI 插入。实际下载的发布 JSON 经 canonical JSON hash 核对，与 `E:/nekoc/dist/kitten4-corpus/<作品号>.bcm` 相同才运行。

两边同为 seed 1、原生 deterministic scheduler、独立同种子的原生 PCG、固定 Clock、受控 rAF、虚拟 Date/16 ms interval；这些是**诊断输入控制而非浏览器原生态**。启动更新算第 1 帧，之后每批 rAF 算一个 update。精确比较完整 `frames` JSON，不按终态或近似坐标判定。

| 作品号 | 线上/语料 canonical JSON SHA-256 | 在线/离线 update | 首/末角色（含克隆）数 | 结果 |
| --- | --- | --- | --- | --- |
| 186831447 | `beb2236094951fd8333c9f7c1998d39b09afef856c131212b559ab44baa42a12` | 60 / 60 | 67 / 67 | 全帧精确一致 |
| 267573240 | `37b49028a7e5434b59183e66f94301c01f814bafcfdb886fc783b6109ec3265a` | 60 / 60 | 2 / 2 | 全帧精确一致 |
| 332140513 | `1c5e5c2f5f2a3db4a5647ac9ba45c91d79a8f0abbb70c5c994e8ef9b1e33608b` | 60 / 60 | 303 / 314 | 全帧精确一致 |

覆盖场景 ID、角色/克隆存在性及位置/原始角度/造型/缩放/显隐、全局/云变量及列表、实体局部变量；值类型和列表快照均保留。双方导出帧数组 JSON 的 SHA-256 分别为：

此处“精确”限定 JSON 导出契约：既有 oracle 的 NaN/Infinity 序列化为 null、负零序列化为 0 等限制仍存在，不据此验证这些值的内部表示。

- 186831447：`7d3461c220cab7fa7a765cffa618653b1f1966566a9b7c0c564b6e909f762290`
- 267573240：`a17d5a3acf689437aaf9ba0d1096110fe0a7398591bddfbe3f150be7163ab744`
- 332140513：`a6455ead58c1e6a4c8389792b26ef8be953966d3fc65741a417485726d2aeffd`

未比较未导出的渲染/物理内部状态、声音输出或像素。写请求及 WebSocket 被阻断，只能验证匿名、禁写/禁 WebSocket 的控制条件，不证明在线云服务等同本地后端。

尝试记录：最初原生浏览器匿名访问成功发现脚本与公开作品；实现无 Cookie jar 的请求代理时，未保留公开 `Origin` 导致作品信息 API 的 CORS 失败，工具正确返回 `unverified`，未纳入成功统计。最终代理仅保留 `Origin` 用于公开 CORS 协商，不转发凭据，也不伪造 CORS 响应头。

## 复现与后续风险

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-online.mjs collect
node tools/compat/k4-online-trace.mjs 186831447 E:/nekoc/dist/kitten4-corpus
node tools/compat/k4-online-trace.mjs 267573240 E:/nekoc/dist/kitten4-corpus
node tools/compat/k4-online-trace.mjs 332140513 E:/nekoc/dist/kitten4-corpus
node tools/compat/k4-online.mjs compare "$env:K4_PLAYER_DIR" dist/k4online/186831447.pair.json
node --test tests/k4-online.test.mjs
```

在线服务、作品内容和 CDN 都可能更新；模块 ID 变化、作品 hash 不匹配或初始化失败应报错/未验证，不适配成假一致。一次 hash 比较不构成长期版本锁定。将来的 oracle 证据应继续携带实际资源 hash，不能删除现有 partial/未验证说明。未移植或参考 HateNeko 逻辑。
