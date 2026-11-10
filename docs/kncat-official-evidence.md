# KN 新候选：官方证据摘要

本记录仅使用官方发布 JS 和官方编辑器现场调用；不把 HateNeko 的实现或注释作为官方证据。检查版本为官方编辑器 **0.27.4**（2026-11-10）。这里只说明证据和边界，不修改覆盖表，不声称 NekoC 已完整兼容。

## 证据身份与复现

官方前缀：`https://creation.bcmcdn.com/neko/web/release/static/js/`。

| 简称 | 文件 | SHA-256 |
| --- | --- | --- |
| M | `main.8ccf2442.js` | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| V | `main-vendors.07f7dd7e.js` | `38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68` |
| C | `crc_libs.8196dbd1.js` | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` |

下面位置均为**原始 UTF-8 文件零基字节偏移**，不是行号。`dist/kncat/oracle-source-locations.json` 保存 30 个带 URL、散列、偏移和长度的摘录。原始第三方文件、现场报告均只保存在忽略目录 `dist/kncat/`。

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kncat-oracle.mjs
node tools/compat/kncat-oracle-source.test.mjs
```

第二条命令验证三个文件散列及 30 个源码锚点。本次通过。第一条使用隔离的无头 Edge 页面暴露官方 webpack loader；除额外暴露一个官方函数工厂外，不改官方函数体。注册查询调用 `BlinkInstance.core.mainWorkspace.new_block(type)`，读取后立即销毁积木；没有生成或交付 `.bcmkn`，没有更改用户编辑器项目。完整现场结果：`dist/kncat/oracle-editor.json`；本次 `pageErrors=[]`。

## 最重要的区别：三个名称不是同名积木

| 候选名称 | 官方编辑器同名注册 | 已确认性质 / 正确积木类型 |
| --- | --- | --- |
| `__break__` | **否**，`Unknown block type __break__` | 类型声明伪名；M:2878885 明确 `#blockName break`、`#callee break_loop`。实际积木是 `break`；代码 API 是 `break_loop()`。 |
| `script_variables_set` | **否** | 代码 API。M:2846315 的 JS→XML 插件改为 `variables_set`；`variable` 字段必须编码脚本变量类型及名称。 |
| `change_script_variables` | **否** | 代码 API。正常积木→JS 路径是 `change_variables` 配合脚本变量字段；但官方反向插件存在下述实测异常。 |

脚本变量字段示例：

```json
{"type":"NEKO_SCRIPT_VARIABLE_TYPE-957f2554-87af","name":"a"}
```

类型标签常量位置 M:1740440。仅把原始字符串 `a` 放进普通变量选择字段，不等于脚本变量。

### 官方 `change_script_variables` 反向转换异常

M:2794762 对 `change_script_variables(...)` 的转换插件实际执行 `s.attributes.type=h.LO.variablesSet`，而不是 `changeVariables`。现场结果与源码一致：

```text
change_script_variables('a', 'increase', 2);
  → <block type="variables_set">（仍有 method=increase 字段）
  → script_variables_set('a', 2);
```

相对地，手工给官方转换器输入正确 `change_variables` XML 和上述脚本变量字段，会得到 `change_script_variables('a', 'increase', 2);`。因此不能用这个 API 的当前 JS→XML 结果证明“增减正确执行”，也不应把同名 API 算作可直接加载的积木类型。

实际 `variables_set` / `change_variables` 的脚本变量运行时分支分别位于 M:1649638 / M:1648304：按当前解释器数据读写已声明脚本变量；未找到时上报缺失脚本变量错误；增减调用官方算术助手并按 `increase` 选择 ADD，否则 MINUS。这些是**源码分支证据**，本次未做完整作品中作用域、嵌套调用、克隆隔离的运行验证。

## 其余候选确为注册积木，但证据层级不同

