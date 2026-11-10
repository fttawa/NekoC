# 声音：官方语义证据与运行边界

本文区分 **官方 bundle 的静态证据** 与 **NekoC 的实现/降级策略**。核查日期：2026-11-10。可复核的文件 SHA256、字节数、webpack module ID 和 UTF-16 偏移见 [`audio-evidence.json`](audio-evidence.json)。偏移从 UTF-8 解码所得 JavaScript 字符串的第 0 个 UTF-16 code unit 起算，不是文件字节偏移。

本次只读分析 K4 播放器原始 `.orig`、其 vendor bundle，以及指定的 KN 官方资源语料；未使用 HateNeko 作为官方证据，未向仓库复制任何第三方实现或源码片段。第 1、2 节“已确认”指静态调用链成立；第 4 节另外列出最小官方实测，不推广为全部行为已验证。

## 1. K4：资源共享属性，独立播放位置

### 积木入口与等待

K4 原始播放器的声音实现位于 webpack module **`xQfl`**，不是根据整个文件中同名压缩变量推断依赖。

| 入口/辅助函数 | UTF-16 偏移 | 结论 |
| --- | ---: | --- |
| `play_audio_2` | 1770415 | 解析声音后以非阻塞方式交给 helper `f`；也接收显式 `lock` 参数 |
| `play_audio_and_wait_2` | 1770671 | 强制 `lock=true`，等待当前声音播放的回调 |
| helper `f` | 1768168 | 等待时取得 entity/interpreter 的 thread lock，正常结束、停止、错误路径释放 lock |
| `stop_audio_2` | 1770926 | 单资源停止；`all` 有额外锁清理分支，不能简单认为每种组合都完全等同无参全局停止 |
| `g`（声音解析） | 1769978 | 数字按 `Math.round` 后的 1-based 顺序；字符串按资源 ID/名称查找；`all` 枚举全部资源 |

`f` 的普通资源播放进入 `AudioPlayer.play`（1762174），PC 分支以资源 ID 取得共享 Howl，然后调用无 play-ID 参数的 `Howl.play()`。自然结束监听绑定返回的 play ID；停止监听则注册在共享 Howl 上。**另一线程再播放同资源，不会先显式停止或倒回之前的播放。** vendor module `HlzF` 中的 `play` 与 `_inactiveSound` 进一步证明：已经播放中的声音不作为空闲 voice，必要时创建新 Sound，因而允许重叠。暂停后恢复等特殊分支不应概括为“所有 `play()` 都必定新建”。

普通、等待、停止回调的真实调度顺序仍受 Howler 的事件分发和 K4 thread lock 调度影响；本次未运行官方多线程听音/事件用例。缺失资源在积木入口会被跳过；资源已存在但未加载完的 PC 分支还可能提前调用完成回调，这不等于“官方以估计秒数等待”。

### 音量、速率和初始重置

`set_volume_or_rate_2`（1774166）与 `change_volume_or_rate_2`（1774466）按所选**资源**调用 `set_volume` / `set_rate`：

- 积木百分数除以 100 后转换为内部数值；增加/减少也是百分数点增量，不是当前值的百分比。
- `It`（1776372）把 volume 限制到 **`[0, 1]`**，rate 限制到 **`[0.05, 4]`**。
- `_2` 的 set 路径拒绝非 number 和 NaN，但未显式拒绝 Infinity；change 路径显式要求有限数。不要声称两者官方非有限值验证完全一致。
- `set_volume` / `set_rate` 找到资源对应的 Howl，不带 actor ID，也不带具体 play ID。Howler 的资源级 setter 更新共享默认值和该 Howl 下的 Sound。因此**同资源的当前重叠播放与后续播放共享音量/速率设置**。
- `reset_sound`（1764668）把项目 `audio_state` 中每项的 `volume`、`playback_rate` 恢复到相应资源。`vxpV` module 的运行清理函数 `pt` 调用它（1727695）；开始流程也先进入清理函数，故不是“每个播放请求重置一次”。
- K4 PC 的 WebAudio playbackRate 会同时影响时长与音高；浏览器后端设置 `preservesPitch=false` 是对这一点的近似承接，不构成跨浏览器声学一致性保证。

