# Kitten 4 partial misc：阵营、舞台信息与拖动

> 第四轮已补齐任意字符串阵营并验证初始 group 忽略行为；本页是历史记录。
> 当前实现与 180 帧新增证据见 [kitten4-partial-camp-4.md](kitten4-partial-camp-4.md)。

## 范围与结果

本次修改 `src/engine.rs` 内 `self_set_role_camp`、`get_stage_info`、
`self_set_draggable` 编译/执行分支，以及 `src/kitten4.rs` 的 `Targets::bump`
对四个标准动态阵营目标的保留分支。本文只描述这三个类型；同一轮属性、效果
和覆盖表修改分别见对应专项文档及 `OC-REPORT.md`。未引入第三方源码或作品。

| 类型 | 本次补齐及原创实测 | partial 建议 |
|---|---|---|
| `self_set_role_camp` | 编辑器四值；切换立即影响阵营碰撞；克隆继承及独立修改；场景使用时报错；`camp_green` 不再冒充 `camp_yellow` | **保留 partial**：官方 `set_group` 接受任意字符串，本 VM 使用四值紧凑表示。非编辑器 camp 字符串显式编译拒绝，不声称完整兼容 |
| `get_stage_info` | `info === "width"` 取宽，其他值（包括未知、空、缺失）取高；三种合法尺寸；角色/场景脚本及背景缩放不改变舞台尺寸 | **可去 partial**（合法 K4 舞台尺寸、标准播放器画布语义） |
| `self_set_draggable` | 仅字符串 `"1"` 开启；`"0"`、`"true"`、`"draggable"`、空字符串关闭；初始值、开关、克隆独立继承、场景错误；Rust 验证 flag 对 VM drag 的门控 | **可去积木本体 partial**；本结论不额外声称所有浏览器拖动手势/物理拖动分支完全一致 |

非标准舞台尺寸的官方导入会归类到标准尺寸；此处没有改变整个 K4 导入尺寸策略。
KN 的历史 draggable aliases、camp_green alias 和舞台 info/type 回退不改变。

## 官方源码核对

外部 app：`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`。
核对 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`，SHA-256：
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
仅记录独立分析定位，不复制第三方源码：

- 字符偏移约 590755：self draggable 对 dropdown 做严格字符串比较；self camp
  直接传字段给 actor group setter。两者禁止 Scene，通过 domain error
  `use_actor_blocks_in_scene` 报错。
- 约 614642：stage info 读取 renderer view，只有 width 分支，其他均 height。
- 约 821670：actor clone 复制 draggable/group 当前值；后续修改不共享。
- 约 825166：group setter 原样存储字符串。约 1118171：三种标准舞台大小。

`.orig` 保留了本机 wrapper 的 DI 暴露，未独立认证上游分发文件；与统一 oracle
既有证据边界相同。没有调用优化后的同名非 `.orig` player 文件。

## 离线实测证据

生成器：`tools/compat/k4-partial-misc-fixtures.mjs`。
原创项目：`tests/fixtures/kitten4/partial-misc-*.bcm`（12 项），仅复用仓库原创
基础结构、schema 与内联 SVG，不读取第三方语料。
证据：`docs/kitten4-partial-misc-evidence.json`，含每个夹具 SHA-256、官方静态
资源 SHA-256、逐帧变量及 actor group/draggable 直接只读观测。

所有用例通过 `k4-oracle.mjs` 的 `runOracle` 运行，seed=1、60 fps、18 帧。
全程不传 `allowAssets`，每例允许的外网请求为 0。正常例无 runtime/page errors；
两个 scene setter 例预期在首帧报错，证据保存官方错误 annotation，并在官方
error-report 边界只读记录 `before=1, after=-1`，证明尾部没有执行。

| 夹具 | 官方结果 |
|---|---|
| `camp-cycle` | red/yellow/blue/no_camp 四次切换，observer 的 4×4 阵营碰撞矩阵为单位阵 |
| `camp-clone` | 原角色改 yellow，克隆仍 red；克隆改 blue 后原角色仍 yellow；observer 只触碰克隆 |
| `camp_green`, `camp_custom` | 官方原样保留字符串，对四个标准阵营检测全 false；本地明确拒绝这些输入 |
| `draggable-cycle` | 开/关及非标准字符串边界，最后重新开；逐帧 flag 完整记录 |
| `draggable-clone` | 克隆继承 true，原角色随即关闭而克隆仍 true |
| `draggable-initial` | 初始序列化 draggable=true 在启动后保持 |
| `stage-landscape`, `stage-portrait`, `stage-classic` | 分别 1280×720、620×900、960×720；width/height、unknown/empty/missing、scene reporters |
| `scene-self_set_role_camp`, `scene-self_set_draggable` | `use_actor_blocks_in_scene`，尾部不执行 |

重录（PowerShell）：

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-misc-fixtures.mjs --record
```

## Rust 回归与验证状态

`tests/kitten4_partial_misc.rs`：JIT 开/关双路径，逐帧官方变量对比、可编辑格式
往返、draggable frame delta/VM drag 门控与重启、场景报错及非标准 camp 显式拒绝。
验收时发现并修复以下两项后，执行本测试：

- `Targets::bump` 曾将标准阵营字符串当作已删除角色，导致碰撞表达式提前降为常量 0。
  现保留四个编辑器阵营 ID，由 VM 按当前成员动态解析。测试已注册原创 SVG 的
  80×40 costume 尺寸，不依赖浏览器图片解码。
- 非标准阵营拒绝测试改用 `format!("{error:#}")` 检查完整错误链，避免顶层
  `owner "Probe"` 上下文遮蔽实际错误。

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo test --test kitten4_partial_misc
```

已执行 fixture 官方离线实测、测试文件 rustfmt，并运行上述 cargo 测试：
**4 passed，0 failed**（JIT 开/关两条路径均由测试覆盖）。
只读检查 `web/input.js`，已有 draggable flag→drag gesture→VM gate 链路，本次未改 viewer。