| 名称 | 编辑器注册与输入 | 官方行为证据 | 验证边界 |
| --- | --- | --- | --- |
| `_break_statement` | 是；无输入；“退出循环” | V:6191474 转成 JS `breakStatement()`；现场 `while (true) { break; }` → `controls_while` / `_break_statement` → 同义 JS | 已验证注册与转换；未验证 KN 作品运行时的独立支持、嵌套退出。 |
| `_continue_statement` | 是；无输入；“继续循环” | V:6052662 声明、V:6191551 转成 JS `continueStatement()` | 已验证注册与源码转换；未做完整作品运行测试。 |
| `_return_statement` | 是；输入 `VALUE` | V:6191242 读取 `VALUE` 后产生 `returnStatement(value)`；现场 XML→JS 得 `return 7;` | 顶层 JS `return 7;` 的 JS→XML 会被官方解析器拒绝，不能拿它测试运行。过程中的生成器可能改用 `procedures_2_return_value`，不是保证保留此类型。 |
| `controls_while` | 是；`BOOL`、`DO` | V:6183639 读取 BOOL / DO 产生 JS while；缺 BOOL 时转换器默认 true。现场 true/false 两种 while 可往返 | 注册 / 转换已验证；运行时分帧、让出、停止响应等未验证。 |
| `calculate` | 是；`input` | C:35903 注册数值输出；C:826722 调 `lex(input).toPostfix().postfixEval()`，异常变为 `block_bad_math_expression` | 调用真实官方域函数的值测试见下一节；非 JS eval。 |
| `get_timer` | 是；无输入；数值输出（C:42101） | C:824985 → `runtime_manager.get_timer_elapsed_s()`；C:1001041 → `(Date.now等价值 - timer_block_date)/1000` | 官方原型方法调用已测；墙钟秒，不是当前舞台显示计时器的数值 API `timer`。 |
| `reset_timer` | 是；无输入；语句块（C:42219） | C:824857 → runtime reset；C:1000962 只设 `timer_block_date` 为当前 Date；C:995467 的 run 同样初始化起点 | 原型方法调用前 1.234 秒，reset 后 0；未测暂停 / 后台节流。重置源码不操作舞台显示计时器。 |
| `_execute` | 是；`action` | M:2962264 的域函数空体；V:6164834 转换器会解开包装，使用 action 中的子积木 | 真实函数接收一个 JS 函数值时不调用它，返回 undefined。**不能据此说 action 子积木不求值**：该函数接收的是参数求值结果。 |
| `_array_literal` | 是；动态 `items` 输入 | M:2962446 返回 `Object.values(args)`；V:6191634 用 mutation items 数读取 items0… 后产生 JS array | 真实域函数、转换器均验证；不要把输入误作单个 `items` 数组或 1 基 items1 起。 |

### 不要把注册成功等同于运行成功

官方现场域函数 registry 中，`calculate`、`get_timer`、`reset_timer`、`_execute`、`_array_literal` 有索引；`__break__`、`script_variables_set`、`change_script_variables` 没有。`controls_while` / `_break_statement` / `_continue_statement` / `_return_statement` 也没有普通域函数索引。

这**不单独证明**控制积木不可运行：标准 `break` 也没有域函数索引，它由专用编译器处理（C:940686）。不过本次没有拿到新控制类型的端到端 KN 播放结果，所以这些类型应标“官方注册 / 转换已验证，原生播放行为未验证”，不宜根据常识或 HateNeko 行为补齐。

## 真实官方函数的局部行为测试

来自现场 `runtimeTests`。数学函数使用官方 `get_domain_functions` 结果；错误工厂用只记录错误种类的 stub，**求值器仍是官方实现**，不是独立复刻。

| `calculate.input` | 结果 |
| --- | --- |
| `1+2*3` | `7` |
| `(1+2)*3` | `9` |
| `2^3` | `8` |
| `2**3` | `block_bad_math_expression` |
| `sin(30)` | `0.5`（这个例子按角度） |
| `sqrt(9)` | `block_bad_math_expression` |
| `1/0` | `Infinity` |
| `1e2+1` | `6.43656365691809`，**不是科学计数法 101** |
| `-3+2` | `-1` |
| `bad(`、空串、`2+`、数值 `7`（非字符串） | `block_bad_math_expression` |

`_array_literal({items0:'a',items1:'b'})` 得 `['a','b']`。整数属性键遵循 JS Object.values 顺序：`{2:'two',1:'one',z:'last'}` 得 `['one','two','last']`。

`[3,1,2];` 通过官方 JS→XML 会生成 `_execute(action=_array_literal(...))`，`_array_literal` 上有 `mutation items="3"` 和 `items0` / `items1` / `items2`。XML→JS 恢复 `[3, 1, 2]`。部分官方转换返回了“不支持的表达式类型: math_number / logic_boolean”的 warning，但仍生成上述 JS，原始 warning 没有从现场报告中删除。

## 尚未验证

- 新控制积木在 KN 播放器中的独立编译 / 解释路径，特别是嵌套 break、continue、return 的作用域与调度。
- 作为积木参数的副作用、未连接输入默认值、异常传播和完整作品 UI 状态。
- 公式求值器全部函数、运算优先级与异常集；上面的有限样例不能替代完整语言规格。
- 脚本变量 API 当前反向插件异常之外的完整往返及运行作用域。

本次未运行 Cargo，未提交，未修改既有源码或覆盖表。新增的是原创探针、只读证据测试和本摘要；第三方 JS 只保留于 `dist/kncat`。
