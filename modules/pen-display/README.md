# RGB 画笔显示模块

## 旋转正多面体示例

[`samples/pen_polyhedron.bcmkn`](../../samples/pen_polyhedron.bcmkn)：单角色原生画笔透视线框，Q/E 切换正四、六、八、十二、二十面体；键盘调节角度、缩放、相机和转速，1/2/3 切换真实 32×20、64×40、128×80 像素网格。左上角显示参数，右下角显示 FPS。几何定义及完整按键见 [使用说明](../../samples/pen_polyhedron.md)。

将 RGB888 帧缓冲编译为 Kitten N 原生画笔积木。逻辑分辨率、舞台像素大小、目标刷新率分别配置。

## 当前推荐：单角色增量高速版

导入 **[`samples/pen_display_fast.bcmkn`](../../samples/pen_display_fast.bcmkn)**，源码为 [`samples/pen_display_fast.ts`](../../samples/pen_display_fast.ts)。保持32×20、896×560铺满舞台，默认60档，按1/2/3切换15/30/60档。

舞台右下角通过原生文字印章显示 `FPS: xx.x`，采用最近至少1秒的完成帧平均值，每个统计窗口刷新一次。文字位于底部光点轨道上方，刷新时仅擦除文字区域。

优化：背景和彩条只绘一次；方块每步只擦尾沿、绘前沿。示例的固定RGB颜色编译成十六进制颜色字段，动态彩条仅初始化时做RGB→HSV；绘制主体放在一个无参数自制积木中，通过单角色共享坐标调用。粗线填中心、两圈内缩描边补四角，28单位条带共9段。

新增接口：`displayFastInit()`、`displayQueueRect(x,y,width,height,color)`、`displayPresentFast()`。命令按提交顺序执行，坐标裁剪到显示范围。**这是增量命令缓冲后端，不更新原有前后像素列表**，不要混用 `displayGetPixel` 或其他 presenter；需要读回时由应用维护自己的图像状态。画笔圆角/抗锯齿仍有亚像素边界误差。

源码调查发现官方计时器每50ms更新，warp默认4ms预算；见 [运行器源码调查](../../docs/kitten-n-runtime-findings.md)。高速示例按调度次数分频，1/2/3键分别每4/2/1轮更新，**并非精确15/30/60Hz限帧**。不要将外层forever包进warp。`__pd_actual_fps`现为至少1秒窗口的完成帧平均值，不再取单帧计时器差的倒数。

当前版本在官方编辑器、Edge headless、每档约8秒窗口测得：

| 档位（调度分频） | 完成帧/秒 | 同窗口rAF/秒 |
|---|---:|---:|
| 15（每4轮） | 33.21 | 132.98 |
| 30（每2轮） | 63.22 | 126.31 |
| 60（每轮） | **92.81** | **92.94** |

浏览器这次实际调度超过60Hz，不能把92.81解释成60Hz屏幕显示了93帧，也不能把档位数字当作限帧值。插桩复核约104次rAF/秒、约104次完成更新/秒，8秒仅1次warp预算让出。上一版本完成约27–29次/秒；这次同时改变编译、换色、调用方式，且浏览器调度频率变化，不将差值归因于单项优化。这仍是增量动画，不是全屏任意RGB刷新。报告、截图和插桩见 `verification/fast-optimized-final/`。

最终**989个积木**通过官方0.27.4兼容检查，较上一版2616个减少约62%。11项JS测试、完整Rust测试、TypeScript检查和Clippy通过。

`displayConfigure(...)`只初始化显示/画笔状态，不分配`__pd_back`和`__pd_front`；帧缓冲后端继续用`displayInit(...)`。队列清空改为原生`deleteListItem(name,"all",1)`，索引不会生成。固定色直绘流程为`displayUseConstantColor(rgb(...))` → `displayRectBounds(...)` → 自制积木中的`pfRaster()`，批次完成调用`pdFrameFinished()`；所有矩形必须为正整数且在范围内，外层使用warp。

单圈描边实验出现橙色/青色点线残影，见`verification/fast-one-ring/`，因此保留两圈。通用矩形舞台短边不超过1000单位（官方笔宽上限）；边缘仍有2单位画笔的亚像素圆角与抗锯齿。

```sh
cargo run -- compile-ts-bcmkn samples/pen_display_fast.ts --template samples/kitten-n-0.27.4.bcmkn --out samples/pen_display_fast.bcmkn
node tools/pen-display-benchmark.mjs artifacts/pen-display-fast fast
```

## 每列一个角色：铺满舞台版

导入 **[`samples/pen_display_columns.bcmkn`](../../samples/pen_display_columns.bcmkn)**。

