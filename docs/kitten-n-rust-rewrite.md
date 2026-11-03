# Kitten N 完整产品 Rust 重写：源码分析与实现进度

> 后续方向已改为 **WebUI + 优化 Rust 运行时 + WebGL2 渲染器**。当前入口和 `.bcmkn` 支持见 [Web Studio](web-studio.md)。本文保留首次源码调查与原生原型记录。

## 范围与当前状态

用户确认的目标是**完整产品**：积木编辑器、项目管理、运行器、舞台、素材、音频，以及原产品的扩展能力。

**当前交付是原生编辑器与运行器集成的开发预览，不是完整 Kitten N 替代品，也未达到全部积木兼容。**
本次建立可运行的 Rust 桌面入口和可复现源码盘点；后续工作以行为对照测试逐步补齐。
旧 TypeScript 编译链仍然存在，`compile-ts*` 仍依赖 Node；新的 Studio 打开、编辑、运行和保存不调用 Node、浏览器、Blockly 或官方 JS 包。

## 反编译材料与复现

分析的是公开发行 JavaScript 的 Webpack 模块提取/格式化结果，不是原始 TypeScript 源码，也没有服务端实现。
本地材料：`D:/AppData/Local/Temp/opencode/nekoc-kitenn/runtime-source/`；schema 为其上一级 `schemas.json`。
基线主包 `main.8ccf2442.js`，项目格式版本 `0.27.4`。

```powershell
cargo run --bin source-audit -- `
  D:/AppData/Local/Temp/opencode/nekoc-kitenn/runtime-source `
  --schemas D:/AppData/Local/Temp/opencode/nekoc-kitenn/schemas.json `
  --out docs/kitten-n-source-audit.json
```

盘点结果：

- 15 个发行包，逐个记录 URL、字节数和 SHA-256；可核验材料是否发生变化。
- 420 个提取到的积木 schema。**这不是所有按需扩展/硬件积木的总量保证。**
- 找到 20 个 `get*DomainFunctions` 入口。
- 90 个 schema 类型在 Rust `exec.rs` 有字符串引用，58 个在 `eval.rs` 有引用。
  这两个数字是**检索线索，不是功能覆盖率**：有引用可能只是空实现，通用分支也可能没有类型字面量。
- 每个 schema 的 `semantics_verified` 初始为 false。已有本地测试不自动等同官方行为一致。

仓库报告只含哈希、类型名、分类和符号位置，不包含官方发行包或图标资源。

## 架构证据

| 子系统 | 本地证据文件 | 观察 | Rust 对应方向 |
|---|---|---|---|
| 项目模型 | `assets-91107.js`，模块91107 | `BcmInstance` 持有各类 `*Dict`、排序、当前对象和变更事件 | 保留未知字段的 Document、可撤销命令、格式迁移 |
| 积木编辑 | `module-40742.js`、`module-53671.js` | `BlinkInstance`、工作区管理、积木连接、mutation、资源字段转换 | 原生积木图、schema 注册表、连接类型检查、动态字段 |
| UI 状态 | `pretty-17028.js` | React UI、MobX 状态、搜索、各类编辑面板 | egui 原生界面；当前不是原界面像素级复刻 |
| 调度 | `core-8541.js:100–167` | actions/broadcast 状态更新、解释器排序、逐个 `_step` | 单执行器协作调度、显式事件队列 |
| 优化解释器 | `core-83084.js:24–50` | 循环让出、过程栈、异步 domain Promise 锁、源映射 | 带可恢复 PC/调用栈的 VM 与宿主异步任务 |
| 配置 | `core-85990.js:5` | warp 4ms、30000 迭代、50000 过程调用、10000 调用深度、每实体300克隆 | 集中的兼容配置，不把多个预算混成一个计数器 |
| 领域积木 | `pretty-46501.js` | 动作、外观、运算、变量、列表、画笔、音频、摄像头、AI、联网等 | 按领域注册的处理器和可测宿主接口 |
| 输入 | `pretty-26921.js:7–16` | 角色/场景/全局点击不同，down 持续触发，键盘绑定当前场景 | 命中检测、焦点、按键状态、拖动与触摸事件 |
| 舞台 | `pretty-61248.js` | 纹理缓存、角色变换、场景层、画笔 Canvas、滤镜/动画/物理相关组件 | 渲染图、资源缓存、画笔纹理、碰撞几何 |
| 音频与云能力 | `pretty-46501.js` 对应 domain | 音频异步等待、云变量状态、AI/联网外部服务 | 音频设备与完成回调、网络协议适配；客户端材料不足以重建服务端 |

### 调度不是每角色一个 OS 线程

官方积木路径是排序后的解释器在同一调度轮次协作执行。直接将每个角色放在 Rust 并行线程中会改变广播、共享变量和绘图顺序。
Studio 当前只用一个后台线程承载整个 Runtime；UI 与运行器通过有界命令通道通信。
项目 JSON 由这个线程拥有，解释器借用它；不使用内存泄漏、unsafe 生命周期或逐帧重放。

### 普通循环与 warp

普通循环迭代返回让出；warp 只有超过预算才让出。Studio 的 cooperative 模式已加入普通循环让出、warp 分支状态恢复和4ms检查。
**仍未完全复现 CRC**：保留了10000执行块的保护预算，还没有独立30000循环/50000过程调用计数，调度排序和过程帧边界也需继续改造。
原有 CLI 场景测试默认保留旧调度语义，不能把 Studio 的行为变化当成 CLI 已完成迁移。

### 舞台与画笔

模块61248的画笔使用所属场景共享 Canvas；`penDown` 会绘制起点，线段还补起点圆。
角色坐标与 Pixi 坐标之间有 Y 翻转，项目/舞台旋转与积木角度还需统一转换。
当前 Rust 状态是每角色笔画列表，画面只做基础合成：跨角色笔画时序、场景清空、印章、透明度、中心点、碰撞及滤镜尚未对齐。

### 值语义不能直接照搬 Rust

`pretty-46501.js:640–760` 有数值/数组/文本转换、小数处理、三角函数舍入和分割后数字转换；CRC 还有 undefined/NaN 相关兼容开关。
当前 `RuntimeValue` 的 Null、数值转换、布尔转换与 JS/Kitten N 语义并不完全相同，需要独立值规范和对照用例。

## 本次新增的实际实现

| 文件 | 功能 |
|---|---|
| `src/source_audit.rs`、`src/bin/source-audit.rs` | 纯 Rust 源码盘点与证据报告 |
| `src/studio/document.rs` | 项目编辑事务、100步撤销/重做、未知字段保留、临时文件替换保存、ID及父连接维护 |
| `src/studio/player.rs` | 持久 Runtime 工作线程、增量 tick、事件、错误回传、停止回收 |
| `src/studio/app.rs` | 原生窗口、工作区积木树、字段编辑、拖动栈接到另一块后、场景/角色列表、属性、资源导入、舞台预览 |
| `src/bin/studio.rs` | `nekoc-studio` 入口、无窗口 smoke、实际窗口截图 |
| `src/runtime/{mod,exec}.rs` | 公开增量 API、可选 cooperative 模式及 warp 分支状态 |
| `tests/studio.rs` | 文档保真、失败回滚、ID/引用、栈移动防环、素材、运行器持久状态、warp、源码盘点 |
| `samples/native-studio.bcmkn` | 无外部素材、无 TS 编译的画笔示例 |

## 启动与使用

```powershell
cargo run --features studio --bin nekoc-studio -- samples/native-studio.bcmkn
```

1. 左侧选角色或场景；积木面板添加启动事件，再选中它添加动作。
2. 在积木卡片内编辑参数；拖动积木标题到另一块标题上，将整条尾部栈插到目标后。
3. 嵌套语句以缩进显示；复杂 mutation/输入替换目前可用 `Workspace JSON`。
4. `Run` / `Pause` / `Step` / `Stop` 控制会话。停止后才能修改项目，避免运行中途的引用失效。
5. 素材路径支持本地 PNG/JPG/SVG/WebP；导入为 data URL，使项目可携带素材。
6. 顶栏路径用于打开/保存；有未保存修改时打开另一项目会询问保存。

```powershell
# 不需要显示设备，不调用 Node
cargo run --features studio --bin nekoc-studio -- samples/native-studio.bcmkn --smoke --ticks 20

