# Kitten 4 支持

NekoC 的 Kitten 4 目标使用原生 JSON `.bcm`，Kitten N 目标继续使用 `.bcmkn`。

## 编译

```powershell
cargo build --bin nekoc
.\target\debug\nekoc.exe compile-ts-kitten4 samples/kitten4-demo.ts --out samples/kitten4-demo.bcm
```

自定义原生模板可加 `--template my-template.bcm`。不指定模板时使用内置资源建立原生 Kitten 4 项目，默认舞台为横屏 **1280×720**。源代码语法沿用现有 TypeScript 前端；当前目标不支持的积木会报告错误，并保留已有输出文件。

示例 [`kitten4-demo.ts`](../samples/kitten4-demo.ts) 绘制一个80步的蓝色正方形：方向键移动，空格画一段绿色线，C清屏。原生文件：[`kitten4-demo.bcm`](../samples/kitten4-demo.bcm)。

## Web Studio

```powershell
cargo run --release --bin web -- samples/kitten4-demo.bcm
# 打开 http://127.0.0.1:4173
```

可导入或拖入 `.bcm`，在现有积木工作区编辑，使用 Rust VM 运行，再导出 `.bcm`。`.bcmkn` 继续保留原来的打开与导出流程。

结构检查与保真往返也可通过 CLI：

```powershell
nekoc inspect samples/kitten4-demo.bcm --out kitten4-inspect.json
nekoc validate samples/kitten4-demo.bcm
nekoc roundtrip samples/kitten4-demo.bcm kitten4-roundtrip.bcm
```

## 架构

```text
TypeScript → 现有前端/标准积木表示 → Kitten 4 字段与连接适配 → 原生 .bcm
原生 .bcm → 格式适配 → Web Studio 编辑 + Rust VM → 格式适配 → 原生 .bcm
```

两种编辑器的项目结构不同，不能只改文件扩展名。Kitten 4 保存 `theatre.scenes/actors/styles`，每个角色或场景使用 `block_data_json.blocks` 与 `connections`；Kitten N 保存分开的字典和嵌套 `nekoBlockJsonList`。

官方 Kitten 4 当前获取到的模板字段为：

- `work_type: "KITTEN"`
- `version: 25`（数字）
- `application_version: "4.11.20"`
- `type: 1`（BCM文件类型；与横屏/竖屏无关）
- `project_name`、`size`、`theatre`、`variables` 等原生字段。

