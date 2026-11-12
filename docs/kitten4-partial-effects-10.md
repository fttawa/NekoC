# K4 第十轮：ASCII 量化链、过渡栅格与启动顺序

基线 `822c57dceb4a4d95df65115187274ef68ace630c`，任务开始时与 `oc/integrate` 一致。
本轮**不升级类型或主路径覆盖等级**。修复旧负例不等于所有滤镜组合或过渡一致。

## 已修复与实测

| 路径 | 本轮结果 | 证据范围 |
| --- | --- | --- |
| hue/alpha/brightness/pixelate/twist/saturate/ASCII 全链 | 第13/14帧原各65个 tol8 超差像素变为0 | 原第九轮输入不变，真实双VM完整画布 |
| hue + ASCII | 第3/4帧原各1个超差像素变为0 | 同上 |
| 9件 ASCII 组合 | 64/64帧 tol8 超差为0 | 960×720、白底合成、无mask，同时保存tol0/1/8；不是字节全等 |
| 无滤镜纹理 distort | 65帧全部 tol8 超差为0，最大MAE `0.00004533179012345679` | 官方VM+ticker与独立renderer输入，不是NekoC VM像素证据 |
| none/slide/fade/bounce 无滤镜纹理 | 各65帧MAE与tol8超差均0 | 同上，左方向，不扩展为所有方向认证 |
| fade全链继承 | 65帧全部tol8超差为0，最大MAE `0.000010609567901234568` | 同上，离场滤镜+入场无滤镜 |
| none 启动顺序 | 不再执行旧场景激活循环；删除旧豁免，14件910个update状态回归通过 | Rust逐帧比较逻辑场景及tail/activated/oldTicks/newTicks |

`kitten4-partial-effects-10-pixels.json` 是现有 `k4-trace.exe --render` 的真实VM结果，
包含二进制hash、renderer LF hash、夹具hash及官方资源身份。
`kitten4-partial-effects-10-renderer.json` 是同9件64帧shader隔离，明确 **NOT NekoC VM evidence**。
过渡证据按case拆为 `kitten4-partial-transition-10-*.json`，8件各65连续帧，共520对；
每帧均为完整画布RGB容差8，没有mask、抽帧或改变容差。
所有新JSON单文件小于200 KB，最大约195 KB。

## 独立实现的调整

- 输入栅格、hue、brightness、saturation分别经过RGBA8中间面；矩阵在CPU计算，
  shader顺序乘加，不把矩阵融合进未量化的输入采样。ASCII亮度分档会放大上游一个字节的差异。
- 原生batch的预乘RGB最近字节舍入，alpha截断；使用独立 `packedTint`，不强行共用一个标量。
  TilingSprite仍走原来的非batch路径。
- K4 SVG先通过Canvas九参数 `drawImage` 栅格化再上传，不启用 `willReadFrequently`。
  本机Chromium上该选项及重载选择会改变斜线抗锯齿；不是跨GPU/浏览器保证。KN原路径不改。
- distort截图保持透明；截图sprite先以world alpha进入带padding的POT RGBA8输入，再做径向采样，
  而非采样后乘alpha。active quad与filter输入尺寸分离；结束释放可重用alpha输入。
- 过渡容器位置/alpha在空间滤镜输入之前继承，最后ASCII直接投影，避免再次继承。
- K4 Start单独dispatch全局启动，然后dispatch场景激活，保留原生创建先后；KN保持原顺序。

没有复制官方shader函数体、第三方作品或资源；没有移植HateNeko，没有全局mediump、epsilon或扩大RGB容差。
第九轮负例证据原样保留，其测试改为历史hash绑定；第十轮证据绑定当前renderer。

## 官方依据与边界

只读 `$K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
下面是UTF-8解码后的0-based UTF-16位置，不是文件字节位置；可重现的定位窗口hash见
`kitten4-partial-effects-10-source.json`，仅存元数据、不存源码体。

| 定位 | offset | 用途 |
| --- | ---: | --- |
| batch.packInterleavedGeometry | 1457165 | worldAlpha与batch打包 |
| 颜色打包Nt | 1281514 | RGB最近字节、alpha截断 |
| ColorMatrix shader | 1574197 | 反预乘、逐项乘加、再预乘 |
| hue CPU矩阵 | 1577306 | 矩阵系数 |
| SVGResource Canvas创建/九参数drawImage | 1356656 / 1357962 | 默认Canvas栅格路径 |
| Et.set_distort_transition | 789964 | 双截图、下方活目标场景、padding10 |
| 启动场景激活ft | 1728353 | 启动回调中的场景激活 |

Start先后的直接实测还保存原生事件：全局根creation_counter0，旧激活根1，下一update目标激活根2；
旧激活根未resume。不能只凭函数位置推断调度结果。
Twist公式、legacy quad/UV等定位沿用[第九轮](kitten4-partial-effects-9.md)与
[过渡第九轮](kitten4-partial-transition-9.md)。

## 保留的负例与覆盖决策

新继承夹具在旧场景同一 `start_on_click` 链内依次设置hue65、brightness125、pixelate9、
twist17、saturate60、ASCII8，再切场。目标场景无滤镜，避免多启动线程竞争。
renderer端initial/target frame为独立输入，**不是从NekoC VM取得的渲染数据**。

| 继承负例 | 最大tol8超差像素 | 最大MAE | 决策 |
| --- | ---: | ---: | --- |
| slide全链 | 4293 | 0.34220100308641976 | 移动filterFrame/网格仍有差异，未修完 |
| distort全链 | 150185 | 11.431806520061729 | 截图透明/滤镜合成路径未完全对齐，未证实唯一原因 |

测试对上述两项明确检查负例存在及当前上界，不把它们标为像素通过；已修复项仍严格要求0个tol8超差。
原生slide几何同时保存：移动后filterFrame从(-20,-20,1000,760)变为(-83,-20,1001,760)，
输入1024²，twist offset保持(480,360)。这不是已经修复移动网格的证明。

**ripple单列例外**：外部displacement素材仍缺失/阻断，完整素材条件没有验证，不伪造资源。
此外，多GPU、多倍率、真实时钟相位、竞争切场、活离场内容、视频/浮层截图与所有排列组合未验证；
没有性能benchmark。局部修复加上这些现存负例，不满足升级 `set_scene_transition` 或五种effect写入类型的条件。

## 复验

官方包和语料只读，输出原始诊断到忽略的dist；无隐式Cargo构建：

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-effects-7-renderer.mjs --round10
node tools/compat/k4-partial-effects-9-visual.mjs --round10
node tools/compat/k4-partial-transition-10.mjs
node tools/compat/k4-transition-10-order.mjs
node --test tests/k4-partial-effects-10.test.mjs tests/k4-partial-transition-10.test.mjs
$env:K4_TRANSITION_10_INTEGRATION='1'
node --test tests/k4-partial-transition-10.test.mjs
```

本轮 `.bcm` 为原创K4工作区，官方原生编译/加载由oracle执行；不声称KN专用editor-compat认证。
通用门禁、三seed、全语料JIT、提交与target清理见根目录不提交的 `OC-REPORT.md`。
