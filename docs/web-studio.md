# Web Studio、Kitten N / Kitten 4 与高性能执行路径

新的主界面改为 WebUI：浅色工作区、中文积木、场景/角色栏、GPU 舞台、性能监视和日志。
执行器仍在本地 Rust 进程内；前端 JavaScript 负责交互、二进制帧解码与 WebGL2 提交。

## 启动

```powershell
cargo run --release --bin web -- samples/native-studio.bcmkn
# 浏览器打开 http://127.0.0.1:4173
```

省略文件时默认加载 `samples/native-studio.bcmkn`。`--port 4174` 可以更换端口。
执行基准和高密度绘图应使用 `--release`；无需 npm install 或前端打包。
服务绑定 `127.0.0.1`，多标签页共享服务端当前编辑项目；每个 WebSocket 播放连接拥有独立 VM 和启动时的项目快照。

PICKCAT 浏览器扩展安装与使用见 [pickcat-extension.md](pickcat-extension.md)。扩展和纯播放器使用独立项目握手，不会改变编辑器当前项目。

### 纯播放器

打开 **http://127.0.0.1:4173/play**，或点击编辑器左栏的「游玩」。独立页面只加载播放器、渲染器与游戏舞台，不构建积木编辑器 DOM。

- 导入 `.bcmkn` / Kitten4 `.bcm`，也可直接拖入；导入后自动开始。首次进入展示服务端当前项目，点击「开始游玩」。
- 暂停、继续、重玩、全屏；舞台保持作品宽高比，点击画面使用作品自身键盘操作。切到后台自动暂停。
- **更新上限**：30 / 60 / 120 次每秒或跟随屏幕。**执行预算**：2 / 4 / 8 / 12ms，每个请求单独传入，服务端限定1–16ms并维持指令上限；编辑器仍默认4ms。
- **渲染精度**：0.5× / 1× / 2× 原始舞台尺寸。切换时缩放并保留当前GPU画笔层，不重置VM或游戏状态；缩小后放大的既有像素无法恢复原始细节，后续绘图使用新精度。
- 设置保存在浏览器本地。顶部「绘制 FPS」统计实际收到并有绘图调用的更新，可能包含作品分步绘制；性能面板另列全部运行更新率、VM/GPU/往返耗时。

验证：`node tools/verify-web-player.mjs`，使用与下方浏览器验证相同的 `NEKOC_NODE_MODULES` 设置。覆盖 Pencraft 导入/键盘、限速、预算传输、暂停重玩、全屏、移动布局、Kitten4拖入、错误导入保留作品和画笔层缩放像素检查。截图与报告写入 `D:/AppData/Local/Temp/opencode/nekoc-pure-player/`。

高密度绘图示例：

```powershell
cargo run --release --bin web -- samples/web-pen-stress.bcmkn
```

也可以在页面里打开或拖入该文件。每轮产生10000条线段和1个落笔点，适合检查画笔提交成本。

已有作品兼容示例：`samples/pen_display_fast.bcmkn`。现在可直接打开运行，显示8条渐变色带、移动矩形、底部像素和FPS文字；按数字键1/2/3切换项目内的15/30/60调度档。

`samples/pencraft.bcmkn`（57 个变量）也已通过导入与浏览器运行验证：材质名称混合列表、临时工作列表、局部变量和语句过程可执行，地形/HUD 可见，持续 W 移动、方向键转向、数字选材质和 H 帮助切换通过。

## .bcmkn 支持

- 打开本地 JSON 格式 `.bcmkn`，支持 UTF-8 BOM、中文文件名和拖入。
- 读取场景、角色、造型、变量、音频、自制积木等字典；编辑器保留完整原始项目树。
- 展示当前场景/角色积木；点击其他场景或其他场景的角色可切换编辑舞台。
- 导出 `.bcmkn`，保留项目版本、未知扩展、mutation、自制积木和音频资源引用。
- 造型支持浏览器可解码的 data URL 和允许跨域读取的远程图片；加载失败显示资源诊断。
- 导入时分别报告**结构验证**与**快速 VM 可执行性**。不支持的脚本仍可编辑/导出，不会被删除。
- 从导入文件中逐脚本定位执行器尚未覆盖的功能。每个脚本检查首个错误，相同 owner/root-cause 合并为一条，并报告 `affected_scripts`；成功导入会清空上一项目日志。
- 已测试仓库现有 `pen_display_fast.bcmkn` 的完整导入保真、快速 VM 执行与 WebGL 像素结果。

