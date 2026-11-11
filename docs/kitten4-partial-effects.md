# K4 partial：角色与场景效果

负责积木：`self_set_effect_2`、`self_set_effect`、`self_change_effect_3`、
`self_change_effect_2`、`self_change_effect`、`self_clear_effects`。

## 来源与复现

只读外部 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`
中 webpack 模块 **Tn6a** 的 `lt` 效果分派、别名、输入检查；没有把官方实现拷入仓库。
夹具由仓库自有最小工程骨架和新写的积木序列生成，无第三方作品语料。

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-effects-fixtures.mjs --record
```

生成器通过 `tools/compat/k4-oracle.mjs` 编译、运行官方 .orig；关闭一切外部请求。
`docs/kitten4-partial-effects-evidence.json` 保留实际官方 bundle SHA-256、
逐夹具 SHA-256、原始效果 getter 的执行帧观察、运行时错误和被阻断的网络请求。
最终共 **11 份夹具、1,794 次官方状态观察**，domain runtime errors 全部为空。
官方域积木每次触发两个 `before_expression` 记录，取首个执行帧；不假定 wait(0)
固定为两帧，分块 repeat 的额外 yield 也包含在真实帧号内。

预设覆盖所有八个 scope：负大数、负一、零、0.5、1、1.5、19.5、20、20.5、
99/100/101、360/721、NaN、正负 Infinity、数值字符串及非数值字符串；
change 额外覆盖 decrease / 非法 method；非法 scope 覆盖 `8/-1/00/color/空串`。
legacy change 即使传 decrease 或非法 method，也由官方别名强制 increase。
另外增加 scene 原生 set/change/clear、80×40 actor，以及 scene fractional reporter
夹具。后者在每次设置后调用 `get_3` 属性7–14，独立记录变量结果，约束属性读取
与效果状态之间的百分数/符号转换及两位小数舍入。

## 官方测得的状态语义

所有设置/改变只接受有限 **number**，不是 JavaScript 全局 isFinite 的强制转型：
`text("20")` 也无效。非法 scope/method 无效，但输入表达式仍求值。

| scope | 原始官方 getter 默认值 | 设置 / 改变后边界 |
|---|---:|---|
| 0 颜色 hue | 0 | 保留原值；不回绕、不 clamp |
| 1 透明度 | alpha=1 | set `(100-v)/100`；increase `alpha-v/100`；decrease 相反；alpha 截到 `[0,1]` |
| 2 亮度 | 100 | 保留原始百分值；不截到 `[0,200]` |
| 3 像素化 | 0 | 一旦设置则截到 `[1,源纹理最短边]`，小数保留；set 0 得 1 |
| 4 波纹 displacement | 0 | `[0,100]` |
| 5 扭曲 twist | 0 | `[0,100]` |
| 6 黑白 saturate | 0 | 官方存负饱和度，范围 `[-100,0]`；NekoC 继续以正向灰度存储 |
| 7 符号码 ASCII | 0 | 先要求**原始输入** `v>=1`，随后计算 set/increase/decrease，并截到 `[1,源纹理最短边]` |

ASCII 减少 -1、0、0.5 都被原始值检查拒绝，不会反向增加或微量减少。
上界分别实测了 20×20 actor（20）、80×40 actor（40）、1280×720 scene（720）；
不能把普通小 actor 的 20 错当全局硬上界。Rust 测试显式注册同尺寸 costume，
生产运行时应由宿主图片加载流程通过 `set_costume` 提供源纹理尺寸。
`self_clear_effects` 把 alpha 恢复 1，所有 effect getter 恢复默认值，
包括 pixelate/ASCII 的 0（不是它们 setter 的下界 1）。

## 修复与存储

- 新增 `src/kitten4/effects.rs`，在 opaque lowering 时保留严格类型/方法语义。
- 新增 `src/engine/k4_effects.rs`，不污染 Kitten N 原有 `Effect` 数值规则。
- `Sprite.effects` 和印章效果快照扩为 `[f64;8]`；slot7 是 ASCII 原始 getter 值。
- slot2 仍以 `官方 brightness - 100` 存储，slot6 仍以 `-官方 saturate` 存储。
- 删除 K4 `self_change_effect_3 scope7` 的条件 noop；三个 change 别名共享完整转换。
- get 属性执行逻辑与覆盖表在本轮其他专项中更新；本文仅说明效果模块。

Rust 回归：`tests/kitten4_partial_effects.rs`，按实际官方执行帧比较透明度和全部效果，
分别启用/禁用 JIT。已运行通过 `cargo test --test kitten4_partial_effects`。
证据中的浏览器 `pageErrors: ["Event"]` 与被阻断的官方资源请求一起保留，
不删去离线环境诊断；domain runtime `errors` 则全部为空。这个证据只支持逻辑状态，
并不把失败素材加载的离线画面当成官方最终视觉效果。

## partial 结论（不能以状态通过代替像素一致）

**六个积木均已具有 scope0–7 的官方边界状态证据**，可移除“仅静态别名映射”
以及“scope7 noop”的旧限制描述。但不建议将六项全部无条件移出 partial：

1. Web renderer 当前只有 scope0–6 的近似 shader；ASCII slot7 尚未渲染。
   颜色 hue、亮度、pixelate、波纹和 twist 的官方像素算法未做截图差分。
2. 官方波纹需要 `displacement_map_full.png`，离线 oracle 按安全策略阻断该外部素材；
   getter 状态仍可实测，但不能宣称官方波纹视觉已经验证。
3. 官方对 ELASTIC 物理体跳过非透明度效果；仓库尚未实现真正弹性体。
   这个物理子选项没有凭普通 actor 夹具宣称完整兼容。
4. iOS 的 ASCII 是提示后不执行；本次验证是 Windows 离线播放器，不覆盖 iOS。
5. clear 对普通 actor/scene 状态可完整恢复；官方清除 filter 的像素结果、
   弹性体和特殊不支持 effects 的实体错误分支仍缺专门证据。

因此在“全 scope / 平台 / 渲染”口径下，**本轮六项仍保留 partial**，
但运行时数值边界与 legacy alias 子范围已经由官方实测和 Rust 回归约束。
本轮没有将覆盖表收窄为只评价 Windows headless 状态执行，
也没有把未实现的 ASCII 像素效果标成完成。
