# KN 对象积木：官方证据与实现边界

> 这是旧原生 KN 对象积木的**编辑器**证据，不是分享播放器证据。
> Rust 继续保留兼容老作品的实现；TS 前端现在不生成 `_object_*`，
> 改用数字句柄和列表堆。当前编译方案、限制和分享 bundle 证据见
> [ts-share-objects.md](ts-share-objects.md)。

本轮实现 catalog 中三个对象积木：`_object_literal`、`_object_get`、`_object_set`，及用户要求且官方确有注册的 `Object.keys`、`JSON.parse`、`JSON.stringify`。不把它们等同于完整 JavaScript 对象系统。原生 KN **0.27.4** 实测时间：2026-11-10。

## 可提交证据

- 原创作品：`tests/fixtures/kn-semantics/objects.bcmkn`，SHA-256 `44879ad1dc5511252d79600abc419cb7909ba089f4be6ae8dd5b2acd4768d963`。
- 键列表/JSON 作品：`tests/fixtures/kn-semantics/object-json.bcmkn`，SHA-256 `a9e3af12bb0989d71cf978cdc40f428cf81cd41a2391d0001200a37fba399f2c`。六变量官方/本地完全一致，`equal=true`、`pageErrors=[]`；编辑器 18 块 `ok=true`。归档同上。
- 完整作品变量观察、与 NekoC 的成对结果、对应编辑器检查：`docs/kn-objects-official.json`。官方/本地全部 14 个变量匹配，`done=1`、`equal=true`、`pageErrors=[]`；官方编辑器 74 块，`issues=[]`、`ok=true`。
- 官方源文件前缀：`https://creation.bcmcdn.com/neko/web/release/static/js/`。

