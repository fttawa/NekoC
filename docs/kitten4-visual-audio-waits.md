# 视觉诊断工具：实测音频时长传入 headless trace

## 修复范围

这是 [327790965 调查](kitten4-visual-animation-investigation.md) 的后续实现，
修的是离线视觉诊断工具缺少音频时长的边界，**不是改变正常 VM 的未知媒体降级行为**。

本任务独占 `src/bin/k4-trace.rs` 及新增夹具/测试。`k4-visual.mjs` 由主会话接线，
本任务没有编辑它；没有运行 Cargo 构建、测试或替换二进制。

### `k4-trace --audios <metadata.json>`

输入格式：

```json
[{"id":"resource-id","duration":15.018666666666666}]
```

- duration 是浏览器解码的**原始秒数**，不预先除以 playback_rate；VM 已按资源速率推进音频。
- 在 `kitten4::to_neko` 后、`Program::compile` 前，只写内存中的 canonical
  `audios.audiosDict[id].duration`。
- 不写回输入 `.bcm`，不改 `_nekocKitten4.source`。`--render` 的有效 canonical project
  和 `--lowered` 诊断会包括覆盖后的 duration，便于复现。
- 只接受已存在的音频 id、正有限数字；空 id、重复 id、未知 id、null、字符串、非正数均报错。
  空数组等同不覆盖。不会把未知值补成 120 秒。
- 不改变 `src/audio.rs`、Engine 的普通 audio wait 或 browser completion 机制。

## 官方已加载组件 getter

只读目录仍是：

```text
E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app
src/player/build/player_v2.2d180c468559fbd29528.js.orig
SHA-256 0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160
```

官方 JS 字符偏移（0 起始 UTF-16，不是字节）：

- `1743488`：webpack `xQfl` module，导出 `.a` 指向 `Nt`。
- `1776762`：`Nt.AudioPlayer` 指向 `ht`。
- `1765069`：`ht.get_howl(id)` 返回当前平台已经加载的 Howl，而非构造新的播放器。

在 `beforeStart` 用以下表达式读组件；不改 vendor 文件、不修改官方状态：

```js
const audios = await page.evaluate(() => {
  const req = window.__k4OracleRequire;
  const player = req("xQfl").a.AudioPlayer;
  const declared = req("ALsR").a.get_state().audio_state;
  return Object.values(declared || {}).map(audio => {
    const howl = player.get_howl(audio.id);
    const loaded = howl?.state() === "loaded";
    const duration = loaded ? howl.duration() : null;
    return {
      id: audio.id,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      loaded,
    };
  });
});
```

327790965 实跑读取到 `loaded=true, duration=15.018666666666666` 秒，
结果在 ignored 的 `dist/visual3-animation/audio-metadata.json`。
先前 120 秒仅用于调查因果干预，正式接口不使用该值。

工具已保存完整 `audio-metadata.json` 诊断，另筛出有效 `{id,duration}` 到 `audio-durations.json` 传入 CLI。
默认内置 trace 启用；自定义 `--nekoc` 为兼容旧二进制保持关闭，需要显式 `--audio-metadata`
（程序 API 为 `audioMetadata:true`）。不会靠未知参数失败后悄悄回退。
静态扫描 workspace/AST 的 `play_audio_and_wait`、`play_audio_and_wait_2`；有等待而无可用解码时长时记
`unverified`。若任一声明资源按保存速率可能在采样虚拟窗口内完成，同样保守 `unverified`，
不声称自然结束回调受虚拟 Date 控制。该保守扫描可能覆盖未执行的等待和无关音频，不是动态可达性证明。

## 原创夹具

`tools/compat/k4-audio-wait-fixtures.mjs` 仅使用仓库自制舞台、自绘红/绿矩形和
`audio-fixtures.mjs` 中原创正弦波，生成 `tests/fixtures/kitten4/audio-wait-restart.bcm`。
不读取语料，不含第三方媒体。

