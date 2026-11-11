# K4 partial 第四轮：按语料频率与修复成本选择

## 只读统计

基线 `cf310a9`（本轮开始时本地 `oc/integrate`），原覆盖清单 96 项 partial。
重新执行 `tools/compat/k4-block-catalog.mjs::corpusFrequency` 扫描
`E:/nekoc/dist/kitten4-corpus`：53 个 `.bcm`，0 个 workspace owner，
4529 个 compiled owner；优先 workspace，AST 按 owner/block ID 去重。
**96 个 partial 共出现 9756 次**，45 个非零频、51 个零频，所有类型频率
与原覆盖 JSON 相同。这里只提交类型与次数，不保存第三方项目内容。

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
node tools/compat/k4-block-catalog.mjs E:/nekoc/dist/kitten4-corpus docs/kitten4-block-coverage.md
node tools/compat/k4-block-catalog.mjs E:/nekoc/dist/kitten4-corpus docs/kitten4-block-coverage.json
```

## 优先级与取舍

成本按可独立验证的代码范围定性排序，不把出现次数当作品数，也不伪造精确工时。

| 候选（基线 partial） | 出现次数 | 消除主要差异的成本 / 决策 |
| --- | ---: | --- |
| get_3 | 2049 | 高：惰性变量槽、非有限状态、无造型与平台效果；保留 partial |
| self_set_role_camp | 1336 | 低至中：独立字符串状态、克隆、动态阵营碰撞；本轮优先完成 |
| self_set_effect_2 / self_change_effect_3 | 1228 / 735 | 高：ASCII 像素与跨平台 shader；保留 partial |
| set_actor_as | 1051 | 高：求解器、复杂轮廓、软体；保留 partial |
| physics2_enable_force / set_velocity | 317 / 250 | 高：接触与跨求解器轨迹；保留 partial |
| stamp / image_stamp | 308 / 165 | 高：字体、raster、复杂纹理；保留 partial |
| cloud_variables_get / set / change | 296 / 159 / 114 | 高：在线权限、并发与持久化不由离线夹具证明；保留 partial |
| set_scene_transition | 215 | 高：distort 与 callback 调度；保留 partial |
| physics2_set_actor_as / physics2_set_texture | 173 / 103 | 高：接触轮廓、纹理与软体；保留 partial |
| get_clone_index_property | 162 | 中至高：继承属性、效果及平台边界；保留 partial |
| cloud_lists_get_value / append | 110 / 83 | 高：在线后端；保留 partial |
| self_enable_physics / friction / boundary / restitution | 95 / 93 / 92 / 91 | 高：共用物理求解器；保留 partial |
| physics2_set_speed / boundary | 77 / 67 | 高：共用物理求解器；保留 partial |
| set_entity_show_hide | 64 | 中：取消/竞争/删克隆与点击状态；未在本轮修复，保留 partial |
| set_costume_by_id | 0 | 中：独立 legacy 命令适合并行探针；本轮补动态 ID、保留复杂资源边界 |

## 结果和证据

- [任意字符串阵营](kitten4-partial-camp-4.md)：六份原创夹具、180 官方帧，
  解释器/默认 JIT 逐帧比较变量与每个角色 group，另复用既有场景错误证据。
  `self_set_role_camp` 去 partial，按固定离线包积木本体标为 offline-oracle-verified。
- [动态造型 ID](kitten4-partial-costume-4.md)：25 份原创夹具，128 正常完整帧，
  9 个首帧错误边界；动态/字段优先级、角色与场景 ID 规则分别约束。
  不将未验证的复杂对象、显式 null、资源加载和平台求解器边界冒充完整支持。

覆盖表 partial **96 → 95**；按类型出现次数加权 **9756 → 8420**（下降
1336，即约 13.7%），不是作品运行成功率或全语义兼容率。

官方依赖仅从外部只读加载，无官方源码移植、无 HateNeko 逻辑移植、
无语料复制入库。正常回归读取原创夹具与事实证据，不依赖官方包。
“逐帧一致”只适用于指定离线包、指定输入与采样范围，不代表全部 K4 作品一致。

完整门禁、语料三 seed 与最终提交见 worktree 根目录不提交的 `OC-REPORT.md`。
