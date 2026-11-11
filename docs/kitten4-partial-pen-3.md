# K4 partial 第三轮：线宽、端点、填充与混合印章

## 证据与范围

只读离线官方资源 `player_v2.2d180c468559fbd29528.js.orig`，SHA-256
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
源码只作定位与行为依据，不复制入库，不参考 HateNeko。
`a1xw` 的 factory offset 从 factory 起始计算：

- `Rt` / `draw_line`：47484 附近；落笔保存坐标后先画旧位置圆盘，再画闭合两点路径。
- `set_pen_down`：同一区域；判断保存坐标的 JS truthiness，而非显式布尔状态，任一坐标为零会重复画点。
- `set_size`：同一区域末尾；尺寸夹到 1..10000；typed number 规则沿用第二轮。
- `draw_fill_pattern`：50156；当前填充色或当前笔色，默认 Canvas nonzero，填充不应用 brush alpha。
- `draw_text_stamp`：50662；`draw_image_stamp`：51080；混合顺序由本轮实测覆盖。

原创生成器 `tools/compat/k4-partial-pen-3-fixtures.mjs` 生成 11 份 `.bcm`，
每份官方实跑 3 帧。记录于 `kitten4-partial-pen-3-evidence.json`：fixture 哈希、
官方资源哈希、每帧真实 Canvas 调用和 brush canvas 原生 RGBA 采样。
只在原生 brush 方法运行时旁路记录 Canvas 原型方法，仍调用原方法。
11 份 `externalAllowed=0`、`errors=[]`，没有读取或复制第三方语料。

原本尝试新编辑器 `pen_begin_path/pen_close_path` 的夹具在此离线内核中没有原生绘图调用；
因此最终夹具使用此内核实际注册的 `set_pen_path(start_point/end_point)`，且测试要求真实 fill 非空，
没有将不执行的分支记作通过。

## 已验证行为

| 夹具 | 观察 |
|---|---|
| opaque-endpoints | 原点圆盘 + 闭合两点 round join；不是单次胶囊 |
| alpha-endpoints | alpha=0.5 时原点中心 RGBA 为 `[32,64,96,223]`，线中与末端为 `[32,64,96,127]` |
| alpha-corner | 拐角再次画原点圆盘并覆盖前一笔；独立 source-over |
| same-position | 同坐标移动再次画圆；零长度路径本身不 stroke 出圆点 |
| repeated-down-zero/nonzero | 坐标 0/0 再落笔 alpha 从 128 变 192；非零坐标重复落笔不重画 |
| fractional-width | 1.5 宽与小数位置保留；以浏览器 Canvas 抗锯齿观测为准 |
| fill-pen-up | 抬笔仍记录路径、alpha=0.25 的笔色填充仍完全不透明；重复 close 不再填充 |
| fill-restart | 再次 start 清除此前路径；结束使用当时笔色 |
| fill-self-intersection | 显式填充色，Canvas 默认 nonzero 自交填充 |
| mixed-stamps | 线、文字、线、图像、线、填充交错；没有把印章统一挪到全部线之后 |

## 实现与主代理接入点

专有文件修改：

- `web/pen-k4.js`：独立 Canvas 原点圆 + 闭合路径实现；每个连续笔划 batch 截取舞台内包围框上传。
  保持原 9-float line 格式和 `before_line` 排序，不改 KN 的实例化 shader 路径。
- `src/engine/k4_drawing.rs`：`k4_pen_down_draws` 处理零坐标重复落笔，
  `raster_k4_line` 对颜色检测 raster 执行分离的原点圆盘/线段混合。
- `tests/kitten4_partial_pen_3.rs`：默认 JIT 开关与禁用 JIT 的增量、填充、混合顺序回归。
  默认开关不是断言实际产生 native region。
- `tests/k4-partial-pen-3.test.mjs`：夹具哈希、非空调用、独立绘图结构、7 夹具浏览器全 RGBA 重放。

为避免专项并行冲突，子任务不直接修改公共入口。主代理已按以下点接入并统一构建：

1. `engine.rs` 的 `Op::Pen(down)` 在修改 `pen` 前计算：

   ```rust
   let draws = down && if self.program.semantics == RuntimeSemantics::Kitten4 {
       self.k4_pen_down_draws(actor)
   } else {
       !self.sprites[actor].pen
   };
   self.sprites[actor].pen = down;
   if draws { self.line(actor, old); }
   ```

2. `line()` 内 `program.uses_color` 分支，把唯一 `raster_line(old,to,size,color)` 改为
   K4 调 `raster_k4_line`、KN 仍调 `raster_line`。
3. renderer 模块加入 `import { drawK4PenLines } from './pen-k4.js';`；
   `apply(frame,lines,...)` 保存 `this.k4PenLines=lines`，
   `drawLines(start,count)` 的空 batch return 后加
   `if(this.kitten4)return drawK4PenLines(this,this.k4PenLines,start,count);`。
   与现有 fillTexture 生命周期一样管理 `k4PenTexture`；不要在每帧新建 GL texture。