这不是“任意 .bcmkn 已完整运行”的声明。文件格式保真与运行器语义覆盖是两项独立的验收。

## Kitten 4 `.bcm` 支持

- 支持在命令行启动时指定原生 `.bcm`，或通过页面导入、拖入。
- 自动将 Kitten 4 的平铺积木/连接表转换为内部标准表示，沿用现有积木编辑器和 Rust VM。
- 支持数字输入修改、撤销/重做、运行、导出原生 `.bcm` 与再次导入；界面显示当前格式。
- 原生来源数据保存在适配器元数据中，未识别字段与积木保留；未适配执行语义明确报告。
- JSON 页签显示的是**内部标准表示**。导出通过服务端适配器恢复原生文件，不能用内部JSON简单改名替代。
- `POST /api/import` 返回 `project`（标准表示）、`format`、`export_extension` 与兼容性报告；`POST /api/export` 返回对应原生格式。
- Kitten 4 编译示例使用1280×720原生横屏舞台。项目源码页签中的方向角采用内部标准表示，导出由适配器转换成Kitten 4方向角。

编译命令、格式边界与验证说明见 [Kitten 4 支持](kitten4.md)。

## 执行器优化

`src/engine.rs` 是预编译数值/画笔 VM，与原来的 JSON 解释器并存。

1. **加载时编译**：JSON → 枚举指令数组、变量索引槽、后缀表达式程序、跳转目标和源积木 ID。
2. **运行热路径无 JSON 查询**：不按积木类型字符串分派，不按变量名称查 BTreeMap。
3. **常量折叠**：仅折叠完全常量的数值表达式，不做不可靠的跨语句传播。
4. **复用表达式栈**：常量/变量单指令表达式直接取值，复杂表达式使用复用栈。
5. **可恢复调度**：普通循环每轮让出；warp 受每帧预算限制。每256条指令采样一次时钟，预算是软预算，不是实时硬截止。
6. **轮转公平性**：预算耗尽后将下一次调度起点移到后续脚本，避免长 warp 饿死其他脚本。
7. **过程调用**：语句自制积木按普通/warp上下文编译，使用显式返回栈；支持参数、递归与跨 yield 恢复。仅编译可达过程，不把调用体逐次展开。
8. **增量输出**：只复制发生变化的角色状态；画笔命令发出后回收缓冲区，不保存完整笔画历史。空闲帧没有角色和画笔更新。
9. **有限的帧工作量**：服务端每帧500000指令、4ms软预算、最多65536条画笔实例；可恢复而非预算耗尽就丢失执行位置。
10. **混合值与数值快路径并存**：数值槽/表达式栈仍使用 f64；文本、布尔、列表引用通过旁路 Cell 存储。列表元素支持混合值与嵌套列表；局部槽和遍历计数器归属任务。动态表达式调用数值程序时保留外层栈基址。

目前快速 VM 重点支持数值变量、算术/比较/布尔表达式、部分数学函数、启动/按键按下与松开/角色点击/广播事件、条件分支、重复/forever/until/break、warp、wait/wait_until、动作、画笔及带参数语句过程。

本轮扩展：

