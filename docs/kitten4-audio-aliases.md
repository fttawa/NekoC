# Kitten 4 legacy audio：核对、纠偏与回归

## 范围与接入

本次核对 `xQfl` 的五个旧入口：`play_audio`、`play_audio_and_wait`、`set_volume_or_rate`、`change_volume_or_rate`、`stop_all_audios`。这五项在当前基线的 `src/kitten4.rs::lower_block` **已经存在**，不是新增五种支持；原覆盖目录的行号/分类已重新生成。

`src/kitten4/audio_aliases.rs` 只补两个可由官方静态代码确认的差异，不重复搬运基线分支：

1. legacy `change_volume_or_rate` 不读取 `increase`；原基线直接改名为 `_2` 后会误用 `increase=decrease`。新 hook 在 VM 边界强制为增加方向，保留 `audio_value` 自身的正负号。
2. 官方 legacy 入口读取已求值的 `audio` 参数，不要求它一定来自下拉字段。基线会用静态 field 覆盖已有动态输入，甚至覆盖为空字符串；hook 保留动态输入，播放入口只把输入 socket 从 `audio` 改为 VM 的 `audio_id`。

在 `src/kitten4.rs` 的接入方式：

- 在模块声明处添加 `mod audio_aliases;`。
- 在 `lower_block` 原有 legacy audio 分支之前调用 `if audio_aliases::lower_audio_alias(block, targets) { return; }`，位于读取旧 audio field、构造默认输入之前。
- 无需删除或修改原有五项 match 分支：静态 play、静态 set、全停仍走原实现；legacy change 和动态输入走新 hook。

所有处理仅发生于 `lower_for_vm`。可编辑 AST 保留 `kitten4::` 原类型、原 sockets、原 metadata 与原 native source，原工程导出不应被归一化。

## 官方只读证据

核查文件：

`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig`

