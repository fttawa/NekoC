# K4 第九轮：场景过渡画面与完成回调

## 结论

`set_scene_transition` **继续 partial**。本轮新增 distort 的双冻结截图、径向扭曲与延迟入场，
修复非 none 过渡期间运行组提前切换：逻辑场景立即改变，但旧场景激活脚本继续运行，
完成回调后才结束旧激活实例并激活目标场景。未改通用表达式编译或任务排序。

不是全像素一致认证。原创纹理背景有栅格残差；无过渡时启动脚本先后仍有明确负例。
没有移植官方源码或 HateNeko。

## 官方依据与输入时钟

只读文件 `$K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
以下为 webpack factory 字符偏移，绝非复制该源码到实现：

| 位置 | 实测交叉规则 |
| --- | --- |
| `Tn6a@36848` | `distrot`/`fadeInOut` 别名、slide/bounce 方向 |
| `a1xw@23824`（xt.create_tween） | 独立 `performance.now()`，严格 `elapsed > duration` 才移除；最后一次插值不夹取 |
| `a1xw@25905`（Et） | 无效类型不创建 tween，因而不触发完成；none 同步完成 |
| `a1xw@26701..27599` | slide 500ms、bounce 1000ms、fade 500ms；distort 出场 500ms、入场延迟100ms再500ms |
| `a1xw@27599`（Et.set_distort_transition） | 两张全舞台截图、入场场景保留在截图下方；半径为短边，截图在0.6s后共同销毁 |
| `a1xw@28534`（reset_scenes） | 最后 tween 完成后清理并恢复场景位置/alpha/层序 |
| `a1xw@45334`（Nt.set_current_scene） | current_scene 先改；只在回调里设可见场景并向上通知 |
| 整文件 `661240`（switch_to_selected_screen） | 回调里 change_running_group、发送激活及场景事件 |
| `lvVU@331680`（TwistFilter） | 径向反向采样、距离平方衰减 |

诊断显式固定 `performance.now()=(frame-1)*1000/60`，每个官方 VM update 后推进一次原生 PIXI ticker，
再截图，不额外推进 VM。NekoC 的离线适配把该受控相位映射到 update 时钟；
**浏览器真实 performance 与 VM 墙钟的同步关系未验证**，不可当作实时播放认证。
离线回调适配对累计秒数的端点使用1e-12秒舍入保护，避免f64累计把理想60Hz端点
误判为超期；这不是原生独立performance时钟的通用实现，亚皮秒差及其他频率未验证。

## 原创夹具与连续证据

生成器 `tools/compat/k4-partial-transition-9.mjs`，夹具 `partial-transition-9-*.bcm`。
重用仓库原创 SVG 底图并新加全局尾部、旧/新场景计数与激活计数。
14件各65帧，共910对连续全画布。所有资源均为 inline data URI，官方包与第三方作品没有复制入库。
`kitten4-partial-transition-9-evidence.json` 保存每件 SHA-256、官方资源哈希、逐帧容器/
截图属性、全画布像素差与 VM 变量，采样不抽帧。另有从激活脚本发起 fade/distort 的夹具，
验证切场积木后尾部在过渡期间仍能同 update 继续。

60Hz 受控时钟下：

| 过渡 | 末端仍存在 | 完成回调样本 | 首个目标激活脚本 update |
| --- | --- | --- | --- |
| slide 四方向 / fade | frame31，500ms | frame32，516.6666666666666ms | frame33 |
| bounce 四方向 | frame61，1000ms | frame62，1016.6666666666666ms | frame63 |
| distort | frame37，600ms | frame38，616.6666666666666ms | frame39 |
| none | 同步完成 | frame1，0ms | frame2 |
| slide-invalid | 永久无 tween | 无 | 65帧均未激活 |

全局切场调用方的 `tail=1` 在 frame1；旧激活计数在完成回调所在 update 仍递增，
下一 update 才终止。Rust 回归逐帧比较逻辑场景及4项变量，而非只比终态。

## 像素与负例

每帧比较960×720完整画布，白底RGB容差8，不遮掉差异像素。
回归上限为每帧2000差异像素（0.290%）、MAE<1.6；这只是已测原创纹理的有界回归，
不是“全像素相同”。证据中保留具体逐帧值，distort 的 alpha/angle 全部活动帧与官方差<1e-12。
在实际帧跳过500ms时记录首次过期样本，保存出场 tween 末次未夹取属性，不硬编码理想60Hz末帧。

明确负例：none-left 中官方旧场景激活循环一次也不运行，NekoC frame1运行一次且随后保持1。
这是原有 Start/激活根调度顺序差异，测试显式标注双方值，不能把它当作一致。

未验证：过渡中重复/竞争切场、从后场景切前场景的全画面、暂停/跳帧/真实时钟相位、
非1:1 backing resolution、动态离场角色与画笔、视频和浮层截图、非WebGL错误路径。
显示器当前保留的离场状态仍是切换时快照；这不等价于官方活离场树。
所以本轮不提升 `set_scene_transition` 覆盖等级。

## 复验

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-transition-9.mjs --record
node --test tests/k4-partial-transition-3.test.mjs tests/k4-partial-transition-9.test.mjs
cargo test --test kitten4_transition_9 --test kitten4_scenes
$env:K4_TRANSITION_9_INTEGRATION='1'
node --test tests/k4-partial-transition-9.test.mjs
```