来源：[Kitten 4 官方编辑器](https://kitten4.codemao.cn/)，2026-11-02 检查。运行器、字段、菜单值和连接必须按对应编辑器实测，不能从 Kitten N 的同名积木推定完全相同。

## 当前映射范围

以下表格描述适配器覆盖。Web Studio 的“快速 VM 可执行性”报告进一步检查对应执行器是否支持整个脚本；官方浏览器验证的具体场景见下文。

| 类别 | 已有映射 |
| --- | --- |
| 项目与资源 | 场景、角色、分组、造型、变量、音频资源引用及项目尺寸；缺少编辑器当前场景字段时从场景顺序选择 |
| 事件 | 开始、按键、广播接收、条件事件；按键事件在原生 `DO` 与标准表示之间转换 |
| 控制 | 重复次数、一直重复、重复直到、条件分支、等待、等待直到、退出循环、warp |
| 数据 | 全局变量读写/增减；列表读写、插入、替换、删除、长度、查找、包含、复制 |
| 运算 | 常用算术、取模、随机、取整、单目数学、正向三角函数、数值属性、比较与布尔逻辑 |
| 文本 | 文本常量、连接、长度、包含、截取与分割 |
| 运动与外观 | 移动、定位、坐标增减、旋转、朝向、碰边反弹、大小、显示/隐藏、说话 |
| 画笔 | 抬笔/落笔、颜色、粗细、颜色属性、清屏 |
| 部分侦测 | 计时器、角色坐标与朝向 |

当前明确边界：

- 适配器接受原生 **version 25**；其他版本报错。
- 原生舞台规格为 **620×900（竖屏）/ 960×720（4:3）/ 1280×720（16:9）**。官方加载器按这些比例选择固定舞台，不接受任意画布尺寸；新导出使用对应规格，已有来源的原始尺寸可保真保留。
- 新编译的 `forRange` / `traverse_number`、脚本局部变量、自制积木定义/调用，以及映射表之外的积木会阻止导出。错误包含对应积木类型；已有输出文件不因转换失败而被覆盖。
- 已导入的未知积木、未映射菜单值和自制积木以 `kitten4::` 类型保留，能随项目导出；这些脚本的运行不计为已支持。
- 克隆、云变量操作、扩展积木、硬件、音频播放等执行语义不在当前映射范围内。资源保留不等于对应指令可执行。
- 文字印章暂作为未适配积木保留：官方文字朝向依赖原生角色角度，需要单独验证，不能沿用内部文字旋转方式。
- 官方 Kitten 4 的按下事件可在持续按住时重复触发；Web Studio 沿用现有 VM 的按键调度。单次按键回归通过不代表两个执行器的长按重复频率一致。
- Kitten 4 执行入口是 Web Studio；已有 `run` / `run-scenario` 命令仍面向 Kitten N 标准表示。

字段与插口的官方观测记录位于 [`kitten4-block-schema.json`](kitten4-block-schema.json)。

### 原生坐标约定

Kitten 4 的方向角以右方为0°、上方为90°；内部标准表示以右方为90°，正转角顺时针。面向角转换为 `90 - angle`，转动增量取反。原生角色的 `rotation` 属性使用**弧度**，运动积木插口和方向报告值使用**度**；方向报告值还会保留两位小数。适配器需要处理数值与表达式，不能直接复制同名运动积木的输入。舞台坐标的X/Y值沿用原坐标，不因格式转换缩放。

因此，导入后的方向输入可能显示额外的减法表达式，用来保留原生角度含义。导出由适配器还原对应表达式；编辑时应保留来源元数据。

## 文件与内部表示

Web Studio 内部继续使用现有标准积木表示。导入的原生 Kitten 4 数据保留在 `_nekocKitten4` 元数据中，以支持导出时恢复原生结构与未知字段。该内部元数据不应作为官方文件直接提交；使用“导出 .bcm”生成原生项目。

未编辑项目通过三方结构比较保留原生数据；修改受支持字段时仅应用相应差异。原生根节点、角色、工作区、积木和连接上的未知字段均有保真回归测试。

## 本地回归验证

2026-11-02：

- `cargo test --all-targets`：**238 项通过**，包含适配器18项、原生编译器9项、格式报告2项和 Web API 1项。
- `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`：通过。
- `npm run typecheck`、`npm run test:tools`：通过，工具测试28项。
- `npm audit --audit-level=moderate`：0项漏洞。
- 独立 Release 构建通过：`cargo build --release --bin nekoc --bin web --target-dir target/kitten4-release`。
- Kitten 4 Web Studio 浏览器检查6项通过：导入、数字编辑/撤销/重做、内部JSON编辑与元数据保护、VM/WebGL运行、原生导出/再导入、Kitten N导出回归；页面错误0项。
- 原有 Web Studio 浏览器回归7项通过，页面错误0项。

Web Studio 报告：[`kitten4-web-verification.json`](kitten4-web-verification.json)；[编辑后运行截图](kitten4-web-studio.png)。最终报告对应上述 Release 构建。

浏览器检查工具：`tools/verify-web-kitten4.mjs` 和 `tools/verify-web-studio.mjs`。二者接受输出目录和本地服务URL，例如：

```powershell
node tools/verify-web-kitten4.mjs .verification/kitten4-studio http://127.0.0.1:4173
```

## 官方编辑器实测

官方应用 **4.11.20 / BCM 25**，Edge **156.0.4314.58**，2026-11-02：

| 检查 | 结果 |
| --- | --- |
| 原生反序列化 | 73个积木、66条连接的字段与插口检查通过 |
| 舞台 | 输入、官方再导出、实际画笔画布均为1280×720 |
| 开始运行 | `sides=4`、`ready=1`、`keyCount=0`；位置约(-40,-40)、原生朝向0° |
| 蓝色方形 | 1280个着色像素，四边指定取样点均通过 |
| 右、上、空格 | `keyCount=3`，位置约(-20,-30)，新增绿色线段的指定取样点通过 |
| C清屏 | `keyCount=4`，画笔画布着色像素数为0 |
| 动态方向表达式 | 独立编译样例在官方运行器中得到(40,-30)、朝向-90°；296个着色像素和两处蓝色路径取样通过 |
| 原生画笔夹具 | 位置、粗细、颜色和像素通过 |
| Studio编辑后导出 | 修改后的73个积木、66条连接及1280×720舞台通过官方导入；此项为导入检查，未启动运行 |
| 验证器负例 | 故意使用错误插口 `invalid_size` 时检查失败 |

示例文件31,277字节，SHA-256：

```text
4bbcdf941f8703deb8fd1c9d9a26026674dc6d60ea1b17ca03b1559468701422
```

完整报告：[`kitten4-verification.json`](kitten4-verification.json)。[启动舞台截图](../samples/kitten4-verification/00-startup-stage.png)、[按键后画笔像素](../samples/kitten4-verification/01-step-brush.png)、[清屏截图](../samples/kitten4-verification/02-step-stage.png)。这些结果验证上述场景，不代表全部Kitten 4积木或调度行为已覆盖。

### 复现

需要 Playwright 和 Edge，或用 `--channel` 指定已安装的浏览器通道；可通过 `NEKOC_NODE_MODULES` 指向外部依赖目录。

```powershell
node tools/verify-kitten4.mjs --input samples/kitten4-demo.bcm --expect samples/kitten4-demo.expect.json --out .verification/kitten4-official.json --artifacts-dir .verification/kitten4-official
```

工具调用官方载入入口，检查反序列化后的积木字段/连接，点击原生开始按钮，发送按键，并读取实际变量、角色位置与画笔像素。`--no-run` 仅检查导入，不计为执行验证。
