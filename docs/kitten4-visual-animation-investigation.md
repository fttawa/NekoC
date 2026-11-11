# 327790965 手臂姿态差异：音频等待降级导致反复重启

## 结论

**本例不是 VM 补间、造型切换或自定义 pivot 的已证实错误。**
基线第 30 帧官方双手抬起、NekoC 手臂水平，根因是作品的启动线程执行
“播放音乐并等待 → restart”。音乐声明没有 `duration`，headless trace 将未知音频按
“下一 tick 完成”的既有降级策略处理，NekoC 因此每两帧重启一次。
官方该线程在全部 60 个 update 中仍等待音频，动画正常推进。

同一个保存的基线二进制，仅给 ignored 派生输入中的音频加 **诊断用 `duration=120` 秒**，
60 帧角色状态恢复一致，帧 1/30/60 像素差异全部为 **0%**。
120 秒不是测量结果，不能作为正式修复值，也不应写回语料。

本次仅调查，没有修改现有 Rust/renderer/overlay/兼容工具源码，没有运行 Cargo，未提交。
之前新增的 `src/engine/k4_monitors.rs` 和 `tests/kitten4_monitors.rs` 已再次执行
`rustfmt --check --edition 2024`，均通过，不需要格式改动。

## 只读输入与证据边界

- 作品只读路径：`E:/nekoc/dist/kitten4-corpus/327790965.bcm`。
- 官方目录：`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`。
- 官方文件：`src/player/build/player_v2.2d180c468559fbd29528.js.orig`；
  SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
- NekoC 基线：`dist/visual3/k4-trace-before.exe`，没有重新构建。
- 所有第三方派生输入、完整 trace、截图仅在 ignored 的 `dist/visual3-animation/`；
  没有复制到 tracked 文件，没有操作其他 worktree，没有参考 HateNeko。
- 仍是包含包装器 DI 暴露点的离线 `.orig`，未独立认证等同线上发布物。

## 官方与本地源码取证

官方位置是上述单行 JS 的 **0 起始 UTF-16 字符偏移，不是 UTF-8 字节偏移**：

|偏移|符号|依据|
|---:|---|---|
|1770671|`xQfl.play_audio_and_wait_2`|强制 `lock: true` 调用 helper `f`|
|1768168|`xQfl` helper `f`|取得线程锁；正常结束、错误、停止回调才释放锁|
|1762174|`AudioPlayer.play`|PC 分支调用 Howl.play，并注册对应 play ID 的 `end` 回调；未加载成功有单独失败路径|

本地因果链：

1. `src/audio.rs:47–57`：只从显式 `duration` 或可解码的 inline PCM WAV 取得 headless 时长；
   该作品是远程音频 URL，声明无 duration。
2. `src/audio.rs:98–108`：未知时长保存 `duration.unwrap_or(0.0)`。
3. `src/audio.rs:140–159`：下一 tick 剩余时长小于阈值，通知完成。
4. `src/engine.rs` 的 `Op::AudioWait`：输出“时长未知：CLI 按加载失败降级，下一 tick 继续”诊断。
5. `src/bin/k4-trace.rs`：使用 headless `Engine` 逐帧 advance，没有浏览器音频完成确认闭环。
6. `tools/compat/k4-visual.mjs`：先离线生成所有 VM deltas，再逐帧喂入 renderer；
   目前只测量视频 duration 并传 `--videos`，没有对应的音频时长注入。

`docs/audio.md` 第 3 节已明确记载未知音频“下一 tick 完成”是 headless 降级，
不是官方语义。本例是该已知边界造成的视觉控制流差异。

## 动态 trace 证据

`dist/visual3-animation/investigate.mjs` 直接只读源作品，运行官方 60 帧
（seed 1、virtualTime、blocks、允许声明素材），以及保存的基线 exe。
输出：`official.json`、`nekoc.json`；双方 trace 均未截断，官方 runtime errors 为空。

舞台音频启动 hat：`5nh97Yaq8PUV95i3gBbO`；
等待音频块：`HNfOqZ5mJqord0Gky5zN`；后续 restart：`Jbuzps5QrEZaItPPCDuq`。

|观察|官方|基线 NekoC|
|---|---|---|
|启动 hat 的 start 事件数量（60 帧）|1|31|
|restart 执行帧|无|2,4,6,…,60|
|手臂通过 `get_timer >= 0.1` 的等待后换造型|已执行|重启前到不了阈值|

第 30 帧两只手臂的真实 VM 状态（不是从截图反推）：

