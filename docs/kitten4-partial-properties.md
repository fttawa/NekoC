# K4 partial：属性与克隆属性

## 范围与证据

只读固定离线包 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
未移植 HateNeko 或官方源码。以下 offset 是模块 factory 开头起算的 UTF-16 offset。

| 官方位置 | 核对内容 |
| --- | --- |
| `Tn6a@6870..7140` | UUID 属性/实体判定（不限定十六进制且不锚定首尾）、两位小数 Math.round |
| `Tn6a@8286` | 玩家非法实体字符串应忽略 |
| `Tn6a@35434` | 克隆目标回溯原型、索引严格 number、0 原型、缺克隆/场景错误 |
| `Tn6a@38280` | get_3 先验证实体字符串，再选择 UUID 变量读取或原生属性 |
| `Tn6a@42386` | get/get_2 均委派 get_3 |
| `Tn6a@86527` | 角色/场景背景属性、造型名/编号、效果和最终数值取两位小数 |
| `a1xw@36681`、`JfQ3/t` | set_rotation 先按弧度归一化，getter 转回角度 |
| `O8fc/get_var_or_list` | 局部变量作用域报错，未知全局 UUID 惰性默认 0 |

`tools/compat/k4-partial-properties-fixtures.mjs --record` 从仓库自有最小作品
`semantics-screen.bcm` 构建 **22** 个原创夹具，经 `runOracle` 执行 6 帧。
结果与官方资源摘要记录于 `kitten4-partial-properties-evidence.json`；错误用例保存
官方 domain error 及 block 事件，不把失败样本当成正常通过。

## 修复

- `get/get_2/get_3` 统一 K4 专用属性分派，不再通过 KN 坐标或 clone reporter 拼接。
- 修复合法但悬空 UUID 被通用删除引用策略吞掉的问题：普通属性 NaN，clone reporter 报错；
  `?` 和非实体字符串仍返回 0。
- `get_clone_index_property` 索引保留 Cell 类型，不把字符串/布尔强制转数字；
  小数、负数、NaN、缺克隆产生 `clone_entity_not_exist`。
- 全部属性 `0..17` 与 unknown 分支均实测；6/15/unknown 是 NaN，不冒充 0。
- 修复透明度等属性缺少最终两位小数处理，角度按官方弧度归一化后转换，
  不借用 KN 的方向归一化公式。
- 支持原型、克隆 self/原型目标与局部/全局 UUID 属性；未知 UUID 属性默认 0。
- K4 场景隐藏标量实体初始化使用背景的位置、方向、缩放、可见性；KN 保持原状。

Rust 回归 `tests/kitten4_partial_properties.rs` 对照每帧 result 列表和错误类型，
分别运行禁用 JIT 与默认 JIT。数值比较只统一 JSON 的整数/浮点表示，保留类型。
局部变量仍通过 reporter 结果核对，不宣称 NekoC entity_variables trace 已全面实现。

## 未验证/保留 partial

> 第五轮已补齐 UUID 全局列表引用、未知 UUID 的运行时惰性槽，以及空造型的
> 编号/名称边界；96 帧和 40 对零差异画布见
> [第五轮专项](kitten4-partial-properties-5.md)。以下条目是本轮历史边界，
> 第五轮仍未证明全平台/非有限状态和删除竞争。

- 全效果状态由效果专项验证；渲染器像素一致、iOS 的 ASCII 提示分支未验证。
- 非有限位置/缩放直接污染底层场景、删除克隆与同帧读取竞争、无造型边界尚未逐项浏览器验证。
- 未知 UUID 默认值目前在 reporter 返回 0，并未建立可观察的惰性全局变量槽。
- 本轮不把四个属性类型标为“完全一致”；保留 partial 并将具体证据与剩余边界写入覆盖表。
- 这些夹具证明指定离线包和输入，不代表其他版本、联网编辑器或平台全集。

## 复现

```powershell
$env:K4_PLAYER_DIR='E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-properties-fixtures.mjs --record
cargo test --test kitten4_partial_properties
```
