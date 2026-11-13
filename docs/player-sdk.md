# 播放器后端 SDK（`nekoc::player`）

浏览器播放器（`web/player.js`、`web/play.js`）把作品交给 Rust 后端运行，每帧把输入发过去、
拿回一帧绘制数据。`nekoc::player` 是这个后端与传输方式无关的实现：`web` 二进制的
WebSocket（`/api/player`、`/api/player-private`）和 HTTP（`/api/start`、`/api/frame`）
接口都只是它的薄包装。想把 NekoC 播放器接到别的宿主上（桌面壳、stdio 子进程、
自己的服务器、无头测试），用这个模块即可，不需要复制 `web.rs` 里的逻辑。

运行示例：

```bash
cargo run --release --example headless_player -- samples/native-studio.bcmkn 120
```

## 会话流程

```text
客户端                                  宿主（Player）
  │── 握手文本：作品 JSON 或扩展握手 ──▶ Handshake::parse → Player::load_with
  │◀── {"ready":true,"stats":…} ─────────  player.ready_message()
  │── 帧请求 JSON ─────────────────────▶ player.handle(text)
  │◀── 二进制帧 ────────────────────────  Reply::Binary
  │── {"debug_snapshot":true} ─────────▶
  │◀── {"snapshot":…} ──────────────────  Reply::Text
  │   …
  ╳ 任一步出错：发 error_message(&err)（{"error":"…"}）后关闭会话
```

每个会话持有自己的 `Player`，会话之间不共享运行时状态。宿主自己已经有作品快照时
（例如 `/api/player` 用编辑器当前作品），跳过握手消息，直接 `Handshake::new(project)`。

## Rust API

```rust
use nekoc::player::{FrameInput, Handshake, InputEvent, Player, Reply};

// 1. 导入：.bcmkn / Kitten4 .bcm → 规范 KN JSON（附导入报告）
let (project, _report) = nekoc::player::import(nekoc::project::load_project(path)?.value)?;

// 2. 编译并开始运行；setup 在作品开始前调用，可以接云变量后端等宿主能力
let mut player = Player::load_with(Handshake::new(project), |engine| {
    // engine.set_cloud_backend(…)
    Ok(())
})?;

// 3a. 线上协议：宿主只搬运消息
match player.handle(&text)? {
    Reply::Binary(frame) => { /* 发给客户端 */ }
    Reply::Text(text) => { /* 发给客户端 */ }
}

// 3b. 进程内嵌入：直接用类型化输入，拿未编码的帧
let frame = player.step(&FrameInput {
    mouse: Some((0.0, 0.0)),
    events: vec![InputEvent::Key { key: "32".into(), down: true }],
    ..Default::default()
})?;
println!("{:?}", frame.logs);
player.recycle(frame); // 复用画笔线段缓冲区
```

| 入口 | 用途 |
| --- | --- |
| `import(json)` | 把用户文件转成可运行的规范 KN JSON，返回 `(作品, 报告)` |
| `check_project_shape(&value)` | 运行前的结构检查（`load` 已自动调用） |
| `Handshake::parse / from_json / new / with_extensions` | 握手消息 ↔ 作品与扩展积木 |
| `Player::load / load_with` | 检查、协商扩展、编译、开始运行 |
| `Player::start(program, setup)` | 宿主自己编译好 `Program` 时使用 |
| `Player::handle(text)` | 处理握手后的任意一条文本消息 |
| `Player::frame_json / frame / step` | 推进一帧：线上 JSON / 类型化输入 → 编码帧 / 未编码帧 |
| `Player::engine / engine_mut` | 读变量、调试等，直接访问 `Engine` |
| `decode_frame(bytes)` | 拆开二进制帧（测试、非浏览器客户端用） |
| `error_message(&err)` | 出错时发给客户端的 JSON 文本 |

常量：`PROTOCOL_VERSION`（`/api/health` 报告的版本，目前为 2）、`MAX_PROJECT_BYTES`
（握手上限 64 MiB）、`MAX_FRAME_REQUEST_BYTES`（帧请求上限 32 MiB）。宿主在传输层
负责执行这两个上限。

