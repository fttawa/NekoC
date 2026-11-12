# HateNeko 41 件三方裁定

本页对应 `oc/hncompat2`，基线 `d2d277b`（`oc/integrate`）。官方裁判为在线
KN 0.27.4；HateNeko 0.4.0 / Love2D 11.5 只是第三方对照。
没有参考或移植 HateNeko 实现，没有改动作品或官方运行时。

> 后续整合复测：2026-11-12，`oc/scorecard` 基线`da8dc9c`，见[总评分卡](../scorecard.md)。
> 下文保留hncompat2原始dev观察、官方长程里程碑与原门禁身份；新轮为release短跑，
> 不把旧官方里程碑冒充本轮重新测量，不把观察相等当全作品/输入/音频兼容率。

## 最新integrate短跑复测（scorecard）

2026-11-12，测量提交`da8dc9c5c414a4b32c9239c33df437d6d8322cf1`，release/default JIT。
沿用精确历史41件manifest、逐输入SHA-256、12次update、无预热、一次双边独立进程；
HateNeko仍为0.4.0 / Love2D11.5。命令：

```powershell
node tools/bench/hateneko.mjs --compat-only --manifest docs/kncompat-hateneko-evidence.json --binary dist/bench/scorecard/bin/perf-bench.exe --normalize-private --out dist/bench/scorecard/compat41
# 空闲guard中断后同参数加 --resume
```

| 指标 | 本轮release复测 | hncompat2原轮dev观察 |
|---|---:|---:|
| NekoC运行成功 | 41/41 | 41/41 |
| H无报告错误／缺原语 | 40/41 | 40/41 |
| 原始最终观察投影相等 | 18/41 | 18/41 |
| 私有默认副本归一化后相等 | 18/41 | 18/41 |
| 双边运行但原始不等 | 22 | 22 |
| H unsupported | 1 | 1 |

相等项集合未变；未增加全局字段排除，不静默删除计时/RNG字段。
N固定二进制SHA-256为`d888cd791d26b7e3efebd8bc3975b126576f809cfb731e8da29fefa774d534ec`；
`binary_unchanged=true`、`reference.unchanged=true`。原始记录为
`dist/bench/scorecard/compat41/results.json`；本轮紧凑归档见[scorecard证据](../scorecard-evidence.json)。
外部Cargo/Clippy及k4effects11的jit-corpus触发guard后等待空窗续跑，没有关闭保护。

