# Kitten N 运行器源码调查（2026-11-01）

从官方编辑器加载的公开 JavaScript 包提取 Webpack 模块，使用 TypeScript printer 格式化后检查；不是仅依据 Scratch 的行为推测。

## 下载来源

- `https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`
- `https://creation.bcmcdn.com/neko/web/release/static/js/crc_libs.8196dbd1.js`
- `https://creation.bcmcdn.com/neko/web/release/static/js/main-vendors.07f7dd7e.js`
- `https://creation.bcmcdn.com/neko/web/release/static/js/base.f158ddbf.js`

本地原始包、模块及格式化版本位于 `D:/AppData/Local/Temp/opencode/nekoc-kitenn/runtime-source/`，下载清单为 `manifest.json`。仓库中只保存调查结论，不复制整个官方发行包。

## 调度与线程

1. 主包模块 **17028** 的运行器 `stepCode()` 调用 `runtimeManager.update()`，再用 `window.requestAnimationFrame(this.stepCode.bind(this))` 安排下一轮。
2. CRC 模块 **8541** 的 `RuntimeManager.step_code()` 遍历 `sorted_interpreters`，逐个调用 `_step()` → `interpreter.step()`。多角色和广播脚本在同一 JS 调度循环中执行，不是每角色一个 Worker。
3. CRC 模块 **85990** 默认配置：
   - `warp_interpreter_millisecond_time_limit: 4`
   - `max_warp_iterations_per_interpreter_step: 30000`
   - `max_procedure_calls_per_interpreter_step: 50000`
4. CRC 模块 **83084** 的 `OptiRunner.step_iteration_yield()`：普通循环迭代返回让出；warp 内检查循环次数和墙钟时间预算，超限也会让出。DebugRunner（模块15220）有相应逻辑。
5. 模块 **8541** 的广播等待有 `Pending / Sending / Waiting / Idle` 状态，等待广播确实有额外调度成本。

**结论**：已检查的积木执行路径是主线程协作调度。包中存在 Worker（例如 Lottie 数据处理、音频处理），不能据此说积木脚本是多核并行。4 ms 是单次解释器步骤的 warp 时间预算，不是固定整页 FPS 上限。普通 `.bcmkn` 没有已验证的积木接口可修改该运行器配置。

## 画笔与关键优化

主包模块 **46501** 的 `getPenDomainFunctions()` 将积木映射到角色 `get_brush()`。画笔尺寸在积木层限制为 **1–1000**。

舞台模块 **61248** 的 brush 实现：

```js
draw_line(x, y) {
  // save context, set width/color/alpha
  canvas_draw_circle(ctx, origin_x, origin_y);
  canvas_draw_line(ctx, origin_x, origin_y, x, y);
  // restore context, mark scene brush texture dirty, update origin
}
```

`canvas_draw_line` 使用 `beginPath → moveTo → lineTo → closePath → stroke`，设置了 `lineJoin="round"`；`canvas_draw_circle` 额外补的是**起点**的圆。`penDown` 还会在起点产生点绘制。`penUp` 清除起点并移除位置监听。

曾据此尝试“两条从中心向相反边缘的粗线”，但官方截图明确显示端点鼓出：闭合路径的 round join 也会影响终点。该实验已撤回。不能仅凭未设置 `lineCap` 就认定两端平头。

当前 `modules/pen-display/paint.ts` 先用短边宽度的胶囊形粗线填中心，再画内缩矩形轮廓，逐层缩小笔宽至2单位。各笔端点按半笔宽内缩，圆连接始终位于目标矩形内部。`raster28.ts` 对28单位条带使用28单位中心线、8单位内缩轮廓、2单位内缩轮廓，共9段。大矩形使用近似四分之一笔宽递减的轮廓，代替线性扫描。任何源码推断仍需官方截图复验。

### 优化实验记录

相同单角色32×20、896×560增量动画，60档约8秒窗口的完成帧率：

| 实现 | FPS |
|---|---:|
| 上一稳定版：2单位细线扫描 | 19.93 |
| 4单位内部扫描＋2单位端部补边 | 22.29 |
| 展开28单位扫描循环 | 20.82 |
| 直接绘制、跳过命令列表 | 18.45 |
| 展开蛇形扫描＋补边 | 21.05 |
| 28单位胶囊＋两层内缩轮廓 | 24.90 |
| 大矩形也使用递减轮廓 | **28.90 / 26.91（复测）** |

