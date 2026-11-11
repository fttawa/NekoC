# KN 同场兼容差异复核

本轮从 `e46d38e`（`oc/integrate`）出发，以 HateNeko 同场差异为排查线索，
不以第三方实现判定官方语义，也没有移植 HateNeko 代码。

## 算术输入缺槽

`projects/eisei/` 六份原作品在减法块中省略 A、B；旧版 NekoC 在编译时
以 `math_arithmetic: missing input A` 拒绝整个作品。**官方 KN 0.27.4 在线编辑器
实测结果不是补 0**：加、减、乘、除、幂的 A/B 任一缺失或全部缺失，赋值结果均为
数值 `NaN`，后续语句正常执行，且无 pageErrors。编辑器不会将这些已保存的缺槽
自动写回成阴影块。

- 紧凑证据：[kn-missing-inputs-official.json](kn-missing-inputs-official.json)，
  含输入 hash、在线 main/runtime bundle hash、浏览器版本和编辑器检查。
- 原创探针保存在忽略目录，不新增兼容短跑的作品集合，也不改原作品。
- 实现只放宽 KN `math_arithmetic` 已实测的五类运算，缺槽作为数值 NaN 编译；
  不修改通用 `input()` 检查，也不改 K4 输入要求。
- 回归涵盖 15 种缺槽组合、浅层/40 层表达式、JIT 开/关、后续语句继续执行，
  以及原始六份作品的无损导入和完整编译。

复现：

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/kn-missing-inputs.mjs --generate
node tools/editor-compat.mjs dist/kncompat/missing-inputs/probe.bcmkn --channel msedge --out dist/kncompat/missing-inputs/editor.json
node tools/kn-missing-inputs.mjs
node tools/kn-missing-inputs.mjs --archive
```

原始观察在 `dist/kncompat/missing-inputs/official.json`，初次试验错误地使用
`math_arithmetic` 的 `mod` 字段，被编辑器检查拒绝后已从有效探针删除；
这里的结论不扩展到取模或其他积木的缺槽处理（**未验证**）。

## 其余争议项

- [类型、嵌套列表与对象缺失值](kn-value-types.md)：官方结果支持保留 NekoC 当前
  类型处理，不应为了第三方状态相同而转换初始列表文本或统一缺失值。
- [fangjie、tiny-lm 进度与 timer](kn-project-progress.md)：固定 12 次宿主 update
  不保证双方完成同等工作量；官方原作的自然进展及默认 warp 切片源码可解释
  区块初始化/生成 id 的阶段差异，不将其记为列表 append/生成序列错误。
  KN 的完整逐帧切片策略仍**未验证**，本轮不进行高风险的调度器结构改造。
- native timer callback 的 statement body 在官方编译后未传到域调用，空函数
  替代是当前官方行为；保留 NekoC 不执行该插槽的兼容路径，不迎合第三方回调。

## 列表中的 Undefined 读取

新增类型探针首次双边运行暴露一处窄化差异：缺失对象属性直接 append 到列表时，
双方均保留 Undefined；随后 `list_item` 将其赋到全局变量，官方为数值 NaN，
NekoC 原先把 Undefined 交给全局赋值后归零。现仅在 KN typed `list_item` 中
将该元素读取归为 NaN，不改变列表存储、对象 getter、全局 Undefined 赋值规则或 K4。
回归与官方带类型结果一起保存在 `tests/kn_value_types.rs`。
补充第五个探针核实普通索引和 `last`：Undefined 均读成 NaN，直接拼接为 `"NaN"`；
显式 null 保留，赋到全局时为 0、直接拼接为空串。因此不将 null 一并转换。

## 验证口径

新探针的官方编辑器检查、在线运行和本地 JIT 开/关回归分别验证结构与行为，不能用
`editor-compat ok` 单独当作语义一致证明。`kn-trace` 对非有限数与 Undefined 显式编码，
五份夹具修复后逐变量在线配对全部相等，报告 `dist/kn-value-types/paired-final.json`。
HateNeko 短跑仍保留原来的 JSON 投影和固定 update 窗口，不靠更改比较器消除残余差异。
本轮运行结果和复现命令见 [performance.md](performance.md) 对应更新节。
