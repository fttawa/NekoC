# TS 写法支持情况（实测）

在 NekoC 里逐条编译（`compile-ts-bcmkn`），再放进 VM 运行，并核对运行结果，不只看能不能编译。有些"结果错"的条目可能有一部分是测试脚本自己的问题，修之前要逐条复核。

## 能用，结果正确

- **变量和赋值**：回调里的局部 `let`，以及 `=`、`+=`、`*=`、`++`。
- **函数**：
  - 普通函数调用时内联展开，但函数体只能是"若干局部声明 + 一个 `return`"。
  - 箭头函数常量，如 `const f = x => x + 1`。
  - `defineProc`、`param()`、`callProc`、`defineReporter`、`returnValue`、`callReporter`。
- **控制流**：
  - `if / else if / else`、`while`、`repeatUntil`、`warp`、`try/catch`（只编译 try 里的部分）。
  - `for (let i = a; i < / <= n; i++ 或 i += k)`，上界可以是变量。
  - `break` 可以跳出 `while` 和 `for`。
  - `do...while` 只有"条件一开始就不成立、只执行一次"这种情况对。
- **运算**：`+ - * / % **`、一元负号，只限常量参与运算。
- **字符串**：`join()`、`selectText()`、`length(x)`。
- **列表 API**：`appendList`、`listItem`、`listLength`、`deleteListItem` 等。
- **其他**：`??`、`const [a, b] = [...]` 数组解构、`wait`、`broadcast` / `onMessage`、`sprite()` 块。
- **数学函数**：用 `floor()` 和 `mathFunc("sqrt", x)` 这一套。

## 不支持，编译时直接报错

- **`Math.*` 全部不行**（`Math.floor`、`Math.PI`、`Math.max` 等），要改用 `floor()` / `mathFunc()`。
- **字符串方法**：`.slice`、`.toUpperCase`、`.includes`，以及 `Number()`、`parseInt`。
- **控制流**：
  - 递归函数。
  - 函数里写多个 `return`。
  - 倒数循环 `i--` / `>`：`for` 的条件只支持 `<` 和 `<=`。
  - `continue`。
  - 在 `forever` 里用 `break`。
- **JS 对象和数组**：
  - 对象字面量、可选链 `?.`。
  - `class` 方法调用、`typeof`、`repeat()`。
  - 数组 `push`、`a[i] = x`。

## 能编译但运行出错，或结果不对（危险）

- **VM 跑不起来**：
  - `(x as string).length`、局部字符串的 `s.length`、数组的 `.length`、数组下标 `a[1]`、对象解构。
  - 三元 `?:`、`&&` / `||` 组合。
- **结果错**：
  - **字符串 `+` 拼接**：`"a" + 变量` 得到 NaN，要用 `join()`。
  - **模板字符串**：输出多出一个字符，`n=5!` 变成了 `n=b5!`。
  - **取余**：变量参与的 `%` 是 JS 的余数（-7 % 3 = -1），不是积木的取模结果 2。
  - **位运算**：`(6 & 3) | 8` 得到 17，应该是 10。
  - **`switch`**：`case 2` 没匹配上，落到了 `default`。
  - **循环**：嵌套 `for` 里用外层的 `i` 当内层上界，结果错；`for-of` 遍历数组字面量什么都没执行。
  - **`do...while`**：正常情况只执行了 1 次。
  - **其他**：`enum` 的值不对；顶层 `let` / `const` 在回调里读到的是 0。

## 写法建议

最稳的写法：

- 状态全部用 `setVar` / `getVar`，数据全部放进列表。
- 循环只用 `for (let i = 0; i < n; i++)`，或者 `repeatUntil`、`warp`。
- 字符串用 `join` / `selectText` / `length()`，数学用 `floor` / `mathFunc`。
- 判断写成 `if`，不用三元。

"能编译但出错"那一组最坑：编译时不报错，运行才出问题。建议优先修字符串 `+`、三元、`&&`/`||`、`%` 和 `switch`，再把 `Math.*` 映射到对应的积木。
