# K4 第九轮：shake 时钟原点的扩大负例（仍 partial）

## 结论

本专项新增**显式shake专用时钟原点接口，不升级self_shake**。第八轮确定性0ms原点仍是默认策略；
不是官方任意墙钟原点等价性的证明。新增只读官方证据用第八轮原创`.14/.23/.4`秒和串联夹具，
对照原点 **0、0.1、1024、1000000ms**，每件40 update，共 **640个官方update**。
原始变量和x/y全部保存，不用最终归位相同代替逐帧一致。

实测不仅首步受严格浮点比较影响：

- `.14s`：0/1000000ms原点在第5帧开始移动；0.1/1024ms在第4帧。
- `.4s`：0ms第26帧phase=2，1000000ms同帧仍phase=1、第27帧才续接。
- 串联`.14→.23`：0.1ms与1024ms初段相同，第二段仍可能分叉；不能按“起步早/晚”
  把原点简单分两类并保证后续等价。
- 所有记录仍验证脚本观测sampleX/Y等于上一update帧尾位置；task帧尾相位保持不变。

## 来源与工具

只读外部文件 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
JS字符串0-based UTF-16 offset（非byte）：

| 定位 | offset | 观察 |
| --- | ---: | --- |
| `Tn6a/self_shake` | 588138 | 严格归一化阈值与相对纠偏 |
| `K9+f/task_update` | 416754 | 毫秒时间相减/除lifetime，结束比较 |
| `VPQ7/ClockImpl` | 705322 | clear后首个now/update从wall clock确定原点，后续累加ms delta |

`tools/compat/k4-shake-9-evidence.mjs`只把Clock的`_wall_clock_now`设为明确输入原点，
沿用oracle原有60Hz/seed1；不替换task、block或调度器。`docs/kitten4-shake-9-evidence.json`
含四件原创夹具hash、资源hash、每update typed变量/x/y，errors/pageErrors均空、externalAllowed=0。
完整官方输出在忽略的 `dist/shake-9/`。第八轮历史JSON保持原样。

## 显式原点适配与双VM回归

同一原点下的跨内核差分通过**显式可配置**的shake专用Clock原点实现，
默认仍0，没有写死1024或加epsilon，不改变全局时间或其他动画：

1. `src/engine/k4_shake.rs` 的Clock保存配置origin和Option当前时间；首tick采用origin，
   之后保持现有`dt*1000`累计。`reset()`只清当前时间、保留origin。
2. `src/engine.rs`提供有限值检查的`set_k4_shake_clock_origin_ms`委托，start时用reset，
   不在活动shake中静默重置；CLI/宿主若暴露需另行定义调用时机。
3. `tests/kitten4_shake_9.rs` 对四原点全部640帧typed变量/位置分别用默认JIT/解释器验证，
   两者共1280帧均一致，再重启各重放一次验证配置保留；第八轮默认0回归也通过。
   原点配置只改善受控同输入差分，**不能**证明真实浏览器墙钟与离线VM天然等价。

API拒绝非有限原点，以及当前Clock已推进后的重配置；调用方必须在首个update前设置。
它对齐受控输入，证明这些负例来自原点参与浮点算术，而非运动/续接规则不同。
暂停/取消、删除、非60Hz、多shake并发、物理刚体、pen和设备事件仍未验证。

## 已运行与复现

```powershell
Get-Process jit-corpus,perf-bench -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-shake-9-evidence.mjs
node --test tests/k4-shake-9.test.mjs tests/k4-shake-8.test.mjs
cargo test --test kitten4_shake_9 --test kitten4_shake_8
```

640官方update、Node断言及上述双VM Rust回归通过；最终全库门禁见OC-REPORT.md。
