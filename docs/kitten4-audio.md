# K4 音频专项取证与实现边界

本页只记录指定离线播放器的静态源码证据、原创夹具和 NekoC 的音频事件边界。官方身份限定为：

`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig`

SHA-256 为 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
下列偏移均为 UTF-16 code unit 偏移，不是字节偏移；未复制官方 bundle。

## 官方源码锚点

主包 webpack module `xQfl` 起点为 `1743488`。关键位置如下：

| 项目 | 偏移 | 已确认行为 |
| --- | ---: | --- |
| 播放 helper `f` | 1768168 | 普通播放非阻塞；等待播放用实体/解释器 thread lock；end、stop、error 都释放等待 |
| 资源解析 `g` | 1769978 | 数字按 `Math.round` 的 1-based 顺序；字符串按 UUID/名称；`all` 枚举资源 |
| `play_audio_2` | 1770415 | 解析后播放第一项，lock 由上层参数决定 |
| `play_audio_and_wait_2` | 1770671 | 固定 `lock=true`，等待当前声音结束或被停止 |
| `stop_audio_2` | 1770926 | 单资源停止；`all` 停止全部声音并清理已登记等待锁 |
| `set_volume_or_rate_2` | 1774166 | 只接受 number 且非 NaN；百分数除以 100 后设置 |
| `change_volume_or_rate_2` | 1774466 | 只接受有限 number；按增加/减少字段改变资源属性 |
| MIDI beats 转秒 `mt` | 1765926 | `60 * beats / 80`，即 80 BPM、每拍 0.75 秒 |
| MIDI 播放 `bt` | 1766068 | 钢琴键名 `A0..C8` 由 0-based key 选择；以临时 Howl 播放并按时长 fade |
| `midi_play_note` | 1771799 | `parseInt(note)`；beats 为正有限 number 才建立 blocking task |
| `midi_play_num_note` | 1772052 | 数字先 `Math.round`，0..100 后钳制到 1..88 再转 0..87；MIDI 对象 id 直接透传 |
| 资源钳制 `It` | 1776372 | volume 为 `[0,1]`，rate 为 `[0.05,4]` |

vendor Howler `HlzF` 的 `Howl.play` 位于 `48170`，`_inactiveSound` 位于 `60451`。它允许同一 Howl 拥有多个 active sound；因此同资源重播不是必然重启旧 voice。`Howl.stop` 位于 `51877`，会清理对应结束 timer。

## NekoC 事件边界

- 引擎继续以 `audio_commands` 表达普通资源声音；资源 volume/rate 是共享属性，正在播放和后续播放都收到同一资源的更新。
- `play_audio_and_wait` 在 headless 模式按已知资源时长和资源速率推进确定性时钟；浏览器模式只接受真实 `audio_done`，stop 会释放对应等待。
- `Frame.k4_media` 是 K4 设备输出的 additive 增量字段。MIDI 输出包含 `key`、`beats`、`seconds` 和 `fade_seconds`；旧的 `take_k4_media_output()` 宿主 API 同时保留。
- `web/audio.js` 消费 MIDI 事件时创建独立 oscillator/gain voice，频率按 `27.5 * 2^(key/12)` 映射 A0 起点。它是本地无资源音源的播放器实现，不宣称与官方钢琴 MP3 的音色或声学波形相同。
- Web 播放的资源 voice 仍按资源 ID 复用空闲实例；属性更新按 `voice.id` 检查，避免重叠实例的键名（例如 `tone#1`）误创建额外 voice。
- legacy `change_volume_or_rate` 与 `_2` 分开：旧入口接受正负 Infinity 后在资源处钳制，`_2` 的 change 忽略非有限 number。输出使用有限饱和增量保留符号，避免 JSON 非有限值丢失或把负无限增量误当零。
- `use_browser_audio()` 同时启用 frame-only 媒体输出，避免未调用旧 take API 的 Web 宿主重复积累输出。原生宿主默认仍使用旧队列；两种队列均保留 1024 上限，浏览器 MIDI 同时 voice 上限为 128。

## 原创回归与未验证项

已覆盖：

- volume `[0,1]`、rate `[0.05,4]` 的引擎属性路径及动态速率等待；
- 同资源重播、逆序结束、资源级属性共享、stop/replay 的旧回调隔离；
- MIDI 数字键边界、MIDI 对象 id、80 BPM 时长、解释器/JIT 路径和 `Frame.k4_media` 传递；
- Web 音频 voice 复用、错误/结束回调隔离以及 MIDI WebAudio 事件参数。

这些测试不是官方实现的替代物。以下明确未验证：

1. 官方 Howler 事件桩下同一 update 内 `stop_all_audios` 与自然 end 的竞态顺序；
2. 非有限值在真实 Howler setter 内部的最终状态、加载中停止和音频资源错误回调；
3. MIDI MP3 的网络/本地加载失败、Howler fade 与 blocking task 的相对顺序；
4. 官方音频的波形、音色、扬声器听感及其他播放器版本；
5. 克隆/跨实体并发等待的全部边界。

## 覆盖决定与复现

`play_audio`、`play_audio_and_wait`、`stop_all_audios`、`set_volume_or_rate`、`change_volume_or_rate` 的资源级主路径升级为 `offline-oracle-verified`。这仅对应本页固定官方包、原创输入及诊断时钟；不是声学、任意自定义内部参数或所有加载竞态的认证。`midi_play_note`、`midi_play_num_note` 仍为 `partial`，不能用本地 oscillator 替代官方 MP3 加载与 fade 竞态证据。

`tools/compat/k4-audio-timeline.mjs` 生成八件原创夹具：properties、overlap、natural、stop-waits、stop-overlap、midi-note、midi-number、midi-invalid。每件记录 18 个官方 update（合计 144），全部逐帧变量与 NekoC 一致；事件记录同时保留官方属性 setters、play、stop、MIDI load。只控制 WebAudio `currentTime` 和 Howler 定时器，不替换官方 domain、声音池或回调逻辑；MIDI MP3 外部请求被阻止，因此 MIDI 的变量时长对照不证明成功发声。证据绑定夹具 hash、官方资源 hash、page errors 与外部允许请求数。

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
node tools/compat/k4-audio-timeline.mjs --record
node --test tests/k4-audio-timeline.test.mjs tests/k4-audio-web.test.mjs tests/project-audio.test.mjs
cargo test --test kitten4_audio_timeline --test kitten4_audio_aliases --test kitten4_media_devices
```

默认 JS 测试校验原创夹具与官方证据身份；Rust 在解释器/JIT 两路重放全部 144 帧，不只信任记录中的 `variablesEqual` 标志。Web host 使用合成 Audio/WebAudio 测试，真实 HTMLAudio 测试需要显式启用环境变量，默认跳过，不计作真实设备认证。

本专项没有移植 HateNeko 逻辑，也没有复制第三方作品或官方内核文件。
