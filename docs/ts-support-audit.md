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
  - 参数每次调用独立，递归安全；但函数里用 `let` / `const` 声明的局部变量是所有调用共用的，在递归调用之后还要用的值请放进参数。
  - `return c ? a : b` 会编译成"如果 c 返回 a，否则返回 b"，所以 `n < 2 ? n : fib(n - 1) + fib(n - 2)` 这种写法能正常结束。
  - 有返回值的函数只能用在表达式里，不能单独作为一条语句调用。
- 箭头函数常量，如 `const f = (x) => x + 1`，规则同上。
- 默认参数 `function f(x, y = 10)`。
- 有返回值的函数也可以单独作为一条语句调用，返回值会被丢弃。
- 不能给参数重新赋值（`n = n - 1`），编译时报错；先复制到局部变量。
- `defineProc`、`param()`、`callProc`、`defineReporter`、`returnValue`、`callReporter`。

### 控制流

- `if / else if / else`。
- `while`、`do...while`（至少执行一次）、`repeat(n, ...)`、`repeatTimes`、`repeatUntil`、`forever`、`warp`。
- `for (let i = a; i < / <= n; i++ 或 i += k)`，以及倒数 `for (let i = a; i > / >= n; i-- 或 i -= k)`。
  - 上下界可以是变量；起点越过终点时一次都不执行（和 JS 一样）。
- `for (const x of ...)`：可以遍历数组字面量、数组变量和 `self.list("名字")`（或 `.get()`）。
- `break`：能跳出 `while`、`for`、`for-of`、`do...while`、`forever`、`repeat`、`repeatUntil`。
- `continue`：可以写在循环体的最后，或者写成直接位于循环体里的 `if (...) { ...; continue; }`。
- `switch`：编译成"如果 / 否则如果 / 否则"链。
  - 连续的空 `case` 会合并（`case 1: case 2:`）。
  - 每个 `case` 要以 `break` 或 `return` 结尾，不支持贯穿到下一个 `case`。
- `try / catch / finally`：try 块里直接写的 `throw` 会跳到 catch，`catch (e)` 拿到抛出的值（`new Error("x")` 拿到 `"x"`）。
  - `throw` 写在 try 里的嵌套循环中、或写在被调用的函数里时，会停止脚本，不会被 catch 接住。
  - 带 catch 的 try 块里不能用 `break` / `continue`。

### 表达式

- 算术 `+ - * / % **`、一元负号。`%` 和 JS 一样（`-7 % 3` 得 `-1`），官方积木也是这样算的。
- 比较、`&&`、`||`、`!`、`??`。
- 三元 `c ? a : b`：编译成官方的 `logic_ternary` 积木。和官方运行时一样，两边都会先算出来再选，所以分支里不要放有副作用的调用。
- 位运算 `& | ^ ~ << >> >>>`：只支持两边都是常量，编译时直接算出结果。
- `Math.floor / ceil / round / trunc / abs / sqrt / exp / log / log10 / pow / max / min / random`、`Math.sin / cos / tan / asin / acos / atan`（弧度）、`Math.PI`、`Math.E` 等常量。
  - `Math.max` / `Math.min` 的参数会被算两次，参数里不要放有副作用的调用。
- `Number()`、`parseFloat()`、`parseInt()`（取整数部分）、`String()`。
- 新增 `Math.sign / cbrt / log2 / hypot / atan2`。`sign / cbrt / log2 / atan2` 通过辅助自制积木保存实参，避免重复执行实参表达式；`hypot` 内联为 `Math.sqrt(Math.pow(a, 2) + …)`，每个实参只计算一次。以有限数字为支持范围；`atan2` 不保留负零象限，`hypot` 不承诺 Infinity/NaN 特殊组合的 JS 语义。
- `Number.isInteger` 支持数字输入；直接文本、布尔字面量返回 false。Kitten N 比较会做类型转换，动态混合类型输入和非有限数不保证 JS 语义。

### 字符串