- 数值/文本/布尔/嵌套列表初始化、临时列表、追加、插入、替换、删除、长度与取项；直接引用编译为索引。列表赋值保留引用，复制深拷贝内容并保持目标引用，重启恢复初始数据。序号四舍五入、最小为1，越界读取为NaN；循环列表明确报错。列表监视器尚未实现。
- 脚本局部变量按任务隔离，声明执行时归零，零参数语句过程继承调用任务的局部值；支持跨 yield 保存。按键事件与持续按下状态独立传输，失焦/重启清除状态。
- 鼠标坐标、角色点击/按下/松开（自身、指定角色或整个舞台）；按透明像素和角色变换命中最前方角色。切换造型支持 ID 或序号，以及列表表达式；当前场景的备用造型预载。支持透明度特效与共享画笔图层置顶/置底/相对角色定位。
- `text_split` 数字 token/空白保留、UTF-16 文字长度、随机整数与反三角函数；音频播放/停止通过有序帧命令在浏览器执行，暂停继续保留音频进度。
- `traverse_number`：整数起点按方向向内取整，正步长四舍五入，按端点自动升/降序，包含终点。零、负数或四舍五入后为零的步长明确报错；这一无进展边界未复制官方的无限重复行为。
- 计时器 start/stop/reset、显示/隐藏；reset归零并开始计时。wait使用独立执行时钟，不受计时器停止影响。计时器基于每帧dt，尚未复制官方UI的50ms刷新量化。
- 画笔色相、饱和度、亮度、透明度设置/增减；`alpha=0`是不透明、`100`是全透明，设置RGB保留透明度。
- `text_join`、文本截取、文本/数值转换、混合值比较与布尔真值；截取按 UTF-16 单元索引，支持反向区间，单独截断代理项会替换为 U+FFFD。`stamp`是文字印章，支持字号、对齐和旋转。
- 广播、带参数广播/接收、广播并等待；接收体读取原生 `statements.DO`。每个任务独立保存参数，嵌套等待使用稳定任务 ID，接收任务完成或停止后释放等待者。新任务仍受指令、时间、输出及4096任务上限约束；`received_broadcast` 不再被永久记为真。广播批处理、重复触发的合并/重入及精确官方帧时序尚未全量对齐。
- `stop` 区分全部、当前、同角色其他脚本及其他角色四种范围；停止全部后不再响应外部事件，重玩恢复。`wait_until` 不满足时让出；按键 `up` 查询为松开事件脉冲，不是“当前没有按住”。支持 `any` 按键查询/事件。
- 语句过程参数保留数值、文本、布尔和列表引用；递归返回恢复调用者参数，原有脚本局部变量仍归任务所有。列表查找/包含按严格相等匹配，查找返回首个一基序号或0；支持文本包含、其他角色坐标/方向/缩放/造型序号、上一/下一造型循环切换。原生 `get_orientation` 是设备倾斜传感器，桌面与官方一样返回0，不再误读角色旋转。
- 修正坐标增减使用的原生 `increase` 字段；接受 `math_number` 的 `NUM` / `TEXT` 空白影子值为0，非数值错误仍明确报告。支持保留但不执行已识别的游离工作区积木；未知事件帽和事件体中的未知积木仍报错。
- TypeScript 前缀 `!` 现在将操作数写入原生连接表，修复导出后 `logic_negate: missing input logic`。已重新生成 `samples/pen_polyhedron.bcmkn`。旧文件中已经丢失的条件不能由运行器猜回，须重新编译或导入修正后的文件。

语义依据：提取的 `core-15220.js` 数值遍历、`pretty-46501.js` 画笔/列表、`core-61248.js` 文字印章，以及 `module-19519.js` 计时器控制。原JSON解释器的部分实现与官方不同，本轮没有用其印章/范围结果作为正确性基准。

**尚未迁移**：完整动态类型强制转换（包括所有运算符）、完整列表 reporter/监视器、返回值过程、交互式问答/选项、克隆、运行时场景切换、角色碰撞 reporter、音频等待与效果、造型印章、透明度以外的滤镜、AI和硬件等。遇到未支持类型明确报错，没有自动静默退回慢解释器。
新 VM 的调度/浮点/初始旋转转换并未全量对齐官方运行器；目前对照测试只覆盖已声明的数值/控制子集。

2026-11-03兼容性增量、真实绘图验证、语料剩余问题和升级方式见 [web-compatibility.md](web-compatibility.md)。

## 渲染器优化

`web/renderer.js`：

- **WebGL2 实例化画笔**：每条笔画是一条 capsule 实例，shader 计算圆端线段距离和抗锯齿覆盖。
- **持久 FBO**：新笔画写入共享画笔纹理；下一帧直接合成该纹理，不遍历旧笔画。
- **命令顺序**：Rust 按实际执行顺序追加画笔；文字印章携带笔画插入位置，renderer只在印章处拆分批次。clear 丢弃该帧之前的笔画与文字并清 GPU 画笔层。
- **缓冲区复用**：实例 VBO 按2的幂扩容，用 `bufferSubData` 更新；小帧不会重新分配大缓冲区。
- **造型缓存**：图片只解码/上传一次；角色属性更新不重复上传纹理。
- **文字纹理缓存**：Canvas2D仅将新文字栅格化为白色纹理，WebGL着色并写入持久FBO；缓存键为文字/字号，颜色改变不重复上传。LRU上限128项及16MiB，超大单条印章明确报错。旧文字没有CPU回放历史。
- **脏状态渲染**：无画笔、清屏、造型加载或角色变动时不发出绘制调用。
- **有界请求**：前端最多一个 frame 请求在途；停止/导入使旧帧失效，避免跨项目绘制残留。
- **异步 GPU 计时**：有绘图工作时采样 `EXT_disjoint_timer_query_webgl2`，最多4个未完成查询，不阻塞等待；不支持扩展时显示不可用，disjoint 时丢弃失效结果。

