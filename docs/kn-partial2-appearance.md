# KN partial2：外观、角色代码 API 与无限对白

## 范围和证据契约

本轮只针对 `appearance_of_sprite`、`get_sprite_property`、`self_dialog_wait` 的普通角色主路径。
只用官方 KN **0.27.4** 实测，不移植官方/HateNeko源码。
官方域函数未替换；共享 `tools/semantics-kitten-n.mjs::probe` 仅暴露 webpack loader，
导入完整原创工程、点击开始、等待 `done=1`，再读取全部变量及实际气泡缓存。

- 原创夹具：`tests/fixtures/kn-semantics/partial2-appearance-{talk,think}.bcmkn`。
- 现场探针：`tools/compat/kn-partial2-appearance-probe.mjs`。
- 成功配对归档：`docs/kn-partial2-appearance-official.json`（归档要求变量全部匹配，
  两边 `done=1`、无 pageErrors、同 SHA-256 的 editor-compat `ok:true`，且编辑器版本 0.27.4）。
- 回归：`tests/kn_partial2_appearance.rs`、`tests/kn-partial2-appearance.test.mjs`。
- 官方 main：`main.8ccf2442.js`，SHA-256
  `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`；
  runtime：`crc_libs.8196dbd1.js`，SHA-256
  `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7`。

## 主路径观测

### `appearance_of_sprite`

对 `--self` 和实际角色 ID，分别设置两轴 123.456 / 56.789 与方向 25.7142857，
完整工程官方读回 scale=width=123.46、height=56.79、direction=25.71。
这验证的是独立两轴缩放百分比，不是造型像素宽高；本地既有 `kn_appearance` getter 已使用此语义。

### `get_sprite_property`

官方没有同名注册积木。实际官方代码转换器分别转换15种属性，归档仅保留输入属性、
目标积木类型/字段和错误数组，不收录转换器源码或生成的 XML。
完整工程中的原生 reporter 是这些已观测映射的可执行形式；Rust 回归再将它们替换为
本地规范 JSON 的同名代码 API 别名，与**同一份官方变量期望值**比较。
这不是声称官方可以导入同名积木。

| 属性 | 实际原生 reporter | 官方工程期望值 |
| --- | --- | --- |
| x / y | coordinate_of_sprite | 1.23 / -2.35 |
| style_index | style_of_sprite | 1 |
| scale / width / height / direction | appearance_of_sprite | 123.46 / 123.46 / 56.79 / 25.71 |
| color | effect_of_sprite(effect=0) | 349.88（写入 -10.125） |
| opacity | effect_of_sprite(effect=1) | 12.34（写入 12.345） |
| brightness / pixelate / ripple / distortion / grayscale | effect_of_sprite(effect=2..6) | 各12.35 |
| distance（实际角色 ID） | distance_to | 0（当前实例到自身） |

这轮配对发现 coordinate/effect 仍沿用旧原生 getter，故其别名也出现未舍入/色相未归一化差异。
只对 KN 的原生 coordinate/effect 接入已有 `KnProperty`，K4 分支保留。
另官方 editor-compat 会把 `distance_to('--self')` 改写为 `sprite="?"`，说明这是非法编辑器目标，
不能将含该字段的工程称作编辑器兼容夹具。主夹具因此只用实际角色 ID 距离；
另在不替换域函数的局部调用中直接传 `--self`，确认结果是 numeric NaN。
对 KN 的 `--self` 精确常量分支返回 NaN；本地代码 API 别名也复用此修复，
独立 Rust 回归覆盖原生及别名，局部调用结果与完整工程变量明确分开。
修复仅在 `engine.rs` 的三个 KN reporter 分支接线，未修改调度或公共结构。

### `self_dialog_wait`

两个完整工程分别执行 talk / think，随后立即写 `after_dialog=1`、`done=1`。
官方两变量均为1，且150ms观察缓冲后实际气泡仍存在：

- talk：`original talk text` 显示为 `original\u00a0talk\u00a0text`；
- think：91个“界”显示为90个“界”加 `...`。

因此该积木是**无限时长、非等待关闭**的对白，而非 timed 对白。
Rust 解释器及 JIT-enabled 两种模式要求第一个 update 即完成后续变量赋值，
比对实际气泡文本与思考/说话类型，并在随后240帧继续保持气泡。
官方观测是执行后状态，不把150ms墙钟缓冲等同于精确帧数或证明任意并发顺序。

同一官方页面另对真实角色直接调用注册域函数（不是完整工程变量），并读取气泡缓存，
五个常见内容均返回 undefined 且显示：空文本→空文本、42→`42`、true→`true`、
列表 `[1,"a b"]`→`1,a\u00a0b`、普通对象 `{a:1}`→`[object\u00a0Object]`。
这些局部调用独立归档在 `inspection.dialogCalls`，Rust 用相同初始变量值逐个对比文本，
解释器/JIT-enabled 两模式均要求后续 `done=1`。隐藏角色忽略和空文本有效另有
既有 `tests/kn_appearance_dialog.rs::hidden_dialog_is_ignored_empty_dialog_is_valid_and_close_clears` 回归；
本轮没有新增官方隐藏角色工程，因此不将可见性边界称作本轮端到端实测。

## 本轮实测结果

- 两份完整工程均89积木，editor-compat **ok:true**、issues/pageErrors为空、编辑器0.27.4，
  工程字节 SHA-256 与归档匹配。
- 每工程31个变量完整配对（含done/after_dialog）；两工程官方及本地均done=1，pageErrors为空。
- 15种官方代码API转换均无 errors/warnings；同名官方注册积木不存在。
- 两个原生talk/think气泡均仍存在，文本及类型符合上文；另五类内容的真实角色域调用均成功。
- `node --test tests/kn-partial2-appearance.test.mjs`：**5/5通过**。
- Rust新增4项均显式遍历解释器/JIT-enabled；最终运行结果由主任务统一门禁记录，
  不以JIT开关回归冒充每个helper原生热编译。

## 复现

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
node tools/compat/kn-partial2-appearance-probe.mjs --generate
# editor-compat 不自动创建输出目录
New-Item -ItemType Directory -Force dist/kn-partial2-appearance
node tools/editor-compat.mjs tests/fixtures/kn-semantics/partial2-appearance-talk.bcmkn tests/fixtures/kn-semantics/partial2-appearance-think.bcmkn --channel msedge --out dist/kn-partial2-appearance/editor-compat.json
cargo build --bin kn-trace
node tools/compat/kn-partial2-appearance-probe.mjs --archive
node --test tests/kn-partial2-appearance.test.mjs
cargo test --test kn_partial2_appearance
```

## 跳过和边界

- `set_system_preset` 属于 AI 账户/在线服务；按本轮范围跳过，不升级、不把匿名离线继续执行当作服务实现。
- `global_animation` 本地 viewer 未接官方 SVGA 真实播放后端；宿主请求/确认接口不等于视觉后端实现，跳过且不升级。
- 文本造型、隐藏/已删除目标、跨场景、克隆生命周期、非有限参数及完整渲染/像素差分未验证。
- 代码 API 的非法属性/目标错误提示 UI 未复刻；英文特效名的转换已测，未将所有任意 JSON 编码称作官方积木。
- 对白的并发覆盖/取消、timed 对白/close 竞争、跨场景、null/undefined/复杂对象转换及截断恰切代理对未纳入本轮主路径认证；仅普通列表/对象的上述局部域调用已测。
- JIT-enabled 通过只表示开启 JIT 时可执行，不保证每个 helper 进入 native 热路径。
