# KN 第四轮：类型转换边界

## 官方证据

匿名官方 KN 编辑器 **0.27.4**，调用其已注册、未改函数体的 `convert_type` 域函数，21 类输入 × number/string/boolean 共 **63 次**。结果和发布包 URL、SHA-256、时间见 [kn-conversion-evidence.json](kn-conversion-evidence.json)。原始 `main.8ccf2442.js` UTF-8 字节 **1633578** 起的 `convertType` 分支使用 lodash.toNumber，失败回退 JS String；布尔值转 number 专门回退 String。string/boolean 分支分别为 JS String/Boolean。

官方源码和现场观测均不是 HateNeko；本轮没有移植第三方实现。

| 输入 | number | string | boolean |
| --- | --- | --- | --- |
| null | 数字 0 | 文本 `null` | false |
| undefined | 文本 `undefined` | 文本 `undefined` | false |
| true / false | 文本 true / false | 文本 true / false | 原布尔 |
| [] | 数字 0 | 空文本 | true |
| [12] / [[7]] | 数字 12 / 7 | 文本 12 / 7 | true |
| ["0x10"] | 数字 16 | 文本 0x10 | true |
| [1,2] | 文本 1,2 | 文本 1,2 | true |
| 普通对象 | 文本 [object Object] | 同左 | true |
| numeric NaN / 文本 NaN | numeric NaN | 文本 NaN | false / true |

## 实现与回归

- `src/engine/kn_conversion.rs` 独立处理 KN 的 list/null/undefined/普通对象边界；不修改通用 Cell 文本显示或 K4 转换。
- `convert_type` 增加有官方域函数源码证据的 boolean 目标；仍拒绝未知目标。是否在当前可见下拉菜单开放该目标以面板审计为准，不混为额外积木类型。
- `tests/kn_conversion.rs` 构造内存 KN JSON，逐条比较归档的 **类型与值**，两种 JIT 配置各执行80轮，另测输入写入副作用和未知目标拒绝。不生成或交付 `.bcmkn`。
- `tests/kn-conversion.test.mjs` 核验63次观测与证据无源码体；本地保留官方包时核验原始字节散列及锚点。

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-conversion-probe.mjs --record
cargo test --test kn_conversion
node --test tests/kn-conversion.test.mjs
```

## 未验证与风险

这是官方域函数局部实测，不是完整原生工程/警告 UI 差分；自定义 valueOf/toString、原型链、循环数组与孤立 UTF-16 代理项**未验证**。本地数组字符串化有循环/深度保护，不声称等价 JS 全对象模型。两种JIT配置不等于新分支已进入native机器码。覆盖表仍保留“部分语义”，不升级为完整语义认证。