下文互斥裁定仍为既有官方证据约束的**18和H一致、20官方支持N、0本轮修复、3无法裁定**；
本轮仅重测短窗，不冒称重跑600update或595秒官方长程，也不将旧官方裁定扩展为全作品认证。
本轮完整门禁另见[总评分卡](../scorecard.md#本轮质量门禁)，下文门禁保持hncompat2原轮身份。

## 口径

- **原始一致**沿用原比较器的观察投影：全局带类型变量/列表、场景、角色多重集、
  角色私有变量；角色 heading 换算和动态克隆 id 去拼写差异仍与历史一致。
  它不是原始 JSON 字节相等，更不是像素、声音、任务轨迹或全程输入一致。
- **归一化一致**另列，绝不替换原始比较、抹掉运行错误或授予性能比。
  `--normalize-private` 仅去掉全局表中与作品声明默认值完全相同的冗余私有副本，
  且要求该原型的全部现存实例已经在实体表中导出对应变量；不覆盖实例当前值。
  因而私有变量值错误、跨实体污染、全局结果不同仍会失败。
- `--exclude-variables id1,id2` 仅从全局观察投影排除明确列出的 id，记录完整排除集，
  **不固定时钟、不修改运行时、不隐式忽略随机数**。即使排除后相等，也只证明剩余投影。
- 12 次各自宿主 update 不一定完成同等工作量，尤其 warp 切片、等待和墙钟读取。
  单个正确字段不升级为整个原作最终状态正确；无法配对的字段写明“未验证”。
- 新增 Rust 原作回归用 `use_virtual_clock()` 固定宿主时间和迭代切片以避免测试抖动，
  JIT开/关分别比较语义里程碑；这不是对官方墙钟逐帧切片的改写或等帧证明。
  真正 N/H 长程工具仍采用各自原有运行方式，单独记录600次update后的里程碑与残余差异。
- 汇总四类互斥：优先记录原始“和 H 一致”；不等项只有官方证据足以解释本次争议时
  才列“官方裁定 NekoC 正确”；本轮确认并修复的缺陷列“NekoC 已修复”；其余“无法裁定”。
  既有 kncompat 修复不冒充本轮新增修复。

## 复现

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
# 先用 Get-Process 检查 jit-corpus / perf-bench；本工具另有 cargo/rustc/Love 空闲保护。
cargo build --bins
New-Item -ItemType Directory -Force dist/bench/hncompat2-41/bin | Out-Null
Copy-Item target/debug/perf-bench.exe dist/bench/hncompat2-41/bin/perf-bench.exe
node tools/bench/hateneko.mjs --compat-only --manifest docs/kncompat-hateneko-evidence.json --binary dist/bench/hncompat2-41/bin/perf-bench.exe --normalize-private --out dist/bench/hncompat2-41
# guard 中断后仅以相同参数、二进制、作品 hash 续跑，加 --resume
node tools/bench/hateneko-evidence.mjs dist/bench/hncompat2-41/results.json docs/compatibility/hncompat2-hateneko-evidence.json
# 在同一批原始样本上重放投影（不会改写 results.json）
node tools/bench/hateneko-evidence.mjs dist/bench/hncompat2-41/results.json dist/bench/hncompat2-41/clock-only.json --normalize-private --exclude-variables kn-var-dt,kn-var-lastTime,kn-var-now
# 原作长程，默认仍是 12 次；必须显式指定 project-frames 才能突破短窗。
node tools/bench/hateneko.mjs --input projects/fangjie/fangjie.bcmkn --project-frames 600 --timeout 600000 --binary dist/bench/hncompat2-41/bin/perf-bench.exe --normalize-private --out dist/bench/hncompat2-long/fangjie-jit
node tools/bench/hateneko.mjs --input projects/tiny-lm/tiny_lm.bcmkn --project-frames 600 --timeout 600000 --binary dist/bench/hncompat2-41/bin/perf-bench.exe --normalize-private --out dist/bench/hncompat2-long/tiny-lm-jit
node tools/bench/hateneko.mjs --input tests/fixtures/actor-variables.bcmkn --project-frames 600 --timeout 600000 --binary dist/bench/hncompat2-41/bin/perf-bench.exe --normalize-private --out dist/bench/hncompat2-long/actor-jit
node tools/bench/hateneko.mjs --input tests/fixtures/actor-variables-deleted.bcmkn --project-frames 600 --timeout 600000 --binary dist/bench/hncompat2-41/bin/perf-bench.exe --normalize-private --out dist/bench/hncompat2-long/actor-deleted-jit
# 各命令同参数另加 --interpreter，--out 后缀改为 -interpreter，验证 JIT 关闭路径。
# 八次完成后从原始记录重算并归档；不等导致的退出1按上述口径保留。
$longResults = @(Get-ChildItem dist/bench/hncompat2-long -Filter results.json -Recurse | Sort-Object FullName | ForEach-Object FullName)
node tools/bench/hateneko-long-evidence.mjs @longResults
```

本轮使用 dev 无调试信息二进制做**行为观察**，不重新发布速度比、不替换历史 release 性能表。
完整输入 manifest / SHA-256、二进制 hash、只读 H 参考树前后指纹和失败均保留在证据中。
官方原始 bundle 仅留忽略目录，归档只含 hash、观察与必要定位信息。
当前基线默认遍历已是63件，使用 `--manifest` 明确锁定历史41件（不是从不等项中挑选），
逐件验证原字节 SHA-256。此前默认63件尝试遇竞争任务guard中断，仅留dist，不作为41件完成结果。
正式复跑二进制先由 `target/debug/perf-bench.exe` 复制到上述本地dist固定快照；
工具每次调用前和套件结束后均复核其hash，避免构建替换二进制而归错身份。

## 证据索引

| 标记 | 官方证据及适用范围 |
|---|---|
| T | [列表类型官方归档](../kn-value-types-official.json)、[说明](../kn-value-types.md)：原作 eisei/pencraft 类型及五份完整带类型小夹具；不代表原作所有坐标与帧轨迹 |
| S | [基础语义官方归档](../kn-semantics-official.json)：conversion 等；[对象官方归档](../kn-objects-official.json) / [源码定位](../kn-objects.md)：objects、object-json 完整探针变量 |
| C | [timer 官方说明](../kn-project-progress.md#timer-native-callback官方仍不执行-statement-body)：statement callback 不进入域调用、fired=0 |
| P | [既有原作进度](../kn-project-progress-official.json)、[说明](../kn-project-progress.md)：tiny-lm 自然 EOS、fangjie 既有完整原作超时和缩短诊断（不能替代原作终态） |
| O | [本轮39件官方观察](hncompat2-official.json)：逐件原始字节 SHA-256、官方样本、带类型变量及声明作用域；starhold timer 源码锚点。官方采样墙钟不冒充 benchmark 帧号 |
| L | [本轮原作长程官方观察](hncompat2-progress-official.json)：完整 fangjie 原作初始化里程碑及 tiny-lm 自然 EOS，完整大列表摘要 hash |

后续各节区分实际测得的终态和未完成观察，不把输入缺席的开场记录冒充音频、键盘、鼠标或服务集成的验证。

## 逐件裁定

本轮41项配对全部完成：NekoC **41/41** 无报告运行错误，H **40/41** 无报告错误/缺失原语，
剩余1项 `object-json` 明确 unsupported；原始一致 **18/41**，原始不一致22项，unsupported1项。
只做私有副本归一化仍 **18/41**，新增相等0项；actor 两项尚有 `cloneChanged` 差异，未洗白。
原始证据见 [hncompat2-hateneko-evidence.json](hncompat2-hateneko-evidence.json)。
NekoC 二进制 SHA-256 为 `6645f7100b3c4f6d48f567deef969c2012f09f22827640c5c0f044607726a386`，
原始结果 JSON SHA-256 为 `0059866a5971b134b7d62b12aeb31acae15ef5969d59541e3ee2b1fd37d38df3`；
7次 guard 中断后相同二进制/参数/输入hash续跑，参考树及固定二进制最终 `unchanged=true`。
仅排除3个时钟字段的同样本重放在 starhold 仍保留2个随机字段差异，整体仍18/41。
套件最终退出1是完整保留不等/unsupported的预期诊断，不是门禁测试失败。

下表“官方裁定”限定为列出的争议，不是任意输入下的兼容承诺。文件路径均相对仓库根。
“和 H 一致”只计本轮固定短窗原始观察投影，输入/音频等未覆盖路径仍在最后一列明示。

| # | 作品 | 原始 N/H | 归类 | 三方结论／局限 |
|---:|---|---|---|---|
| 1 | `projects/eisei/eisei_pen.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：数字文本保留；H 数值化不应反向修改 N；缺槽 NaN 已由既有修复处理 |
| 2 | `projects/eisei/eisei_pen_128.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：初始及复制后的数字文本保留；不证明像素相等 |
| 3 | `projects/eisei/eisei_pen_128_compact.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：同一声明类型规则，不能把文本按数字归一化 |
| 4 | `projects/eisei/eisei_pen_128_fixed.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：此原作官方直接观察 `ep_bank_color[0]="1"` |
| 5 | `projects/eisei/eisei_pen_128_full_rebuilt.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：文本/数值差异；输入缺槽修复已在基线 |
| 6 | `projects/eisei/eisei_pen_128_import_probe.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：三个初始列表元素仍为文本，不迎合 H 数值化 |
| 7 | `projects/eisei/eisei_pen_128_lite.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：文本标签及复制规则；完整渲染未验证 |
| 8 | `projects/eisei/eisei_pv.bcmkn` | 一致 | 和 H 一致 | 仅开场状态；声音/视觉时序未验证 |
| 9 | `projects/fangjie/fangjie.bcmkn` | 不等 | 无法裁定 | 长程三方world/chunk完整hash及标题位置一致；剩余4个鼠标相关变量未同输入裁定，不冒充全状态一致 |
| 10 | `projects/pencraft/pencraft-before-present-fix.bcmkn` | 不等 | 无法裁定 | T 裁定长数字文本 N 正确；额外 x/y 进度未有同里程碑三方配对，不升级整件正确 |
| 11 | `projects/pencraft/pencraft.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：初始 world 是文本，不应丢前导零或按数值舍入 |
| 12 | `projects/pencraft/pencraft_flicker_fixed.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：官方直接观察 `world[0]="3333333333333333"`，H 为数值 |
| 13 | `projects/qwen-chat/base.bcmkn` | 一致 | 和 H 一致 | 无合成输入，不证明聊天、网络服务或返回结果 |
| 14 | `projects/qwen-mini/base.bcmkn` | 一致 | 和 H 一致 | 开场观察，不证明后续交互与训练 |
| 15 | `projects/starhold/starhold.bcmkn` | 不等 | 无法裁定 | 墙钟及不同 RNG 输入；排除时钟不能删除 socialId/socialSession；见归一化说明 |
| 16 | `projects/tiny-lm/tiny_lm.bcmkn` | 不等 | 官方裁定 NekoC 正确 | 600帧N两模式与官方15项id/EOS输出一致；H自然DONE/LIMIT、32项不同id，不再只是进度差异 |
| 17 | `tests/fixtures/actor-variables-deleted.bcmkn` | 不等 | 官方裁定 NekoC 正确 | O及600帧：官方/N cloneChanged=cloneRead=99，otherRead=other-value，删除后数值NaN；H仍为0 |
| 18 | `tests/fixtures/actor-variables.bcmkn` | 不等 | 官方裁定 NekoC 正确 | O及600帧确认H cloneChanged/cloneRead/otherRead仍为0；官方/N为99/99/other-value，不是仅结构差异 |
| 19 | `tests/fixtures/audio.bcmkn` | 一致 | 和 H 一致 | 音频不在快照字段中；并未验证播放、停止、资源或听感 |
| 20 | `tests/fixtures/input-kn.bcmkn` | 一致 | 和 H 一致 | 未注入任何键盘/鼠标输入；输入事件语义未验证 |
| 21 | `tests/fixtures/kn-async-services/timers.bcmkn` | 不等 | 官方裁定 NekoC 正确 | C：官方 fired=0，H=2；官方未传 callback statement，不能为了 H 执行它 |
| 22 | `tests/fixtures/kn-semantics/broadcast-wait.bcmkn` | 一致 | 和 H 一致 | S 已有独立官方探针；此行仍只计短窗观察 |
| 23 | `tests/fixtures/kn-semantics/broadcast.bcmkn` | 一致 | 和 H 一致 | S：已有独立官方结果，不由第三方代替 |
| 24 | `tests/fixtures/kn-semantics/clone.bcmkn` | 一致 | 和 H 一致 | 此短窗不保证后续广播/等待完成 |
| 25 | `tests/fixtures/kn-semantics/conversion-boolean.bcmkn` | 一致 | 和 H 一致 | 布尔转数值共同路径 |
| 26 | `tests/fixtures/kn-semantics/conversion.bcmkn` | 不等 | 官方裁定 NekoC 正确 | S/T：官方 joined=`1e+21\|true\|1,猫,2,3`，H 串化为列表 id |
| 27 | `tests/fixtures/kn-semantics/list.bcmkn` | 一致 | 和 H 一致 | 列表索引探针；不是任意列表行为证明 |
| 28 | `tests/fixtures/kn-semantics/object-json.bcmkn` | H unsupported | 官方裁定 NekoC 正确 | S：官方对象/JSON 探针与 N 一致；H 缺原语不能计为原始或归一化一致 |
| 29 | `tests/fixtures/kn-semantics/objects.bcmkn` | 不等 | 官方裁定 NekoC 正确 | S/T：missing 赋到全局后官方为数值0，N=0；H=null |
| 30 | `tests/fixtures/kn-semantics/scheduling.bcmkn` | 一致 | 和 H 一致 | 小探针不证明 KN 全部 warp 切片已对齐 |
| 31 | `tests/fixtures/kn-semantics/wait-negative.bcmkn` | 一致 | 和 H 一致 | 固定情景等待 |
| 32 | `tests/fixtures/kn-semantics/yield-warp.bcmkn` | 一致 | 和 H 一致 | 小循环，不证明 30000 次/4ms 大循环边界 |
| 33 | `tests/fixtures/kn-semantics/yield.bcmkn` | 一致 | 和 H 一致 | 小探针短窗 |
| 34 | `tests/fixtures/kn-value-types/initial-lists.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T 完整逐变量官方证据：数字文本、前导零及嵌套列表保留类型 |
| 35 | `tests/fixtures/kn-value-types/missing-object.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：列表储存 Undefined；读取成 NaN；全局 missing 为0，不能用 JSON null 混淆 |
| 36 | `tests/fixtures/kn-value-types/nested-conversion.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：逗号串化与单项嵌套转数值；H 使用列表 id，不符合官方 |
| 37 | `tests/fixtures/kn-value-types/nullish-list-item.bcmkn` | 不等 | 官方裁定 NekoC 正确 | T：Undefined/null 按上下文区分，官方完整结果支持 N；不删除类型差异 |
| 38 | `tests/fixtures/kn-value-types/runtime-lists.bcmkn` | 一致 | 和 H 一致 | T 另有完整官方逐变量证据 |
| 39 | `tests/fixtures/list_writes.bcmkn` | 一致 | 和 H 一致 | 指定写入探针 |
| 40 | `tests/fixtures/nonfinite/kn-list.bcmkn` | 一致 | 和 H 一致 | 原 JSON 投影把 NaN/Infinity 写成 null，不声称带类型全等 |
| 41 | `tests/fixtures/nonfinite/kn.bcmkn` | 一致 | 和 H 一致 | 同上，非有限值的类型判定须另查带类型证据 |

## 原作长程：官方里程碑

L 是原封不动的原作，不是单数字缩短诊断。每10秒采样并落盘，单作品最长600秒；
未更改官方配置、调度、时钟、随机源或游戏输入。两件均无 pageErrors，达到里程碑后再采样确认。

| 原作 | 官方首次达到里程碑（墙钟） | 观察 |
|---|---:|---|
| fangjie | 594807 ms | world=524288，全为0；chunk_x/chunk_z 各64，全为99999；gui_dirty=0，逻辑位置(0,-65) |
| tiny-lm | 20413 ms | `DONE / EOS`，lm_running=0，tokens_processed=position=18，generated=15，next_token=1 |

tiny-lm 完整 id 为 `[66,15,31,4,78,58,64,7,8,2,27,33,32,35,2]`，
完整输出“走到山上，看见了云。它很开心。”。官方 world JSON 全列表 SHA-256 为
`85f99ca1946040d96a6130d38d54735660098f0a066ec0cbfc15fdc56ac7a576`；
chunk_x/chunk_z 均为 `17294ded8e7270f1f5db008f1a7a0dcf7ec945d5f6b48c89064f9129f87d9125`。
两个作品到里程碑后仍有事件循环，因此 core running=true 不等于初始化/生成尚未完成。
该结果补齐旧轮 fangjie 五分钟未完成的证据边界，不改写旧轮失败。

### NekoC / H：600 update 后的原作状态

[长程完整配对摘要](hncompat2-long-evidence.json) 共8次（4件×N JIT开/关，H每次新进程），
均完成600次update、无预热、双方status=ok，参考树及固定二进制hash未改变。
比较器仍保留不等，未给任何速度比。`milestone_reached` 是明确谓词，不是状态全等标志：
tiny-lm 专门要求EOS，因此H的自然LIMIT终止记录为false，而不是运行失败。

| 作品 | 官方 | N（JIT开/关） | H（两次相同） | 结论 |
|---|---|---|---|---|
| fangjie | world/chunk完整hash见上，y=-65 | 同官方 | 同官方 | 初始化/标题里程碑三方一致；完整投影仍不等 |
| tiny-lm | EOS，generated=15，position=18，上述完整id及输出 | 与官方完全相同的id/输出/终止条件 | LIMIT，generated=32，position=34；id `[20,29,71,71,...28个58]` | N正确，不迎合H输出；不声称每个浮点中间量逐位一致 |
| actor-variables | cloneChanged=99，cloneRead=99，otherRead=other-value，done=1 | 同官方 | 三个读取结果均0，done=1 | N正确，归一化后仍不同 |
| actor-variables-deleted | 同上，afterDelete数值NaN | 同官方（旧JSON投影NaN为null，带类型Rust/官方另证） | 三个读取及afterDelete均0，done=1 | N正确；NaN不等于JSON null语义 |

fangjie 的600次update残余仅 `kn-var-guimx,kn-var-guimy,kn-var-mx0,kn-var-my0`：
N均0，H JSON均null。真实Love窗口可能有OS焦点/指针事件，官方L未采样这四个字段，
没有共同指针输入/非有限数带类型证据，故整项仍“无法裁定”，但旧world/chunk进度争议已解决。
不能为提高一致率默认排除四个字段。tiny-lm两次H完整id保存在长程归档，非缩略表的省略号。

## 汇总裁定（互斥，共41件）

| 归类 | 数量 | 含义 |
|---|---:|---|
| 和 H 一致 | **18** | 本轮12次update原始观察投影一致；不等于全程官方兼容 |
| 官方裁定 NekoC 正确 | **20** | 17件已有类型/回调等争议，加tiny-lm及actor两件完整语义里程碑；只限所列字段/情景 |
| NekoC 已修复 | **0** | 本轮未发现需改运行时的新缺陷，不把基线修复重复计数 |
| 无法裁定 | **3** | fangjie残余指针输入、pencraft-before-present-fix坐标、starhold墙钟/RNG未配对 |

原始一致18、仅私有归一化一致18（新增0），与官方裁定20是不同维度，不相互冒充。
41件均有结论或具体无法裁定原因；不是41件全正确的承诺。

## 门禁与剩余风险

- `cargo fmt --check`：退出0；`cargo clippy --all-targets -- -D warnings`：退出0，无warning。
- `RUST_TEST_THREADS=1 cargo test --all-targets`：**848 passed / 0 failed / 1 ignored**，90个测试二进制汇总。
  新增完整原作回归各自覆盖JIT开/关，旧actor/type/timer回归也全部保留。
- `node tools/compat/k4-run-error-corpus.mjs E:/nekoc/dist/kitten4-corpus` 原文：
  seed1、6、42 均 `{ ran: 52, run: 1 }`，达到任务52门槛；保留原有1件运行错误，
  不声称全语料零错误，也未将其改成跳过。
- `npm run -s test:tools`：**547 passed / 0 failed / 53 skipped**，共600项；
  本地target清理结果见根目录未提交 `OC-REPORT.md`。
- 本轮没有运行时语义修复，也没有HateNeko逻辑移植；来源注释清单为空。
  三件无法裁定、无输入/音频覆盖、非有限数旧JSON投影限制均如上保留。
  各种终态一致仍不是全程调度、渲染或任意作品兼容证明。

复现长程官方观察及压缩归档：

```powershell
node tools/compat/hncompat2-progress-official.mjs
node tools/compat/hncompat2-progress-archive.mjs
node tools/compat/kn-hateneko-official-probe.mjs --out dist/hncompat2-official/report.json
node tools/compat/kn-hateneko-official-probe.mjs --archive dist/hncompat2-official/report.json
```

## 输入、音频与时间的未覆盖部分

O 的 input-kn 被动样本事件计数全0；另一次官方 `a` 按住350ms、释放后，
`a-down/any-down=83`、`a-up/any-up=1`。这只是官方输入分支实际执行证据，
不把83视为其他机器必须逐帧相同的计数，也没有对 H/N 注入同一事件脚本。
audio 约1.6秒的官方窗口中未捕获完成console，变量始终空表；该结果是
**未验证音频完成**，不能拿开场相等替代。qwen 两件的聊天/服务路径同样未验证。

O 的 starhold 样本 `now/lastTime` 从0到0.57、1.77秒，`dt` 曾为0和0.05。
官方 timer 底层以 Date 差值计秒（crc bundle hash和UTF-16源码锚点见 O 的 sourceFacts），
不是按帧计时；但不能用这些墙钟样本对无共同输入的12次update作数值正确性判断。
socialId/socialSession 来自不同随机流，同seed不等于跨实现同随机序列。仅排除
`kn-var-dt,kn-var-lastTime,kn-var-now` 后仍须保留随机字段不等；即使额外显式排除
两个随机字段，也只证明剩余状态投影，不将整项升级为官方裁定正确。
