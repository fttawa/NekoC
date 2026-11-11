# K4 第八轮：self_shake 帧尾任务与结束续接（仍 partial）

## 结果与边界

局部实现将 shake 从脚本阶段 `AnimStep` 移到帧尾；完成帧执行归位，下一 update 才续接脚本。
新增六件原创夹具：`.14/.23/.4` 秒、串联、另一脚本持续移动竞争、零/负数/文本时间。
每件40 update，分别在官方 Clock 原点0和1024ms下采样，共480个官方 update。
所有原始逐帧变量、演员 x/y、夹具hash、资源hash在
`kitten4-shake-8-evidence.json`；完整未裁剪诊断在未跟踪的 `dist/shake-8/`。
六件均无物理刚体，不涉及场景切换、renderer 或设备服务。

**仍维持 partial，不修改总 catalog/scope。** 官方任意墙钟原点会影响严格浮点阈值。
如 `.14` 秒在原点1024ms第4帧开始移动，而原点0ms第5帧开始移动。
NekoC shake-only clock选择确定性0ms原点，不写死1024、不增加epsilon、不调整全局时间。
因此不能声称与第七轮1024ms位置证据完全一致；旧证据保持不变。
`tests/kitten4_partial_data_7.rs` 原负例改为钉住这个剩余差异，同时断言第10帧
phase仍1、第11帧才2的结束续接修正。

## 官方只读定位

外部文件（仅只读查看/供oracle加载；不复制源码、不移植实现）：

`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig`

SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
以下为该UTF-8解码后JS字符串的0-based UTF-16 offset（非文件字节偏移）：

| 定位 | offset | 观察 |
| --- | ---: | --- |
| `Tn6a/self_shake` | 588138（模块相对12136） | 数字且大于0才创建blocking task；5单位四向单步，归一化初阈值`.05/time`，每次增加`.04/time`；结束相对纠偏 |
| `K9+f/update_dispose` | 415593 | update入口移除已结束task/blocker |
| `K9+f/task_update` | 416754 | 首次只记录起点；后续毫秒归一化进度；到期先on_end而不再on_tick |
| `VPQ7/ClockImpl` `ms_per_update` | 705322 | current_time累加毫秒delta；clear后首次从墙钟建立原点 |
| `iNFq/update` task尾调用 | 1181449 | `step_code`之后task update，再after_update采样 |

本轮没有替换官方积木、task、调度器；沿用现有oracle固定60Hz/seed1，
仅将Clock墙钟起点分别固定0与1024ms以重现浮点原点效应。
所有官方 errors/pageErrors为空、externalAllowed=0。
观察脚本每帧采样位置，严格等于上一帧结束位置，直接验证task在脚本之后而非脚本之间更新。

## 改动位置

- `src/engine/k4_shake.rs`：独立毫秒时钟、归一化进度与阈值；`tick_k4_shake`
  帧尾累计delta/纠偏/移除blocker。每update至多一步，不追赶遗漏步数。
- `src/engine.rs`：仅shake专有Clock字段及构造/start重置；Shake创建使用该clock；
  AnimStep对Shake只阻塞；tick入口推进shake clock、帧尾调用独立更新。
  不改变Glide/Fade/EntityVisibility本身算法，也不改公共Anim/Task结构、物理或renderer。
- 新夹具/工具/Node/Rust测试只使用仓库原创项目；未复制任何第三方作品。

## 验证状态

已运行：

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
node tools/compat/k4-shake-8-fixtures.mjs --record
node --test tests/k4-shake-8.test.mjs tests/k4-partial-data-7.test.mjs
```

Node 3/3通过；独立JS毫秒算术诊断与零原点官方240 update的phase/x/y一致，
**不将此诊断当作Rust VM测试**。执行前检查jit-corpus/perf-bench无进程。

主会话已串行验证Rust：`kitten4_shake_8` 1通过、`kitten4_partial_data_7` 2通过、
`kitten4_catalog` 33通过，均0失败。命令：

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo test --test kitten4_shake_8 --test kitten4_partial_data_7 --test kitten4_catalog
cargo test --lib engine::k4_shake
```

`kitten4_shake_8` 比较零原点六件全部240帧typed变量与x/y、默认/禁用JIT两模式，
并检查start重置。默认启用JIT并不证明短脚本达到了native region热阈值。

未验证：任意原点完全等价、非60Hz官方采样、零dt/长帧官方差分、暂停/取消/删除与多shake并发、
物理刚体受力、pen像素/事件、任意非有限时间与长期累计溢出。竞争移动只覆盖一条线性加x脚本；
结束归位是相对纠偏，不强制覆盖别的脚本位置。原点0与1024完整轨迹均保留，不以最终归位一致代替逐帧一致。
