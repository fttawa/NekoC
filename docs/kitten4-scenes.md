# Kitten 4 起始场景和场景切换

## 证据边界

本页针对指定离线 Kitten 4 播放器的 `player_v2`，不是所有线上版本的兼容性声明。
外部只读文件：`$K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`。
SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
下面偏移为 UTF-8 解码后的 JavaScript 字符索引，不是字节偏移；可用 `String.indexOf` 复查符号。
`.orig` 有第三方包装器增加的 DI 暴露点，未独立认证等同于当前线上发布物。
没有复制官方内核或第三方作品到仓库；本次也未参考或移植 HateNeko。

## 起始场景

**播放器取 `theatre.scenes_order[0]`，不取保存的 `theatre.current_scene`，也不取场景字典首项。**

- 官方 theatre reducer `function O(t,e)`，偏移 **1740517**：加载作品时取 `e.payload.scenes_order[0]`，设置 `current_scene`；保存的当前场景不参与选择。
- Start 路径 `function ft()`，偏移 **1728353**：再次取 `theatre_states.scenes_order[0]`，发送 `scene_on_change`，设置 running group，再发送 `running_group_activated`。
- 自制 `initial.bcm`：保存 B、列表 `[A,B]`，实测从 A 开始。
- 自制 `reordered.bcm`：字典仍先 A、保存 A、列表 `[B,A]`，实测从 B 开始。

NekoC 只在有有效 K4 来源标记的 `Program::compile` 中按列表选初始场景，不修改导入后的编辑器选择，也不破坏导出 round trip。
Kitten N 原生作品仍按 `currentSceneId` 开始。列表为空或第一项不是现存场景时，VM 显式拒绝编译；
没有新增“退回保存场景/首个有效项”的猜测。无效作品在官方的完整失败路径**未验证**。

## 切换时的脚本和状态

| 对象/脚本 | 已确认行为 | 证据 |
|---|---|---|
| `start_on_click` | 所有场景的原型均在 Start 执行一次；切换不重启；离场仍可继续 | 自制 lifecycle：A/B 各计数 1，B 中的全局脚本能从 A 切 B 再切回 A |
| `on_running_group_activated` | 激活目标场景时触发；离场结束旧实例；返回时重新触发 | lifecycle：A 激活 2 次、B 1 次，旧的等待尾部没有执行；activationSwitch：切离自身后尾部计数 0 |
| 已运行的 `self_listen` | 离场暂停，不销毁；返回后继续原来的等待/后继，不重复执行入口 | lifecycle：入口 1 次，离场尾部 0，返回尾部 1 |
| 克隆实体 | 离场保留，返回仍为同一克隆，不重新创建 | lifecycle：两边场景各采样时都是 3 个角色；克隆 ID 不变，克隆启动计数 1 |
| 坐标/旋转/缩放/造型 | 不因切换重置 | lifecycle：原型和克隆始终保持 `(73,-29)`、37°、横纵 135%、`costume-b` |
| 全局变量 | 切换不恢复初值 | lifecycle 中的全部计数保留 |
| 切换到当前场景 | 不重新激活、不终止后继 | sameScene：激活计数 1，切换后的尾部计数 1 |

官方源码交叉证据：

- RegisterEvent `switch_to_selected_screen`，偏移 **661240**：调用 `stage.scenes.set_current_scene`，回调中切 running group 并发出激活与场景动作，没有重建舞台或恢复属性。
- core scenes `set_current_scene(t,e)`，约 **807699**：同 ID 直接返回；否则只更新 current scene、可见场景和转场，不销毁角色。
- RuntimeManager `change_running_group`，约 **1169786**：只更新组与 changed 标记。
- `step_code`，偏移 **1187919**：非当前组的脚本不执行；只有带 `finish_out_of_run_group` 的根会销毁。
- BasicBlockProvider `block_metadata`，偏移 **1676841**：仅 `on_running_group_activated` 注册 `finish_out_of_run_group`；`self_listen`、`when` 只注册 restart 标记。
- `current_interpreter_must_yield`，偏移 **1183732**：组变更后，当前脚本若属于旧组必须让出。

NekoC 改动仅限初始场景选择、离场结束条件、非当前场景任务的可运行条件和 K4 克隆保留。
不修改任务排列、广播唤醒队列、wait/循环 yield 或转场调度相位；Kitten N 的原有离场策略不变。
跨内核精确切换帧和“切换积木后的全局脚本能否同帧继续”仍属调度专项，**未在这里对齐**。

## 对比工具的采样修正

离线内核切场景时，`theatre_states.current_scene` 仍是加载时的编辑器选择，不能当作当前运行场景。
`k4-oracle.mjs` 现在从 `stage.core.scenes.get_current_scene()` 读取实际场景。
旧采样会把 lifecycle 的全部帧错误显示成 A，即使 B 的激活脚本已经执行。
集成测试要求实际观测到 B，防止再次误用 store。

此外，原工具只给角色的非全局根填写 `running_group_id`，现在也给场景自己的非全局根填写所属场景。
否则 `activationSwitch` 中的场景激活脚本会被工具错误地加载成不受组限制的脚本。
这属于 workspace 编译适配；仅发布 AST 仍原样加载，不改作品保存的运行组表。
指定语料中场景根的 `running_group_id` 也有 191 项指向所属场景（包括 activation/listen），
这是序列化结构的交叉检查，不作为作者脚本实际执行行为的独立官方证据。

## 复验

夹具生成器 `tools/compat/scene-fixtures.mjs`，复用仓库自有 workspace 构造器，所有图片为自制 data URI。
只生成 `.bcm`，不是 `.bcmkn`，不需要 KN 编辑器检查。生成/运行：

```powershell
node tools/compat/scene-fixtures.mjs --generate
$env:K4_PLAYER_DIR = 'E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app'
$env:NEKOC_NODE_MODULES = 'D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/scene-fixtures.mjs
$env:K4_ORACLE_INTEGRATION = '1'
node --test tests/kitten4-scenes.test.mjs
cargo test --test kitten4_scenes
```

生成器官方实测每件 180 帧、seed 1、60 Hz、无输入、禁外网，轨迹和资源哈希留在被忽略的
`dist/scene/fixtures/`。Rust 回归检查宽松时间窗口内的语义里程碑，不把调度相位差伪装成已对齐。

未覆盖：局部变量/列表跨场景的独立最小探针、可见性/特效/音频/物理/画笔像素、转场动画、
非 activation 事件所有种类、分身的任意自定义运行组、广播等待依赖跨场景的全部组合。
从“不调用重置”的源码可推测部分状态也保持，但这些项目的官方行为均标为**未验证**。