| 文件 | SHA-256 |
|---|---|
| `main.8ccf2442.js`（M） | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| `main-vendors.07f7dd7e.js`（V） | `38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68` |
| `crc_libs.8196dbd1.js`（C） | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` |

源码位置均为原始 UTF-8 **零基字节偏移**：

| 位置 | 证据 |
|---|---|
| M:2962498 | `_object_literal` 先创建 `{}`，从 0 循环，条件是 `args[keyN]` 的 JS 真值；只写非空字符串 key，重复 key 后者覆盖。非字符串真 key 跳过，假 key 终止。 |
| M:2960709 | `_object_get` 取 `f(CONSTRUCTOR ?? obj)[key]`；`f` 对非 null object 原样返回，其他值变 `{}`。因此字符串不暴露字符/length，数组索引是 **0 基**；缺失属性是 undefined。 |
| M:2960812 | `_object_set` 用同一个 `f`，执行属性赋值，返回容器本身而不是所赋值。官方积木表面是语句块。 |
| M:2960257 | `Object.keys` 同样先经 f；数字键升序，其他键按插入顺序；字符串输入返回空数组。 |
| M:2948142 | `JSON.parse` 先 String(text)，失败 catch 返回 null；存入全局后读取因 UserVariable 的 nullish 默认变 0。 |
| M:2948236 | `JSON.stringify` 用原生 JS 序列化，异常 catch 返回空串。 |
| V:6127945 | JS 对象表达式转换为 `_object_literal`，mutation `items`，输入 `key0/value0` 起。 |
| V:6120591 | JS 属性赋值转换为 `_object_set`，输入 `obj/key/value`，mutation `computed`。 |
| C:822263 | `text_join` 读取 ADD0 起，遇到 undefined 停止连接；不是直接 String(undefined)。参数仍先求值。 |
| C:820058 | `logic_compare` 的 EQ/NEQ 调用模块 18111 的深相等；现场两个新建空对象比较为 true。列表搜索不走此比较。 |
| C:1025407 | `get_var_or_list` 对 undefined 全局值恢复默认值；get_variable 默认值为 0。因此缺失属性直接赋全局后，观察该全局得到 **0**。 |

原始官方 JS 只在忽略目录 `dist/kn-objects/`；原创只读探针 `tools/compat/kn-objects-oracle.mjs` 保存注册、转换和真实官方域函数调用。它只暴露 webpack loader/域函数工厂，不替换函数体、不修改用户作品。域函数实验中 `key0=12,key1='b'` 得 `{b:2}`，`key1=''` 后的 b 不进入结果，重复 a 得 `{a:2}`，缺失读取编码为 `{$undefined:true}`，标量 set 返回新对象。

## API 可用性调查（不是支持声明）

官方编辑器现场注册成功且域函数存在：`Object.keys`、`Object.values`、`Object.entries`、`Object.assign`、`Object.hasOwnProperty`、`Object.toString`、`JSON.parse`、`JSON.stringify`。静态方法的输入分别为 `obj`、`target/source`、`text` 或 `value`；实例方法有 `CONSTRUCTOR`。`Object.keys` 的数字键先升序，然后其他字符串保留插入顺序；`JSON.parse('bad')` 返回 null。

`_object_delete`、`_object_keys`、`Object.delete`、`typeof`、`type_of`、`_typeof`、`delete` **均未注册**。官方 JS→XML 对 `typeof a` 和 `delete a.x` 返回“不支持的一元运算符” warning。不能猜测或导出这些伪类型。`Object.keys({a:1})`、`JSON.parse('{}')` 分别转换成同名积木并由 `_execute` 包装，已实现，不需要尚未支持的通用 function_call。其他额外 Object API 仍显式未实现。

## 实现与保护

- `Cell::Object` 是共享可变、保留插入顺序的属性表；拷贝变量、嵌套读写和装入列表保留引用身份。`Cell::Undefined` 与 null、NaN 独立。
- 严格 `Cell::equals/index_in` 对对象使用引用身份；KN 对象 EQ/NEQ 按已证实的结构比较；K4 既有比较及列表搜索策略不变。
- 对象真值为 true、数值为 NaN、文本为 `[object Object]`。字面量值参数全部求值后再应用 key 终止规则。
- 自引用对象/列表可深拷贝（保留同一图内的别名）、结构比较；对象文本不遍历属性，列表文本检测活动路径并对循环引用输出空段。序列化遇循环或深度超过 128 返回显式错误，不无限递归。
- JIT 的 `none_tag` 样本包含 Object/Undefined；对象/键列表/JSON reporter 全部被 `jit_pure_tree` 保守拒绝，由解释器执行。含对象的全局赋值和列表元素不会被数值快速路径覆盖。1200 次热循环专项确认 native_ops > 0，同时对象增值、别名与列表 1200 项完全一致。
- KN 初始 JSON 对象可导入；K4 初始值仍显式拒绝对象（含列表嵌套对象），没有借 Cell 扩展悄悄扩大 K4 支持范围。扩展模块参数边界对对象/undefined 显式拒绝，不改变扩展协议。

## 明确风险/未实现

1. 原型对象/函数值不是该值模型的一部分：无同名自有属性时读取已知继承方法/`__proto__`，或写 `__proto__`，均明确运行错误，不返回伪造值。
2. 数组只支持普通密集 0 基索引读写（含尾部追加）与读取 length；稀疏索引、改 length、非索引 expando 属性显式失败。
3. 除 `Object.keys`、`JSON.parse`、`JSON.stringify` 外的 `Object.*` 仅留可用性证据，未实现；删除请求受官方 0.27.4 转换/注册能力阻塞，无删除和 typeof 伪 API。
4. Rc 共享图没有垃圾收集器；循环引用安全但会保留内存。测试主动断开循环。极深非循环 `deep_clone` 仍采用递归；不声称任意深对象树无栈限制。
5. 标量 `Undefined` 的通用 serde 表示为 null；专用证据 runner 递归编码为 `$undefined`，对象非有限数也不会在证据中混成 null。`JSON.stringify` 使用独立 JS 规则：undefined 自有属性省略、数组中 null、非有限数 null、数字键排序、循环返回空串。深度上限 128；JSON parse 的孤立 UTF-16 surrogate 仍受现有 Rust 字符串模型限制。
6. JSON.parse 当前用 serde_json；超出 f64 范围的 JSON 数字（例如 `1e400`）以及孤立 surrogate 不支持完整 JS 解析语义。对象自定义 `toString`/`valueOf` 函数值也未实现。

## 复现与回归

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-objects-oracle.mjs
node tools/semantics-kitten-n.mjs --case objects --out dist/kn-objects/semantics.json --nekoc target/debug/kn-trace.exe
node tools/semantics-kitten-n.mjs --case object-json --out dist/kn-objects/json-semantics.json --nekoc target/debug/kn-trace.exe
node tools/editor-compat.mjs --channel msedge --out dist/kn-objects/editor-compat.json tests/fixtures/kn-semantics/objects.bcmkn
$env:CARGO_PROFILE_DEV_DEBUG='0'; $env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'; $env:CARGO_BUILD_JOBS='1'
cargo test --test kn_objects --test kn_semantics --no-default-features
node --test tests/kn-objects.test.mjs tests/kn-semantics.test.mjs
```

七个对象定向集成测试、对象 JSON 单元测试及既有 KN 语义归档回归已纳入全量门禁；Node 证据/归档测试校验 fixture 与官方观察的绑定。最终门禁、集成后重跑及语料统计见 worktree 根目录未提交的 `OC-REPORT.md`。既有 `docs/kn-semantics-official.json` 及其十个 fixture 没有修改；对象是独立专项归档。
