# Rust Web VM 兼容性增量（2026-11-03）

本轮优先修复会阻断实际项目的事件和调用链，而非只增加可识别的积木名称。文件导入保真、编译成功与运行语义正确是独立指标；下面不代表任意 Kitten N 作品已经完全兼容。

## 已交付

- 广播、带参数广播/接收、广播并等待，读取原生 `statements.DO` 接收体；支持动态消息表达式、独立任务参数、嵌套完成依赖、停止接收脚本后释放等待者。
- 有界可恢复事件队列。广播创建的任务和恢复的等待者可在本次更新继续执行，仍受原来的预算保护；等待依赖不引用会被压缩的数组序号。
- 四种停止范围、条件等待、松开事件脉冲、任意键查询和事件。
- 带参数语句自制积木，递归及 yield 后恢复参数，动态值与列表引用保持；不改动原有任务局部变量行为。返回值过程仍未迁移。
- 严格相等的列表查找/包含、文本包含、跨角色坐标/方向/缩放/造型序号、上下造型循环切换、坐标增减字段兼容。
- `math_number` 的 `NUM` / `TEXT` 空白影子值处理；游离 reporter / 已识别的游离语句栈不被误当事件执行，保留在原项目中。未知事件和可达未知指令仍报错。
- 修复 TypeScript 前缀 `!` 的连接表生成，重新生成当前正多面体。不能给丢失输入的旧积木猜补条件。

`get_orientation` 的官方含义是设备倾斜，不是角色朝向。桌面返回0；角色方向使用 `appearance_of_sprite` 的 `direction` 字段。

## 真实作品与绘图验收

### 32角色列绘图

`samples/pen_display_columns.bcmkn` 原先被广播/接收积木阻断，现在零诊断、可运行。Rust测试以每帧500条指令强制跨预算恢复，逐次检查提交帧时前/后缓冲一致，连续5帧没有接收任务泄漏。

初次浏览器检查发现顶部色带变为灰色。原因是列渲染样例先在黑色画笔上设置HSV饱和度，再设置亮度，而官方HSL画笔也会在黑色丢失饱和度。本轮修改的是 `modules/pen-display/columns.ts` 的属性顺序（先亮度再色相/饱和度），未更改VM既有的官方黑色边界语义；已重生成样例并增加颜色断言。

真实 WebSocket + WebGL2，Edge 156 / SwiftShader，1440×1000，2ms执行预算，约6秒采样：

| 指标 | 结果 |
|---|---:|
| 运行更新/s | 59.96 |
| 作品完整帧/s（作品计数器） | 23.98 |
| 实际绘图更新/s | 23.90 |
| 平均VM执行耗时 | 0.186ms |
| 采样时最大存活任务数 | 1 |

采样没有触及预算；跨预算正确性由强制低指令预算的Rust测试独立验证。浏览器截图像素检查检测到331015个彩色像素、96个量化色值。数字键1/3修改作品刷新率、重玩恢复30Hz均通过。以上是该次软件渲染实测，不是所有设备的速度保证，也不是与官方运行器的同条件性能对比。

### 正多面体与已有作品

- 当前本地正多面体：前缀取反操作数完整、列表成员检查/隐藏边运行，Space暂停、切分辨率、E/Q形体、H切换X-ray通过。
- 真实已发布正多面体 `335008960`：编码下载、旋转、切面数、暂停及原版/Rust恢复通过。
- 真实公开论坛文章内的「衛星 ASCII PV」：接管、Enter启动、音乐、FPS及原版恢复通过。
- Pencraft纯播放器：导入、持续键盘、暂停/重玩、限速、执行预算、全屏、移动布局、画笔缩放和Kitten4拖入回归通过。
- STARHOLD：菜单、键松开、选关、建塔、升级、波次、暂停和自然击杀回归通过。
- 扩展：注入/接管提示、右下角实际绘制FPS、全屏、资源捕获、端口重连和SPA清理回归通过，零记录的扩展错误。

已登录的真实 PICKCAT 作品页尚未直接验证；作品页接管使用测试容器加载真实官方播放器和真实资源，公开论坛文章则直接使用真实页面。登录与网站播放限制保持不变。

## 语料审计与未解决项

同一14个代表性本地项目，从10个编译可运行提升到11个。报告为 [web-compatibility-audit.json](web-compatibility-audit.json)，修改前为 [web-compatibility-before.json](web-compatibility-before.json)。不能把这个小样本比例当作平台整体兼容率。

- `pen_display_columns.bcmkn`：从广播/32个接收帽诊断变为零诊断。
- `我的作品-原生.bcmkn`：广播和游离块诊断已消除，仍阻断于真实可执行事件中的 `ask_and_choose`，未静默忽略。
- `eisei_pen.bcmkn`、`eisei_pen_128.bcmkn`：可达过程内的算术积木 `b123` 没有A/B操作数。检查确认不是游离块；保留报错，不猜补。与已验证的真实已发布ASCII PV资源不是同一份文件。
- 官方广播的精确帧时序、同消息多次触发的合并/重入等未全量对齐；克隆、返回值过程、交互问答、运行时切场景、碰撞和完整动态运算仍是后续缺口。

## 验证命令

```powershell
cargo test --bin web --test engine --test bcmkn_web --test web_kitten4 --target-dir target/web-validation
cargo clippy --all-targets --features studio -- -D warnings
node --test tests/*.test.mjs
node tools/audit-web-compat.mjs

$env:NEKOC_NODE_MODULES='D:\AppData\Local\Temp\opencode\nekoc-kitenn\node_modules'
node tools/verify-web-broadcast.mjs
node tools/verify-web-player.mjs
node tools/verify-web-starhold.mjs
node tools/verify-extension.mjs
node tools/verify-extension-overlay.mjs
node tools/verify-extension-sources.mjs
```

Rust专项55项、Node工具82项全部通过，严格Clippy通过。新增浏览器报告为 [web-broadcast-verification.json](web-broadcast-verification.json)，纯播放器与星垒报告分别为 [web-player-verification.json](web-player-verification.json)、[starhold-web-verification.json](starhold-web-verification.json)。截图保存在 `D:/AppData/Local/Temp/opencode/neko-broadcast-validation/`。

## 更新方式

本轮包含Rust后端修改，**必须使用新后端进程**。源码目录已编译 `target/release/web.exe`；分发包 `dist/neko-pickcat-windows.zip` 也已更新。关闭旧后端窗口，替换完整包并重新运行 `start-rust-backend.cmd`，刷新播放器页面。

扩展代码本轮未变，版本仍为0.1.3。单独更新扩展而不更新后端不会获得这些能力。正多面体请重新导入仓库中修正后的 `samples/pen_polyhedron.bcmkn`，旧下载文件的缺失输入不会被后端自动恢复。
