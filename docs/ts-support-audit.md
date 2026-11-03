# TS 写法支持情况（实测）

每条写法都用 `compile-ts-bcmkn` 编译，再放进 VM 运行，并核对运行结果（共 117 条用例）。目前 111 条结果正确；剩下 6 条是 Kitten N 没有对应积木的写法，编译时会直接报错并给出原因，不会生成错误的作品。

## 能用，结果正确

### 变量

- 顶层 `let` / `const`：初始值必须是常量（数字、字符串、布尔），会写进作品的变量表，作品一开始就是这个值。不是常量的初始值请在 `onStart` 里赋值。
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
- `try/catch`：只编译 try 里的部分。

### 表达式

- 算术 `+ - * / % **`、一元负号。`%` 和 JS 一样（`-7 % 3` 得 `-1`），官方积木也是这样算的。
- 比较、`&&`、`||`、`!`、`??`。
- 三元 `c ? a : b`：编译成官方的 `logic_ternary` 积木。和官方运行时一样，两边都会先算出来再选，所以分支里不要放有副作用的调用。
- 位运算 `& | ^ ~ << >> >>>`：只支持两边都是常量，编译时直接算出结果。
- `Math.floor / ceil / round / trunc / abs / sqrt / exp / log / log10 / pow / max / min / random`、`Math.sin / cos / tan / asin / acos / atan`（弧度）、`Math.PI`、`Math.E` 等常量。
  - `Math.max` / `Math.min` 的参数会被算两次，参数里不要放有副作用的调用。
- `Number()`、`parseFloat()`、`parseInt()`（取整数部分）、`String()`。

### 字符串

- `+` 拼接：只要一边能确定是字符串（字面量、模板字符串、字符串变量、`as string`、`join()` 等），整条 `+` 链都会编译成"连接"积木。两边都是 `getVar(...)` 这种不知道类型的值时按数字相加，需要拼接请写 `join()` 或 `as string`。
- 模板字符串 `` `n=${x}` ``。
- `.length`、`s[i]`、`s.charAt(i)`、`s.slice(a, b)`、`s.substring(a, b)`（不支持负数下标）、`s.includes(x)`、`s.split(sep)`。
- `join()`、`selectText()`、`length(x)`。

### 数组（列表值）

- 用数组字面量、`split()`、`tempList()` 初始化的变量是列表。
- 支持 `a[i]`（读第 i + 1 项）、`a[i] = v`、`a.length`、`a.push(x)`、`a.includes(x)`。
- 项目列表用 `appendList`、`listItem`、`listLength`、`deleteListItem` 等 API 或 `self.list("名字")`。

### 其他

- `wait`、`broadcast` / `onMessage`、`sprite()` 块。

## 编译时报错（Kitten N 没有对应积木）

- 对象字面量、对象解构、可选链 `?.`。
- `class` 方法调用、`typeof`。
- `toUpperCase` 等没有对应积木的字符串方法。
- 变量参与的位运算。
- `continue` 写在嵌套的 `if` 里面、`switch` 贯穿到下一个 `case`、`case` 中间的 `break`。

## 写法建议

- 状态用 `setVar` / `getVar`，或者顶层 `let`；数据放进列表或数组变量。
- 递归函数里，递归调用之后还要用的值放进参数，不要放进局部变量。
- 字符串拼接时，让 `+` 的某一边能看出是字符串，或者直接用模板字符串、`join()`。
