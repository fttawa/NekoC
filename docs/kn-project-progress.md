# KN 原作运行进度与 timer callback 复核

2026-11-11，官方编辑器 <https://kn.codemao.cn/editor>，0.27.4。HateNeko 对比只作为问题线索，本页结论取自**原始作品在官方编辑器的运行**及官方发布 bundle，不读取或移植 HateNeko 运行时代码。

## 复现

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-project-progress-probe.mjs
node tools/compat/kn-project-progress-probe.mjs --settle
node tools/compat/kn-project-progress-probe.mjs projects/fangjie/fangjie.bcmkn --short-world --settle
node tools/editor-compat.mjs dist/kn-project-progress/fangjie-short-world.bcmkn --channel msedge --out dist/kn-project-progress/short-world-editor-compat.json
node tools/compat/kn-project-source-evidence.mjs
node tools/compat/kn-async-services-probe.mjs
node tools/editor-compat.mjs projects/fangjie/fangjie.bcmkn projects/tiny-lm/tiny_lm.bcmkn tests/fixtures/kn-async-services/timers.bcmkn --channel msedge --out dist/kn-project-progress/editor-compat.json
node tools/compat/kn-project-progress-archive.mjs
node --test tests/kn-project-progress.test.mjs
```

前两条分别保存 `dist/kn-project-progress/report.json`、`settled-report.json`；均使用新页面、原样 previewUrl 作品和官方代码，只暴露 webpack loader，不修改调度器、块实现或原作。定时采样是墙钟进度，**不是逐帧 oracle**。`--settle` 等待 fangjie 完成标题绘制，tiny-lm 等待自然停止；最长等待五分钟。原作 fangjie 的本次 settle 超时如实保留，tiny-lm 成功终止。`--short-world` 则生成**单独诊断副本**，仅改 world 遍历上限数字 524287→7（524288 次→8 次），另存 `short-world-report.json` 并另做 editor-compat。完整官方 bundle 与摘录留在忽略目录 dist，紧凑归档见 `kn-project-progress-official.json`。

## 根因定位

### fangjie：初始化尚未结束，不是 chunk_x 无法 append

原作 `modules/fangjie/game.ts:619-631` 在一个 warp 中依次：填充 **524288** 项 world → 填充 64 项 chunk_x/chunk_z → inv/hot → 离开初始化 → 标题绘制。因此在前一循环尚未结束时，chunk_x 长度 0、角色逻辑 y=0 是合理中间状态。

官方第一轮从 world 长度 8 → 836 → 3662 → 7035 → 14851 → 30065 持续增长；同期 chunk_x/chunk_z 始终长度 0，角色仍在原点，running=true，无 page error。这证明停在初始化过程，不是列表操作丢失。原作标题最后一个按钮在 `game.ts:360`，结合按钮定义和文字位置，完成标题后角色逻辑 y 会到 -65；不能拿尚未初始化完成时的 y=0 与标题绘制后的位置直接做语义判决。

完整原作第二轮五分钟内未满足 settle，不能宣称观察到原作终态。**单数字缩短初始化的诊断副本**已在官方实测：world.length=8，chunk_x/chunk_z.length=64、内容99999，最终 `actor.get_position()={x:0,y:-65}`。注意渲染对象 `actor.position.y=65` 是反向的屏幕坐标，证据同时保存两者；对 NekoC 应比较 get_position 的逻辑坐标。诊断副本 4070 块，editor-compat ok=true、pageErrors=[]。

### tiny-lm：id 长度与 token 进度相关，不是输出序列不一致

原作 `projects/tiny-lm/tiny_lm.ts:1079-1105` 初始化 KV 后每轮调用 `lm step`、采样、append id。`lm_frames` 由 **作品自己在完成 lm step 时递增**（`:993`），不是浏览器/引擎帧计数器；不运行时的 else 分支也会递增它（`:1104`），不能把它无条件当 token 数。

官方第一轮观察到 phase 从 KV CACHE → LAYER 1/2 → LAYER 2/2，随后 tokens_processed=1、generated=0；继续运行后 generated_ids 为 `[66]`，再为 `[66,15,31,4,78,58]`，输出“走到山上，看”。这与 NekoC 对比记录中同一原作的生成前缀一致。固定 12 次各自 scheduler pass 后 0 对 10，只能说明执行进度不同，不能证明生成语义错误。

第二轮官方自然终止 `DONE / EOS`，tokens_processed=18、generated=15，完整 id 为 `[66,15,31,4,78,58,64,7,8,2,27,33,32,35,2]`，输出“走到山上，看见了云。它很开心。”。此时 lm_frames=20，进一步证明该作品变量不是无条件等同 token 数。

### 官方 warp 本身有切片边界

官方 `crc_libs.8196dbd1.js`（SHA-256 `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7`）零基 UTF-8 字节位置：

| 位置 | 含义 |
| --- | --- |
| 864527 | 默认 warp 每 interpreter step 30000 次迭代、4ms 墙钟限制 |
| 924463 | 编译器在循环边界生成 iteration yield 检查 |
| 935049 | compile_warp 标记 warp 并保留其子循环编译，不移除切片机制 |
| 957710 | OptiRunner：warp 仍检查迭代/非 deterministic 墙钟限制 |
| 884764 | DebugRunner 对应墙钟切片分支 |

诊断副本读取的 live `core.get_util().config.get()` 也确认 30000/4ms、user_debug_mode=false、未设 deterministic；此配置快照见紧凑证据 `diagnostic.runtimeConfig`。仍不能推广为所有编辑器模式配置；墙钟切片使不同 CPU、调试模式和宿主调度下相同 tick 数并非同一工作量。

**保留的调度边界**：`src/engine.rs` 的 `Work::Loop`、`Work::Range`、`warp_iteration_yields` 和 `Op::Next/RangeNext` 当前 KN warp 主要消除普通循环 yield，`WarpIteration` / 10000 次限制是 Kitten4 专用，不能据此声称 KN 的官方切片边界已对齐。若做逐帧兼容，应另建 KN 策略并验证 30000 的比较/递增顺序、嵌套与 procedure、reporter/warp 传播、确定性模式；不要直接改成 HateNeko 的任意步数，也不要用一个固定 token/帧阈值补丁。本轮未修改调度器。若仅性能比较，应先用共同语义里程碑配对状态，再计同等工作量；现有不等状态样本仍不得计入语义等价加速比。

## timer native callback：官方仍不执行 statement body

重新运行现有专用官方探针，六项 checks 全 true：workspace 保留两处 callback 子块，但两次实际域调用 args 均只含 delay，callbackType 为 undefined。原始 timer 作品开始后一秒得到 `ready=1,after=1,fired=0`，running=true；浏览器 timeout 收到官方替代的空函数。真实 JS function 的 registry 直接调用能触发，并不意味着 native statement body 能触发。

官方 `main.8ccf2442.js`（SHA-256 `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`）2952116/2952514：非函数 callback 替换为空函数。crc 941381/945923：域函数编译只编译 params，没有 callback statement→函数的转换。原生兼容路径**不应新增执行 callback body**，现有 `src/engine.rs` 仅取 delay 的 timer 分派符合此次官方观察。通用 JS function/闭包属于另一功能，不可混同。

## 边界

- 未修改任何原作 `.bcmkn`；三份原始作品及单独生成的诊断副本均 editor-compat ok=true。
- 本页是独立官方取证，不以 NekoC/HateNeko 的运行结果替代官方证据；本轮整体门禁和短跑另见 `performance.md`、根目录未提交报告。
- 不是完整逐帧、像素、用户输入或 wall-clock timer 生命周期一致性证明；不是为 HateNeko 的具体调度实现背书。
