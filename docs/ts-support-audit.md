# TS 写法支持情况（实测）

原有 156 条用例之外，普通 JS 兼容性回归见 `tests/js-compat.test.mjs` 和 `samples/js_compat.ts`：使用 `compile-ts-bcmkn` 编译，再由 `nekoc run --ticks 120` 在固定 60 Hz 虚拟时间内核对快照。对象积木格式依据 `tests/fixtures/kn-semantics/objects.bcmkn` 与 `docs/kn-objects-official.json` 的官方取证。`samples/js_compat.ts` 生成的作品已通过 `tools/editor-compat.mjs`（`ok: true`）。

## 能用，结果正确

### 变量

- 顶层 `let` / `const`：常量初始值（数字、字符串、布尔）写入变量表；数组、对象、函数调用等非常量初始值和普通顶层语句按源码顺序放入隐式开始脚本。
  - 有隐式脚本时，显式 `onStart` 仍是各自独立、并发运行的开始脚本，只是开头先等待顶层初始化完成（生成的 `__nekoc_ready` 标志）；初始化含 `wait` 时也会等它完成。没有隐式脚本时与原来完全一样。角色工作区的独立开始事件不在此屏障内。
  - 常量仍在所有脚本运行前存在，不实现 JS 的暂时性死区；不要依赖声明前读取变量。
- 回调里的局部 `let` / `const`，以及 `=`、`+=`、`-=`、`*=`、`/=`、`%=`、`++`、`--`。字符串变量用 `+=` 是拼接。
- `const [a, b] = [1, 2]` 数组解构。
- `enum`：成员会直接编译成常量，支持数字和字符串成员以及显式赋值（`A = 5`）。

### 函数

- 简单函数（若干局部声明加一个 `return`，或者没有 `return` 的语句函数）调用时内联展开。
- 递归函数（包括互相递归）、带多个 `return` 或提前 `return` 的函数，会自动编译成自制积木：
  - 返回值的编译成有返回值的积木，不返回值的编译成普通积木。
  - 参数和函数里的 `let` / `const` 局部变量每次调用独立：包装积木为每次调用分配一个列表帧，递归调用之后局部变量的值不会被覆盖。报告器递归深度上限是 200 层。
  - 递归函数的返回类型要写出来（如 `function sum(n: number): number`），否则 TS 推断为 `any`，`+` 会报错。
  - `return c ? a : b` 只计算被选中的分支，所以 `n < 2 ? n : fib(n - 1) + fib(n - 2)` 这种写法能正常结束。
- 箭头函数常量，如 `const f = (x) => x + 1`，规则同上。
- 内联调用的实参只计算一次，按顺序在函数体之前计算（没用到的参数也会计算）；数组实参按引用传递，函数里 `a.push(x)` 会改到调用方的数组。
- 默认参数 `function f(x, y = 10)`：常量默认值在调用处展开；`y = next()`、`y = settings.size` 这类默认值在调用处按参数顺序计算一次，前提是不读任何参数、用到的名字在定义处和调用处指同一个文件级变量或函数，否则编译报错。
- 有返回值的函数也可以单独作为一条语句调用，返回值会被丢弃。
- 不能给参数重新赋值（`n = n - 1`），编译时报错；先复制到局部变量。
- `defineProc`、`param()`、`callProc`、`defineReporter`、`returnValue`、`callReporter`。

### 控制流

- `if / else if / else`。
- `while`、`do...while`（至少执行一次）、`repeat(n, ...)`、`repeatTimes`、`repeatUntil`、`forever`、`warp`。
- 一般 `for` 循环：每轮重新计算条件，支持小数起点、变量步长、`i *= 2`、复杂条件、多个循环变量、循环体里改循环变量和 `for (;;)`。常量整数范围且循环变量只读时仍用紧凑的遍历积木。
- `for (const x of ...)`：可以遍历数组字面量、已知数组变量和 `self.list("名字")`（或 `.get()`），被遍历的值只计算一次；字符串字面量按 Unicode 码点遍历。
- `break`：能跳出各种循环，也能写在 `switch` 的任意位置；带标签的 `break` 能跳出外层循环或带标签的块。
- `continue`：可以写在嵌套的 `if` 和 `switch` 里；`for` 的步进和 `do...while` 的条件仍会执行。
- `switch`：支持贯穿和条件 `break`，判别值只计算一次。
- `try / catch`：try 里嵌套循环和条件中的 `throw` 都会跳到本地的 catch，`catch (e)` 拿到抛出的值（`new Error("x")` 拿到 `"x"`）。
  - 跨函数的异常和没有 catch 接住的 `throw` 编译报错，不会悄悄变成"停止"。
  - `try/finally` 里有 `return` / `break` / `continue` / `throw` 时编译报错（未实现每种完成方式都执行 finally）。

