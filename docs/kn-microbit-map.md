# microbit_math_map：真正执行体有硬件连接前置条件

官方 KN 编辑器 **0.27.4**，证据采集没有连接或伪造硬件，也没有使用 HateNeko。本地仅实现已证实的无连接分支，最终测试见未提交的 `OC-REPORT.md`。

## 结论

**不能把 `microbit_math_map` 当作无条件纯计算块。** 真正官方域函数首先调用 `getHardwareCoreAndCheck("microbit")`，结果为假就直接返回 **number NaN**。无设备情况下，正常数字、非法字符串、空字符串、退化区间、超范围数字、Infinity 七组输入均实测同步返回 NaN。真实硬件 Map 为空；没有修改连接 helper 或注册虚假设备。

它有五个 value sockets，按官方块定义依次为：

| socket | 默认文字 |
| --- | --- |
| `value` | `0` |
| `fromStart` | `0` |
| `fromEnd` | `1023` |
| `toStart` | `1` |
| `toEnd` | `10` |

本地 `ValueExpr::OfflineMicrobitMap` 保留五个输入的完整求值、副作用和错误，再返回 typed numeric NaN；没有在编译阶段丢掉输入。该节点保守退出热 JIT 原生树提升。`tests/kn_microbit_map.rs` 覆盖五个独立对象写入副作用、循环、无连接时不运行线性公式、各输入错误/缺失拒绝。探针另用会抛错的 args property getter，实际域函数无设备时 getter 读取次数为 0，证明连接检查在**域函数内部**早于读取参数属性；这不意味着解释器在进入域函数前可以跳过块输入求值。没有完整作品执行轨迹，不能宣称完整语义已验证。

## 官方动态加载链与源码锚点

main 中的异步模块表映射 `./microbit` → module **83939**，依赖 chunks **1359 / 5337 / 8205 / 2308**。官方 webpack loader 加载这些 chunk 后，extension 的实际 domain factory 是 module **20592** 的导出 **`d()`**，其返回对象包含 `microbit_math_map`。调用的是该原始官方函数，不是反编译重写或独立公式。

官方前缀：`https://creation.bcmcdn.com/neko/web/release/static/js/`。

| 文件 | SHA-256 |
| --- | --- |
| `main.8ccf2442.js` | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| **`entry_hardware.481194e4.chunk.js`** | **`7259df6bc25c81905028a569ca5e99fba5091ca4fbddd29c2ec92ac15c75842d`** |

原始 UTF-8 零基**字节偏移**：

| symbol | 文件 | byte offset | hash 覆盖字符数 |
| --- | --- | --- | --- |
| microbit lazy mapping | main | 5467319 | 400 |
| module 20592 factory | entry_hardware | 190292 | 400 |
| **microbit_math_map 实际注册/执行体** | **entry_hardware** | **205131** | **1740** |
| hardware connection helper | main | 2178339 | 1200 |

完整 URL、字节位置与摘录 hash 在 **`docs/kn-microbit-map-evidence.json`**。下载的第三方代码/函数体只在本 worktree 忽略目录 **`dist/kn-microbit-map/`**，归档 JSON 没有函数体或源码摘录。

## 连接后的计算：仅源码证据，不伪装成实测

在硬件连接检查通过后，函数依次对五个字段做 `Number(...)` / isNaN 检查，非法数值会向官方错误管理器记录对应 input 的 ONLY_NUMBER_IN_MATH；随后又对五个值分别做 **parseFloat**。任一 parseFloat 得到 NaN 则返回 NaN，否则计算线性映射并对结果 **toFixed(2)** 后再 Number。

这里存在 Number 校验与 parseFloat 实际转换的差异，不能简单用统一数值转换替代。公式没有显式 clamp 区间。没有测真实连接设备，不能凭公式样例覆盖连接条件，也没有伪造 hardware object 来制造“官方连接实测”。

## 复现与验证

```powershell
# 可使用 NEKOC_NODE_MODULES 指向已安装 Playwright 的 node_modules；默认复用第三轮 dist 安装。
node tools/compat/kn-microbit-map-probe.mjs --record
node --test tests/kn-microbit-map-source.test.mjs
```

探针暴露官方 webpack loader、调用原始 lazy loader 和 domain factory，没有启动硬件扩展 init/connect，没有改服务函数。官方版本 0.27.4，`ok=true`，七组无设备调用均 NaN，getter 读取 0，pageErrors 为空。完整 native workspace 注册/编译/运行路径及连接设备下的公式边界仍未验证。