4. `tools/compat/k4-visual.mjs` 新增显式 `/pen-k4.js` route（与 renderer/overlay route 同类），
   因其临时页面不是一般 web 静态服务器。若其他浏览器测试的 server 已通用服务 web/ 文件，无需额外修改。

## 实测结果

接入前，`tools/compat/k4-partial-pen-3-visual.mjs` 在 `dist/partial-pen-3/` 注入候选 renderer，
只用当前已存在的 `target/debug/k4-trace.exe` 的真实 VM 增量，不修改正式 renderer，
不构建 Cargo，不将官方 trace 重画成 NekoC。每份 baseline/candidate 都实际重新运行官方。
双侧原尺寸 960×720、691200 像素、帧1、RGB 单通道容差8；接入前 11 对均完成截图：

| 夹具 | 原 renderer 超差像素 | 候选超差像素 | 候选 MAE |
|---|---:|---:|---:|
| opaque-endpoints | 42 | 0 | 0 |
| alpha-endpoints | 346 | 0 | 0 |
| alpha-corner | 672 | 0 | 0 |
| same-position | 6 | 0 | 0 |
| fractional-width | 206 | 0 | 0 |
| fill-pen-up | 0 | 0 | 0 |
| fill-self-intersection | 0 | 0 | 0 |
| mixed-stamps | 29 | 0 | 0.00000626929 |
| repeated-down-zero | 332 | 332 | 未接入 engine 修复，保留已知差异 |
| repeated-down-nonzero | 0 | 0 | 0 |
| fill-restart | 0 | 0 | 0 |

混合印章存在小于容差的非零差异，不宣称其像素全等。接入前其他样例除 repeated-down-zero 外 RGB 均相同。
接入前双方 PNG 留在 `dist/partial-pen-3/` 的 baseline/candidate 子目录。
新增 JS 浏览器回归 5/5 通过，连同原 image-stamp JS 回归 6/6 通过；其中七个纯画笔夹具重放观测到的原生 Canvas 指令与新模块，
全画布 RGBA 零差异，并逐个核对官方实际 brush canvas 采样。

### 最终集成复核

共享 engine/renderer 接入完成后，重新 `cargo build --bins`，以上脚本自动使用正式
`web/renderer.js`，不再注入候选；11 份均从真实 VM 重新生成增量并重新运行离线官方。
同为帧1、960×720全舞台、每份691200像素、无视频遮罩、RGB单通道容差8：

- **11/11 captured，11/11 超差像素为0**。
- `repeated-down-zero` 从接入前332超差修复为0，MAE=0。
- 除 `mixed-stamps` 外10份 MAE=0；混合印章 MAE=`0.00000626929012345679`，
  RMSE=`0.002503855052405548`，仍不称RGB字节全等。
- 最终报告 `dist/partial-pen-3/visual.json`，双方 PNG 与诊断在 `integrated/` 子目录。
  这些输出均忽略，不复制官方素材入库。该结果只证明11个夹具的帧1，不能推出跨帧/多倍率兼容。

复验命令：

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-pen-3-fixtures.mjs --record
$env:K4_PEN3_BROWSER='1'
node --test tests/k4-partial-pen-3.test.mjs
# 正式接入后记录 integrated 结果；旧 renderer 可生成隔离候选
node tools/compat/k4-partial-pen-3-visual.mjs
# 以下已由主代理统一构建/运行：3个集成测试与模块测试均通过
cargo test --test kitten4_partial_pen_3
cargo test --lib k4_drawing
```

## 未验证与去 partial 建议

本轮不能单独移除 stamp/image_stamp/画笔相关 partial：

- 共享入口已接入；零坐标重复落笔的真实 VM 增量及最终集成像素回归已通过。
  上表保留接入前候选对比，最终结果见上一节；全量门槛见 worktree 根目录 `OC-REPORT.md`。
- Canvas batch 先合成透明纹理再与旧画笔面合成，跨帧/多 batch 的 alpha 量化与离屏缩放尚未全面实测。
  大量笔划由 GPU 胶囊改 Canvas raster/upload 有性能成本，未做性能基准。
- 颜色检测 raster 仍按像素中心二值覆盖，不复现抗锯齿；本轮圆/线分离后半透明内点约为 224/128，
  官方 Canvas 为 223/127；不是颜色检测像素完全一致。
- 文字字体、超大纹理、半透明图像素材、裁切/ELASTIC、pivot/多倍舞台分辨率、1024个印章安全上限，
  并发填充、删除/克隆/切场中的路径生命周期仍未全面覆盖。
- 不把 11 个局部原创夹具推广成所有发布版本或真实作品完全兼容。

建议仅记录本轮端点/alpha/小数宽修复；印章 partial 与画笔整体边界保留。