- **32 个列渲染角色 + 1 个控制角色**，每个渲染角色只负责对应的一列。
- 默认 **32×20**，每像素 **28** 舞台单位，区域 **896×560**，居中放置于 900×562 舞台。左右仅留 2 单位，上下各 1 单位。
- 控制角色更新共享后台缓冲，然后广播并等待 `__pd_render_columns`。所有列完成后才计数并开始下一帧；`displayPresentColumns()` 必须放在 `warp` 外。
- 各列拥有独立 `__pc_<列号>_*` 临时状态、画笔位置和 HSV 属性，避免角色交错执行时串色。共享前缓冲的写入索引按列分开。
- 列内采用纵向同色段合并和脏像素检测。绘制过程中其他脚本不能修改帧缓冲或重新初始化。
- 按 **1 / 2 / 3** 切换 15 / 30 / 60 Hz 目标，RGB/填充/读写接口与单角色版共用。

源文件由生成器展开原生角色定义；修改角色数后重新生成、编译：

```sh
# 默认 32×20、像素大小 28
node tools/pen-display-columns.mjs
cargo run -- compile-ts-bcmkn samples/pen_display_columns.ts --template samples/kitten-n-0.27.4.bcmkn --out samples/pen_display_columns.bcmkn

# 更细的同尺寸显示：64×40、每像素14，64个列角色
node tools/pen-display-columns.mjs 64 40 14 samples/pen_display_columns_64.ts
cargo run -- compile-ts-bcmkn samples/pen_display_columns_64.ts --template samples/kitten-n-0.27.4.bcmkn --out samples/pen_display_columns_64.bcmkn
```

使用较小逻辑宽度时，多余列角色自动跳过；增大宽度须生成足够多的列角色。请勿直接将 `displayInit` 的宽度改到超过已生成角色数量。多个角色由 Kitten N 协作调度，并不代表多 CPU 核并行；等待所有列完成的屏障也不是原子换页，实际速度以实测为准。

同尺寸、同动画负载的单角色/多角色对比命令：

```sh
node tools/pen-display-benchmark.mjs artifacts/pen-display-columns compare-columns
```

2026-11-01 本机 Edge headless / 官方编辑器 0.27.4，同为 **32×20、像素大小28**，每档约8秒测量结果：

| 渲染方式 | 目标15 Hz | 目标30 Hz | 目标60 Hz |
|---|---:|---:|---:|
| 单角色、横向合并 | 1.75 FPS | 1.99 FPS | 2.12 FPS |
| 32列角色、纵向合并 | 0.87 FPS | 0.87 FPS | 0.87 FPS |

此示例下多角色版更慢，不能将角色数量等同于加速倍数；广播同步、角色调度和独立状态都有成本，横向/纵向合并对不同图像的收益也不同。六组均无数值/列表警告、无页面错误。原始结果和铺满舞台截图见 [`verification/columns/`](verification/columns/)。默认项目共33角色、8887积木，官方结构检查通过。

## 快速运行

在官方编辑器导入 [`samples/pen_display.bcmkn`](../../samples/pen_display.bcmkn)，点击开始。
示例为 **32×18、每像素 12 舞台单位**，彩色条带、移动方块和单像素光点；按 **1 / 2 / 3** 切换 **15 / 30 / 60 Hz 目标刷新率**。

重新编译：

```sh
cargo run -- compile-ts-bcmkn samples/pen_display.ts --template samples/kitten-n-0.27.4.bcmkn --out samples/pen_display.bcmkn
```

在 `samples/` 下编写自己的程序：

```ts
import { displayInit, displayPresent, displayWaitFrame } from "../modules/pen-display/display";
import { displayClear, displayPixel, displayFillRect } from "../modules/pen-display/framebuffer";
import { rgb } from "../modules/pen-display/state";

onStart(() => {
  displayInit(64, 36, 6, -192, 108, 30);
  forever(() => {
    displayWaitFrame();
    warp(() => {
      displayClear(rgb(8, 12, 24));
      displayFillRect(5, 5, 12, 8, rgb(255, 100, 30));
      displayPixel(30, 18, rgb(40, 220, 255));
      displayPresent();
    });
  });
});
```

## API

| 函数 | 说明 |
|---|---|
| `displayInit(width, height, pixelSize, left, top, fps)` | 初始化或切换分辨率，清除画笔并重建两个缓冲区；隐藏绘图角色 |
| `rgb(r, g, b)` | 通道向下取整、限制到 0–255，返回 `0xRRGGBB` 数字 |
| `displayClear(color)` | 填充后台缓冲区 |
| `displayPixel(x, y, color)` | 写入一个像素，越界忽略 |
| `displayFillRect(x, y, width, height, color)` | 填充矩形，裁剪到显示范围 |
| `displayGetPixel(x, y)` | 读取后台缓冲区；调用者须保证坐标在范围内 |
| `displayPresent()` | 比较前后缓冲区，通过画笔绘制变化区域 |
| `displaySetRefreshRate(fps)` | 动态修改目标刷新率，限制到 1–60 Hz |
| `displayWaitFrame()` | 按计时器等待下一帧截止时间；超时后重新排期，不补帧 |

