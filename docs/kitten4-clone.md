# Kitten 4 分裂生命周期（4.11.20）

## 证据与复现

官方：https://kitten4.codemao.cn/ 。`tools/clone-kitten4.mjs` 用无头 Edge、
`openOfficial` / `loadOfficialProject` 导入自写作品，检查官方 Blockly
反序列化后的积木类型、字段、连接，再点击开始按钮。没有替换官方运行时。

```powershell
node tools/clone-kitten4.mjs --generate
node tools/clone-kitten4.mjs --out dist/clone/reproduced.json
cargo test --test kitten4_clone
npm run -s test:tools
```

记录：`tests/fixtures/kitten4/clone-official.json`，包含浏览器版本、时间、
官方构建 URL、作品 SHA-256、检查点、原角色和分裂体状态。
`split-semantics-official.json` 是只读参考分支的原始记录；其中
`when-split` / `keys-split` 对应本分支保留的同名自写作品。
JS 测试检查生成一致性和所有相关 SHA-256。

点击探针通过**官方舞台的 `actor:click` 事件入口注入输入**，官方事件监听器、
动态响应器和积木代码均照常执行；不是自己执行积木语义。未验证浏览器实际
纹理命中测试（小尺寸 SVG 在本次无头渲染里未能用鼠标命中）。

## 官方结论及回归

| 自写作品 | 官方结果 | 回归 |
| --- | --- | --- |
| `clone-events` | 原角色与分裂体各运行开始帽子，`started=2`；`cloneStarted=0`；广播响应数 2；条件持续为真时重复执行且 body 不重入；分裂体点击响应数 1；具体键按住重复 | `split_start_broadcast_and_mirror_use_distinct_code_policies`；条件/按键 single-flight 测试 |
| `semantics-when-split` | 原角色和分裂体都电平重复、单次在途 | `split_conditions_and_held_keys_are_repeated_single_flight_per_instance` |
| `semantics-keys-split` | 两者都按住重复，释放后在途 body 完成；不运行 mirror-start | 同上，解释器及 JIT 开启各跑一次 |
| `clone-state` | 分裂参数是绝对坐标 `(100,-80)`，不是源角色 `(30,40)`；继承第二造型及 150% 大小；画笔重新初始化，黑色、宽度 1、抬笔，而非源角色的 `#123456` / 7 / 落笔 | `split_copies_appearance_and_entity_variables_but_not_brush`；笔划输出检查未继承落笔和笔宽/颜色 |
| `clone-variables` | 私有变量在分裂时复制：原角色 12、分裂体读到 12 后改为 13，原角色仍 12；全局变量共享，20→21 | 同上 |
| `clone-mixed` | mirror 和分裂体共用编号/数量：mirror=1（x=0），split=2（x=100），count=2；只有 split 执行普通开始/广播代码，mirror 仅执行 mirror-start | 混合策略测试 |
| `clone-recurse` | 分裂体可再次**指定原角色**分裂；最终开始计数 3、分裂体数 2 | `split_can_target_original_again_and_dispose_does_not_kill_siblings` |
| `clone-mirrorSelf` | 空代码克隆在 mirror-start 中再次 mirror 自己，官方报“克隆体无法克隆自己” | `kitten4_clone_cannot_copy_itself_as_a_mirror`；普通 split 禁止以克隆体自身为目标另有官方源码证据 |
| `clone-dispose` | 删除编号 1 后 count=1，编号 2 仍 x=200；新增编号 3 为 x=300；编号不压缩也不复用。删除原角色不删除兄弟分裂体；被删角色当前脚本停止，后继计数为 0，存活分裂体继续响应键盘 | 删除/重启回归 |
| `clone-limit` | 跨帧创建第一批 350 个成功；累计第二批后仅存活 512 个 | `split_limit_is_not_a_300_live_sprite_cap` |
| `clone-burst` | 同帧串联 305 次请求只创建 301 个；等待后一次新请求成功，count=302 | 同上 |
| `clone-collision` | 在分裂体位置放另一自写角色，`when bump(__self,target)` 持续重复，原角色不接触；无需开启物理 | `split_collision_condition_remains_active_and_hot_keys_fall_back_safely`（显式提供官方已解码 SVG 的 20×20 尺寸） |

