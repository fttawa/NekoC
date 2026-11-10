# K4 克隆层序与阻塞介绍弹窗

## 官方证据

使用只读离线播放器 `K4_PLAYER_DIR`，不复制其源码。主内核
`src/player/build/player_v2.2d180c468559fbd29528.js.orig` SHA-256：
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
它含有既有 DI 暴露点；结论限于该播放器，并未证明与当前线上版本完全相同。

可复现的原创探针：`tools/compat/k4-layer-dialog-fixtures.mjs`；官方观测脚本：
`tools/compat/k4-layer-dialog-probe.mjs`；记录：`kitten4-layer-dialog-evidence.json`。
不使用 HateNeko，也没有移植第三方实现。

源码位置用符号和唯一字符串定位（内核为单行压缩 JS）：

- `Tn6a` 模块的 `$.clone_actor`、`init_cache`、`set_cloned_actor_z_index`、
  `clear_cloned_actors_z_index_cache`：`4.1.0` 之前直接追加顶部；新版在本体上方创建第一个克隆，
  后续接在仍链接的最后一个克隆上方。不是每次贴本体，也不是统一倒序。
- `lt.set_theatre_layer`：`previous_level` 是前移一层，`next_level` 是后移一层；
  置顶/置底/相对移动均受画笔平面限制。只有实际改变层位才修改链：移克隆删除该节点，移本体清空链。
- `Ht` 内画笔函数的 `set_layer_with_pen`：移到画笔下方时把角色移到底部，移到上方时移到顶部，
  同时跟踪画笔目标的层位并使克隆链失效；不能用调整画笔数字或空操作代替。
  `219930972` 的说明控件正是通过此积木进入蒙版下方，回归夹具为 `pen-below` / `pen-roundtrip`。
- `Lt.set_z_index` / `Ct.get_actor_ids`：角色容器从后到前排列。K4 原始 `scene.actors` 与 KN 的
  前到后 `actorIds` 不能统一反转；VM 按语义区分，renderer 仅对未启动预览采用相同约定，运行时仍严格使用 VM `frame.order`。
- `lt.create_stage_dialog`：解析 `actor`（克隆回到本体），获取 `get_thread_lock`，放入
  `dialog_command_queue`；完成回调才释放调用线程。与 ask/choose 共用 FIFO，其他线程不被冻结。
- `tn.show_stage_dialog` / `on_mouse_up`、`ze.add_task/finish/release`：打印中首次释放点击补全，
  打印完再点击进入下一页或关闭，只有末页关闭才执行回调。`self_dialog_wait` 是常驻气泡，不是同一种 UI。
- `JfQ3.T` 以 PIXI 字体测量拆页宽度；`tn` 的布局常量为边距 12、预览 100、弹窗高度 180、正文 22。

## NekoC 实现

- `src/engine.rs` 保留原 chain/表达式编译结构，只增加 `StageDialog` 指令和运行时状态；
  层序修复在 VM，不在 renderer 重新猜测运行时顺序。KN 保留旧克隆/层序规则。
- `src/kitten4.rs` 将 `set_layer_with_pen` 从显式 stub 改为 VM 指令，并保持导入/导出原文不变。
- `src/engine/stage_dialog.rs` 管理独立请求、线程挂起、分页、打印状态、显式点击与过期 ID；
  与现有 ask 以单调 ID 仲裁。终止任务清理请求，重启清空请求但不复用 ID。
- `Frame.stage_dialog` 是可选扩展；`stage_dialog_click {id}` 经现有输入批次传到 VM。
  `web/overlay.js` 显示安全纯文本、角色预览与继续按钮，阻止点击/键盘冒泡到作品事件。
- CLI 无输入不自动应答。coverage 保留 `stage: ran` 的既有含义（采样成功），并增加
  `blocked: {kind: stage_dialog, ...}`，不宣称后续脚本已执行。

## 验证

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-layer-dialog-fixtures.mjs
node tools/compat/k4-layer-dialog-probe.mjs  # 原始观测仅写忽略的 dist/
$env:K4_ORACLE_INTEGRATION='1'
$env:K4_VISUAL_BROWSER='1'
$env:K4_VISUAL_INTEGRATION='1'
node --test tests/k4-layer-dialog.test.mjs
cargo test --test kitten4_layer_dialog
```

官方探针在第 2 帧补全文字，第 3 帧点击继续；长文本直到最后一页确认前仍挂起。
克隆探针第 3 帧按 A，第 4 帧松开，验证显式移层之后新克隆的位置；UUID 只归一化成生成序号，
不重排官方数组。

## 已知限制（未验证/不宣称像素一致）

- VM 没有操作系统字体测量，分页暂以 ASCII 半宽/其他全宽估计；比例字体、emoji、换行、连字符的精确分页边界未验证。
  官方用 PIXI 实测文字宽度，不能把该估计称为完整官方拆页实现。
- 打印进度用 VM 时间而非官方 ticker/wall clock；阻塞、补全与确认语义有实测，逐字时刻不宣称一致。
- 后续 `oc/k4fix` 已把 DOM 弹窗纳入 `k4-visual` 的 1:1 舞台容器截图；本轮历史结果原为
  canvas-only，不能与新结果混淆。新实测与像素残差见 [kitten4-fixes.md](kitten4-fixes.md)。
- 跨场景/被销毁目标与其它翻译/语音弹窗的全队列互操作尚未穷举；ask/介绍弹窗和基础 FIFO 有回归。
- 本轮优先解决层序和介绍弹窗；按钮尺寸与填充画笔问题不据推测修改。
