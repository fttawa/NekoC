# K4 partial 第二轮：印章、画笔尺寸与场景过渡

## 官方依据

只读指定 `K4_PLAYER_DIR` 的 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`；
SHA-256 为 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
下列 offset 由 `webpackModules(...)[id].toString()` 得到，以 factory 开头为 0，
不是原文件行号，不复制官方代码进入仓库。固定 `.orig` 含 DI 暴露点，不能证明等于线上所有版本。

| 官方位置 | 检查结果 |
| --- | --- |
| Tn6a@36848 | `distrot`→`distort`、`fadeInOut`→`fade_in_out`；bounce/slide 拼 direction；其他字符串直接存储，不拒绝未知 direction |
| Tn6a@59500..62100 | 画笔积木拒绝场景；size 的 number 检查排除 NaN，不排除 Infinity；文字与笔宽夹到 1..10000 |
| a1xw@46935 | 场景管理器只在非 WebGL 的 distort 返回不支持；未知 transition 仍可存储 |
| a1xw@50662 | 文字印章是 bold Arial/Microsoft YaHei、middle baseline、brush RGB/alpha，旋转参数是负角色 rotation |
| a1xw@51080 | 图像印章画原始纹理源，忽略角色 alpha/filter/visible；目的矩形坐标、宽高 floor，平移和缩放翻转保留 |

## 原创实测与实现

`tools/compat/k4-partial-drawing-fixtures.mjs --record` 生成并实测 18 份原创夹具。
证据 `kitten4-partial-drawing-evidence.json` 保留 fixture 哈希、资源哈希、逐帧状态和官方错误 annotation。
正常夹具各采 3 帧（笔宽组采 18 帧，逐步核对变化）；5 份 scene 夹具为预期 domain error。
所有 externalAllowed=0，不接触第三方语料。

印章 probe 仅在原生 brush 调用期间记录 Canvas 的实际 fillText/drawImage 和变换矩阵，
随后仍调用原方法；不替换官方计算结果。Start 会重建 brush，因此 hook 在原型与 Canvas 原型，
不是挂在初始化后将被丢弃的单个 brush 实例上。测试要求文字/图像实际调用非空，防止空观察假通过。

- `src/engine/k4_drawing.rs` 隔离 K4 typed number、1..10000 尺寸与 transition 名称规则，KN 不变。
- string size/NaN 不画，±Infinity 画为 10000/1，数值 text 在画布前字符串化；非法 align 按 Canvas 默认 start 的 LTR 视觉位置处理。
- 场景中的印章/画笔命令报 `use_pen_blocks_in_scene`，不再静默忽略或执行尾部。
- image stamp 输出不再携带角色滤镜/透明度；viewer 对目标矩形取整，颜色检测 raster 同步忽略 actor alpha 并对目标矩形取整。
- transition 保留现有 JSON 结构，kind 存规范化结果；未知 direction 不再编译时拒绝。

复验命令：

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-drawing-fixtures.mjs --record
cargo test --test kitten4_partial_drawing
cargo test --lib k4_drawing
node --test tests/k4-partial-drawing.test.mjs tests/k4-partial-fixtures.test.mjs
node tools/compat/k4-visual.mjs --input tests/fixtures/kitten4/partial-drawing-image-state.bcm --frames 1 --out dist/partial-drawing/image-visual.json
```

实际专项 Rust 4+2 测试通过，夹具比对含默认 JIT 和禁用 JIT，另有颜色 raster 单元回归；JS 5 测试通过。
图像样例另做真实双侧像素比对：960×720、691200 像素、容差 8，
294 像素超差（0.0425347%），MAE 0.01746576、RMSE 1.01937656；不是像素全等。
该结果只说明此夹具，不能据此扩展为所有 pivot/翻转/滤镜/分辨率已验证。

## 仍保留 partial 的理由

- stamp：字体栅格、超大文字纹理资源限制、精确孤立 surrogate、Canvas direction/非法 align 在 RTL 环境的行为未验证。
- image_stamp：颜色检测 raster 仍是掩码采样近似；半透明素材、纹理裁切、ELASTIC、混合印章顺序和 1024 个/帧安全限制等没有全面差分。此样例已有非零像素差异。
- set_scene_transition：名称/存储已对齐，但 viewer 仍用 CSS 近似，而非官方双场景 shader/ticker 动画；非 WebGL distort 错误与竞争切场时序未验证。
- 本轮画笔尺寸是顺带修复，不把其余笔色 HSL/填充、并发/删除与抗锯齿宣称全部完成。

本轮不移除上述三个 partial；不因为补了分支或有有限样例便宣称完整。
没有参考或移植 HateNeko。
