# TypeScript 对象的分享播放器兼容方案

本方案把受限的 TypeScript 对象编译为**全局扁平列表堆和数字句柄**，不依赖 `_object_*` 私有对象积木，也不把 JavaScript 对象直接交给官方播放器。

这是一套有明确边界的对象子集，不是完整 JavaScript 对象模型。官方公开 bundle 的源码及局部执行证据支持底层操作；**尚不能据此宣称已经通过真实发布作品的分享播放器验证**。

## 数据布局

编译器收集本次编译涉及的静态属性名，为每个名字分配从 0 开始的槽位 `slot`。所有对象使用同一个槽位表、同一个固定宽度 `W`，存放在隐藏的全局列表 `__nekocObjectHeap` 中。

- 对象值是其首个堆单元的 **1 基数字句柄** `handle`，不是对象序号。
- 用 JavaScript 风格的 0 基下标表示，属性读取为 `heap[handle - 1 + slot]`。
- 官方 `list_item` / `replace_list_item` 的下标为 1 基，因此最终积木位置为 `handle + slot`。
- 每次分配追加 `W` 个单元，返回 `heap.length - W + 1`。
- 当前采用全局统一布局；没有写入该对象的槽位会预留并填入 `0`，但这个 `0` **不能当作缺失属性的 JavaScript 值**。
- 空对象也必须保留至少一个单元，以便不同分配拥有不同身份。

例如槽位表为 `{ x: 0, child: 1 }` 时，两个对象的起始句柄可为 `1`、`3`。对象别名只复制数字；嵌套对象的字段也只保存另一个句柄。对象在数组中时，数组元素保存句柄。因此别名、参数传递和返回不依赖列表跨边界时的复制策略。

### 分配与求值顺序

每个对象字面量生成分配用自制积木。属性初始化表达式先作为调用参数求值，然后进入分配过程。追加全部槽位和计算返回句柄放在 `warp` 中，避免其他协作脚本在分配中途插入堆单元，破坏固定宽度和句柄地址；`warp` 不是跨网络或宿主线程的事务。

属性赋值需要先保存接收对象，再求值右侧。复合赋值还必须在右侧副作用发生前读取旧属性值，不能重复求值 `target()`、数组下标调用等表达式。测试 fixture 对这些顺序分别输出标量结果。

对象存储层只需要官方的列表、算术、变量、自制积木和 `warp`；用户程序原有的文本、比较、计时器、控制流及日志仍使用其对应积木。无需 `list_new`、`list_create` 或 `_object_literal` / `_object_get` / `_object_set`。

## 支持范围

在可静态确定类型和属性的前提下，目标支持：

- 普通数据属性对象字面量，包括简写属性。
- 点访问、字符串/数字字面量 key，以及单一 literal 类型的 `const` 标识符 key。不能只凭返回类型把 `key()` 这种调用当常量；先求值存入 const，再以该 const 访问。
- 对象别名、引用相等比较，以及修改后经别名观察结果。
- 嵌套对象、父字段替换后仍有效的旧子对象别名。
- 对象数组、数组中的对象，以及对象中的数组。
- 自制积木/普通函数的对象参数和对象返回值，包括每次调用生成新对象。
- 作为语句使用的属性 `++` / `--`，以及支持的算术或文本复合赋值。
- 计时器回调使用同一全局堆中的对象句柄；这不意味着支持任意 JavaScript 闭包。

测试入口包括 `tests/fixtures/ts-share-objects.ts` 和 `tests/ts-share-objects.test.mjs`。同步 fixture 的 JavaScript oracle 使用可擦除的 TypeScript 类型和纯标量日志，共 54 条；计时器另有编译测试，不包含在这 54 条同步 oracle 中。

## 拒绝范围

以下构造不应退化为数字句柄运算或伪造 JavaScript 语义，而应给出带源码位置的编译错误：