当前仍是每可见角色一次纹理绘制，没有实现全角色 texture atlas batching。画笔纹理大小跟舞台分辨率相关，不随累计笔画数增长；造型纹理占用取决于素材。
设备丢失会明确报错，尚不支持无需重跑脚本的画笔恢复；中心点、完整图层语义、滤镜和像素命中仍需补齐。

## 二进制帧协议

主界面连接 `ws://127.0.0.1:4173/api/player`，收到 `{ready:true,stats}` 后发送 `{dt,keys,pressed}`；每个请求对应一个二进制响应。`keys` 是新按下事件，`pressed` 是当前持续按下的键码。客户端只允许一个在途请求，并提供连接/帧超时与停止清理。

诊断用 `POST /api/start`、`POST /api/frame` 仍保留，HTTP frame 使用相同请求和响应格式：

```text
u32 little-endian: metadata 字节数（补空格到4字节对齐）
UTF-8 JSON metadata
float32 little-endian instances[]
```

每个实例9个 float：`x1, y1, x2, y2, width, r, g, b, a`。
metadata 包含 `sequence/reset/sprites/variables/timer/timer_visible/logs/clear/active/instructions/execute_us/budget_yield`。
可选 `text_stamps[]` 包含 `before_line/text/x/y/size/direction/align/color`；`before_line`表示先绘制多少条本帧线段，然后绘制该文字。位置单调不减，同位置按数组顺序绘制；空数组省略，纯画笔的二进制实例格式不变。
`reset=true` 时重建角色表，否则 `sprites` 是按 ID 的更新列表。
变量当前仍传数值槽数组；角色/资源初始信息在项目载入阶段传输。调试轨迹不随每帧增长。

## 测量与验证

### VM 基准

```powershell
cargo run --release --bin bench-engine -- --iterations 100000 --rounds 9 --out docs/web-engine-benchmark.json
```

固定同一项目，先预热；每轮验证两个执行器的最终变量值，再记录耗时。
编译耗时单列，旧解释器最终 snapshot 在计时外；新 VM 的帧结果生成包含在执行计时内。
记录见 [web-engine-benchmark.json](web-engine-benchmark.json)。加入混合值/局部变量后，Release测量旧解释器中位数23.10ms，新VM中位数1.63ms，约14.17倍；之前纯数值兼容版本为22.72ms/1.31ms。动态语义有成本，两轮也不是控制环境下的严格回归结论。
这是**数值循环微基准**，不是所有积木、任意项目、HTTP往返或GPU性能保证；环境负载会影响具体数字。

### 端到端结果（2026-11-02）

```powershell
node tools/profile-web-player.mjs docs/web-player-after.json
```

同一 Edge 156 + SwiftShader 软件渲染配置，1440×1000 页面；旧数据见 [web-player-before.json](web-player-before.json)，当前见 [web-player-after.json](web-player-after.json)。没有控制其他进程负载，不能把跨次差值归因于单项优化。

| 工作负载 | 旧版运行更新/s | 当前运行更新/s | 当前作品完整 FPS |
|---|---:|---:|---:|
| pen_display_fast | 221.47 | 162.83 | 未单独统计 |
| 10k 笔画压力 | 11.43 | 10.98 | 未单独统计 |
| Pencraft | 无法编译文本列表 | 116.95 | **43.77** |

Pencraft 用项目自身 `kn-var-frames` 的增量测量，连续3个8秒窗口为 **43.75 / 42.85 / 44.73 FPS**，24.01秒累计1051帧，默认出生视角/帮助面板。它不同于浏览器刷新率与 VM 更新次数，也不代表全部玩法或硬件GPU成绩；本轮没有重跑官方运行器做同条件倍数比较。

同轮100请求的独立传输测量（不绘图）：pen_display HTTP/WebSocket 均值 **2.01/0.357ms**，Pencraft **3.314/1.600ms**；约360KB压力帧则为 **7.31/11.96ms**，WebSocket没有在该大帧场景获益。压力场景异步GPU均值约 **78.31ms**，当前渲染吞吐没有实质提升。

检查过4顶点 strip 代替6顶点三角形的方案：交替绘制相同实例并同步读回，median **122.6ms vs 119.0ms**，没有改善，生产 shader 保留原方案。可复现脚本与结果为 `tools/profile-web-renderer.mjs`、[web-renderer-benchmark.json](web-renderer-benchmark.json)。

### 浏览器/GPU验证

```powershell
# 环境中已有 Playwright 时可设置外部 node_modules 位置
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/verify-web-studio.mjs
```

