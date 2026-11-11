# KN 第三轮：角色外观、对白与过程角色参数

> 后续更新：本地规范 JSON 现在接受 `get_sprite_property` 作为官方代码 API 的显式别名，严格按官方转换插件映射原生 reporter，见 [kn-local.md](kn-local.md)。本文旧的“不新增同名积木支持/拒绝回归”是当时交付状态，不再是当前本地编译契约；它仍不是官方注册积木。

仅依据官方源码及官方编辑器局部调用，不使用 HateNeko。主会话已实际运行专项 Rust 回归 **8/8 通过**；最终全量门禁结果见 `OC-REPORT`。本子任务未启动 Cargo，没有生成 `.bcmkn`。

## 版本身份与复现

URL 前缀：`https://creation.bcmcdn.com/neko/web/release/static/js/`。

| 文件 | SHA-256 |
| --- | --- |
| `main.8ccf2442.js` (M) | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| `main-vendors.07f7dd7e.js` (V) | `38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68` |
| `crc_libs.8196dbd1.js` (C) | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` |

原始文件均放在忽略目录 `dist/kncat/`；以下位置是原始 UTF-8 **零基字节偏移**。原创观测摘要（不含第三方源码或转换器 XML）归档于 `docs/kn-appearance-evidence.json`，仅包含 URL、哈希、源码位置及观测。默认工具测试只读可提交归档，干净仓库不依赖 `dist/`、浏览器或网络。

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-appearance-oracle.mjs
$env:KN_APPEARANCE_LOCAL='1'
node --test tests/kn-appearance-source.test.mjs
```

普通离线检查仅运行 `node --test tests/kn-appearance-source.test.mjs`，不设置 `KN_APPEARANCE_LOCAL`；原始 bundle 及本地现场报告检查独立 skip。设置该变量为 `1` 后，两项本地检查必须找到文件且通过，不会静默跳过缺失证据；可用 `KN_APPEARANCE_LOCAL_DIR` 指定探针输出目录。

探针只在隔离无头 Edge 页暴露 webpack loader，不改官方函数体。调用注册查询后销毁积木；局部 helper 调用临时替换舞台 actor 查找并在 finally 恢复；未修改用户项目。报告 `dist/kncat/appearance-dialog-oracle.json`，本次 `pageErrors=[]`，源码/现场证据测试 **8/8** 通过。

## 已确认与实现

### `appearance_of_sprite`

- M:1574870 附近域函数选择自身或指定角色，调用 `getSceneOrActorProperty`；M:**1897852** 是完整 getter 入口。
- `scale` 与 `width` 都是当前横向缩放百分比，`height` 是纵向百分比；不是 costume 像素尺寸。场景这三个值固定 100。方向为角度。结果经 lodash `round(value, 2)`。
- 现场真实 getter 输入 x-scale=1.23456、y-scale=0.56789 得 scale/width=123.46、height=56.79；角度 π/7 得 25.71。
- 新 `src/engine/kn_appearance.rs` 提供 KN 专用 getter，保留 K4 原分支。新表达式种类由解释器 helper 执行，不声明额外原生 JIT 编译支持。
- 为使写后读一致，同步修复 KN 的 set-scale / change-scale / 单轴 set/change：M:**1621338**、**1621702**、**1622204**、**1622655**。set-scale 重设两轴；change-scale 对实际两轴分别加减；单轴是绝对百分比；范围 1..9999；场景不变。非有限值维持既有策略。

### `self_dialog_wait`

- 注册 M:1150200；域函数 M:**1567273** 将 `Infinity` 和 `blocking=false` 传给公共气泡 helper M:**1569626**。名字中的 wait **不意味着等待关闭**。原 NekoC 的非阻塞行为正确，未改成阻塞。
- helper 仅对可见角色显示；空字符串有效；null/undefined 不显示；普通空格替换为 NBSP；超过 90 个 UTF-16 code units 截成前 90 个并加 `...`。
- 官方 helper 局部实测：两次 Infinity 气泡没有创建任何 task；对照 0.25 秒 timed 气泡只创建一条 lifetime=250、blocking=true task；输出验证空格替换及截断。
- KN 普通气泡运行分支复用上述格式化/可见性规则，不改 K4。显式 close 仍清除。

### `get_sprite_property`：**不新增同名积木支持**

- 官方编辑器现场 `new_block` 报 `Unknown block type get_sprite_property`。
- M:2797697 的 JS→XML 插件负责把此代码 API 映射成 coordinate/style/appearance/effect 等实际积木；现场 `get_sprite_property('--self','height')` 转成 `appearance_of_sprite(appearance=height)`。
- `camp` 转换报“暂不支持的属性值”，因此不能按 API 类型声明或转换残留 XML 假定其为可执行积木。Rust 增加拒绝回归。

### `procedures_2_actor_param`

- 注册 M:**1124189**；实际域函数 M:**1667073** 起。
- 从当前 procedure 中积木 mutation 的 `id="..."` 找 `proc_parameters[id]`，不按展示名称。Actor 实参是字段：C:**886804** 的 `getParameterFiledOrInput` 明确 Actor→field；官方编辑器 M:1390519 的 Actor 编辑分支同样读取 field。
- 新实现按参数 ID 编译，Actor 下拉字段变成文本实参；支持 x/y、style_index、scale/width/height、direction、camp、distance、0..6 特效。无效目标返回 NaN。距离按官方 Math.round(100*d)/100；普通属性按公共 getter。
- 菜单列出 `clone_index`，但公共 getter 没有对应 case；本次保留编译错误，不伪造该结果。缺 mutation ID / 不存在 ID 显式编译报错，故错误路径不是完全复刻官方运行时。

### `get_clone_index_property` 常用外观项

- M:**1560338** 域函数解析原型/克隆序号，然后直接调用同一个 `getSceneOrActorProperty`。
- 新增命名属性 `scale`、`width`、`height`、`direction`、`style_index`，复用新 getter。未改历史数字属性编码；数字属性与 KN 特效的重叠问题不在本轮声称完成范围。

## Rust 回归与门禁建议

`tests/kn_appearance_dialog.rs`：解释器/JIT-enabled 两种模式覆盖独立两轴、rounding、写后读、缩放上下限、非阻塞无限气泡、空文本/隐藏角色/close、参数 ID（故意过期展示名称）、Actor 字段实参、无效角色、拒绝错误 ID/clone_index、伪 API 拒绝、克隆命名宽高。

`tests/kn_appearance_dialog.rs` 专项 8 项已由主会话实际运行通过。`src/engine/kn_appearance.rs` 另有 decimal-shifting round 单元回归。以下为复现命令，最终全量结果见 `OC-REPORT`：

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo test --test kn_appearance_dialog
cargo test --lib kn_round_matches_official_decimal_shifting
```

## 未验证 / 未声称

- 专项 Rust 8 项已通过，最终全量门禁结果见 `OC-REPORT`；JIT-enabled 回归不等于验证所有新增表达式的热 native 路径。
- 未做完整 KN 作品播放/像素差分；局部官方调用验证的不是端到端调度。
- 并发 timed 气泡、自动关闭和 close 对阻塞线程的取消、跨场景切换延后显示未重构；timed 对白仍用既有 show/wait/close lowering。
- 文本 costume 的特殊缩放来源、代理项在第 90 个 UTF-16 单元正好被切断（Rust 字符串用 replacement）、复杂数组/对象的 JS toString 不保证完全一致。
- 过程角色 clone_index 以及 Actor 参数非法值警告、普通参数 reporter 按 mutation ID 绑定的既有缺口未补齐。