- 动态 key、运行时计算的属性名；computed 字面量属性也不在当前支持范围。
- 对象到字符串/数字的隐式或显式 coercion，例如直接输出对象、`String(obj)`、`Number(obj)`、模板插值或对象算术。
- `JSON.parse` / `JSON.stringify`、对象反射与合并等未实现操作。
- `delete`、对象 spread、对象方法、getter/setter/accessor，以及原型相关特性。
- 需要取得属性/元素更新表达式值的写法，例如 `const old = obj.x++`；改用独立更新语句和显式读取。
- 缺失或可选属性读取/写入，以及 optional property access。
- 不允许用类型断言把空对象伪装成已有初始化属性的对象；请直接在字面量中初始化完整形状。
- 未标注形状的函数参数属性访问；请写 `obj: { x: number }`，不要通过 `any` 隐藏对象类型。
- 将对象赋给 `any`/`unknown` 别名、擦除对象形状的类型断言/返回类型、联合类型属性访问也会被拒绝，避免泄漏内部数字句柄。数组回调对象参数应显式标注形状，合成过程保留该标注。
- 对象放入 `any`/`unknown` 属性或数组元素同样拒绝；箭头表达式返回也必须保留形状。合成数组回调通过原节点映射查询类型，保留含 import 模块中的本地类型别名作用域。
- 对象值 `&&`/`||` 不支持；用显式 if/else 选择对象。文本 API（例如 `say`）不能接收对象，请传标量属性。
- 对象与标量直接比较、对象值三元表达式、对象数组直接 `join()` 或默认 `sort()`；改为比较引用/标量、if/else、映射标量属性或提供比较器。
- 对象程序中分配/修改对象或含局部变量的递归函数；改为显式状态的迭代循环。
- 对象赋值目标或右侧调用 `wait` 等可让出执行的操作；先在赋值前独立求值。
- 对象程序中含局部变量且直接或间接调用让出操作的函数（包括导入、事件和数组回调路径）；局部变量仍是 VM 全局槽，暂不支持 per-call 局部存储。改为显式状态机或 per-event 状态参数，不允许并发重入后静默覆盖。
- 对象/对象容器跨赋值、断言、实参和返回边界必须递归保留形状；用户泛型传入/返回对象保守拒绝。不能将嵌套对象擦除为 `unknown[]`、`{child: unknown}`，也不能把标量/unknown 断言成对象句柄。
- 对象引用必须声明时初始化，返回对象的函数必须每条路径返回有效引用。对象程序中的 `throw` 暂时拒绝；改为显式标量状态，在分配前判断。
- 对象数组 `pop/shift/find` 可能返回缺失引用，当前一律拒绝，改为经过长度/选择检查的索引访问。`map/filter/slice` 等有泛型类型保留，不会退化为 any；对象容器整体日志、转换和模板插值同样拒绝。
- 对象值 `reduce` 当前在用户调用点拒绝，改用显式 `for` 循环和已初始化 accumulator；不会要求用户修复隐藏 helper 的 any 参数。
- 过程路径中省略的默认参数若依赖本函数参数，暂时拒绝，改为显式传入该实参；全局默认表达式和显式传参仍可用。
- 字符串属性 `++/--`、string/number 联合属性的 `+=` 不会猜测 coercion；请保持单一标量类型并显式改写。

尤其不能因为对象宽度统一、空槽填 `0`，就让 `obj.missing` 返回 `0`：JavaScript 应当得到 `undefined`，二者在比较、转文本和算术中均不同。**当前策略是拒绝缺失/可选属性访问，要求在字面量中显式初始化所需属性**，不承诺稀疏对象或“空对象稍后任意增加字段”。

## 生命周期与限制

- 每次运行初始化时重建堆，旧运行的 handle 不能持久化或跨运行复用。
- 当前没有 GC；重复分配会持续增长堆，包括计时器回调中的分配。
- 句柄是内部表示，不可当作公开数字 ID 参与业务算术、JSON 或对象 coercion。
- 不应删除或插入堆中间单元，否则所有后续地址失效。
- 不要用 `list_copy` 实现对象赋值：那会改变应共享的身份。
- 不同对象形状仍占用统一的 `W` 个单元，空间开销随全程序属性集合增加。
- 对象程序的普通函数使用自制积木而不是表达式替换式内联，以保留实参单次求值。数组字面量通过返回值积木连接过程参数，布尔形状的实参用 any 形状的选择积木包装，防止官方编辑器丢弃连接；底层值仍是原始列表/布尔。
- 对象程序的角色开始事件也等待顶层初始化屏障，避免角色先于堆初始化执行。

### 审查返工回归入口

