# K4 第三轮：初始变量/列表监视框的 VM 输出

本轮只处理 Rust 加载/启动时的监视框登记和可见性，以及私有列表的既有文本输出契约。
`web/overlay.js` 的字体、布局和皮肤属于另一个独占任务，本轮没有编辑该文件，
也没有编辑 `web/renderer.js`、`tools/compat/k4-visual.mjs` 或 `tests/k4-visual.test.mjs`。

## 官方证据（只读）

唯一内核来源为外部只读目录：

```text
K4_PLAYER_DIR=E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app
src/player/build/player_v2.2d180c468559fbd29528.js.orig
SHA-256 0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160
```

下表是该单行文件的 **0 起始 JavaScript 字符偏移，不是 UTF-8 字节偏移**。
没有参考 HateNeko，没有从语料复制作品，没有修改外部官方文件。

|偏移|符号|观察|
|---:|---|---|
|1000005|`dr.load_variable`|列表走 `load_list`，其他走 `load_variable`，两条路径均调用 `n.set_visible(t.visible)`；不要求先有 show 积木|
|1001965|`dr.generate_variable_opt`|从声明读取 `id/type/theme/value/name/current_entity/position/scale`；值为字符串则直接用，否则 `toString()`|
|1002430|`dr.generate_list_opt`|列表读取 `current_entity` 并在运行时 `lists_get(n, undefined, a)`，因此必须保留私有拥有者，而不是误读全局列表槽|
|1003937|`dr.get_widget_prefix`|有 `current_entity` 时生成 `实体名·` 前缀；属于渲染元数据，不改公开 `Monitor.name` 协议|
|1014765|`load_stage_from_state`|遍历整个 `variable_states` 调用 `add_variable`，不按当前场景过滤；随后遍历云声明，保留其 `visible` 并把初始值设为 0|
|1020547 / 1020732|`update_variables` / `update_lists`|运行时更新已存在的组件值，不靠显示积木重新创建组件|
|578784 / 580608|`show_hide_variable` / `show_hide_list`|按 id 获取现有组件，再切换可见性；不能登记一个初始组件、显式 show 时又追加第二个|

源码表支持“对象声明遍历顺序”，并非 `variable_order` 重新排序。
探针故意采用 `z-score, a-text, m-items, ...`，并使 `variable_order` 倒序；
官方探针读取的每个组件的存在/可见性，但**没有把读取顺序冒充 PIXI 子节点顺序的动态验证**。

## 根因与修复

原来的编译器只有编译 `show_hide_variables/list` 时才登记 `monitor_targets`，
`Engine::start()` 又把 `monitors` 完全清空。保存为 visible 的声明如果没有显示积木，
就永远不会进入 `Frame.monitors`。这是 `docs/kitten4-fixes.md` 所记缺失项的 VM 根因。

改动：

- `src/engine/k4_monitors.rs`：在实体和变量槽已建立、脚本尚未编译时，按 canonical 声明顺序登记所有 K4 监视目标；
  记录全局标量/列表槽和角色或场景私有槽，保存声明的布尔 `visible`。
- `src/engine.rs`：增加一个**私有** `Program.initial_monitors: Vec<bool>`，启动或重启时恢复它；
  现有 show/hide 编译会复用这些 id，不产生重复目标。KN 路径不运行这项初始化，原行为保持不变。
- 私有列表原先经 `Cell::text()` 输出逗号拼接文本；改为与全局列表共享既有“每项一行、100 项后省略号”输出。
  100 项上限是本项目既有 Frame 契约，**不是声称官方只显示 100 项**。
- `src/kitten4.rs`：云变量 lowering 原来只保留 name/type/value/cloud，会丢掉 `visible`；现在额外保留该位。

**没有改变公开 `Monitor` 或 `Frame` 字段，也没有改变 Op / JIT / Cell 布局。**
公开监视框仍仅有 `id/name/list/value`；位置、theme、scale 和实体前缀所需声明仍在项目元数据中，
由 overlay 侧负责。canonical 可见性编辑仍有效，不强行从 provenance 的旧副本覆盖。

## 原创夹具与回归

生成器 `tools/compat/k4-monitor-fixtures.mjs` 只从仓库自制 `runerr-addition.bcm` 的舞台/资源外壳出发，
清掉原脚本和变量，建立全新的声明及脚本；没有读取第三方语料。

