# K4 缺失积木第二轮

## 基线与选取顺序

开始基于 `oc/integrate` 的 `8d5bdc1`，结束前先快进同步到 `de1ff5b`（含输入、JIT、KN 清单与 video 任务），再同步到 `4ceb30f`（warp 测试确定性及 KN 清单行号比较修正）。原覆盖表 139 项缺失的语料频率均为 0；8 项 stub 中先处理 10 次的 `self_shake`，不修改交给 video 任务的四种视频积木。随后按常用基础类别选文本、条件、启动/点击、介绍弹窗，再处理可以明确定位的无设备行为。没有取得官方编辑器面板使用频率统计，常用度排序是工程选择而非官方统计。

五个 legacy audio 入口在基线已支持，本轮只纠偏、补回归并重新生成覆盖表，**不算新增五项**。详细边界见 [kitten4-audio-aliases.md](kitten4-audio-aliases.md)。硬件的 74 项见 [kitten4-devices.md](kitten4-devices.md)。

重生成表另将基线已有 `play_words_audio/play_words_audio_wait` 从过期 stub 分类修正为显式映射；本轮未修改这两项实现，不算新增 TTS。共新增 89 种入口：74 项硬件降级、6 项手机/摄像头/方向降级、8 项基础入口、1 项 shake stub 实现。表的缺失从 139 到 46，差额 93 中有 5 项为已存在的 audio 映射，而不是 93 项全部新写。

## 官方源码定位与语义

固定只读 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`，SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。下表为 webpack factory 字符串首字符起算的 **0-based UTF-16 offset**；不是整个包的偏移或字节偏移。完整注册位置随覆盖表生成，本文不包含源码片段。

| 积木 | 官方定位 | 实现及回归 |
| --- | --- | --- |
| `self_shake` | Tn6a@12136；数值 guard `w`@6887；坐标 helper `u`@10722；K9+f `task_update` | 正时长阻塞；超过 0.05 秒后开始，之后每个 update 最多走一段，阈值每段增加 0.04 秒；按 x+5、y+5、x-5、y-5 循环，结束补回未闭合偏移。新模块 `engine/k4_shake.rs`，非正时长立即继续。回归运动、阻塞与最终归位。 |
| `text_indexOf` | oiyH@2414 | FIRST/LAST；1-based UTF-16 位置；找不到 0；空 FIND 返回 1 或 length+1。回归 emoji、重叠、空串、未找到。 |
| `text_append` | oiyH@2546 | 读取变量并使用 JS 加法，不一律转字符串。复用 K4 typed add，回归数字相加和字符串拼接。 |
| `text_implicit` | oiyH@2668 | 空串仍为空串；其他可转数字文本变为数字，不能转的保留文本；复用既有 `k4_number_text`。回归空串、空白、十六进制、普通文本。 |
| `days_after_2000` | oiyH@4181 | 以 UTC 2000-01-01 为起点，秒数除以 86400 后 floor；真实时钟/虚拟时钟同现有日期 reporter。回归虚拟 epoch。 |
| `start_on_click_2` | oiyH@3860、Qeyy@1564；ojop `start_on_click`；DmFr `ws_json_to_json` | 记录全局启动帽，不作为普通堆栈；workspace 的首个 statement DO 变 next，published 沿用官方已编译 next_block。两种格式回归。 |
| `controls_if_no_else` | Qeyy@356；inF4 `eval_cond`；DmFr `conditional_json_to_json` | 与普通条件相同；published 的 conditions/child_block 正确还原 IF0/DO0；真/假分支回归。 |
| `self_on_tap` | Tn6a@77993 | 当前实体的 mouse_down/up/click 事件；复用 pointer 事件调度，不在启动时误运行。回归启动静止、显式点击触发。 |
| `show_stage_dialog` | Tn6a@33009 | 原样转交 create_stage_dialog；回归打字结束不释放、确认关闭才续接。 |
| `get_orientation` | Tn6a@42128 | 无浏览器方向信息为 0，不误当角色朝向。X/Y 回归。 |
| `get_mobile_slope_value` | Tn6a@58029，`zt`@57541 | 未配对/断开返回零轴 x/y/z。回归 z。 |
| `get_mobile_rocker_value` | Tn6a@58299，`Ft`@57090 | 未配对/断开返回零轴 x/y。回归 x；未知轴不假定为零，仍拒绝编译。 |
| `mobile_vibrate` | Tn6a@58566 | 无可选配对传输时不发信号；本地 noop，回归后续积木继续。 |
| `get_camera_data` | Tn6a@63918 | motion/direction 无样本为 0，target=? 返回 NaN；修正通用悬空引用处理，不能提前把 ? 改为 0。两字段及 sentinel 回归。 |
| `set_camera_opcity` | Tn6a@63714（官方拼写） | 相机组件不存在时无效果；本地 noop，回归续接。 |

除 shake 外，新增 lowering 位于 `src/kitten4/common.rs`；保留原生 opaque 编辑 AST，只改 VM 副本。所有上述类别回归位于 `tests/kitten4_catalog.rs`，使用原创合成输入，检查 workspace/published、原样 roundtrip、解释器与默认 JIT。没有搬运第三方作品，也未移植 HateNeko 逻辑。

## 已知边界与未验证

- **未验证**：本轮新增项未运行官方浏览器差分或官方编辑器面板实测；证据为上述固定内核的源码定位与调用链分析，不能泛称所有官方版本一致。
- shake 是 **partial**：与官方任务管理器的首次启动、task tick/线程续接帧相位未逐帧核对；物理刚体原实现经 `u` 施加力，本地动画仅位移；其他脚本并发移动、取消/销毁、场景对象、非数值/Infinity 等边界未全面验证。不能声称确定性像素等价。
- `text_indexOf` 正常字符串输入已回归；原始非字符串 VALUE 在官方可能 TypeError，本地采用 VM 字符串转换，保留 partial。未知 END 不默认为 FIRST。
- `days_after_2000` 已核对 UTC 起点；实际墙钟跨午夜及浏览器历史 Date 解析版本差异未实测。
- 无设备 reporter 是同步本地固定值，不模拟官方 Promise 微任务相位、设备接入、权限提示、通知 UI、联网配对或真实硬件。摄像头扫码/识别结果弹窗会涉及交互阻塞，未简单当 noop。
- 剩余 TTS、语音/识别、MIDI、旧自制积木协议、dropdown 条件、帧计数、reset_timer 与物理旧向量入口等仍按覆盖表公开，未用猜测补齐。`get_choice/get_choice_index` 官方 legacy wrapper 丢返回值，也未冒充成新 reporter。

## 复验

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo test --test kitten4_catalog --test kitten4_devices --test kitten4_audio_aliases
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
node tools/compat/k4-block-catalog.mjs E:/nekoc/dist/kitten4-corpus docs/kitten4-block-coverage.md
node tools/compat/k4-block-catalog.mjs E:/nekoc/dist/kitten4-corpus docs/kitten4-block-coverage.json
```