`tests/knobject-review-codegen.test.mjs` 覆盖字符串展平、14 类 Boolean-only reporter
的对象初值/过程参数包装、key 副作用拒绝、参数依赖默认值诊断；
`tests/knobject-review-boundaries.test.mjs` 覆盖并发与导入 yield 路径、递归形状保留、
方法返回缺失、伪造/未初始化引用、容器 coercion 和 reduce 用户位置。
`tests/fixtures/knobject-review-valid.ts` 由 Rust 解释器/JIT 和 WASM 包运行验证，
包括字符串 `+`、数组方法后的共享引用、`divisibleBy` 布尔初值/实参和 reduce 的显式循环替代。

返工时对组合 `divisible_by`、`math_number_property`、键盘/鼠标、碰撞、文本/列表
reporter 的作品和上述 valid fixture 做官方编辑器 0.27.4 检查，均 `ok: true`，
`issues: []`、`pageErrors: []`；只读本地证据在 `dist/rework-editor.json`。
这证明这些测试作品没有连接丢失，不替代运行语义或完整发布链路验证。

## 官方分享 bundle 的精确证据

2026-11-14 访问 <https://kn.codemao.cn/player>，浏览器实际加载：

```text
https://creation.bcmcdn.com/neko/web/release/static/js/main.0f3db563.js
SHA-256: 42841119872219828a193880c7261774643e05e14848be58e6679d78b9add827
```

主 bundle 本身包含列表工厂、变量管理器和两套过程解释器；该次访问未加载独立 `crc_libs`。下表 offset 是**未修改文件中从 0 开始的字节偏移**。这些位置的 UTF-16 offset 与字节 offset 相同，均在第 2 行，1 基列号为 `offset - 70`。module ID 只适用于这个精确 hash，不是稳定 API。

| 功能 | webpack module | 字节 offset | 关键源码 |
| --- | ---: | ---: | --- |
| 列表实现工厂 | 89196 | 2181538 | `getListDomainFunctions:function(e)` |
| `list_item` | 89196 | 2183066 | `var g=o[f(...)-1]`，然后 `return b?g:NaN` |
| `list_append` | 89196 | 2183676 | `s.push(c),o(n,s)` |
| `replace_list_item` | 89196 | 2185004 | `g>s.length?s.push(v):s.splice(g-1,1,v)` |
| `list_length` | 89196 | 2185991 | 校验后返回 `o.length` |
| `temporary_list` | 89196 | 2187120 | 新建 `t=[]`，逐个 `t.push(e["ITEM"+n])`，返回 `t` |
| 变量/列表读取 | 97289 | 4852293 | 直接返回全局或实体变量中的值 |
| 变量写入 | 97289 | 4853198 | `this.variables[e]=t` 或实体变量直接赋值 |
| 算术 domain | 70542 | 4649861 | `math_arithmetic:function(e,t,n,r){return v[e.OP](e)}` |
| 变量读取 domain | 70542 | 4650422 | `r.runtime_manager.get_variable(e.VAR,t,n)` |
| 变量写入 domain | 70542 | 4650504 | `r.runtime_manager.set_variable(e.VAR,e.VALUE,t,n)` |
| warp 核心特殊积木枚举 | 79224 | 4668903 | `e[e.warp=4]="warp"`；同步 fixture 的分配/赋值 warp 亦经真实 Heart 执行 |
| 过程参数读取 | 15220 | 4714934 | `var s=o[a]; ... value:s` |
| 过程返回值求值 | 15220 | 4715692 | `return_value:n`，其中 `n=args.VALUE` |
| Debug 过程帧 | 15220 | 4725407 | `proc_parameters:i||{}` |
| Optimized 过程帧 | 83084 | 4789541 | `proc_parameters:i||{}` |
| Optimized 返回 | 83084 | 4785886 | `this.program_state.proc_return_value=t` |
| Optimized 参数编译 | 56612 | 4770949 | 生成直接读取 `proc_parameters[...]` |
| Optimized 返回编译 | 56612 | 4772074 | 直接调用 `proc_do_return_value(...VALUE)` |

这些实现没有在普通读写、列表元素存取、过程参数或返回路径上克隆数组。限定研究脚本还实际执行了从该 bundle 原样抽出的列表工厂、真实纯辅助模块、变量管理器及两套过程关键方法，引用身份和修改可见性检查均成立；UI/cloud 通知依赖使用 stub。这是**源码及局部真实实现执行证据**，不是完整分享页面验收。

