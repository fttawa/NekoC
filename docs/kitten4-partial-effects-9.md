# K4 第九轮：ASCII 组合的最终投影（仍 partial）

## 结果

`web/renderer.js` 的独立实现改用 active filter rectangle 的 quad/UV，最后一个
ASCII pass（无 sceneTransform）直接投影到目的画布，不再先在 POT 面生成字形后复制。
官方像素格边界对最终投影的插值舍入敏感；多一次 POT 投影会使部分字形水平移动1像素。
没有复制官方实现、float 打包字形或引入 epsilon，也没有放宽容差。

| 原创输入、固定帧 | 修改前 tol8 超差 | 修改后 tol8 超差 |
| --- | ---: | ---: |
| twist+ASCII，第3/4帧 | 各557 | 各0 |
| 舞台外 ASCII+twist，第3/4帧 | 各72 | 各0 |
| hue/alpha/brightness/pixelate/twist/saturate/ASCII，第13/14帧 | 各703 | 各65 |
| hue+ASCII，第3/4帧 | 各1 | 各1 |

真实 NekoC VM 与官方 VM：**9件64对**固定帧、960×720完整画布、白底合成、无mask。
其中60对 tol8 下0超差；不代表字节全等。报告同时保存 tol0/1/8，alpha/brightness
等链在tol1下仍有超差，不把所有误差概括为“单字节”。独立官方 getter 驱动的 renderer
隔离报告得到相同数字，但它**不是 VM dispatch 证明**。

仍维持五种效果 setter/change **partial**，不升级总类型或主路径。

## 只读官方依据

外部 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
UTF-8解码后JS字符串0-based UTF-16 offset（非文件byte offset）：

| 定位 | offset | 可观察事实 |
| --- | ---: | --- |
| `jt.get_effect_filter` | 793395 | ASCII排在saturate之后 |
| legacy quad `.map` | 1380071 | 顶点为active rectangle，UV为active/POT尺寸 |
| filter manager `applyFilter` | 1385192 | 先绑定output，再使用legacy quad绘制 |
| ASCII shader | 1596092 | screen坐标取mod、格角采样与预乘亮度分档 |

`k4-partial-effects-9-probe.mjs` 仅在原生 `filter.apply` 调用完成后观察，不改变
原生shader、参数、input、framebuffer或精度。`geometry.json`证实ASCII最后output为null，
投影为960×720舞台；输入256×256但active frame为232×184、原点377/275，UV最大
0.90625/0.71875。舞台外原点814/588的最终输出也不增加POT字形面。
图像读回诊断曾用于定位，完整原始数据仅在忽略的 `dist/partial-effects-9/`，不当作
未扰动官方最终证据；可提交geometry探针没有readback副作用。

## 文件与证据身份

- `kitten4-partial-effects-9-pixels.json`：现有 `k4-trace.exe --render` 的真实VM数据；
  含二进制hash、renderer LF hash、夹具hash和每次官方资源hash。
- `kitten4-partial-effects-9-renderer.json`：shader隔离，明确NOT NekoC VM。
- `kitten4-partial-effects-9-baseline.json`：同9件输入的修改前shader隔离基线，
  不是旧VM基线。源文件保存为忽略的 `dist/partial-effects-9/renderer-before.js`。
- `kitten4-partial-effects-9-geometry.json`：原生pass目标、quad、UV、投影、精度。
- 夹具只有仓库原创非对称SVG及自制积木工作区，无外部素材、无第三方作品。
- 第八轮JSON不重写；第八轮测试改为验证历史报告彼此hash绑定；第九轮测试负责当前renderer绑定。

## 仍公开的负例与未验证

- 全链65像素及hue+ASCII1像素仍为tol8负例；上游量化和亮度阈值都可能被字形放大，
  **没有证实剩余负例的唯一原因**，不以“浮点误差”笼统豁免。
- ripple外部displacement素材仍缺失/阻断；完整素材条件未验证，不伪造资源。
- sceneTransform存在时保留中间面复制路径；未认证transition中继承alpha、移动网格或
  嵌套filter的最终投影。`distort`截图专项由主会话另行验证。
- 多分辨率/非1倍backing scale、不同GPU、iOS/非WebGL、极端尺寸、所有排列组合未验证。
  本地shader仍highp，官方本次观察mediump，不宣称跨GPU字节一致。
- 缓存与纹理上限沿用第八轮；未做性能benchmark，不承诺性能不回退。

## 专项验证与复现

先确认无 `jit-corpus` / `perf-bench`，不隐式执行Cargo：

```powershell
Get-Process jit-corpus,perf-bench -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-effects-9-fixtures.mjs
node tools/compat/k4-partial-effects-7-renderer.mjs --round9
node tools/compat/k4-partial-effects-9-visual.mjs
node tools/compat/k4-partial-effects-9-probe.mjs ascii-twist ascii-offstage all-no-ripple
node --test tests/k4-partial-effects-9.test.mjs tests/k4-partial-effects-8.test.mjs
$env:K4_EFFECTS8_INTEGRATION='1'
node --test tests/k4-partial-effects-8.test.mjs
```

已运行9件64对真实VM、同64对隔离和原生几何探针；Node第8/9轮静态断言通过，
第八轮6件live regression（每件1/3/5帧，tol1）通过。Cargo/最终全库门禁由主会话集中运行。
额外尝试 `editor-compat --channel msedge` 对本轮原生K4 `.bcm`返回
`invalid_project`/blockCount0/ok=false：此工具针对KN `.bcmkn`，不是本轮K4工作区的
编辑器检查通过证据；本轮不声称在线编辑器认证。K4官方原生编译与加载已由上述oracle实际执行。
