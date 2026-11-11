# K4 partial 第四轮：任意字符串阵营

## 选择与结果

从 `oc/integrate` 的 96 项 partial 出发，按只读语料出现次数与修复成本排序。
`get_3`（2049）、效果（1228/735）受属性副作用/跨平台滤镜像素制约；
物理（1051 等）还受求解器与复杂轮廓制约；云受联网后端制约。
`self_set_role_camp`（1336 次）是高频且边界独立的修复：
不再把 K4 的任意 group 字符串拒绝编译、别名到 yellow，或退成 no_camp。

实现独立的 `src/engine/role_camp.rs`：区分未设置、四标准值与任意字符串。
KN 保持原四值及 `camp_green` 别名。K4 setter 保留空串、Unicode 等字符串；
克隆复制当前值后独立修改；标准阵营碰撞只包含实际设置为该阵营的角色。
碰撞选项解析还按官方规则保留任意包含 `camp` 的目标字符串，支持自定义阵营
作为碰撞主语或目标，而不只四个编辑器值。
`Engine::actor_group` 提供不消费帧的只读观测，不改变 trace JSON 契约。

额外发现：本离线包导入时**忽略序列化 actor.group**。三份初始 group 探针
全部观测为未设置，而不是对应字符串或 no_camp，四阵营碰撞全部 false。
本地初始 K4 状态据此修正；Start 恢复未设置状态并清除克隆。

## 官方证据与复现

只读 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
整包 JS UTF-16 字符偏移约 590999：setter 把字段传给 group setter，场景报
`use_actor_blocks_in_scene`；825166：存储原字符串；既有克隆证据见
[partial misc](kitten4-partial-misc.md)。这里只记录位置与独立观察，不移植官方源码。
`.orig` 有包装器 DI 暴露，未独立认证为线上分发物。

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-camp-4-fixtures.mjs --record
node --test tests/k4-partial-camp-4.test.mjs
cargo test --test kitten4_partial_camp_4 --test kitten4_partial_misc
```

原创生成器只复用仓库原创 fixture/schema，不读语料。六份 `.bcm`，每份 30 帧，
seed=1，共 **180 帧**；官方运行无错误、无 pageErrors、放行外部请求数为零。
证据 `kitten4-partial-camp-4-evidence.json` 保存 fixture SHA-256、官方资源
SHA-256、每帧完整变量和角色 group（包括克隆 ID 规范化）。

| 夹具 | 逐帧约束 |
| --- | --- |
| cycle | camp_green、自定义、空串、Unicode 不属于四标准阵营；随后四值切换构成单位碰撞矩阵 |
| custom-cycle | camp_green、camp_custom、Unicode camp 双向碰撞逐帧矩阵；未设置成员与未知阵营不命中 |
| clone | 克隆继承 Unicode；原角色改 yellow 不影响克隆；克隆随后改 camp_green 不影响原角色 |
| initial-camp_green/custom/empty | 序列化字段未恢复；真实运行 group 为未设置，标准阵营碰撞全 false |

自定义目标规则的只读定位：`Tn6a@37458` 附近的选项目标解析对包含 `camp`
的字符串查询运行时阵营，`a1xw@43337` 附近按 group 严格相等取成员。
偏移从模块 factory 开头起算，与本节前面的整包偏移口径不同。

Rust 回归逐帧比较变量与每个角色的 group，解释器/默认 JIT 均检查，并重复 Start；
既有 `kitten4_partial_misc` 继续验证标准阵营、场景错误及失败后不执行尾部。
JS 回归核对再生成一致、hash、帧数、网络隔离和克隆关键值。

据此将 **self_set_role_camp** 从 partial 改为已实现 / offline-oracle-verified。
仅指固定离线包的字符串字段积木本体；不声称物理碰撞求解器、所有非字符串
畸形 workspace、跨版本或在线编辑器全等。上述扩展范围仍**未验证**。
没有引用或移植 HateNeko。
