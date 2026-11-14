# CLI 无头运行

```powershell
nekoc run project.bcmkn --ticks 60 --out snapshot.json
nekoc run project.bcm --frames 60 --seed 42
nekoc run project.bcmkn --event key-down:space --event mouse-move:15,-20
nekoc run project.bcmkn --legacy-runtime --ticks 30 --expect old-snapshot.json
```

## 执行路径与时间

- 默认路径：读取 JSON → 原生 K4 经 `kitten4::to_neko` 导入（保留来源信息）→ `Program::compile` → `Engine`。KN 不需要 K4 转换。Engine 默认启用 JIT；编译/执行失败会报错，**不静默退回旧解释器**。
- `--ticks N`（别名 `--frames N`）默认 1；恰好执行 N 次 1/60 秒更新，不因脚本结束而提前停止，也不合并 tick。0 表示启动并注入输入，但不执行更新。
- 默认 `--seed 1`。使用虚拟时钟：日历基准为 UTC 2000-01-01，等待/计时器由模拟时间推进，不等真实墙钟。相同作品和输入可重复；显式启用的本地云文件仍是外部状态。
- 每帧指令上限 2,000,000；指令/输出预算让出不当作错误。快照的 `budget_yields` 记录发生次数，`active_threads` 可判断还有多少未完成工作（包括等待中的工作）。帧数耗尽不代表作品完成。
- `--legacy-runtime` 保留原 KN JSON 解释器、30 Hz、旧 snapshot/trace。它不是 K4 播放器；原生 K4 不应交给它执行。不能与 `--seed` 或本地云配置混用。
- `run-scenario`、`compile-ts-scenario` 的旧路径和断言契约不变。

## 输入

`--event` 可重复，所有输入都在启动后、第一次更新前按顺序注入：

| 输入 | 意义 |
|---|---|
| `click` / `click:x,y` | 在当前/指定坐标点击，命中最上层角色或舞台 |
| `key-down:key` / `key-up:key` | 改变按键状态，支持数字 keycode、单字母、`space`、`enter`、方向键别名 |
| `mouse-down:x,y` / `mouse-up:x,y` | 改变指针位置及按下/松开状态 |
| `mouse-move:x,y` | 只改变位置 |
| `drag:actor-id,x,y` | 设置鼠标位置和按下状态，并尝试移动可拖拽角色 |

这是 Engine 的状态输入：同一更新前按下再松开可能合并成最终状态，持有按键/指针可能跨帧重触发。点击按命中和场景分发，不再像旧解释器那样广播给所有点击帽。`start_on_click` 在 Engine 中是启动帽（沿用现有 Engine 解释），不是旧路径的点击触发；本次未重新验证该积木的官方行为。需要逐帧 DOM 回放和 source trace 时使用现有 `kn-trace` / `k4-trace --input-script` 工具，而不是假定多个 `--event` 之间会推进时间。

## 输出与退出码

默认 stdout 为 pretty JSON；`--out path` 写文件且不打印快照。作品日志累计放在 `logs`，不直接打印到 stdout。Engine 每帧最多保留 1024 条日志，CLI 不恢复超过该上限的日志。

Engine 输出的 `schema` 是 **`nekoc-engine-run-v1`**，基于完整、非消费式 `debug_snapshot`，不是渲染增量 Frame：

- `sequence`、`time`、`scene`：VM 更新序号、模拟秒数、当前场景 ID。
- `actors`：所有存活非舞台角色（含克隆），包括坐标、`direction`（VM 原始朝向）、可见性、缩放/造型和私有变量。不是旧快照的 `rotation`。
- `variables` / `lists`：按 ID 区分标量与列表，保留有限数字的 JSON 数字表示；非有限数分别写成字符串 `"NaN"`、`"Infinity"`、`"-Infinity"`，不再与 `null` 混淆。同样适用于角色私有变量及变量中的嵌套列表/对象；这些字符串不区分同名的普通文本。
- `variable_names`、`logs`、`active_threads`、`ticks`、`seed`、`budget_yields`：显示名、累计日志及执行统计。
- `ask` / `stage_dialog`：最后一帧尚未完成的询问/舞台对话；CLI 不自动作答。
- `extension_requests`：累计宿主扩展请求；默认未注册自定义扩展，不授权网络/设备。
- `costume_turn`、`ranking_variable`：现有 Engine 调试字段。

不伪造旧 `trace`、`received_broadcasts`、`message_values`、`current_scene_name` 等字段。需要这些字段请显式走 legacy；两个 schema 不承诺逐字段等价。

`--expect path` 仍对**完整快照**做结构对比（不是部分路径匹配），成功打印 `Runtime snapshot matches expectation`，之后照常输出/保存快照；因此使用 `--expect` 时 stdout 不再是单个 JSON。失败打印差异，不写 `--out`。

- 0：所有指定帧成功执行且 expectation 匹配（若提供）；允许仍有等待任务或预算让出。
- 1：读取、导入、编译、运行、写文件或 expectation 错误。
- 2：clap 命令行参数错误。

## 云、扩展与媒体边界

默认没有云 backend，不访问官方云、账号或网络。可显式启用**本地模拟**：

```powershell
nekoc run project.bcm --cloud-memory --cloud-namespace example
nekoc run project.bcm --cloud-file local-cloud.json --cloud-namespace example --cloud-user tester
```

文件 backend 会创建数据文件和旁路锁文件；错误传播为失败退出。选项复用 Web/trace 的 `CloudOptions`，不是官方云认证。

无头模式不提供资源解码、透明度 mask、浏览器音视频播放、真实设备、交互作答或自定义扩展注册。音频等待采用 Engine 的模拟时钟路径；碰撞/点击在缺少 mask 时使用现有矩形回退。绘图/音视频命令不作为媒体文件导出。这里没有新增官方语义声明：运行语义沿用 Engine 及已有专项证据；本次 CLI 测试验证的是 NekoC 宿主契约，不是官方播放器等价证明。
