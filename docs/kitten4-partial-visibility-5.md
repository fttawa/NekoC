# K4 partial 第五轮：set_entity_show_hide

## 范围与当前状态

本轮针对原覆盖统计出现 64 次的 `set_entity_show_hide`；仅测试仓库原创作品，
不读取第三方作品语料、不复制播放器实现。先保留 **partial**，不能将已录制或
`compared/captured` 当作所有语义一致。

官方基准是只读离线包
`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app` 的 `.js.orig`。
主资源 SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
该包有包装器 DI 暴露点，未独立认证等于线上发布物。

只读定位（整包UTF-16字符偏移，0-based）：599871 渐变 helper、602703
`set_entity_show_hide`、665247 隐藏清理实体输入、416754 task_update、
415593 延迟 task disposal、705342 原生 Clock。只记录位置与实测规则，不移植源码。

## 原创证据

`tools/compat/k4-partial-visibility-5-fixtures.mjs` 用仓库原创基础结构和 schema
生成 17 个1280×720作品，每件 24 帧，共 **408 帧**。无 CDN 素材，40×40 内嵌 SVG 原创实色方块。
`docs/kitten4-partial-visibility-5-evidence.json` 保存逐帧变量、visible、原生 alpha、
fixture hash、资源 hash、官方错误和网络隔离结果。克隆 ID 仅在本专项规范为 `#clone`。

| 探针 | 观测事实 |
| --- | --- |
| hide/show/group-hide | 0.2s 渐变；首帧设置初始 alpha、后续逐帧推进；结束帧重置 alpha=1，调用线程再下一帧继续 |
| race-hide-hide | 两个任务向当前 alpha 叠加固定斜率，允许负 alpha；先结束的任务重置 alpha=1，不取消另一个任务 |
| race-hide-show | 已 visible 的渐显立即继续，不取消已有渐隐 |
| race-show-hide | 渐显/渐隐叠加；第二个任务从脚本阶段看到的 alpha 捕获斜率 |
| instant-during-fade | 瞬时 hide+show 不取消已有渐隐 |
| cancel-caller | stop 当前角色其他脚本冻结 alpha；不会自动重置/隐藏，不执行 after |
| delete-clone | 删除正在 self 渐隐的克隆停止其任务 |
| delete-caller-clone | 克隆在原角色上启动渐隐，删除调用克隆也停止该任务；原角色 alpha 冻结 |
| input-hide/input-gradual-hide | pointerdown 后隐藏清除实体 held 状态；之后不继续 down，释放不产生该角色 up/click；渐变完成前 down 仍持续 |
| duration-zero | 同帧直接隐藏并继续 |
| duration-negative/negative-infinity | 首帧仍 visible 并阻塞，下一帧结束隐藏，再下一帧继续 |
| duration-infinity | 24 帧内保持初始 alpha，调用方持续阻塞；不是测试“无限运行后完成” |
| duration-nan | 不改变 visible/alpha、不阻塞 |

### 固定时钟诊断边界

播放器 deterministic Clock 固定增量但初始值仍取 `performance.now()`。
原生浮点减法使 0.2s 的临界完成帧有一帧抖动。专项通过 DI 在 Start 前将原生
Clock 的墙钟原点固定为 **1024ms**；原生 update/task 回调仍原样执行。
这是明确记录的诊断插桩，不声称真实浏览器墙钟原点天然为此值。
DOM 输入使用既有输入重放时钟，与任务原点分开。

## 可控修复与公共接线

`src/engine/visibility.rs`（KN仍使用原Anim::Fade，输入KN回归保持通过）：

- 新增 tick 尾部 `tick_entity_visibility(dt)`：所有脚本执行后才推进 alpha，
  按任务创建顺序叠加，不做 0..1 clamp；下一帧才释放 AnimStep。
- 隐藏时只清除该实体 `input_targets`，不伪造物理 pointerup。
- 脚本阶段取消的任务仍推进本帧最后一次 delta，下一帧移除并冻结；死亡目标不再更新。
- 接受负数和正负 Infinity；NaN 仍无效，零时长直接赋 visible。

`src/engine.rs` 仅做以下公共接线，`src/kitten4.rs` 不变：

1. `Op::AnimStep` 开头，若 `entity_visibility_blocked(index)`，回退 PC 并 yield。
2. `tick` 的 ready while 结束后、任务压缩前调用 `tick_entity_visibility(dt)`。

不需要新增 Engine/Task/Anim 字段。旧绝对插值分支不应再用于 K4 EntityVisibility。

## 门禁与像素

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-visibility-5-fixtures.mjs --record
node --test tests/k4-partial-visibility-5.test.mjs
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:CARGO_BUILD_JOBS='1'
cargo test --test kitten4_visibility --test kitten4_partial_visibility_5 --test input
cargo test --test engine effects_size_and_fade_update_sprite_state
cargo build --bin k4-trace
node tools/compat/k4-partial-visibility-5-visual.mjs
```

Rust 回归对解释器和默认 JIT 配置比较全部逐帧值；不声称夹具必然进入 JIT 热区。
显隐5项、输入5项（含KN）、属性专项1项已通过；显隐测试将两帧公共克隆删除差异显式列为已知边界。
最终新增 actor-count 检查与 KN fade 专项由主会话统一门禁复验，不重复并发构建。
专项视觉 runner 比较真实 `k4-trace --render` 帧增量和原生播放器画布，每个 update
保存两侧 PNG 到 `dist/partial-visibility-5/visual/`，包含输入脚本。
`docs/kitten4-partial-visibility-5-pixels.json` 绑定 fixture/input SHA-256，记录逐帧
changedPixels、MAE、RMSE；RGB 容差8/255，白底，不缩放、不遮罩。

**完整408帧均已比较；407帧 changedPixels=0，1帧非零**：
`delete-caller-clone` 第8帧1600像素超差，占1280×720的 **0.173611%**。
该帧官方仍显示40×40克隆，本地已删除；未遮罩或删去该帧。
`delete-clone` 第8帧也有presence差异，但克隆重叠原角色，像素0不能证明对象存在状态一致。
其他全部帧 changedPixels=0仅指8/255容差，无“逐字节像素相同”的额外断言。
视觉runner在任何非零差异时退出1，不能将 `compared` 当作兼容通过。
最终归档已完整17例/408帧，fixture/input hash专项JS检查2项通过。
录制工具的中间结果仅写 `dist/partial-visibility-5/*-progress.json`；仅完整未筛选
批次且全部采样成功时，才原子替换最终tracked证据。非零像素差异完整保留，不阻止事实归档。

## 保留边界

已确认的非一致：两个 delete 探针的第8帧，官方克隆仍存在，NekoC 已删除；
官方第9帧消失。Rust 回归对此帧显式断言“已知提前删除”，不将该帧列为官方一致。
这是公共 clone disposal 延迟问题，不在本模块改变其全局生命周期。

尚未穷举场景隐藏、切场景中断、删除非调用目标及 slot 重用、嵌套 tell/同步过程、
同帧 stop-all 与 restart、场景/组中克隆成员扩展、畸形 mode/悬空 UUID、
非60Hz和指令预算中断、长于24帧的无限渐变交互。输入清理只测先 down 后 hide，
尚未覆盖同帧 click/hide responder 顺序、拖拽中隐藏和多点触摸。
真实纹理边缘、滤镜、不同平台的 alpha 混合也不由实色方块证明。