- 原创 100 ms PCM 拼为实长 2 秒 WAV，以合法 `data:audio/x-wav;base64,...` 提供。
- 该 MIME 可被官方浏览器解码，但不命中 headless 既有的窄 `data:audio/wav` 解析器，
  因而无 metadata 时稳定触发“未知 duration”的真实路径，无需网络资源。
- 资源初始 `playback_rate=.1`，因此 decoded duration 仍是 2 秒、实际播放约 20 秒；
  目的是让 60 update 和截图开销都处于自然结束前，**不声称验证音频结束的墙钟时刻**。
- 舞台：Start → 播放音频并等待 → restart。
- 角色：Start → 启动 timer → 红色水平造型 → 等到 timer ≥ .1 → 绿色竖直造型。
- 官方声音选择器优先识别 UUID 或名称，夹具按名称选择，避免非 UUID 自定义 id 被官方忽略。
- 像素集成首次发现 320×240 被该官方播放器归一化成 960×720，工具返回 size mismatch，未缩放截图掩盖；
  原创建具现使用原生 960×720 舞台和原创同尺寸白底，造型与控制流不变。
- timer 启动在官方还会显示计时器组件，本探针显式执行原生“隐藏计时器”积木，
  将音频等待/造型回归与尚未对齐的计时器组件隔离；没有修改官方页面或遮罩差异像素。

## 回归与状态

`tests/k4_trace_audios.rs`：

1. 无 metadata 60 帧触发 30 次 restart；加真实 2 秒 metadata 后不再提前 restart，
   第 7 帧起为绿色造型；JIT 开启/关闭配置分别测试。
2. `--render` 输出 canonical duration，但 provenance 与输入文件字节均不变。
3. `--lowered` 同样应用 metadata。
4. 非法格式、未知/重复 id、缺省/null/零/负/字符串 duration 拒绝；空数组保持原 trace。
5. 用独立合成的 .01 秒 metadata 检查现有 .1 playback_rate 仍正确生效，
   在第 7 update 完成，而非将等待永久挂住。该项是接口单元测试，不是实测音频声明。

`tests/k4-audio-wait.test.mjs`：

- 确定性重建夹具，检查 PCM 真实长度为 2 秒。
- 官方集成：Howl loaded、duration=2，60 帧无 restart、造型第 7 帧切换。
- 像素集成：使用已构建 exe（可用 `K4_TRACE_BIN` 指定，测试不运行 Cargo），
  新工具接线后帧 1/30/60 应为 0%（RGB 容差 8），并检查实测 metadata；
  完整 VM 造型由 trace 测试断言，不把 frame.sprites 增量误当完整状态。

已运行：

```powershell
node tools/compat/k4-audio-wait-fixtures.mjs
$env:K4_PLAYER_DIR='E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app'
$env:K4_ORACLE_INTEGRATION='1'
node --test tests/k4-audio-wait.test.mjs
rustfmt --check --edition 2024 src/bin/k4-trace.rs tests/k4_trace_audios.rs
```

结果：2 个 Node 测试通过，像素项按开关跳过；旧基线 exe 运行原创夹具，确认 30 次 restart。
新增 Rust 与既有 monitor 新文件的 rustfmt check 通过，源码 diff check 通过。

主会话统一执行：

```powershell
cargo test --test k4_trace_audios
$env:K4_VISUAL_INTEGRATION='1'
node --test tests/k4-audio-wait.test.mjs
# 再使用真实 measured metadata 单独复测 327790965，不重写整轮历史基线。
```

**后续已验证**：CLI 编译和全部4个 Rust 集成测试通过；Node 官方/像素3/3通过、无跳过，
原创音频探针实测 duration=2，固定帧1/30/60均0%超差（容差8），没有提前 restart。
普通工具测试及联合像素回归另由主会话统一执行。
**未验证**：音频自然结束回调与模拟时长在边界帧的精确一致性、媒体加载失败/重载竞态，
以及运行中改变播放速率/重叠播放对完成窗口的影响；静态检查仅使用保存的初始速率。
原始全语料批次 `after.json` 不含音频接口；补测必须另保留 provenance，不能覆盖历史数字。