**没有找到 K4“克隆独立音量”的官方依据，且当前调用链与这种说法冲突。** 可独立的是每次播放的位置/完成通知，不是同资源在不同克隆中的音量槽。

## 2. KN：普通资源播放与全局 TTS 配置是两条路径

### 从 module 起点解析依赖

`getAudioDomainFunctions` 位于 module **46501**（入口偏移 1634555）。在该 module 的作用域内：

- `w` 指向 **73968**，导出 `B0` 音频 wrapper；wrapper 将 `play`、`stop`、`stopAll` 转发到初始化时注入的 core。
- `Qe` 指向 **47693**，定义 `PLAY_ING=0`、`PLAY_END=1`、`PLAY_FAIL=2`、`PLAY_TIMEOUT=3`。
- `le` 指向 **90667**（中间存在一个逗号表达式依赖，不能用别的 module 中的 `le` 代替）。该 module 的导出 **`si` 对应字符串 `all_audio`**。
- `We` 指向 **50865**，是全局 TTS config singleton，不是普通资源播放器的音量对象。

### 普通播放、重播、停止

普通 `playAudio` / `playAudioAndWait` 只向 wrapper 传资源 ID、URL、进度/超时选项和回调，**没有普通声音音量/速率参数**。等待版取得 thread lock，在匹配资源 ID 的 `PLAY_END`、`PLAY_FAIL`、`PLAY_TIMEOUT` 上解除等待，并注册线程停止清理。

KN Web core 不是 module 73968 本身。初始化链在 **module 17028** 中，选择本地 `aw` Web core 或 `ow` native bridge core：

1. Web core `aw.addAudio` 每次构造一个新 Howl，加入按资源 ID 保存的 `howls` 数组。
2. `play` 没有先调用 stop 或 seek-to-zero；它在加入新 Howl 后遍历已有 Howl 并调用 play。结合官方 vendor **module 1845** 的 Howler 行为，可确认 **Web 分支支持同资源重叠，不是强制 restart 旧播放**。它也可能再次触发旧 Howl 的新 voice，不能宣称“严格每个积木正好一个物理声源”。
3. 存在 `howls.length > 10` 时拒绝后续请求的保护；这也不是 NekoC 任意数量重叠的精确等价实现。
4. `onend` 回报 `PLAY_END` / progress `1`；`onstop` 同样回报 **`PLAY_END`**，但 progress `0`。因此等待积木可以由停止解除，不应只监听自然结束。
5. core 的结束/停止处理会删除资源 ID 下的注册项；同资源多实例的注册表清理、加载期间 stop、stopAll 与事件回调交错仍有边缘行为，未在官方实机验证。不要把静态可见的重叠能力写成所有竞态都已对齐。
6. native core `ow` 只转发到宿主 `audio.play/stop/stopAll`；宿主实际 restart/overlap 与停止通知语义 **未验证**，不能从 Web core 推广到所有 KN 平台。

`stopAudio` 在 domain 内严格比较 `le.si` 后调用 `stopAll`，所以 KN 官方“全部声音”的真实 token 是 **`all_audio`**。K4 的 `all` 与实现曾使用的 `--all--` 不能替代这条证据；本次已补齐官方 KN 全停输入和回归测试。

### `soundColor` 只配置 TTS

`soundColor`（1638460）从当前积木或序列化 mutation 读取：

- 字段 `sound_color_per`（发音人/音色 ID）；
- mutation 属性 `sound_color_speed`、`sound_color_pitch`、`sound_color_volume`，缺省字符串均为 `10`。

随后转换成数字，调用 module 50865 的 singleton `setConfig`，存为 `per` / `spd` / `pit` / `vol`。**此配置不是 actor 或 clone 私有，也不是普通导入音频的音量。** 运行停止事件调用 `resetConfig`。