- `+` 拼接：只要一边能确定是字符串（字面量、模板字符串、字符串变量、`as string`、`join()` 等），整条 `+` 链都会编译成"连接"积木。两边都是 `getVar(...)` 这种不知道类型的值时按数字相加，需要拼接请写 `join()` 或 `as string`。
- 模板字符串 `` `n=${x}` ``。
- `.length`、`s[i]`、`s.charAt(i)`、`s.slice(a, b)`、`s.substring(a, b)`（不支持负数下标）、`s.includes(x)`、`s.split(sep)`。
- `indexOf`、`lastIndexOf`、`startsWith`、`endsWith`、`replace`、`replaceAll`、`trim`、`trimStart`、`trimEnd`、`repeat`、`padStart`、`padEnd`、`toUpperCase`、`toLowerCase`（只转换英文字母）、`concat`。
  - 这些方法没有对应积木，编译器会生成用循环实现的辅助自制积木，用到哪个才加哪个。
  - 比较字符时用的是积木的"等于"，和积木本身的规则一致（例如数字形式的文本 `"1.0"` 和 `"1"` 视为相等）。
- `join()`、`selectText()`、`length(x)`。

### 数组（列表值）

- 用数组字面量、`split()`、`tempList()` 初始化的变量是列表。
- 支持 `a[i]`（读第 i + 1 项）、`a[i] = v`、`a.length`、`a.push(x)`、`a.includes(x)`。
- `map`、`filter`、`forEach`、`reduce`（需要初始值）、`find`（找不到时返回空字符串）、`findIndex`、`some`、`every`、`sort`（可带比较函数，原地排序）、`indexOf`、`lastIndexOf`、`join`、`concat`、`slice`、`reverse`、`pop`、`shift`、`unshift`、`splice`。可以链式调用，如 `a.map(...).filter(...).join(",")`。
  - 回调里可以使用外面的变量；但不能使用外层自制积木（递归函数等）的参数，需要先复制到变量。
  - 作为语句写的 `a.reverse()` 会把结果写回 `a`；写在表达式里的 `reverse()` 返回新数组，不改原数组。
- 项目列表用 `appendList`、`listItem`、`listLength`、`deleteListItem` 等 API 或 `self.list("名字")`。
- `Array.from({length: n}, (_, i) => ...)`、`Array(n).fill(v)` 和 `new Array(n).fill(v)`。长度限定为有限非负整数；`Array.from` 负数截到 0、小数向下取整。映射的第一参数是目标平台的未定义占位值 0（不是 JS undefined），不支持 thisArg。fill 值求值一次，对象元素共享同一引用。

### 数据对象

- `{k: value}`、简写 `{k}`、嵌套数据对象，属性读取 `obj.k` / `obj[key]`、赋值和 `+= / -= / *= / /= / %= / **=`，以及语句位置的属性 `++ / --`。
- 使用官方 `_object_literal`（`items`、`key0/value0` 等）、`_object_get` / `_object_set`（`computed="true"`、`obj/key/value`）积木，别名保留对象身份。复合赋值的目标和键各求值一次。
- 对象属性的 `+` / `+=` 仍受类型推断限制：无法确认属性是文本时按数字处理，文本追加请写 `obj.s = String(obj.s) + "text"`。赋值的临时引用使用共享变量，不保证同一调用点跨 `wait` 重入安全。
- 空键、`__proto__`、计算字面量键、对象方法、访问器、展开和解构明确报错；没有原型、类实例语义。缺失属性服从 Kitten N 未定义值转换规则，不是完整 JS undefined。

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
- `continue` 写在嵌套的 `if` 里面、`switch` 贯穿到下一个 `case`、`case` 中间的 `break`、带标签的 `continue`。
- `JSON.stringify / parse`、`String.fromCharCode / charCodeAt` 等尚无可靠实现的全局/方法；没有借 Rust 专有运行时扩展输出不兼容作品。clamp 可写 `Math.min(hi, Math.max(lo, x))`，仍需注意现有 max/min 对实参重复求值的限制。

## 能编译，但和 JS 不完全一样

- 三元两边都会先算；`Math.max` / `Math.min` 的参数会算两次。
- `??` 按"或"处理（Kitten N 没有 null / undefined，没赋值的变量是 0）。
- `for` 循环起点是小数时会被取整。
- 两边都看不出类型时，`+` 按数字相加。
- 所有 `let` 都是全局变量：同时运行的两个脚本用同名变量会互相影响，递归函数里的局部变量也是共用的。
- 生成器 `function*`、`async` / `await`：`await` 会被直接去掉，不支持真正的异步。

## 写法建议

- 状态用 `setVar` / `getVar`，或者顶层 `let`；数据放进列表或数组变量。
- 递归函数里，递归调用之后还要用的值放进参数，不要放进局部变量。
- 字符串拼接时，让 `+` 的某一边能看出是字符串，或者直接用模板字符串、`join()`。
