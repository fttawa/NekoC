# 云监视器和匿名离线排行榜 UI

## 本轮结果和认证边界

**尚未达到整舞台 RGB 容差 8 全等，因此五项 UI 继续为 partial，不升级。**
实现已从通用绿白监视框推进到独立 Canvas 云列表皮肤、云标量保存位置，以及 Web/原生匿名 loading 壳。
这不是在线排行榜、字体/图标素材或原生像素一致性认证。

四份原创夹具共 **105 个连续 update**，双方使用实际 VM 状态，不拿官方数值代替本地执行。
证据 [k4cloudui-evidence.json](k4cloudui-evidence.json) 小于 300 KB；PNG 和诊断仅在忽略目录 `dist/k4cloudui/`。

| 夹具 | 帧数 | 舞台超差像素最大值（960×720，RGB 8） | 内容 |
| --- | ---: | ---: | --- |
| k4cloud-monitors | 27 | 485 | public/private/list 显隐、跨帧更新、重叠层序 |
| k4cloud-ranking | 24 | 0 | 有效/无效 show、hide、reporter；DOM 另比，不包含在零差异声明中 |
| k4cloud-ui-empty-rows | 27 | 434 | 空表、空字符串项、换行、长文本省略、六项、真实指针上拖一行、清空/隐藏 |
| k4cloud-ui-ranking-values | 27 | 0 | show 时数值快照、重复 show 不替换、字符串显示 `-`、大数字科学计数 |

监视器非零残差约占画面 0.0702%，主要是圆角/边框三角化、亚像素纹理取样和调整手柄；
500 像素仅是回归上限，**绝不等于“容差 8 内全等”**。原生采用 egui 字体与几何，尚无与官方配对的原生截图。

## 官方依据

只读包 `E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`，
`src/player/build/player_v2.2d180c468559fbd29528.js.orig`，SHA-256
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
沿用已记录的 DI/受控 update oracle，不重新证明线上发布物关系。
下表为 UTF-8 解码后 **JS 字符偏移（零起始），不是字节偏移**：

| 位置 | 事实与本轮实测 |
| --- | --- |
| 918600 起 `Gn/Yn/$n/ti` | 标量 18px NotoSans 字体族、52 高、橙白值框；当前无 theme 夹具实际没有图标 |
| 927000 起 `ri/oi`，933700 起 `li/hi/di` | 列表 body 位于 (8,58)、170×180，四行每行45；外框186×246，2px灰边，bounds从锚点减1；空文案“空” |
| `di.draw_background / li.create_item`，约 934000–945000 | 橙色标题、居中20px文字、首白次灰；拖动更新内容而不换四个背景纹理，因此滚动后首行仍白，不按绝对序号交替 |
| 1001965 / 1002430 `generate_variable_opt/generate_list_opt` | 标量 scale 与列表 offset 是两种不同尺寸契约；列表精确行数组不能从换行拼接字符串还原 |
| 1814500 起 ranking React 组件 | 独立 DOM，`value_format`、重复show、空user_list、loading状态；实际默认wide壳555×400，不是舞台canvas的一部分 |

逐帧证据读取真实 PIXI stage 的可见性、文字和 bounds；没有把 `CmCloud` 声明里不更新的 `visible` 当实际显隐。
通过真实浏览器鼠标从舞台 (570,410) 拖到 (570,365)，第17帧官方可见序号由1–4变成2–5，数据数组不变。
初次空表还有淡灰滚条、从非空清空后无滚条，这个离线观测同样保留。

排行榜实测：`42` show后把原变量改为99，当前值仍42；已显示时对另一变量show也保持原榜。
字符串分数不强转数字，DOM为`-`。`12345678901`显示`1.23457e+10`。
每个update分别检查DOM出现/消失、标题、匿名名、分数、loading、current-user/content/scroll/loading分区，以及无排名行。
没有把“空舞台零差异”当作排行榜图像全等。

## 实现

- `src/engine/cloud_ui.rs`：只读 UI 数据，准确区分 `[]`、`[""]` 与换行项；只传可见云列表。
  记录show时的排行榜分数快照，close/hide/restart清除；不改表达式、编译链、调度/JIT布局。
- `Frame.cloud_ui` 是附加 wire 元数据；既有 `Monitor` 四字段和换行值契约不变。
- `web/renderer.js`：cloud无theme标量复用common canvas，云列表独立Canvas，按保存位置/offset绘制，
  真实指针按45舞台像素步进滚动，不引入官方资源。
- `web/overlay.js`：原创无资源排行榜DOM壳，555×400与分区布局、匿名/当前值/loading、脚本切换，close发送本地VM事件。
- `src/studio/overlay*.rs`：独立原生传输/egui绘制，保存位置、监视器当前值、列表精确行、滚动、排行榜快照。
- `k4-visual` 新增可选逐帧观测钩子；截stage时暂时隐藏本地ranking DOM，与官方PIXI范围一致；排行榜另采DOM与全页PNG。

未复制官方源码、纹理、头像或字体。未参考或移植 HateNeko。

## 回归与复现

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo build --bin k4-trace
node tools/compat/k4cloudui-evidence.mjs
$env:K4_CLOUD_UI_INTEGRATION='1'
node --test tests/k4cloudui.test.mjs
cargo test --test k4cloudui
cargo test --features studio --lib studio::
```

证据生成器只写两件新原创`.bcm`、本轮JSON和忽略目录；没有生成`.bcmkn`。
Rust回归逐帧比官方snapshot、默认JIT/禁用JIT两路；原生preview额外比较监视器集合/列表/分数。
门禁最终结果见 worktree 根目录未提交的 `OC-REPORT.md`。

## 未完成 / 未验证

- 舞台像素全等未完成：已知上述非零残差；本轮没有升级任何UI类型。全覆盖表已重新生成并记录本轮证据。
- 原生真实字体/圆角栅格化、云图标主题、头像、header字形/背景、旋转loading图形为原创近似，不是官方美术复制。
- 原生列表暂用鼠标滚轮，未对齐官方触摸拖动；原生关闭/拖动/缩放排行榜、Web排行榜拖动/缩放、列表缩放手柄交互未完成。
- Web关闭按钮已接入VM，但本轮没有官方点击关闭配对取证；不把它纳入认证。
- 竖屏/非默认舞台、不同DPI/OS字体、theme=common的云图标皮肤、未保存位置的自动排布、超长/超大列表传输性能未验证。
- 云列表新增完整可见行数组会增加每帧payload；未设置100项截断以免误画真实行，需后续按可见视窗分页优化。
- 真实联网、鉴权、在线数据、用户排名、10秒后真实墙钟错误态、重连/后端持久化均不在匿名受控update范围。