# 打开真实窗口，保存截图后退出
cargo run --features studio --bin nekoc-studio -- samples/native-studio.bcmkn --screenshot studio.png

cargo test --features studio --test studio
cargo clippy --features studio --all-targets -- -D warnings
```

## 尚未完成：完整产品的后续验收

### 本次验证记录

- `cargo check --features studio --all-targets` 通过。
- `cargo clippy --features studio --all-targets -- -D warnings` 通过。
- 新增 `tests/studio.rs` 12 项测试全部通过。
- 全量测试首次执行有1项失败：`cli_compile_ts_supports_variable_blocks`。工作区原先的 `ts/compile-ts.mjs` 已将 script-variable mutation 改为带 `<arg>` 子节点，旧测试仍断言空 mutation；本次未改动这两处。
- 排除该已知失败后，全目标回归173项通过；随后增加的 warp 内 break 回归用例及完整12项 Studio 测试通过。
- `samples/native-studio.bcmkn` 结构校验通过；20 tick 输出15条笔画、闭合路径、预期日志、0个活动脚本。
- 已启动真实 Windows 原生窗口并检查空模板/示例截图，验证 CJK 字体、积木树和SVG造型显示。没有完成全交互人工验收或官方像素/行为对照。

| 工作包 | 必须达到的验收标准 |
|---|---|
| 格式与资源 | 官方样例无损往返；版本迁移；未知扩展保留；资源丢失诊断与缓存 |
| 积木编辑器 | 全 schema 字段/下拉/mutation、表达式插槽、C形语句槽、类型检查、拖放/缩放/平移、复制、注释、自制积木参数 |
| VM | 场景过滤、值转换、局部/实体变量、广播等待、过程返回/递归、克隆、tell、异步等待；与官方逐步轨迹对照 |
| 渲染 | 舞台坐标与旋转、中心点、图层、共享画笔纹理、alpha命中、碰撞、特效、转场、动画；像素对照 |
| 音频 | 实际解码/混音、音量/音调/速度、停止、播放并等待及资源失败语义 |
| 素材编辑 | 造型绘制/裁剪/中心点编辑、声音录制/剪辑、资源库管理 |
| 输入 | 当前场景目标命中、全局/角色事件区分、按住触发、拖动、多点触摸 |
| 扩展 | 摄像头、AI、云变量、排行榜、硬件按实际协议接入；需要额外运行环境/服务实现 |
| 调试/性能 | 断点/单步/变量监视、运行错误定位、预编译块图、避免逐帧克隆整个笔画历史 |
| 完整全 Rust 化 | 若同时要求迁移旧 TS 编译器，应另用 Rust TS parser 移植前端；目前没有完成 |

“完整重写完成”的标准是上述功能有可追溯的对照证据，而不是窗口能打开、类型名在源码中出现或几个示例能运行。