脚本使用独立 Edge + SwiftShader 运行（用于可复现正确性，不用于宣称硬件GPU吞吐）：

- .bcmkn 加载、执行闭合路径、带BOM文件、未知字段/mutation导出保真。
- 数值积木编辑、撤销、重做。
- GPU像素验证圆端笔画、覆盖顺序、持久画笔层和clear。
- 10000实例只需1次画笔 draw，加1次画笔纹理合成；静止帧0 draw。
- VBO容量复用，WebGL error为0。
- 完整高密度 `.bcmkn` 通过 Rust→二进制→WebGL2 路径运行。
- 文字覆盖笔画、笔画覆盖文字、文字持久化/clear、缓存命中不上传、LRU上限。
- `pen_display_fast.bcmkn`连续100个确定性dt帧：5051条新画笔实例、2次文字印章，8条色带和背景RGBA逐一正确，FPS区域检测到文字，WebGL error为0。该计数是验证轨迹，不是GPU吞吐测量。
- 实际文件选择器与拖入 Pencraft、零重复诊断、地形/HUD画面、持续W/右方向键、3选材质、H帮助、停止/重启/单步；WebSocket拒绝并发帧请求，重开后序号从1开始。

页面“渲染提交”是 CPU 提交时间；GPU 字段是最近一次可用的异步查询。“运行帧提交”统计收到并提交的运行更新（含无绘图更新），不等于作品完整 FPS。
验证报告和截图默认写入 `D:/AppData/Local/Temp/opencode/nekoc-web-verification/`。

### Rust检查

```powershell
cargo test --test engine --test bcmkn_web
cargo clippy --all-targets --features studio -- -D warnings
```

此前 `cli_compile_ts_supports_variable_blocks` 断言旧版空 mutation，与工作区已有 TS 修改不一致。本轮已将断言更新为官方要求的 `PARAMS0/PARAMS1` mutation 子节点；历史记录见 [上一轮记录](kitten-n-rust-rewrite.md)。
快速VM与导入专项共31项通过；新增混合/嵌套列表别名与深拷贝、重启隔离、循环引用错误、局部声明/并发/过程、嵌套数值动态表达式、UTF-16截取、按键状态和诊断聚合测试。全目标回归在独立 `target/web-validation` 构建以避开被其他会话占用的可执行文件：222项通过，原先跳过的 mutation 用例在更新后单独复测通过；严格 Clippy 通过。额外浏览器检查计时器显示/隐藏/停止通过。

## 后续优先级

优先补动态类型运算符一致性、参数/返回值过程、完整列表、广播/克隆及官方差分测试；渲染优化以GPU实测为依据，继续定位10k压力场景的软件栅格化成本。
UI 已转为 Web，后续以执行语义与端到端性能为主，不把视觉界面完成当成运行器完成。

## 2026-11-03 播放器性能优化

- **更新节奏与显示解耦**（`web/play.js`）：更新按「更新上限」用定时器推进，不再每个 `requestAnimationFrame` 只发一次往返；画面每个显示帧合成一次（`renderer.apply(frame, lines, false)` 只把画笔增量写入 FBO）。此前 120/s 实际被限制在屏幕刷新率；Pencraft 这类每帧 `wait(0)` 的作品在 120/s 下从 30 提升到约 55 作品 FPS（无头 Chromium + SwiftShader）。「跟随屏幕」仍是每显示帧一次更新；60/s 语义不变。
- **TCP_NODELAY**（`src/bin/web.rs`）：监听套接字开启 NODELAY，接入连接继承，消除多段帧尾段被 Nagle/延迟 ACK 卡住。350KB 画笔压力帧 WebSocket 往返 mean 4.3→2.4ms、p95 9.6→4.0ms、max 60→8ms（Linux 回环）。
- **VM**（`src/engine.rs`）：`ValueExpr` 变为 `Copy`（常量/拼接参数移入程序表），求值不再逐次克隆/释放；文本拼接直接追加；表达式改为在后缀数组上递归求值（预计算子树起点），去掉运行时值栈；`Op` 48→32 字节、`ExprOp` 24→16 字节；位置读取/有限性检查只在移动类指令执行。callgrind 指令数（60帧）：Pencraft 442M→370M，画笔压力 670M→594M，多面体 442M→383M。
- 原生端到端基准：`cargo run --release --bin bench-player -- samples/pencraft.bcmkn --frames 600 --hold 87,39 --frame-var kn-var-frames`，测量与 WebSocket 播放器相同的 VM + 帧编码工作。
