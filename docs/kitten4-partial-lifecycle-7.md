# K4 第七轮：延迟克隆删除与显隐主路径

## 已修复的真实差异

K4 `dispose_clone` 以前即时调用公共删除，导致第五轮两份夹具第8帧角色提前消失；
`delete-caller-clone` 同帧相差1600像素。本轮将 **K4 脚本停止**与**实体移除**分开：
请求帧停止该实体任务，允许已取消显隐任务完成帧尾的最后一次 alpha 更新；
下一 update 入口才清理实体、局部值、物理体及图层。KN 仍即时删除。

新增 `src/engine/k4_lifecycle.rs`；`src/engine.rs` 只添加队列、Start清空、
update入口和两个 disposal 指令的接线。场景清理和超克隆上限淘汰不改为延迟；
直接删除也会撤销队列中的同slot记录，避免之后误删复用slot。

## 官方证据与来源

只读指定 `.js.orig`，不移植官方源码，不使用 HateNeko：
`src/player/build/player_v2.2d180c468559fbd29528.js.orig`，SHA-256
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
原始整包 0-based JS UTF-16 offset：

| 位置 | 只读观察 |
| --- | --- |
| 610924，Tn6a/dispose_clone | 克隆删除进入 RuntimeManager 的 destruction 请求 |
| 1189114，iNFq/destruct_entity | 登记实体销毁请求及强制停止解释器，不立即移除实体 |
| 1179866，iNFq/update | update入口先执行 update_dispose |
| 1187225附近，iNFq/update_dispose | 在入口处理排队的实体销毁与dispose |
| 1187690附近，iNFq/step_code | 排队停止的解释器不再进入本轮step |

这是指定离线包的受控60Hz行为；线上关系沿用 [版本取证](compatibility/k4-online-vs-offline.md)，
不扩展成所有浏览器/墙钟/版本认证。

生成器 `tools/compat/k4-partial-lifecycle-7-fixtures.mjs`，新增4份原创作品，
共72个官方update（24+24+12+12），证据
`kitten4-partial-lifecycle-7-evidence.json`。全部 errors/pageErrors=[]、外网放行0。

- 重录 `delete-clone`/`delete-caller-clone`：第8帧仍3个角色，第9帧为2个。
- `delete-following-code`：第2帧发起删除，第3帧移除；删除后的赋值从不执行。
- `delete-recreate`：原克隆消失后再次创建，第二只克隆也保持同样的下一帧删除相位。
- 克隆只按原型/存在数比较，不把随机UUID相等作为条件。

`tests/kitten4_partial_lifecycle_7.rs` 默认/禁用JIT、各两次Start比较全72帧存在数和变量。
`tests/kitten4_partial_visibility_5.rs` 已移除两处“已知早删除”豁免，检查完整408帧角色数、
visible、alpha及变量，不能只用重叠画面证明presence。

## 显隐主路径认证范围

`set_entity_show_hide` 主路径为有效UUID角色/组的瞬时显隐、渐变显隐、
已归档的竞争/取消与先down后hide输入清理，加上本轮删除调用克隆。
第五/六轮原创样例证据继续有效。本轮再次完整执行第五轮408对画布，
不得遮罩或删除原第8帧。最新结果 **408/408对 changedPixels=0**（RGB容差8/255，
完整1280×720，无缩放/遮罩）；并非宣称逐字节相同。结果见 `kitten4-partial-visibility-5-pixels.json`。

未验证：场景隐藏、悬空UUID、畸形mode、嵌套tell、删除与slot复用的同帧竞争、
restart/stop-all同帧、跨场景销毁、拖拽/多点触摸、非60Hz和预算中断。
本轮没有宣称完整生命周期全集兼容。

```powershell
node tools/compat/k4-partial-lifecycle-7-fixtures.mjs --record
cargo test --test kitten4_partial_lifecycle_7 --test kitten4_partial_visibility_5
node tools/compat/k4-partial-visibility-5-visual.mjs
node --test tests/k4-partial-lifecycle-7.test.mjs tests/k4-partial-visibility-5.test.mjs
```