例外是显式 `list_copy`：module 89196、offset `2185541` 使用 `(0,G.Z)(c)` 克隆源列表，再填入目标列表。`G` 来自 module 45534（起始 offset `11173233`），实现为：

```js
var r=n(40680),i=1,a=4;
t.Z=function(e){return(0,r.Z)(e,i|a)}
```

这条路径会深拷贝嵌套数组。`list_new` 和 `list_create` 在整个 bundle 中出现次数均为 0，也不是列表工厂注册项；新列表应使用 `temporary_list`。flat heap 不依赖嵌套数组的引用共享，因而不需要把源码研究中的“列表池套子列表”方案直接搬进编译器。

### 自制积木编码约束

应用预处理函数位于 offset `2348289`：`procedures_2_parameter` 从 `mutation.match(/id="([^"]+)"/)` 提取参数 ID，stable parameter 的字段则改为该积木自身 ID。定义 stable block ID、procedure `params` ID、参数引用 mutation ID 必须一致；显示名称不能替代 ID。返回积木需要编辑器风格的 `items="1"` mutation 和数字阴影块。

## 验证层级

应分别报告以下结果，不能相互替代：

1. **前端结构/拒绝测试**：是否只输出目标官方积木，是否对不支持语法给出诊断。
2. **JavaScript oracle**：独立执行原 TypeScript 擦除类型后的 54 条标量日志。
3. **本地 NekoC VM**：生成作品在本地执行后的标量输出是否逐条一致。
4. **缓存分享 runtime 直接执行**：若能用上述精确 bundle 的真实核心执行生成作品，应记录 fixture hash、bundle hash、必要适配和完整对比结果；不能悄悄换成自制解释器。
5. **官方编辑器兼容检查**：对生成 `.bcmkn` 运行 `node tools/editor-compat.mjs <作品>`，只有 `ok: true` 算通过。
6. **真实发布作品分享播放**：实际发布并通过有效 workId 在分享页面播放。

### 已完成的缓存分享 runtime 对比

2026-11-14，在隔离浏览器中使用上述缓存主 bundle 的真实 Heart 编译器及运行时，直接编译、加载并执行 `dist/ts-share-objects.bcmkn`，得到 **54/54 条标量日志与独立 JavaScript oracle 完全一致**。该次 fixture 的 SHA-256 为：

```text
027594f62242d6862a56059f2d244f9fb54049e37c7392dd9997630440d6c3b0
```

官方核心 lint 没有错误，结束后 `n_interpreters` 为 `0`。其中 `initializerCalls=1`、`argumentCalls=2`、`targetCalls=5`、`indexCalls=1`、`rhsCalls=1`，同时覆盖别名、对象参数/返回、嵌套和数组对象的同步行为。

这一实验使用 module 75337 的 Heart、module 63257 的官方 `K7` workspace 转换，以及 module 89196 中原始 operator/variable/shadow/list 工厂。复用了官方基础积木和过程运行时，并按应用的参数 ID 预处理逻辑转换 procedure；没有另写对象解释器或换掉堆读写实现。**唯一替换的执行端是 `console_log` 的 UI 输出 sink**：原 sink 的日志格式化需要已初始化的图形场景，直接调用会报 `Scene container needs init before using`，因此改为记录运行时求得的标量输入。手动驱动 running-group action 与 runtime update，不初始化图形场景。它不覆盖官方日志 UI、发布服务、实际分享页面加载作品、资源/场景渲染或计时器 fixture。

临时脚本为 `dist/kn-list-research/run-fixture.mjs`，完整结果为 `dist/kn-list-research/fixture-runtime.json`；重跑时应核对 fixture hash，避免把重新生成后的作品与旧报告混用。这些产物不属于需要提交的通用工具。

这项第 4 层实验仍不等于第 6 项。裸 `/player` 没有有效 workId 时只显示“作品不存在”；不得将它描述为已验证真实发布、发布打包或服务器处理链，也不能替代单独的官方编辑器兼容检查。

官方 bundle 和临时研究脚本只能保存在未跟踪的 `dist/`，不应把官方运行时或第三方作品提交到仓库。
