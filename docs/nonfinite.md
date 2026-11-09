# NaN / Infinity 数值语义验证

## 范围与证据

本次只修正已有数值运算、转换和角色状态通路，不增加物理、克隆、
画笔填充或新的积木实现。`src/kitten4.rs` 的 `convert_type` 改动仅将
现有转换积木的输入名 `original_value` 映射到已有 VM 操作数 `text`。

官方实测入口：

- K4：<https://kitten4.codemao.cn/>
- KN：<https://kn.codemao.cn/editor>
- K4 bundle：`https://creation.codemao.cn/kitten/build/kitten.99f88a64d495cf0e79d0.js`
- KN bundle：`https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`

通过隔离的 Playwright/Edge 会话载入自制工程，只暴露页面现有 webpack
模块加载器供读取状态；未替换官方运算、setter、命中测试或碰撞实现。
`tools/verify-nonfinite.mjs` 断言观测值并在失败时返回非零状态；
`tools/probe-nonfinite.mjs` 只读采集相关模块源码。
完整本地证据在忽略目录 `dist/nonfinite/`（`official.json`、截图、
`*-sources.json`、`*-live-sources.json`、运行日志）。官方版本变化后应重新实测，
不可把当前结果视为未来所有版本的保证。
可入库的精简观测记录、夹具 SHA-256 和版本位于
`docs/nonfinite-verification.json`，不包含第三方作品或 bundle 副本。

四份 `tests/fixtures/nonfinite/*` 是自制工程，不来自第三方语料；
K4 使用内嵌矩形 SVG，KN 使用仓库内置的空白样例。
生成命令：`node tools/nonfinite-fixtures.mjs --generate`。
每份包含 30 阶段：5 种属性 × NaN/正负 Infinity × bounce 前后。
NaN/Infinity 通过除零表达式生成，不通过非法 JSON 字面量输入。
负零数值输入保留 `"-0"`，不先在生成器中变成 `"0"`。

## 官方实测结果

角色每组恢复至位置 `(100,20)`、方向 35°、大小 80%、透明度 25%
（alpha 0.75），再执行非有限赋值并在 bounce 前后采样。

| 输入/操作 | K4 | KN |
| --- | --- | --- |
| `0/0` → 文本 | `NaN` | `NaN` |
| `1/0` → 文本 | `Infinity` | `Infinity` |
| `sqrt(-1)` → 文本 | `NaN` | `NaN` |
| `log10(0)` → 文本 | `-Infinity` | `-Infinity` |
| `1 % 0` → 文本 | `NaN` | `NaN` |
| 显式把 `not-a-number` 转为数值 | 保留原文本 | 保留原文本，控制台警告 |
| `1e21` / `1e-7` / `-0` → 文本 | `1e+21` / `1e-7` / `0` | 同左 |
| x/y/方向/透明度直接设置 NaN 或 ±Infinity | 忽略，保留原状态 | 同左 |
| 大小直接设置 ±Infinity | 保留 80% | 保留 80% |
| 大小直接设置 NaN | 保留 80% | 大小为 NaN；逻辑 visible 仍为 true |
| NaN 大小时原位置命中 / 自身几何碰撞 | 原大小仍命中 | false / false |
| NaN 大小时 bounce | 不改变原状态 | 保留 NaN 大小及 `(100,20)` 位置 |
| NaN 列表索引读取 | 报错停止，done=0 | 返回 NaN，继续至 done=1 |

K4 列表错误实测文本：`列表的项数不合规范，快去修改吧！`。
KN 列表警告实测文本：`仅支持数值类型，已处理为NaN`。
普通三份工程最终 `done=1`；K4 列表错误工程是预期的官方失败，
不能当作“非有限值全部不许报错”的反例而抹掉该错误。

KN NaN 大小的官方 bounds 为 `{left:-450,top:281,right:-450,bottom:281}`；
这是底层几何的特殊输出，**未仿制为通用边界数值规范**。
本次只验证该状态不能命中、不能自碰撞且 bounce 不重置位置。

### 源码交叉证据

K4 模块 `Tn6a`：

- 算术函数直接使用 JS 除法/取余；不把除零结果替换为 0。
- `z/c`（位置/滑行辅助）分别检查 x、y 的 `isFinite`，非有限轴保持原值。
- `self_go_forward`、`self_rotate`、`self_rotate_around`、`set_scale`、
  `self_change_scale_2`、宽高设置/增减对输入作有限值检查。
- `convert_type` 使用 `String` / `toNumber`；转换失败返回 `String(i)`，
  但数值 NaN 与文本 `NaN` 均保留 NaN 语义。
- `lists_get_value` 对非有限索引抛 `invaild_list_index`。

KN 同样按官方页面实测，不从 K4 的实现推断 KN 大小 NaN 行为。
JS 风格格式化由共享 `ryu-js` 实现；字符串数值解析的空白、radix 与舍入
边界有本地单元测试，但这些额外边界并未逐一在官方编辑器实测。

## 实现与差分测试

- VM/JIT 除法使用 IEEE 运算；取余也保留 NaN。
- `src/js_number.rs` 统一数字文本和字符串数字解析；拒绝 Rust 特有 `inf`
  拼写，接受 JS Infinity、进制前缀、规定空白；二进制/八进制/十六进制整数
  只在末尾做一次 53 位 ties-to-even 舍入。
- `Cell`、文本拼接、数值日志及参考解释器使用共享格式化。
- 保留非有限逻辑状态，不再因位置非有限一概停止 VM。
- 发送帧时隐藏非有限几何，避免 JSON 将 NaN 变 null 后被前端默认值误绘；
  不改逻辑 visible，不把 NaN 重写为 0，有限大小恢复后可重新显示。