### 表达式

- 算术 `+ - * / % **`、一元负号。`%` 和 JS 一样（`-7 % 3` 得 `-1`），官方积木也是这样算的。
- 比较、`!`。
- `&&`、`||`、三元 `c ? a : b`：编译成带"如果/否则"分支的报告器自制积木，只计算被选中的一边，结果是操作数本身（和 JS 一样，`0 || "x"` 得 `"x"`）。不使用分享播放器缺失的 `logic_ternary`。
- `??`：只接受能静态证明不是空值的数字、字符串、布尔操作数（`let a = 0; a ?? 7` 得 `0`）；其他可能为空的操作数编译报错，不会当成"或"。
- `a++`、`++a`、`a--`、`--a` 可以用在表达式里（限可变的简单变量）。
- 位运算 `& | ^ ~ << >> >>>`：只支持两边都是常量，编译时直接算出结果。
- `Math.floor / ceil / round / trunc / abs / sqrt / exp / log / log10 / pow / max / min / random`、`Math.sin / cos / tan / asin / acos / atan`（弧度）、`Math.PI`、`Math.E` 等常量。
  - `Math.max` / `Math.min` / `Math.trunc` 的每个参数只计算一次，按从左到右的顺序。
- `Number()`、`parseFloat()`、`parseInt()`（取整数部分）、`String()`。
- 新增 `Math.sign / cbrt / log2 / hypot / atan2`。`sign / cbrt / log2 / atan2` 通过辅助自制积木保存实参，避免重复执行实参表达式；`hypot` 内联为 `Math.sqrt(Math.pow(a, 2) + …)`，每个实参只计算一次。以有限数字为支持范围；`atan2` 不保留负零象限，`hypot` 不承诺 Infinity/NaN 特殊组合的 JS 语义。
- `Number.isInteger` 支持数字输入；直接文本、布尔字面量返回 false。Kitten N 比较会做类型转换，动态混合类型输入和非有限数不保证 JS 语义。

### 字符串

- `+` / `+=`：按 TS 类型检查器给出的操作数类型决定。有一边是字符串（字面量、模板字符串、`string` 标注、函数返回值、元组位、`string[]` 元素、对象属性等）就编译成"连接"积木；`any`、混合联合类型（如 `string | number`）和非原始值编译报错，拼接请写 `String(x)`，相加请给出准确的数字类型（如 `getVar<number>("x")`）。
- 模板字符串 `` `n=${x}` ``。
- `.length`、`s[i]`、`s.charAt(i)`、`s.slice(a, b)`、`s.substring(a, b)`（不支持负数下标）、`s.includes(x)`、`s.split(sep)`。
- `indexOf`、`lastIndexOf`、`startsWith`、`endsWith`、`replace`、`replaceAll`、`trim`、`trimStart`、`trimEnd`、`repeat`、`padStart`、`padEnd`、`toUpperCase`、`toLowerCase`（只转换英文字母）、`concat`。
  - 这些方法没有对应积木，编译器会生成用循环实现的辅助自制积木，用到哪个才加哪个。
  - 比较字符时用的是积木的"等于"，和积木本身的规则一致（例如数字形式的文本 `"1.0"` 和 `"1"` 视为相等）。
- `join()`、`selectText()`、`length(x)`。

### 数组（列表值）

- 用数组字面量、`split()`、`tempList()` 初始化的变量是列表。
- 支持 `a[i]`（读第 i + 1 项）、`a[i] = v`、`a.length`、`a.push(x)`、`a.includes(x)`。读越界下标得到 Kitten N 的空值 `NaN`，不是 JS 的 `undefined`。
- `map`、`filter`、`forEach`、`reduce`（需要初始值）、`find`（找不到时返回空字符串）、`findIndex`、`some`、`every`、`sort`（可带比较函数，原地排序）、`indexOf`、`lastIndexOf`、`join`、`concat`、`slice`、`reverse`、`pop`、`shift`、`unshift`、`splice`。可以链式调用，如 `a.map(...).filter(...).join(",")`。
  - 回调里可以使用外面的变量；但不能使用外层自制积木（递归函数等）的参数，需要先复制到变量。
  - 作为语句写的 `a.reverse()` 会把结果写回 `a`；写在表达式里的 `reverse()` 返回新数组，不改原数组。