结果受浏览器与编辑器负载影响，不将单轮差异视为精确因果证明。最终两轮报告与截图保存在 `modules/pen-display/verification/fast-nested*/`。几何测试覆盖1/2/3单位窄矩形、奇偶尺寸、28单位条带、大矩形、裁剪、顺序、重复绘制与黑色擦除；画笔半径边界不越界，28单位路径另采样半单位网格检查内部接缝。

`tools/profile-pen-display.mjs` 在独立浏览器包装 `OptiRunner.step_iteration_yield`，统计实际让出次数，不修改预算。旧补边方案8秒内记录438次rAF、160完成帧、278次warp让出。包装自身有开销，其FPS不能直接替代未插桩基准。

最终版本插桩约8秒记录452次rAF、219完成帧、233次warp让出、5300次warp检查；旧补边版为11340次检查。每完成帧的warp让出约从1.74降至1.06，但仍经常跨越两次浏览器调度。记录见 `verification/fast-nested/profile.json`。最终2616个积木通过官方0.27.4兼容检查；两次未插桩基准均无页面错误、资源失败或未处理拒绝。

## 50 ms 计时器陷阱

主包模块 **26537** 的 `startTimer()` 用 `setInterval(..., 50)` 更新显示计时器，并以 `toFixed(2)` 写入观察状态。用这个值做16.67ms截止时间调度会读取过期时间并引入多余等待。

高速示例改为利用普通 `forever` 循环每轮自然让出一次运行器调度：60档每轮更新，30/15档按调度次数分频。它以60Hz浏览器调度为参考，**不是跨刷新率设备的精确墙钟限帧器**；若浏览器本身只调度30次/秒，60档也只能做到30次/秒。正式性能测量使用 `performance.now()` 的8秒窗口，不用显示计时器。

模块61248还含有内部多边形填充方法 `set_fill_start / draw_fill_pattern`，但当前已提取的官方积木 schema 和笔积木映射没有对应公开入口，因此没有通过注入调用它来伪装成可移植 `.bcmkn` 功能。

## 编译与调用优化复核

- 普通`compile-ts-bcmkn`并未调用独立Rust优化器。现在TS前端在表达式内联完成后对纯数字子树折叠：算术、floor/ceil、abs/neg及非负余数。动态变量、随机数、计时器、零除、非有限结果保留运行时积木；不依赖跨语句常量传播。
- `setPenColor(rgb(8,12,24))`编译为颜色字段`#080c18`。官方schema为`FieldColour`而非表达式输入，故动态RGB仍使用HSV；固定色示例不再每帧转HSV。
- 原生列表删除模式包含`all`。编译器在该模式省略`list_index`，本地运行器也补齐清空语义。
- FPS统一为至少1秒的帧数差/时间差。fast使用`displayConfigure`，不再分配1280个无用帧缓冲项。
- 共享绘制主体使用零参数原生自制积木。调用字段`NAME`和mutation中的`name`都必须为定义ID；只改字段仍会被mutation重新覆盖。参数化版本另外遇到`procedure_no_such_parameter`：官方准备运行时会把定义参数名改成ID，现有参数reporter缺少对应mutation ID。本次示例用共享坐标规避，参数化编译兼容问题尚待单独修复。
- 失败的空白画面计数（约130次/秒）已排除。成功共享版最终约92.81完成帧/秒，同时rAF为92.94次/秒；独立插桩8秒记录835次rAF、833次完成、1次warp让出。这里的rAF本身超过60Hz，不能推断所有用户设备均能显示90+ FPS。档位仍为1/4、1/2、全速调度分频。
- 保留原笔画几何。删除8单位中间描边后，实机出现明显点线擦除残影。`fast-one-ring`实验还带有`wait(0)`，其速度不可作为纯几何A/B比较，只用于覆盖质量证据。
- 最终积木数量2616→989，保留记录在`verification/fast-optimized-final/`。完整Rust测试163项、JS测试11项、TS检查及Clippy通过。

## 输出范围

`displayPresentFast` 是增量矩形命令队列，保留 RGB 和画笔输出；它不是每帧任意 RGB 全屏帧缓冲的性能保证。窗口完成帧数不等同于实际 GPU 呈现帧数。默认样例短边不超过舞台562单位，符合1000单位笔宽限制。