特别注意官方的两套数值域：module 50865 会把 `spd` / `pit` / `vol` 的原始 UI 数值先限制到 **`[5,20]` 再减 5**，得到服务端的 `[0,15]`；默认 config 仅显式包含 `vol:9`。因此“原始 mutation 中的 `10`”不等于“官方服务收到的 `10`”，也不等于“本地 speechSynthesis 的 1 倍”。`per` 不经过这个转换。

`playWordsAudio` / `playWordAudioWait` 把文本交给在线 `getTextAudio(..., "huoshan")`；ServiceApi 的 module **35296** 读取该全局 config，向 `/public-api/baidu-openapi/text2audio` 请求音频，再用资源播放通路播放返回的 URL。domain 还检查网络/登录状态；实际服务质量、发音人集合、模型、参数映射及鉴权结果未验证。

**没有发现 KN 普通声音积木提供克隆独立音量的官方证据。** 不应把 TTS 的 soundColor 或产品希望支持的“克隆独立音量”反向解释为现有官方普通声音语义。若要新增此能力，应标注为产品扩展，并另行规定与 K4 资源共享属性如何交互。

## 3. NekoC 代码现状与明确降级

以下描述本次实现；最终检查的原文摘要见 worktree 根目录未提交的 `OC-REPORT.md`。

### Headless / CLI：确定性时钟，不发声、不联网

- 新增的 `src/audio.rs` 保存资源级 volume/rate 和按播放 ID 区分的剩余时长；每次播放有自己的位置，修改资源 rate 影响该资源剩余时长的推进。
- 可计算时长来自显式 **`resource.duration`，单位约定为秒**，或内联 `data:audio/wav;base64,` 的 RIFF/WAVE 元数据（面向自有 PCM WAV fixture 的轻量读取，不是通用媒体解码器）。这里的秒数约定是 NekoC 接口行为，未由上述官方 bundle 独立证实为所有项目资源字段的格式约定。
- 不联网下载 MP3/AAC/远程 WAV，不通过文本长度伪造 TTS 时长，也不使用墙钟模拟媒体加载。
- 未知媒体/缺失资源的等待记录“时长未知”诊断后采用 **下一次 tick 有限完成** 的 headless fallback，避免永久挂起；这是降级策略，不是官方时长推断。可确定的 WAV/显式 duration 按真实秒数及动态 rate 等待，不是所有声音固定等待一帧。
- Web 模式不靠这个估时解除等待，而等待浏览器的具体完成 ID。headless TTS 不发声，当前直接继续执行；它不具有在线 TTS 等待时间语义。

### Web：每次播放独立 voice，属性按资源共享

- `web/audio.js` 的 `ProjectAudio` 为同时播放的请求提供不同 Audio voice（可复用已空闲 voice），不因同资源重播而完成旧 waiter。
- 资源 volume/rate 同步给该资源的现有 voice，也用于新 voice；不提供克隆私有资源音量。这与 K4 静态证据相符，不能说成 KN 普通积木的官方音量能力。
- 引擎通过 `audio_commands` / `speech_commands` 输出请求；等待使用请求 ID 与 `audio_finished`/Web `audio_done` 确认闭环。自然结束、显式停止、加载/播放错误需完成对应 waiter；旧运行的回调不得释放新运行的 waiter。
- 自动播放被浏览器 `NotAllowedError` 拒绝时，保留待播放请求，提示点击/按键解锁后重试，而不是谎报已经播放完成。暂停/继续应维持 voice 位置；停止/重启应清理旧 voice、等待项与属性缓存。
- 正在等待的线程被停止、删除克隆或离场时，输出该资源停止命令并清理等待；这采用官方 KN 的资源级 stop，因此会停止同资源的其他播放，不影响无关资源。
- 声音并发上限为 128；超限会明确提示并停止最早 voice、完成对应 waiter。空闲池仅保留每资源一个实例；语音等待队列也限制为 128。它是 NekoC 资源保护，不是官方 KN 数量保护的精确复制。
- 听音、后台标签页调度与平台音高处理不由 headless 确定性时钟保证。真实 Edge 回归使用 WebAudio analyser 检测非零 PCM，检查媒体时钟、暂停恢复、ended、损坏媒体恢复和真实 autoplay 拒绝/点击重试；不是扬声器听感或声学等价测试。

