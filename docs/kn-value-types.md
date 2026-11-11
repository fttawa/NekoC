# KN 列表类型、嵌套转换与缺失属性复核

## 结论

本轮只使用官方在线 KN **0.27.4**。不参考或移植 HateNeko，不改运行时实现，不将其他实现的输出当作正确答案。

| 争议点 | 官方观察 | 判定 |
| --- | --- | --- |
| eisei `eisei_pen_128_fixed.bcmkn` 的 `kn-list-ep_bank_color[0]` | 文本 `"1"`；列表长度 1435，前三项 `typeof` 均为 `string` | 不能将初始数字文本统一转为数字 1 |
| pencraft `pencraft_flicker_fixed.bcmkn` 的 `kn-list-world[0]` | 文本 `"3333333333333333"`；列表长度 192，前三项 `typeof` 均为 `string` | 长数字文本必须保留；不能按数值解析或舍入 |
| 初始列表及 `list_copy` | `"1"`、`"01"`、16/17 位数字文本、`"1e2"`、空白、嵌套数字文本均保留原类型 | 不是运行时初始化/复制时的隐式数字转换 |
| `list_append` 文本/数字 | `["1", "33333333333333333", 1]`，复制后相同 | 输入积木的文本与数字类型仍需区分 |
| `[1,"猫",[2,3]]` 拼接、转文本、转数字 | 三者均为文本 `"1,猫,2,3"` | 列表转数字失败回退 JS 字符串；不是 JSON 数组文本，也不是 NaN |
| `[["2"]]` 转数字 | 数字 2 | 嵌套单项列表可成功转换 |
| 空对象缺失属性直接赋到全局变量再读 | 数字 0 | 不应把全局观察值归档成 Undefined；不据此推断任意局部变量也为 0 |
| 缺失属性直接拼接 | 空文本 `""` | 与直接 JS `String(undefined)` 不同 |
| 缺失属性转数字 | 文本 `"undefined"` | 不应与数字 NaN 或 Undefined 混淆 |
| 缺失属性直接追加列表，再 `list_item` 读取 | 列表中为 `{"$undefined":true}`；读取结果为数字 NaN | 列表存储值与列表读取结果不可混为一谈 |
| Undefined 元素用普通索引 / `last` 读取后直接拼接 | 两者均为文本 `"NaN"`，直接赋全局均为数字 NaN | list_item 应仅将 Undefined 读取结果变为数字 NaN |
| 显式 null 元素用普通索引 / `last` 读取 | 直接赋全局均为数字 0，直接拼接均为空串 | **不能把 null 也转换成 NaN**；全局赋值结果不证明底层读取值是数字 0 |
| 整个 `[null]` / `[undefined]` 拼接 | 均为空串 | 与先 `list_item` 再拼接区分 |

原版 `tools/semantics-kitten-n.mjs` 也分别复测了 `conversion` 和 `objects`：前者仍得 `joined="1e+21|true|1,猫,2,3"`；后者 `missing=0`、`missingText=""`、`done=1`。所以这两项不是根据其他运行时推定的“缺陷”。

## 证据与边界

- 紧凑可提交证据：[kn-value-types-official.json](kn-value-types-official.json)。含五个原创夹具的完整带类型最终变量、bundle URL/SHA-256、时间、浏览器版本、夹具 hash 和 editor-compat；另含两个**原封不动**项目的争议列表快照。
- 原始报告：`dist/kn-value-types/official.json`、`original-inputs.json`、`base-conversion.json`、`base-objects.json`、`editor-compat.json`。
- 补测普通索引/last 的 null 与 Undefined：`dist/kn-value-types/nullish-official.json`、`nullish-editor-compat.json`。本次紧凑归档采用这份包含全部五个夹具的新报告。
- 官方原始包仅在忽略目录 `dist/kn-value-types/main.8ccf2442.js` 与 `crc_libs.8196dbd1.js`，不入库。SHA-256 分别为 `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`、`462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7`。
- 新工具 `tools/semantics-kn-value-types.mjs` 复用原工具的原生项目模板、官方 URL、导出的 `probe` 和双边比较函数；五个小夹具直接由原工具观测。原项目快照另外保留同一 webpack 暴露、previewUrl 导入、点击开始、读取 runtime manager 的协议。没有覆写任何官方域函数。
- 原项目在点击开始后立即读取列表；不声称停止在指定帧，也不声称全部项目状态等价。首次尝试在开始前读取时 runtime 尚无列表，该失败不算证据；成功报告来自开始后的实际运行时列表。
- 五个新 `.bcmkn` 均已通过官方 `editor-compat`，每项 `ok: true`、无 issues/pageErrors。原有大项目未被生成器修改。
- 归档的 `ok` 表示**官方观测完整且无页面错误**，不是 NekoC 双边全等；本轮另由 Rust 回归对照全部变量，分别启用/禁用 JIT。
- 修复后在线双边报告 `dist/kn-value-types/paired-final.json` 的五项均 `equal=true`，逐变量核对包括 Undefined/null/NaN 标签；Rust 同时覆盖 JIT 开/关。
- 未覆盖循环列表、稀疏数组、原型属性、任意局部变量对缺失值的行为、多帧程序轨迹和性能。

## 运行时建议定位

初始列表、转换、对象缺失值大部分源码已有对应实现；新增回归只暴露下述列表读取差异，不能依据外部实现的数字列表直接修改初始值。

- 初始列表：`src/engine.rs` 的 `variablesDict` / `initial_lists` 编译分支，以及 `src/engine/value.rs::Cell::from_json`，应保留 JSON 字符串标签。
- 嵌套列表：`src/engine/value.rs::text_guarded` 的逗号串化，与 `src/engine/kn_conversion.rs::convert` 的失败回退；此处已有列表专用转换。
- 对象缺失值：`src/engine/kn_objects.rs::eval_object_get` 应产生 Undefined；之后分别由全局赋值、文本拼接、convert、list_item 决定可见结果。不能把对象读取统一改为 0，否则会破坏转数字与列表存储。
- 双边报告定位 `missing-object/listMissing` 的官方 NaN vs NekoC 0：`ValueExpr::Item` 读取 Undefined 后被下游全局赋值归零。补测证实普通索引与 last 都应将 Undefined 转 NaN，但必须保留 null；本轮已修复这个 KN 分支，见 [kncompat.md](kncompat.md)。

## 复验

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/semantics-kn-value-types.mjs --generate
$fixtures=(Get-ChildItem tests/fixtures/kn-value-types/*.bcmkn).FullName
node tools/editor-compat.mjs @fixtures --channel msedge --out dist/kn-value-types/editor-compat.json
node tools/semantics-kn-value-types.mjs --out dist/kn-value-types/official.json
node tools/semantics-kn-value-types.mjs --original-inputs --out dist/kn-value-types/original-inputs.json
node tools/semantics-kitten-n.mjs --case conversion --out dist/kn-value-types/base-conversion.json
node tools/semantics-kitten-n.mjs objects --case objects --out dist/kn-value-types/base-objects.json
node tools/semantics-kn-value-types.mjs --archive dist/kn-value-types/official.json --editor dist/kn-value-types/editor-compat.json --original-report dist/kn-value-types/original-inputs.json
node --test tests/kn-value-types.test.mjs
```

主代理可另外执行 `cargo test --test kn_value_types`；已有 `kn-trace` 可用时，新工具的 `--out ... --nekoc <exe>` 会在报告中增加逐变量双边结果，但不自动将差异重定义为官方错误。