重复次数由浏览器调度决定，回归不把官方墙钟计数当作 60 Hz VM 的固定值。
Kitten 4 没有本次 schema 可用的独立 `on_bump_actor` 帽子；碰撞帽子按原生
`when` + `bump` 组合验证，没有引入物理实现。

## 官方源码定位

实际加载构建为：

- `https://creation.codemao.cn/kitten/build/kitten.99f88a64d495cf0e79d0.js`
- `https://creation.codemao.cn/kitten/build/vendors.5035cd22e77914a9f363.js`

`node tools/clone-kitten4.mjs --inspect --out dist/clone/source-probe.json`
可只读提取相关 webpack 模块到忽略目录 `dist/clone/vendor-modules.json`。

- `Tn6a` 的 `clone:function`：检查目标不是克隆体；调用 `clone_entity(c,!1)`，
  再 `generate_clone_actor(c,d,{x:f,y:g})`。mirror 则用 `clone_entity(a,!0)`。
- `Tn6a` 的 `clone_actor`：`latest_order++`；删除只移除对应映射，不压缩编号。
- `Tn6a` 的 `get_clone_num`：读取原型的 `get_sprite_clones`，包括 mirror 和 split。
- `Tn6a` 的 `get_clone_index_property`：0 表示原角色，正编号查询共用映射。
- `iNFq` 的 `clone_entity`：`entities_cloned_times[e] > entity_max_clones_per_frame`
  才拒绝；默认阈值 300，因使用 `>`，第 301 个仍成功；计数每帧清空。
- `3pZI` 的 `RuntimeDataImpl.clone_created`：超过 `per_entity_clone_limit`
  时向最老克隆发送 `dispose_clone`，不是拒绝新克隆。Kitten 4 编辑器实测配置
  的存活阈值为 512（通用运行时默认 300 不能代替该编辑器实测）。
- `O8fc` 的 `clone_entity_variables`：复制实体变量。
- `Tn6a` 的 `sprite_on_tap` 动态响应器以当前实例为 `__self`，
  `actor:click` 监听器设置对应实例的 clicked 状态。

## 实现与限制

仅在 VM lowering 将 `kitten4::clone` 变为 `kitten4_split`，可编辑 canonical
格式保持原块，导出逐字数据结构往返不变。实例保留原型引用与独立分裂编号，
mirror 的普通事件代码为空。删除原角色保留其稳定槽，不能作为新克隆槽复用。

`Split` 不属于 JIT 可委托操作，自动退回解释器执行分配；带实体私有变量的
Kitten 4 / Kitten N 程序使用解释器，避免 native slot 读写误用全局槽。
私有变量统一使用 [`actor-variables.md`](actor-variables.md) 中的 `Sprite.variables`
实体单元，mirror 和分裂都经 `copy_actor_variables(source)` 深复制源实体的
当前表，不再占用全局数值槽，也不再维护额外的 K4 实体覆盖表。
回归同时测试显式禁用 JIT 与默认开启 JIT，650 帧热键重复覆盖热路径。

未验证：任意键/释放键的完整生命周期、跨场景分裂和激活时序、所有视觉效果与
层级关系、实体私有列表的浏览器实测及完整别名关系、非数值/无穷坐标、超额
淘汰的精确帧内时序。当前私有标量变量已有官方实测；私有列表的克隆深复制
有官方源码依据和本地回归，但不能声称完整一致。
同帧创建超多有大量帽子的角色时，还可能触及 VM 自身 4096 任务保护限额。

没有参考或移植 HateNeko；没有第三方运行时逻辑引用。