`Player` 总是以浏览器音频模式运行：声音、朗读、设备输出都放进帧里交给客户端，后端
自己不出声。

## 握手

直接发作品 JSON；需要远程扩展积木时发：

```json
{
  "nekoc_extension_handshake": 1,
  "project": { "...": "规范 KN JSON" },
  "extensions": [ { "api_version": 2, "opcode": "demo.double", "...": "BlockSchema" } ],
  "extension_api_versions": [2, 1]
}
```

- 没有 `extension_api_versions` 的旧客户端按 `[1]` 处理。
- 最多 256 个扩展、16 个版本号；任一 schema 的 `api_version` 不能高于协商结果。
- 协商到 v2 时，扩展调用错误按「报告」策略处理。
- 线上数据不能打开网络权限。Schema 格式见 [extensions.md](extensions.md)。

ready 消息里的 `extension_api_version` 是协商结果，没有扩展握手时为 `null`。

## 帧请求

所有字段都可省略。类型不对的单个字段或事件会被忽略，与旧后端一致。只有三种情况
会让整个请求出错：麦克风状态非法、扩展结果缺 `value`、扩展事件缺 `opcode` 或
`value`。请求先整体解析再应用，出错时这一帧的输入一个都不生效，运行时也不推进。

| 字段 | 说明 |
| --- | --- |
| `dt` | 距上一帧的秒数，默认 1/60；运行时夹在 0..=0.25，非有限值报错 |
| `budget_ms` | 本帧执行预算，默认 4，夹在 1..=16 |
| `coalesce` | `true` 时，没有可见变化的拍在同一帧里继续跑（最多 16 拍）；非官方行为 |
| `mouse` | `{x, y}`，舞台坐标，y 向上 |
| `pressed` | 当前按住的全部键（keyCode 字符串），最多 256 个 |
| `keys` | 本帧按下的键（旧接口），最多 64 个 |
| `costumes` | `[{id, width, height, centerPoint?, mask_width?, mask_height?, mask?, rgb?}]`：解码后发一次。`mask` 是 base64 的 1 bit/格遮罩，`rgb` 是每格 3 字节，最多 4096 个 |
| `videos` | `[{id, duration, width?, height?}]`，最多 4096 个 |
| `utc_offset` | 本地时区相对 UTC 的分钟数 |
| `kn_microphone` | `{status:"ready", value}` / `{status:"pending"}` / `{status:"denied"\|"unavailable"}` |
| `events` | 按顺序处理的离散事件，最多 256 个，见下表 |
| `debug_snapshot` | `true` 时不推进，回 `{"snapshot":…}` |

| `kind` | 字段 |
| --- | --- |
| `key` | `key`（keyCode 字符串）、`down` |
| `pointer` | `state`、`x`、`y`、`target?` |
| `drag` | `target`、`x`、`y` |
| `swipe` | `direction` |
| `answer` | `id`、`text?`、`choice?` |
| `stage_dialog_click` | `id` |
| `ranking_close` | — |
| `audio_done` | `id` |
| `extension_result` | `id`，`value` 或 `error` |
| `extension_event` | `opcode`、`value` |
| `device_motion` | `x`、`y`、`z` |
| `device_orientation` | `beta`、`gamma`、`portrait` |
| `device_event` | `action`、`device`、`value` |
| `mobile_button` | `device`、`event`、`button` |

输入按固定顺序交给引擎：麦克风、按住的键、按键、造型、视频、时区、鼠标、事件。

## 二进制帧

```text
u32 LE  元数据长度 N（N 是 4 的倍数，JSON 尾部用空格补齐）
N 字节  JSON 元数据（engine::Frame：sequence、sprites、logs、audio_commands、order、scene…）
余下    f32 LE 画笔线段数据（engine::Frame::lines）
```

`decode_frame` 返回 `(元数据 JSON, 线段 Vec<f32>)`。元数据字段与 `web/renderer.js`
消费的格式一致；新增字段只追加，不改已有字段的含义。