- 字节数：`1855324`
- SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`
- webpack module：`xQfl`
- factory 长度：`33515` 个 UTF-16 code unit
- factory 在完整 bundle 的 UTF-16 起点：`1743493`

以下均为 **从 0 起算的 UTF-16 code unit 偏移**，不是 UTF-8 文件字节偏移，也不是 Unicode code point 偏移。factory 相对位置以 `modules.xQfl.toString()` 的首字符为 0；bundle 绝对位置等于起点加相对位置。

| 入口 / helper | factory 相对偏移 | bundle 绝对偏移 | 静态结论 |
| --- | ---: | ---: | --- |
| `jt` | 24360 | 1767853 | 构造声音 domain 函数表；需要播放器提供 pixi info |
| 播放 helper `f`（`jt` 内） | 24675 | 1768168 | 检查声音存在或 improvise；有锁时取 thread lock，结束/停止/错误路径释放 |
| `_2` 的声音解析 helper `g` | 26485 | 1769978 | 提供名称、数字索引、`all` 等选择器解析；旧入口不经过它 |
| `play_audio_2` | 26922 | 1770415 | 先解析 selector，再取第一个资源进入 `f` |
| `set_volume_or_rate_2` | 30673 | 1774166 | 解析 selector；数值属性除以 100 |
| `play_audio` | 31836 | 1775329 | 将参数 `audio` 直接传给 `f`；默认非阻塞，显式 `lock` 可改变该行为 |
| `play_audio_and_wait` | 32000 | 1775493 | 同样直接传 `audio`；强制阻塞 |
| `set_volume_or_rate` | 32165 | 1775658 | 检查资源存在；只接受 number 且非 NaN；百分数除以 100 后设值 |
| `change_volume_or_rate` | 32400 | 1775893 | 检查资源存在；只接受 number 且非 NaN；读取现值并加 `audio_value / 100`，不读取 `increase` |
| `stop_all_audios` | 32686 | 1776179 | 清理已登记的阻塞线程和声音映射，执行无参全局停止；另有微信录音停止分支 |
| 限幅 helper `It` | 32879 | 1776372 | volume 限制到 `[0,1]`，rate 限制到 `[0.05,4]` |

研究方法：仅用 `node:fs` 读原文件，在隔离的 `node:vm` context 中截获 `webpackJsonp.push` 的 factory 表，再读取 factory 文本；**没有调用任何 factory 或播放器入口**。可用已有 `tools/compat/k4-block-catalog.mjs` 的 `webpackModules` 取得同一张表，缺 TypeScript 时不必依赖该脚本。上述 table 是事实与偏移摘要，不向仓库复制官方源码片段。

其他共享属性、播放完成和 headless/browser 边界见 [`audio.md`](audio.md)。本次未运行官方浏览器，不把静态调用链说成官方听音实测。

## 回归设计

`tests/kitten4_audio_aliases.rs` 构建原创合成工程，分别使用：

- workspace `block_data_json` 的平铺积木与连接；
- published `compile_result` 的嵌套 `params` 和 `next_block`，并移除 workspace，确保实际走 published 导入。

每种 source 均覆盖解释执行与默认 JIT 路径，检查导入后的旧入口仍为 opaque、VM 降级类型正确、compile/run 不改可编辑 AST、`from_neko` 精确恢复原 native JSON（包含自定义 metadata）。具体断言：

1. `play_audio` 静态 ID、动态输入均保留目标，发出单个非阻塞播放命令，续接本帧完成，下一帧无重复命令。
2. `play_audio_and_wait` 静态 ID、动态输入均阻塞续接；headless 明确使用合成资源的 0.1 秒时长，零 dt 不完成；browser 模式不按估时结束，错误完成 ID 无效，匹配 ID 才释放。
3. set/change × volume/rate × 静态/动态 target × 正负值：命令保持有符号的百分数点值；legacy change 即使带 `increase=decrease` 也不翻转符号。
4. 文本 `"50"` 与布尔值不被强制转换成 number，不产生属性命令，但继续执行后续积木。
5. `stop_all_audios` 不读取无关 audio 字段；播放后按顺序输出全局停止命令 `all`，不阻塞续接。
6. legacy rate 的 set/change 确实影响后续声音等待时长；正常值、上限 4 和下限 0.05 均由离线资源时钟核对，不只检查命令字段。

速率等待测试将预期总时长拆为 8 个等长 tick，分别断言前 7 步未完成、第 8 步完成。原因是 `Engine::advance_with` 将单帧 `dt` 限制为最多 0.25 秒；下限速率对应的 2 秒等待不能用两个 `dt=1` 的调用模拟。初版测试误用了这种步长，实跑发现 5 过 1 失败；此次仅修正测试时间推进，不修改引擎或放宽完成断言。修正后 Cargo 回归已通过。

使用带 UUID 形态的原创资源 ID，避免把 `_2` 解析器对任意非 UUID ID 的宽容扩展混入本次旧入口测试。fixture 的 `duration=0.1` 仅为 NekoC 的离线时钟约定，不声称官方使用该字段估时。没有生成 `.bcmkn` 文件，也未引入外部声音素材。

接入后统一运行，`kitten4_audio_aliases`：`6 passed; 0 failed`。相关复验命令：

```powershell
cargo test --test kitten4_audio_aliases
cargo test --test audio
cargo test --test kitten4
```

## 仍然存在的限制（不能计为精确等价）

- legacy `change_volume_or_rate` 只拒绝 NaN，因此接受 Infinity；现有 VM `_2` 的 change 路径拒绝非有限数。本 hook 未新增 VM 指令，故未修复这一差异，也未加入会假称通过的 Infinity 等价测试。
- 官方旧入口按资源 ID 直接检查；现有 VM/backend 的选择器对名称、数字索引、`all` 有更宽容的处理。hook 保留参数类型和值，但不引入全新的“仅 ID”执行模式，不能声称这些异常输入已逐项对齐。
- 官方 `play_audio` 可以显式传入 `lock`、`improvise`、callback/parameter 等内部参数；本次仅覆盖通常积木保存的播放/等待语义，不实现临时 URL 播放或回调协议。
- 静态证据中属性更新先检查资源存在；现有 VM 仍可能对不存在的 ID 输出属性命令，再由资源层/backend 忽略。没有把缺失资源的命令轨迹说成完全一致。
- `stop_all_audios` 的微信录音分支不由普通资源全停命令实现；多线程锁释放顺序、Howler 加载/停止竞态和实际音质/音量未在本次官方实机验证。
- headless 不发声；未知时长有限完成是已有降级策略，不是官方播放时长。browser audio 命令测试也不等于真实扬声器播放测试。
- 本次不新增 TTS、语音识别、麦克风检测或 MIDI 支持；不根据名称返回占位值伪装实现。
