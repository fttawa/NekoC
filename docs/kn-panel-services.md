# KN 第五轮：翻译、排行榜与全局特效

## 官方依据与复现

官方匿名桌面编辑器 KN **0.27.4**，`main.8ccf2442.js` SHA-256
`58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`。
本轮不使用 HateNeko 逻辑。位置均为原始 UTF-8 零基字节；定位、摘录散列和带类型调用结果见
[kn-panel-services-evidence.json](kn-panel-services-evidence.json)。没有把第三方源码或资产放进跟踪路径。

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-panel-services-probe.mjs --record
node --test tests/kn-panel-services.test.mjs
cargo test --test kn_panel_services
```

探针在全新隔离 Edge 暴露官方 webpack loader，调用原 registry。仅翻译 HTTP 路由显式 abort
`internetdisconnected`，不替换域函数返回值；四次 POST 全部被拦截，没有实际提交翻译。
19 次调用均返回 Promise；报告保留 await 后的类型。它不是原生工程/完整调度差分。

| 积木/辅助函数 | 官方源码字节位置 | 已确认行为 |
| --- | ---: | --- |
| `translate` | 1567608 | `text`、`language`；空白直接返回，传输失败释放锁，不开翻译对话框 |
| `translate_result` | 1568646 | 空白或传输失败返回 string 空串，不是 K4 的原文回显 |
| 翻译传输 | 精确值见 JSON `translate_transport` | `text.toString().substring(0,200)` 后 POST；catch 返回 null；null/undefined 在 try 前调用 toString 会拒绝 |
| `show_hide_ranking` | 1695924 | 字段 `show_hide`、`ranking`；缺 ranking/缺 rankingId/无已发布 workId 时不发查询 |
| `update_ranking` | 1697530 | 字段 `variable`、`ranking`；debug 或无发布作品/榜单时提前返回；不是本地变量加分 |
| `user_ranking_info` | 1699438 | 字段 `ranking`、`type`；无真实榜单/发布作品时 numeric NaN |
| `user_info_of_th` | 1700796 | 另有 value `order`；无真实榜单/发布作品时 numeric NaN |
| `global_animation` | 1659364 | 字段 `animation`；获取线程锁，播放全局音频/SVGA/滤镜，完成回调释放锁 |
| 全局特效清理 `Re` | 1604902 | 去滤镜、删容器、lock.stop |
| 选项模块 61823 | 1551838 | `animation_salvo/firework/awkward/silent` 四种，横竖不同动画 |

## 实现范围（全部仅部分语义）

本轮原来“缺失”且属于普通默认/可配置默认隐藏的 27 项中，26 项新增受限分派，全部标为部分语义；仅 `get_voice_volume` 继续缺失。300 项总缺失 81→55、部分语义 36→62；不宣称本轮完成真实 AI/网络/摄像头服务。

新模块 `src/engine/kn_panel.rs`：

- `translate`/`translate_result` 是**显式离线传输失败 profile**。保留输入按 text→language 求值；无网络服务，不伪造翻译内容。空白与传输失败可运行；不实现成功翻译 UI、HTTP、语言服务或实际 Promise 时间。
- 四个排行榜类型采用**本地未发布作品、没有 KN 排行榜后端 profile**。查询返回 numeric NaN，`order` 仍求值；命令走无发布作品早退。不是完整榜单、真实用户、分数提交、错误提示 UI 或云持久化支持。不能把无后端当成“未上榜”/“无记录”。
- `global_animation` 建立**阻塞式宿主请求边界**：`pending_kn_global_animations()` 读取请求，`finish_kn_global_animation(id)` 释放指定脚本；重启清理，ID 不复用，旧回调无效。**仓库 viewer 未接 SVGA/全局音频/滤镜，headless 不会自行完成**；未接宿主时脚本一直等，不谎报已播放，也不猜持续时间。非法选项明确报 unsupported，未复刻官方非法参数的锁悬挂。

实际编辑器默认的 `limit_length_text`/`multiline_text`（TEXT 字段）和 `camera_alpha_slider`（NUM 字段）也已补编译回归，避免只支持测试用替代阴影却拒绝面板刚拖出的积木；源码定义/读取位置另存于同一证据 JSON。alpha 只按 Number 求值，不把文本强转。

## 回归与未验证

Rust 集成覆盖翻译与 `order` 输入副作用、离线类型、命令后续、全局特效等待/回调/重启陈旧句柄。
JS 回归绑定官方 bundle/源码 hash 与 19 次 typed observations，离线运行不要求 dist 源码，存在源码时逐项验证。

**未验证**：完整原生 KN 工程调度与微任务相位；成功联网翻译；有效已发布榜单与真实登录账户；全局 SVGA 的像素/音频、横竖屏、并发滤镜及切场景；浏览器缺 DOM 容器的锁行为。以上不认证完整官方兼容。