- K4 非有限列表读取在数值表达式、boxed 表达式、JIT helper、参考解释器
  均进入错误通路；KN 返回 NaN。
- 文本切片反向范围先规范化，防止 NaN 导致 Rust slice 范围 panic。

测试入口：

- `tests/nonfinite.rs`：官方夹具三路径输出，以及 NaN 大小中间态和恢复断言。
- `tests/jit_differential.rs`：逐帧协议差分、10 次重启、500 次热循环，
  覆盖 NaN、正负 Infinity、取余零、乘法溢出和参考解释器比较。
- `engine::nonfinite_geometry_tests`：NaN 大小原位置/原点命中、自身几何重叠、
  bounce 保持状态、恢复有限大小。
- `src/js_number.rs`：正负零、非有限值、指数边界、字符串数字解析。
- `tests/nonfinite-fixtures.test.mjs`：夹具可重现与负零输入完整性。

**测试边界**：参考解释器没有 bounce 实现。三路径测试只对本夹具中已实测
处于舞台内、bounce 无效果的调用替换为 wait(0)，并明确保留来源语义标识。
不能据此声称参考解释器完整支持 bounce。参考解释器的碰撞本来就是半径近似，
不作为像素几何 oracle；命中/几何重叠由 VM 单测和官方实测交叉验证。

## 数值防御审计清单

以下审计范围是 `src/engine.rs`、`src/engine/jit.rs`、`src/engine/value.rs`
和 `src/runtime/`，并区分产品规则、宿主边界与未验证限制，未机械删除检查。

| 位置/类别 | 处理及理由 | 官方证据状态 |
| --- | --- | --- |
| `Binary::Div/Mod`，JIT `fdiv`/`h_mod`，runtime arithmetic | 删除除零→0 特例，保留 IEEE 结果 | 已实测、K4 源码 |
| `Cell::text/append_text`、runtime `format_value` | 删除 i64 截断/Rust 非有限格式 | 已实测 |
| `ValueExpr::Convert`、runtime `convert_type` | 非数字文本转换失败保留文本 | 已实测、K4 源码 |
| `Op::Position/X/Y/Direction/Scale/Opacity` | 按产品过滤输入，KN 大小 NaN 例外 | 已实测 |
| Move/AddX/AddY/Turn/ChangeScale/SizeAxis/RotateAround | 有限输入守卫保留/补齐 | K4 源码；KN 扩展边界未逐项实测 |
| Glide 目标 | 删除 VM 非有限目标报错，逐轴保留起点 | K4 `z/c` 源码；非有限 duration 未验证 |
| 最终 non-finite position 报错 | 删除：不把合法 IEEE 传播统一当成 VM 错误 | setter 实测和源码；有限值溢出的完整官方行为未验证 |
| bounce 几何守卫 | 无效几何不执行反弹计算，不修改数值状态 | KN NaN 大小实测 |
| `frame()` 几何有限检查 | 仅隐藏 wire sprite，避免 null 被误绘 | 传输适配；不声称官方内部如此实现 |
| `list_index` / K4 list read guard | 有限索引才转整数；K4 读取显式报错 | 非有限读取已实测；列表写入/有限负索引未在本次验证 |
| `ValueExpr::Select`、UTF-16 下标 | clamp/get 保护范围；反向切片避免 panic | NaN 切片边界未官方实测，仅安全修复 |
| `Unary::Whole` / prime | finite/范围检查是谓词，不是 VM 中止 | 本次未官方实测，不改 |
| 常量折叠 `n.is_finite()` | 非有限结果不折叠，但保留原表达式继续求值 | 优化保护，不影响非有限值传递 |
| timeline 的 `is_finite`/NaN sentinel | 未指定动画属性的内部哨兵，不是数值异常中止 | 内部约定；特殊输入动画未验证 |
| stage width/height、dt、mouse、drag、UTC offset、costume dimensions | 宿主 API / 工程结构校验，保留 | 不是积木算术；不宣称官方数值语义 |
| `Op::Style` 无效造型错误 | 保留既有错误，不擅自取消 | 非有限造型选择未验证 |
| `Op::Range` 有限端点/step、RangeNext no-progress | 保留既有限制 | **未验证**；可能与官方不同，不声称完成全数值一致性 |
| pen property/size、text size、line finite/1e9 上限 | 保留既有渲染安全限制，未扩展画笔能力 | **未验证**；不是官方兼容性结论 |
| Repeat / Wait / list / clone 等 float→integer | Rust 饱和转换或显式 clamp/get，未引入 unwrap；执行预算仍限制 VM | 非有限循环、时长、克隆边界 **未验证** |
| engine/JIT 的 `unwrap/expect` | 编译器栈、已验证图/IR、JIT 初始化、固定枚举等结构不变量 | 不由 NaN/Infinity 决定，不机械删除 |
| runtime 的 `unwrap` | 已检验存在的 actor/continuation/list 借用 | 不由数值决定；不增加新积木 |
| 编译器 `ensure/bail` | 未知块、输入缺失、深度/任务/调用/递归/循环列表限制 | 结构与资源限制，保留 |
| 数值运行时错误 | K4 非有限列表读取保留；Range、无效造型等留待独立验证 | 不把未知规则当作已兼容 |

没有使用或移植 HateNeko 代码，无 HateNeko 来源路径需标注。

## 语料与 florr 限制

本 worktree 缺少 `dist/kitten4-corpus/cov.mjs` 和第三方 `.bcm`，包括
`335327306.bcm`。即使 release 构建成功，覆盖率脚本仍因缺文件无法执行。
因此覆盖率前后、florr 多次实际运行结果均 **未验证**，不能填 0 或推断提升。
没有从其他 worktree 复制第三方作品，也没有把第三方作品放入跟踪路径。