颜色参数是整数 `0x000000`–`0xffffff`，可直接传数字，也可用 `rgb()` 动态计算。无透明像素，黑色同样是实际绘制的颜色。输出通过 RGB→HSV 转换驱动画笔色相、饱和度、亮度，透明度固定为 0。

坐标原点是显示区域左上角，x 向右、y 向下；`left/top` 是 Kitten N 舞台坐标。宽、高和像素大小向下取整，最小为 1。例：

| 逻辑分辨率 | pixelSize | 舞台占用 |
|---|---:|---:|
| 32×18 | 12 | 384×216 |
| 64×36 | 6 | 384×216 |
| 128×72 | 3 | 384×216 |

分辨率不限于这些预设。示例模板舞台为 900×562，请自行保证显示区域在舞台内。调用 `displayInit` 可重新设置分辨率，应在绘图线程中进行。

## 缓冲与刷新语义

- `__pd_back` 是待显示图像，`__pd_front` 是已提交图像缓存，每像素一个 RGB888 数字。占用两个长度为 `width × height` 的列表。
- 同一行连续同色像素合并为画笔运行段；无变化帧跳过画笔输出，但仍扫描整个缓冲区。
- 一单位水平扫描线填充像素。边界会受到原生画笔圆端点、抗锯齿与舞台缩放影响，不保证截图逐字节等于输入 RGB。
- 批量写入和展示使用“一步执行”。在应用中将整帧更新放入 `warp` 能减少循环调度开销；等待必须放在 `warp` 外。
- 前缓冲是软件图像缓存，画笔并没有硬件原子换页。长帧仍可能被官方运行器分段调度。
- 当前模块是单实例：保留所有 `__pd_*` 名称。由同一个角色、同一个绘图线程操作；其他线程只宜请求调整刷新率。其他画笔操作或清屏会使缓存失效，需重新初始化。
- 使用项目共享计时器，运行过程中不要从其他脚本重置或暂停计时器。

## 统计与验证

在官方编辑器变量观察面板查看：

- `__pd_fps`：目标 Hz。
- `__pd_frames`：已完成的 `displayPresent` 次数。
- `__pd_actual_fps`：相邻完成帧计时器间隔的倒数，属瞬时值。
- `__pd_changed`：本次重画的像素数量（合并段内可能包含未改变像素）。
- `__pd_runs`：本次绘制的水平同色段数。

**目标刷新率不等于实测 FPS。** 显示复杂度、分辨率、像素大小、浏览器性能及编辑器观察面板都会影响实际完成速度。较高目标不会自动加速画笔。

2026-11-01，Windows / Edge headless / 官方编辑器项目格式 0.27.4，本机实测完成帧率：

| 分辨率 | 目标 15 Hz | 目标 30 Hz | 目标 60 Hz |
|---|---:|---:|---:|
| 32×18 | 1.99 FPS | 2.37 FPS | 2.37 FPS |
| 64×36 | 0.75 FPS | 0.75 FPS | 0.75 FPS |
| 128×72 | 0.12 FPS | 0.12 FPS | 0.25 FPS |

每档窗口约 8 秒，128×72 仅完成 1–2 帧，采样误差很大，不能据此认为设置 60 Hz 会加倍性能。此实现支持这些配置，但**尚不适合高分辨率实时动画**。测量时本机亦有编译/兼容检查任务，数字不是独占环境基准。原始记录和官方编辑器截图保存在 [`verification/`](verification/)；显示脚本未出现数值或列表越界提示。结构检查通过 1142 个积木及其连接/下拉值。

历史基准记录中的页面级 `Uncaught (in promise) #<Event>` 已定位到模板角色 SVG：编辑器解码 URL 后，十六进制颜色的 `#` 成为 URL 片段。改用 `rgb(96,143,238)` 后重新编译并运行默认演示 10 秒，页面异常、图片加载错误均为 0，完成 18 帧。历史基准数据保留原样，未将修复后的复验伪装为重新测量的九组数据。

可重复测量官方编辑器：

```sh
cargo build
# 需要可用的 Playwright；可用 NEKOC_NODE_MODULES 指向外部 node_modules。
# 默认使用 msedge，可用 NEKOC_BROWSER_CHANNEL 调整。
node tools/pen-display-benchmark.mjs artifacts/pen-display
```

此脚本对三种分辨率逐一按键切换 15/30/60 Hz；首帧完成后，每档取 8 秒墙钟窗口，记录完成帧差、实际时间、错误及截图。高分辨率时保持示例图形的逻辑尺寸，故不是等比例视觉负载。结果不是显示器刷新率或 GPU 呈现帧率。

自动检查：`npm run test:tools`、`cargo test --test pen_display`。前者验证 RGB、裁剪、脏区域和截止时间逻辑，后者验证真实编译导入链与本地解释器的 RGB 画笔输出。本地解释器有每 tick 步数预算，不用于衡量大分辨率演示的实际 FPS。
