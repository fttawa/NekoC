# KN 本地音量与角色代码 API 别名

## 接口与边界

`get_sprite_property` 是官方代码 API，不是官方注册积木。本地规范 JSON 接受同名别名，按官方完整代码转换路径映射到原有 reporter（本轮现场证据见 `kn-remaining-official.md` 的 API 转换表）：

| attribute | 原生积木 / 字段 |
| --- | --- |
| x / y | coordinate_of_sprite / coordinate |
| style_index | style_of_sprite |
| scale / width / height / direction | appearance_of_sprite / appearance |
| color / opacity / brightness / pixelate / ripple / distortion / grayscale | effect_of_sprite / effect=0..6（按此顺序） |
| 0..6 | effect_of_sprite / effect（保留规范 JSON 数字兼容） |
| distance | distance_to |

`camp`、`clone_index`、`size`、`style`、`visible`、`alpha` 及未知项仍拒绝。别名复用原属性路径，不单独实现另一套 rounding 或目标解析。`procedures_2_actor_param` 支持 camp 不意味着代码别名也支持。

`get_voice_volume` 使用宿主状态：`Engine::set_kn_voice_volume(Some(n))` 接受已归一化的有限 0..100 并标记 resolved；`set_kn_voice_volume(None)` 显式完成 record-disabled NaN。`set_kn_voice_pending()` 清空采样并标记 unresolved，默认状态亦 unresolved。浏览器在真正开始播放、且项目数据含该 reporter 时才申请麦克风，不在导入/静态页面加载时申请。`PlayerConnection` 通过现有宿主帧协议的 `kn_microphone: {status,value}` 输入发送状态；并未放宽扩展 JSON 类型或加载项目指定脚本。

**异步等待：**官方普通默认调用返回 Promise，本轮观察 3000ms 仍 pending，不能将默认状态认定为 NaN。`src/engine/kn_await.rs` 已接入子表达式级 lowering：先检查 `kn_voice_resolved()`，未完成时阻塞当前线程；完成后保存本次读数，下一 update 才恢复后续表达式。浏览器 `pending` snapshot 保持 null，调用 `set_kn_voice_pending()`；`ready` 送入实际数字；最终 `denied` / `unavailable` snapshot 为 0，调用 `set_kn_voice_volume(Some(0.0))`。官方 NotAllowedError 已实测域 Promise 兑现 0；无 API、NotFoundError/no-device 的 0 降级依据源码错误分支及本地宿主策略，实际无设备仍未官方实测，不标成实测兼容。record-disabled NaN 是独立前置分支，不与设备失败混淆。重启清空旧值，关闭播放器释放 tracks 和 AudioContext；getUserMedia 迟到成功也必须立即 stop。

**调度限制：**宿主层提供最新浏览器采样快照，VM 每次 reporter 单独保存快照并跨 update 恢复。它不是完整 JS Promise 队列，不认证任意线程锁/自制 reporter 过程交织，也不复刻官方权限 UI、移动端或桌面客户端分支。详细范围见 [kn-remaining.md](kn-remaining.md)。

## 官方来源

仅官方 KN 0.27.4；未使用或移植 HateNeko。已有身份与现场调用见 `kn-panel-capture.md`、`kn-appearance-dialog.md`，本轮实测代理证据见 `kn-remaining-official-evidence.json`。

- 主 bundle `https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`，5594327 bytes，SHA-256 `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`。
- 官方 worklet `https://kn.codemao.cn/worklet/volumeMeter.js`，804 bytes，SHA-256 `28caabe53694965f72d90e2e24e5ea0b2a00957f0c04a8359462b25dac2da593`（本轮直接读取核对；未把第三方函数体入库）。
- 主 bundle UTF-8 零基字节：1578772 recordEnable 前置分支；1730576 桌面归一化；1810109 legacy analyser；1810516 AudioWorklet；2797372 代码别名插件。主 bundle 为 ASCII 转义文本，这些偏移与 JS 字符索引相等。

现代浏览器算法：每个输入 quantum 的第一声道 `100 * sqrt(sum(sample²)/length)`，包络取 `max(currentRMS, previous*0.8)`，按 25ms 累积帧数发布（首量子即发布）。普通浏览器 reporter 再 `round(clamp(raw/70*100,0,100))`。本实现不复制 samples 消息（只需要音量）。旧版官方 analyser fallback（fftSize=1024、smoothing=.5、频谱平均值）未实现；缺 AudioWorklet 时明确 unavailable，不假称同算法。移动端 85 / iOS 40..95 与桌面客户端 30 阈值不适用于普通 Web 宿主。

## 回归

```powershell
node --test tests/kn-microphone.test.mjs tests/extensions.test.mjs
# Rust 由主会话统一运行：
cargo test --test kn_local --test kn_appearance_dialog --test kn_panel_services --test kn_offline_services
```

JS 专项含实际生成的 AudioWorklet 源在隔离 JS VM 中执行、RMS/衰减/发布频率、归一化、权限拒绝兑现 0、无 API 的 0 降级、pending null、迟到设备关闭、资源清理、扩展打包路径、PlayerConnection 音量宿主帧、现有扩展握手回归。Rust 包含解释器与 JIT-enabled 场景、属性别名成对比对、七个英文特效名与数字/原生 reporter 非零值三方比对、类型、默认 pending 无日志、显式 disabled NaN、实时更新、重启清空及输入验证；结果见根目录未提交报告。本地采样算法未申请真实设备权限，未声称真人录音或端到端音频差分。

## engine.rs 接线

1. `mod kn_local;`
2. `ExprOp::KnVoiceVolume` 无参 variant。
3. Engine 字段 `kn_local: kn_local::State`，new 初始化 default，start 重置 default。
4. expression_one：KN guard 下 get_voice_volume → KnVoiceVolume；get_sprite_property → self.kn_sprite_property(b)?。
5. node_slow：KnVoiceVolume → self.kn_voice_volume()。
6. `kn_await` 为每次读数生成 `KnAwaitVoice`、task-local 保存和 yield，默认无宿主不会直接读到 NaN。

无新 ValueExpr，既有 value→numeric fallback 可复用。按 KnProperty 同类策略退回解释器，不宣称新增 native 编译能力。`src/bin/web.rs` 的帧输入和静态资源路径、`tools/build-extension.mjs` 的打包模块已接。