|角色|官方 rotation / style|NekoC rotation / style|
|---|---|---|
|`56eaa1e8-b050-4d6c-943c-38e43b3a2b94`|`-18.73499399519518°` / `d98d0efe-b6a9-4cb4-accf-ee143d4964f6`|`0°` / `9c010b14-f4fc-4a81-9d25-f812a95aa00c`|
|`91bae3d8-4f77-4fcc-bc7c-f58792b14a80`|`8.734993995195193°` / `b7a7dbd4-bd9c-4f09-aaa5-28fd4ca5a0b8`|`0°` / `c1a771e5-faf8-464a-b6d7-1e5c982b11ff`|

两侧已在 VM rotation 和 current_style_id 上不同，所以不能直接归为渲染 pivot。
作品的缓入由自定义过程和 timer 实现，不是 GIF/视频或引擎单独的造型动画播放器。

## 单变量因果干预及像素复核

`dist/visual3-animation/duration-probe.mjs`：

1. 从只读作品构造内存副本，仅在 `audio` 声明设置诊断 duration=120。
2. 保存到 ignored 的 `duration-intervention.bcm`，不覆盖源作品。
3. 同一个基线 exe 重新跑 60 帧 blocks trace。
4. 对全部角色逐帧比较 `x/y/rotation/current_style_id/scale/scale_y/visible`；
   数值容差 1e-8，非数值严格相等。
5. 用现有 `visualWork` 和同一个基线 exe 比较干预输入的帧 1/30/60。

结果：

- 60 帧所有角色所列字段的差异数量 **0**，见 `duration-differences.json`（空数组）。
- 干预后的 restart 次数 **0**，启动 hat 的 start 事件数量 **1**。
- 没有修改造型、图片、pivot、旋转或自定义过程。

|帧|主会话原基线差异 %|仅 duration 干预后的差异 %|
|---:|---:|---:|
|1|0|0|
|30|13.713831|0|
|60|5.716291|0|

干预像素结果在 `dist/visual3-animation/duration-pixels.json`，
这里的 0% 指 RGB 单通道容差 8 下没有超差像素，不代表 RGBA 字节相等；
三帧 MAE 分别约 0.0911 / 0.0768 / 0.0765。
PNG/state/素材诊断在 `duration-pixels/duration-intervention.bcm/`。
原基线百分比取自主会话提供的统一基线，不声称本任务重跑了全语料。
干预复核读取了当时 worktree 的 renderer/overlay，未固定其源码快照；
但 trace 的 60 帧状态复核直接使用保存的基线 exe，不依赖 renderer。

## 初次调查时的建议与边界（历史记录）

应在兼容/trace 工具层解决或明确排除 **音频完成影响后续控制流且 headless 时长未知** 的情况：

- 浏览器解码音频测量时长，并通过独立元数据接口传给 trace；或
- 在逐帧 browser 模式按明确的媒体完成事件确认等待；或
- 在无法控制/验证时返回 `unverified`，不要把大差异当 renderer 优化目标。

**不要**凭本例把未知音频统一设为 120 秒、永久挂起，或修改 pivot/自定义过程插值。
`mediaWaitCandidate` 目前只检查视频等待，本例也说明音频等待需要单独界定验证边界。

初次调查时未完成 / 未验证（后续实现状态见下节）：

- 没有实测本曲真实时长；120 秒只是确保 60 帧窗口内不触发结束的因果干预。
- 没有修复 trace 的音频元数据接口或新增媒体驱动，未声称后续音乐结束/restart 时刻对齐。
- 官方音频自然结束依赖实际媒体时钟；本次只确认前 60 update 内没有结束，
  并非证明全部播放时间轴受虚拟 Date 控制。
- 本任务没有新增正式回归夹具：没有提交修复，现阶段第三方诊断闭环足以定位根因。
  若主会话实施工具修复，应新增自制音频“播放等待 → restart + timer 驱动造型”夹具，
  且不能把这份第三方派生输入移入 tracked。

复跑（无 Cargo）：

```powershell
$env:K4_PLAYER_DIR='E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app'
node dist/visual3-animation/investigate.mjs
node dist/visual3-animation/duration-probe.mjs
rustfmt --check --edition 2024 src/engine/k4_monitors.rs tests/kitten4_monitors.rs
```

## 后续正式时长接口

已从官方已加载 Howl 只读实测本曲 **15.018666666666666 秒**，并新增
`k4-trace --audios`、`k4-visual` 元数据接线及原创 `audio-wait-restart.bcm`。
详见 [音频等待接口与验证](kitten4-visual-audio-waits.md)。
前文“没有修复接口/没有实测时长”仅描述初次因果调查，不是最终实现状态；
120 秒仍仅是历史诊断干预，正式采样不采用它。自然结束时刻的媒体时钟边界仍未完整验证。