|夹具|覆盖|
|---|---|
|`tests/fixtures/kitten4/monitors-idle.bcm`|完全无 show/hide；初始数字、文字、列表、角色私有标量和列表、当前/非当前场景私有变量；false 和缺省可见性|
|`tests/fixtures/kitten4/monitors-dynamic.bcm`|先 wait，隐藏原可见全局及私有列表、显示原隐藏变量、改全局文字及私有数值，再恢复可见性|
|Rust 内联派生夹具|同一原创作品分别改 canonical 可见性、移除 K4 provenance、生成 102 项列表、加入云声明|

官方逐帧记录在 [kitten4-monitor-evidence.json](kitten4-monitor-evidence.json)，包含夹具 SHA-256、
加载后/Start 前每个组件的存在和可见性、8 帧组件可见性、真实变量快照及空错误数组。

实测：

- idle 在 Start 前及全部 8 帧中，7 个保存为 true 的组件均存在且可见；hidden 为 false。
- 缺省 `visible` 的组件存在，但 `get_visible()` 返回 undefined（JSON 省略该字段），不列入可见输出。
- dynamic 第 1–2 帧为初始集合，第 3–4 帧隐藏 `z-score/private-items`、显示 `hidden`，
  同时 `a-text=88/private-score=99`；第 5–8 帧恢复初始可见集合，变量保持新值。
- 官方运行均无 runtime errors。记录后又独立跑一次 integration 回归，3/3 Node 测试通过。

`tests/kitten4_monitors.rs` 检查每帧 id/名称/类型/实时值、公开序列化字段数、重启恢复、
JIT 开启/关闭配置、canonical 编辑、KN 隔离、私有列表截断及云 lowering 可见位。
这些短探针**不声称达到热 JIT 阈值**。

## 复验命令与当前验证状态

```powershell
$env:K4_PLAYER_DIR='E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app'
node tools/compat/k4-monitor-fixtures.mjs --record
$env:K4_ORACLE_INTEGRATION='1'
node --test tests/k4-monitors.test.mjs
# 以下由主会话统一执行，本任务没有运行 Cargo 或改动任何既有二进制：
cargo test --test kitten4_monitors
cargo test --test kitten4 published_list_and_variable_monitors_show_and_hide
cargo test --test kitten4 published_monitor_hide_reuses_the_shown_monitor
```

- **已验证**：官方源码取证、原创夹具可重建性/哈希、官方播放器独立复跑的 3 个 Node 测试、`git diff --check`。
- **主会话已验证**：`cargo test --test kitten4_monitors` 4/4；`cargo clippy --all-targets -- -D warnings` 与
  `cargo test --all-targets` 全通过，包含两项既有 published monitor 回归。
- `StageRenderer.monitorCanvas` 按 `$n/ti`（918600–925610）重建 common 标量皮肤：18px NotoSans 字体族、
  名称/值各自测量，52 高、11 圆角、橙色底与白色值框；保存的位置为舞台坐标中的左上角，
  使用声明 scale 和私有实体前缀。Canvas 文本避免 DOM LCD 子像素颜色，原生图片/字体未随仓库分发。
- 自制 `visual3-monitors.bcm` 覆盖中英名称、空值、初始可见、私有前缀、非整数倍率和运行时数值更新。
  固定 1/30/60：修前 **4.622685 / 4.780671 / 4.780671%**，修后均 **0.184896%**。
  残差是纹理取整/圆角栅格化与文字采样，未声称逐字节相等。
  `tests/k4-visual-monitor-pixels.test.mjs` 官方像素回归通过，阈值 0.2%。
- **未验证/未完成**：列表、纯文字和图标皮肤仍走原 DOM 后备；无保存位置的自动排布尚未完全对齐；
  已认证云变量、不同场景切换后的私有组件表现、非布尔 visible 畸形输入。
- 8 帧记录使用仓库既有只读 `.orig` 服务和确定性调度配置；它保留离线包装的 DI 暴露点，
  **未独立认证与线上发布物相同**。
- Rust 改动曾在主会话要求冻结既有源码前应用，收到冻结要求后只撤回自己的改动；
  主会话确认 `dist/visual3/k4-trace-before.exe` 已保存后重新应用。全程未运行 Cargo 构建，
  未改 `target/debug/k4-trace.exe`，未操作其他 worktree，未提交。