- 项目列表用 `appendList`、`listItem`、`listLength`、`deleteListItem` 等 API 或 `self.list("名字")`。
- `Array.from({length: n}, (_, i) => ...)`、`Array(n).fill(v)` 和 `new Array(n).fill(v)`。长度限定为有限非负整数；`Array.from` 负数截到 0、小数向下取整。映射的第一参数是目标平台的未定义占位值 0（不是 JS undefined），不支持 thisArg。fill 值求值一次，对象元素共享同一引用。

### 数据对象

- `{k: value}`、简写 `{k}`、嵌套数据对象，属性读取 `obj.k` / `obj[key]`（键必须是编译期常量）、赋值和 `+= / -= / *= / /= / %= / **=`，以及语句位置的属性 `++ / --`。
- 对象存成隐藏全局列表堆里的数字引用，只用分享播放器支持的列表积木，不用 `_object_*` 积木。别名、数组里的对象、函数参数和返回值都保留对象身份；复合赋值的目标和键各求值一次。详见 `docs/ts-share-objects.md`。
- 用到对象的程序里，函数编译成自制积木而不是内联展开；递归函数里修改或新建对象、以及递归局部变量要改写成循环。对象堆在重新开始前不回收。
- 缺失/可选属性、动态键、对象转换/打印/JSON、`delete`、表达式里的属性 `++` 明确报错；空键、`__proto__`、对象方法、访问器、展开和解构也报错。没有原型、类实例语义。

### 定时器

- `setTimeout(() => {...}, ms)`、`setInterval(() => {...}, ms)` 和两种 `clear`，支持省略延时、箭头表达式回调及 function 回调；必须是内联无参回调。不支持字符串代码、附加回调参数及捕获外层函数参数（可先复制到变量）。
  - 暂不支持在 `sprite(...)` 回调内部声明定时器，会明确报错；请从根工作区调度。
- 每次返回独立对象句柄，使用生成广播、带参数接收脚本、`wait(ms / 1000)` 和循环；两种 clear 均将句柄标为取消，正在等待的脚本醒来后退出，不中断正在运行的回调。
- 是 Kitten N 协作式脚本，不是浏览器事件循环：帧量化、负延时按 0、0 延时也经 wait 让出调度。interval 在上一回调结束后重新等待，不补偿回调耗时，不执行追赶、不实现浏览器嵌套钳制。句柄不是浏览器数字 ID，不承诺跨角色共享。回调局部变量仍受现有全局存储限制。

### 其他

- `wait`、`broadcast` / `onMessage`、`sprite()` 块。

## 编译时报错（Kitten N 没有对应概念）

- 对象解构、可选链 `?.`、一般 `new X()`（包括 `Map`、`Set`、`Date`、`Promise`）、`class` 实例和对象方法调用。
- `typeof`、`in`、`instanceof`。
- 剩余参数 `...args`、给函数参数重新赋值。
- 变量参与的位运算。
- `for...in`、动态字符串的 `for...of`、生成器 `function*`、正则表达式。
- `+`、`+=`、`==` 用在 `any`、混合联合类型或非原始值上（见上文"字符串"）。
- 读参数、或用到在调用处被局部变量遮蔽的名字的非常量默认参数。
- `JSON.stringify / parse`、`String.fromCharCode / charCodeAt` 等尚无可靠实现的全局/方法；没有借 Rust 专有运行时扩展输出不兼容作品。clamp 可写 `Math.min(hi, Math.max(lo, x))`。

## 能编译，但和 JS 不完全一样

- 读数组越界下标得到 `NaN`，不是 `undefined`（Kitten N 没有 undefined）。
- 报告器自制积木的递归深度上限是 200 层，更深的递归会报运行时错误。
- 事件脚本里的 `let` 仍是全局变量：同时运行的两个脚本用同名变量会互相影响（函数局部变量已按调用分帧）。
- `async` / `await`：`await` 会被直接去掉，不支持真正的异步。

逐条对照 Node 的语料结果见 `tests/ts-js-semantics/known-diff.md`。

## 写法建议

- 状态用 `setVar` / `getVar`，或者顶层 `let`；数据放进列表或数组变量。
- 递归函数写出返回类型。
- 字符串拼接时，让 `+` 的某一边能看出是字符串，或者直接用模板字符串、`String(x)`、`join()`。