### 本地 TTS 不等于官方音色

浏览器 `speechSynthesis` 是显式离线降级：当前把 KN 原始 speed/pitch/volume 按本地规则映射，并尝试用本地 voices 数组索引选择 `per`。**本地 voice 顺序不对应官方发音人 ID，参数尺度也不是官方服务端 `[0,15]` 的等价变换**。系统语言、已安装音色、语音合成引擎和浏览器均会改变结果。

K4 bundle 自身也存在离线 speechSynthesis 分支（rate `0.8`、pitch `1`，按语言选择），但这不能证明本地 TTS 与 K4 在线语音或 KN 官方服务具备音色/音质/时长一致性。

## 4. 夹具、实测及复验

所有音频夹具都是 NekoC 自有 440Hz、100ms 单声道 PCM WAV，由 `tools/compat/audio-fixtures.mjs` 生成。没有复制语料或外部素材。

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo test --test audio
node tools/compat/audio-fixtures.mjs
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/editor-compat.mjs tests/fixtures/audio.bcmkn --channel msedge --out dist/audio-editor.json
$env:NEKOC_AUDIO_BROWSER='1'
node --test tests/project-audio.test.mjs tests/audio-browser.test.mjs
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
node tools/compat/audio-oracle.mjs
```

- KN 原创夹具于 2026-11-10 经官方 `main.8ccf2442.js` 编辑器加载检查：5 个积木，issues/pageErrors 均空，`ok=true`。此检查不是 KN 原生音频播放验证。
- K4 原创夹具实测见 [`audio-runtime-evidence.json`](audio-runtime-evidence.json)：官方第一 update 后 volume `.25`、rate `2`、duration `.1`、正在播放，`audio-after=0`；等待真实媒体时钟 300ms 后，下一个 update 已结束且 `audio-after=1`。该等待不伪装成 300ms 的 VM tick。
- Oracle 初次使用非 UUID 的资源 ID 时，官方解析器跳过了该声音；夹具改用资源名称后成功。因此官方 ID 查找限于 UUID 形态，NekoC 接受其他 ID 是宽容扩展；不能把跳过积木当作播放完成验证。
- Rust 覆盖 CLI 时长/动态速率/夹紧/零 dt 合帧、显式浏览器完成、全停、取消与重启旧回调，以及 TTS 命令配置。Node mock 覆盖资源顺序、重叠、属性、错误、队列上限和生命周期。

## 5. 未验证与已知限制

1. KN 官方全停 `all_audio` 已实现；保留 `all` / `--all--` 作为扩展别名，不能把别名当官方 KN token。
2. **克隆独立音量：** 当前无官方依据，K4 证据是资源共享。若需求坚持独立，应明确为新增行为而非兼容性已证明。
3. **KN Web 重叠的精确度：** 当前本地每次一个独立 voice 不是官方 core 重复遍历已有 Howl、数量保护、共享注册项清理等细节的逐行为复制。
4. native KN 音频宿主、官方在线 TTS、停止/加载竞态、多线程同资源等待释放顺序以及跨平台音高/音量听感尚未实测。普通浏览器 TTS 的实际音色和播报仍依赖系统语音服务；仅 mock 验证配置/等待/取消。
5. headless 未知时长有限 fallback、`duration` 单位约定及 WAV 支持范围必须与最终实现一致；不能以本次静态审计替代实现测试。
6. 未引入 HateNeko 逻辑，不存在需列出的移植文件。旧的 `src/runtime` 参考解释器仍不发声；真实播放和时长等待位于默认 fast VM/Web 链路，不声称桌面 studio 已支持音频。
