# K4 partial 第三轮：场景过渡

## 结果和边界

`web/renderer.js` 中 K4 的单画布 CSS 近似改为双场景内容合成：slide 同时移动出入场景，
bounce 置顶进入场景，fade 对两个场景的每个绘制子项继承 alpha。
保留离场背景、角色索引和画笔纹理，新场景内容每次 render 刷新；不把角色和背景扁平化后再淡入。
KN 仍保留原 CSS 路径。本专项不改 VM；coverage/catalog 与 Cargo 门槛由主代理统一处理。

**建议继续保留 `set_scene_transition` 的 partial。** distort 实际是两张截图加扭曲滤镜，
本轮仅测得其原生属性/延迟，不实现假 fade；当前 viewer 直接显示目标场景，明确不对齐。
本轮没有复制官方源码，也没有使用第三方作品或 HateNeko。

## 只读源码依据

文件：`$K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`。
SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
以下为 `webpackModules(source)[id].toString()` 的字符偏移（factory 首字符为 0），不是文件行号。
该离线 `.orig` 有包装器 DI 暴露点，不能认证等于全部线上版本。

| 模块与偏移 | 观察到的规则 |
| --- | --- |
| `Tn6a@36848` | 名称归一化：`fadeInOut`、`distrot`；slide/bounce 拼接 direction |
| `a1xw@23171` | 二次缓出；标准分段 bounce-out，不是 cubic-bezier overshoot |
| `a1xw@23824` | tween 读 `performance.now()`；elapsed 严格大于 duration 才移除；先计算未夹取的末次插值 |
| `a1xw@25905` | 支持的名称分派；未知名称没有 tween，也没有完成回调 |
| `a1xw@26701` | slide 双场景同时平移 0.5 秒；up 从屏幕下方进入，left 从右侧进入 |
| `a1xw@27049` | bounce 只平移新场景 1 秒；临时移到场景容器最上层 |
| `a1xw@27464` | fade 两场景同时变 alpha，0.5 秒，无顺序等待 |
| `a1xw@27599` | distort 截图精灵；出场 alpha/angle 0.5 秒，入场另延迟 0.1 秒再走 0.5 秒 |
| `a1xw@28534` | 完成后还原 x/y/alpha、bounce 原层序、移除截图精灵 |
| `a1xw@44829,46935` | current scene 先变；未知类型可存储；非 WebGL distort 报不支持 |
| `lvVU@331680` | distort 使用径向扭曲，半径内角度随距离平方衰减；需独立 shader/padding 像素验证 |

## 原创实测

生成器 `tools/compat/k4-partial-transition-3-fixtures.mjs` 创建 12 份可编辑 `.bcm`：
slide/bounce 四方向、fade、distrot、none、非法 slide direction。
图像都是仓库原创 inline SVG。每份采样 65 帧，证据
`kitten4-partial-transition-3-evidence.json` 含夹具哈希、原生资源哈希、逐帧 x/y/alpha/visible、
原生 tween 数、场景层序、distort 截图 alpha/angle。全部 `errors=[]`，`externalAllowed=0`。

诊断只替换动画输入时钟 `performance.now()`，每帧设为 `(frame-1)*1000/60`，
显式推进原生 PIXI ticker；不替换计算结果、不额外推进 VM。
这不是“官方墙钟必然与 VM Clock 同步”的声明。普通 viewer 使用浏览器 performance 时钟；
测试可注入 `renderer.transitionClock`。本轮没有改变官方 oracle 的默认运行模式。

代表性值（960×720）：

- slide-left：0 ms 出/入 x 为 `0/960`；250 ms `-720/240`；500 ms `-960/0`；
  516.666… ms 已清理，出场不可见且坐标归零。
- bounce-up：250 ms 入场 y=`379.6875`；500 ms=`168.75`；516.666… ms=`175.4875`，
  能看见反弹；1000 ms 到零但仍有 tween，1016.666… ms 清理。
- fade：250 ms 出/入 alpha 为 `.25/.75`；不是 先出后入，也不是 CSS 默认 ease-out。
- slide-invalid：65 帧逻辑 current 均为 B，但 A 仍 visible，B hidden；不能当作 none。
- distort：250 ms 截图 alpha `.25/.51`，angle `-2.981895027/1.616349420` radians；
  500 ms 入场仍 `.96`；516.666… ms 出场末次未夹取采样 alpha 回到 `.001111…`，
  留待截图管线实现时处理；不因记录了这些属性宣称当前 renderer 支持 distort。

## 回归和复验

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-transition-3-fixtures.mjs --record
node --test tests/k4-partial-transition-3.test.mjs tests/k4-partial-drawing.test.mjs
$env:K4_TRANSITION_3_INTEGRATION='1'
node --test tests/k4-partial-transition-3.test.mjs
```

默认 JS 测试逐项核对 11 份夹具的全部 715 帧（distort 不列入对齐断言），容差 `1e-9`；
另检查名称、严格端点清理、未知名称、继承 alpha、保留离场角色索引、K4 不调用 CSS 动画。
所有夹具同时验证确定性再生成和证据 SHA-256，避免改夹具后误用旧证据。

可选浏览器回归直接比较原生 ticker 与真实 `StageRenderer` WebGL：5 个场景、各 10 个时刻，
每帧固定 598 个像素网格、RGB 容差 8，允许最多 2 个栅格边界样本超差。
这不是完整像素图相等证明，也不是 VM 调度差分。该专项隐藏角色，只隔离背景/场景合成：
未额外驱动的官方角色 render-texture 首帧上传存在独立相位，不能把它当作过渡语义修复。
本轮上述 5 组浏览器对照全部通过：50 帧共 29900 个网格样本，RGB 容差 8 下超差 0；
采样明细复跑后存 `dist/partial-transition-3/pixel-samples.json`。
同时接入画笔专项的 `web/pen-k4.js`（`apply` 保存本帧 lines，K4 `drawLines` 分派），
不更改 KN capsule；纹理同现有 fillTexture 一样跨 batch 复用。该模块源码与画笔证据由画笔专项维护。

## 尚未验证/未对齐

- distort screenshot/filter 合成、非 WebGL 错误传播、滤镜 padding/纹理边缘。
- 转场尚未结束又切换（原生 clear/reset 的参数与可见性组合）；本实现取消旧过渡并从当前逻辑场景开始，
  不保证保持原生竞争切场的瞬态画面。
- 转场期间离场角色仍被全局脚本修改：viewer 只保留最后一份离场 frame 状态；VM 目前只输出当前场景增量。
- 带视频的跨场景层序；避免把同一视频重复绘制进两场景，但没有原生逐帧差分。
- 从后场景切回前场景的 fade 层序、bounce 还原层序，局部变量/克隆、窗口分辨率变化、暂停/续播相位。
- 当前清晰端点测试使用理想 60 Hz 时钟；实际 ticker 跳帧、多个 tween 创建时间不同、末次超期属性短暂值未完全重现。
- 没有修改场景激活/切换积木的 VM callback 阻塞时机。官方完成回调参与 running group 切换，
  renderer 的显示过渡不能被当作调度语义已对齐。

上述边界意味着不应去除 partial；本轮完成的是可证伪的位置/透明度回归和主要普通过渡的显示改进。
