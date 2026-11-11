# KN 鼠标判断的目标语义

> 本轮后续修复：非法目标现在返回false，不再编译拒绝；官方0.27.4原创工程、局部调用及浏览器按下实测见[kn-partial.md](kn-partial.md)。下述原轮次的错误时机/部分语义结论为历史记录；覆盖状态已改为有执行路径／未完整验证，仍非完整认证。

本轮修复常用侦测积木 `mouse_down` 忽略 `sprite` 字段的问题，不宣称浏览器输入、拾取和全部错误处理完全兼容。

## 官方源码证据

- 官方 URL：`https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`。
- SHA-256：`58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`。
- UTF-8 零基字节 **1158568**：`mouseDown` 面板注册，`type` 为 `click/down/up`，`sprite` 可选自己、屏幕、角色，默认屏幕。
- UTF-8 零基字节 **1576944**：域函数 `mouseDown`。空目标或 `--screen` 读取 `global_click/global_tap`；`--self` 只用当前实体 ID；指定角色调用 `z(c)` 后对实例集合做 `some`。点击使用 `getIsMouseClickTarget`，按下/抬起读取 `sprite_on_tap` action state。
- UTF-8 零基字节 **1720624**：`getActorIdsFromOption` 对 UUID 目标取 `get_sprite_clones`，返回 `[e].concat(clones)`。三个锚点可用 `node tools/compat/kn-pointer-source.mjs dist/kncat3/main.8ccf2442.js` 检查；源文件只保存在忽略目录，不提交官方内核。

这是官方源码分支证据，**不是本轮新的官方浏览器端到端实测**。前轮输入实测见 `docs/input-kn-evidence.json`，不能扩大为本轮所有目标与克隆场景均已官方实测。

## 实现与回归

- `src/engine/input.rs` 新增目标敏感查询，复用现有按实例输入状态；`src/engine.rs` 仅对 KN 选择它，Kitten4 原有全局鼠标路径不变。
- `tests/kn_pointer.rs` 覆盖屏幕与当前角色分离、命名角色包含克隆但 self 不包含其他实例、按下保持、点击/抬起脉冲、restart 清理及非法字段拒绝。
- `mouse_event_type` 兼容别名仍保留。默认空目标按官方屏幕处理。

## 未验证与风险

- 官方对不存在角色是诊断后返回 false；当前 NekoC 在编译时拒绝，错误时机不等价。
- 隐藏角色、跨场景目标、多个触点、拖动出界后抬起和克隆删除期间的完整浏览器事件顺序未验证。
- 数值表达式使用 0/1，通用值路径保留官方 Boolean 类型。错误时机和完整事件顺序尚有边界，覆盖表继续保守列为部分语义。
- 未使用或移植 HateNeko 逻辑。
