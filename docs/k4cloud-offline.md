# K4cloud 官方匿名离线逐帧证据

## 已完成的范围

本轮新建 5 件原创 K4 `.bcm`，经固定外部官方包的 JSONEntityCompiler、真实 Start 入口执行，
共 138 个连续 update。所有外部 HTTP/WebSocket 请求均被 oracle 拦截；无账号、无凭据，
没有复制官方实现、第三方作品或第三方素材。没有生成 `.bcmkn`，因此未调用仅适用于该格式的编辑器检查器。

官方包仍为 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
`.orig` 保留包装器 DI 暴露点；本轮不再次认证其与线上发布包的关系。
旧标量/边界依据见 `kitten4-cloud.md` 与 `kitten4-partial-cloud-2.md`，旧证据未修改。

| 新夹具 | update 数 | 实际观测 |
| --- | ---: | --- |
| scalar-shared | 24 | public 0 默认值、数值赋值/增减、字符串连接、数值减少、非法 bool 写入保留旧值 |
| scalar-personal | 24 | private 同上，另一 public/private 值保持 0，保存 metadata value 被忽略 |
| list | 39 | 空表、前/后 append、insert、get 活别名、nth/last、length、exist/index、nth/last replace/delete、越界追加、delete all |
| monitors | 27 | public/private/list 分别显示，值与列表行跨帧更新，分别隐藏，舞台 PIXI 文本及部件可见性/边界 |
| ranking | 24 | private/public 显示与隐藏，reporter 返回值，未知 `?` show 忽略，Redux 与 DOM 壳 |

`tools/compat/k4cloud-fixtures.mjs` 是可重建生成器，夹具位于 `tests/fixtures/kitten4/k4cloud-*.bcm`。
`tools/compat/k4cloud-evidence.mjs` 复用现有 `runOracle` 回调逐帧读状态，不改共享 oracle 或外部内核。
证据 `docs/k4cloud-evidence.json` 约 205KB，包含项目哈希、实际执行 block ID、每帧 typed 变量、
舞台部件、DOM、错误与网络拦截记录。全页官方截图只保存在忽略路径 `dist/k4cloud/official/`，
不把截图或官方 UI 资源带入版本库；JSON 仅保存截图路径/哈希。

## 关键舞台事实

### 云标量与列表监视器

- `CmCloud.db.get_variables()[id].visible` 在 show/hide 后仍为夹具初始 false。
  不能用这个元数据值代表舞台显隐；采样同时遍历真实 PIXI stage 的 monitor id、visible 和文本。
- show shared 的第 4 帧显示 `NekoC shared / PUBLIC`；第 7 帧 private 显示 `NekoC personal / 42`；
  第 10 帧 list 显示 `NekoC items / ROW-A`；第 13 帧分别更新为 `PUBLIC-NEXT / 43 / ROW-A,ROW-B`。
  第 16/19/22 帧依次隐藏 shared/personal/items，文本随之消失。
- position 是舞台中心偏移而非左上像素。960×720 舞台中 `{x:18,y:18}` 的 shared monitor
  局部坐标 `(18,-18)`，bounds 起点 `(498,342)`；personal y=82 的 bounds y=278，
  list y=146 的 bounds y=213（部件边框使起点比 `360-146` 少 1）。
- 同时显示可能重叠；本轮保留官方原生位置，不用重新排版掩盖位置证据。

### 排行榜

- 有效 private show 第 4 帧：`show=true,var_id=personal,value=42,loading_status=0,user_list=[]`；
  DOM 显示 `排行榜 / - / 未登录用户 / 42 / loading`。public show 第 10 帧同形，value=0。
- 离线并不是完全没有 UI；有 loading 壳与匿名当前值卡片，但没有任何已取得的排名行。
  本轮截图 `dist/k4cloud/official/ranking/step-1.png` 已实际查看，属于上述 loading 壳。
- hide 清为 `show=false,user_list=[],scale=1`，DOM 排行榜消失；未知 `VAR=?` show 后仍隐藏，
  reporter 为 false，不抛运行错误。
- 排行榜是 DOM，监视器是 PIXI；只抓 canvas 会漏掉排行榜。
- 未测试点击关闭、拖动/缩放、滚动、非默认尺寸、长文本、show 后分数实时更新、真正在线排名。

## 覆盖表与回归

17 个 cloud/ranking 类型全部有官方真实 block event；不是仅凭 fixture 含块名。
证据覆盖表由 `node tools/compat/k4cloud-coverage.mjs` 生成，见 `k4cloud-coverage.md`。
全表 `mappingStatus` 不把显式映射当语义认证；cloud默认partial，随后用精确数据类型集合升级。
主会话已通过全部 Rust 门禁，其中新增5项及既有18项云专项全部通过。
12项数据积木升级为 `offline-oracle-verified`，仅指固定官方包匿名离线数据分支；
显隐与排行榜5项保留 partial。孤立surrogate、在线服务及舞台UI像素仍不在认证范围。

本轮已按主会话要求给正式 `k4-block-catalog.mjs` 添加新证据说明，并用同一外部官方包、原只读语料
重新生成正式 JSON/Markdown 全表；升级依赖实际双VM回归，不以“新增证据链接”冒充完成。

### 已经双VM回归通过并升级的精确类型

纯数据域是 **12 项**，不是 13 项：

- 标量 3：`cloud_variables_get`、`cloud_variables_set`、`change_cloud_variable`。
  public/private 各 24 帧验证 0 默认值、set、increase/decrease、文本连接/数值减少和非法 bool 保留旧值；
  旧第二轮提供更多 primitive、非有限、UTF-16 上限与拒绝输入证据。
- 列表 9：`cloud_lists_get`、`cloud_lists_get_value`、`cloud_lists_length`、`cloud_lists_is_exist`、
  `cloud_lists_index_of`、`cloud_lists_append`、`cloud_lists_insert_value`、`cloud_lists_replace`、`cloud_lists_delete`。
  39 帧验证全部操作及逐次中间列表、活别名、nth/last/all、越界 insert/replace 追加；
  旧第二轮补严格索引类型/范围、非数值项与 UTF-16 项上限。

上述在 `k4cloud`、`kitten4_cloud`、`kitten4_partial_cloud_2` 实际双VM通过后，
标为 `offline-oracle-verified` 并明确范围“固定官方包匿名离线数据分支”。尚未验证边界继续独立列出，
不意味着在线服务/精确孤立 surrogate 或本地共享后端等于官方。

UI/相关状态暂保留 **5 项 partial**：`show_hide_cloud_variable`、`show_hide_cloud_list`、
`show_ranking`、`hide_ranking`、`is_ranking_show_hide`。其中 reporter 可以单独证明离线状态布尔值，
但本轮不利用 reporter 形式绕过整个排行榜 UI 缺口；原生尚无 ranking loading 壳。

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4cloud-evidence.mjs
node tools/compat/k4cloud-coverage.mjs
node --test tests/k4cloud.test.mjs tests/k4-partial-cloud-2.test.mjs
# 仅主会话统一执行，不与其 Cargo 并发：
cargo test --test k4cloud
```

本子任务实际结果：官方 5/5、138 帧，runtime/page errors 全空；JS 7/7 通过（本轮5、旧第二轮2）。
正式全表重生成后，连同 `tests/k4-block-catalog.test.mjs`（启用官方包只读集成校验）共 **24/24 通过**，
0 failed、0 skipped；目录仍为原 53 件只读语料，377 类型。这是升级前的专项结果；最终12项数据域升级、5项UI保留partial。
`tests/k4cloud.rs` 新增 5 项默认 JIT/禁用 JIT 逐帧比较，含全部变量、monitor id 可见性、ranking 变量 ID；
主会话随后实际运行 `cargo test --all-targets`，这些回归已通过；舞台UI只验证monitor可见ID/值及ranking状态，不声称本地像素或DOM壳等价。
另一次临时 monitor 祖先节点诊断曾因 `text` 并非总为字符串而失败，补 string guard 后重跑成功；
失败不计入最终5件成功的采样结果，也没有把部分轨迹当完整证据。

不声称：线上服务端数据、鉴权/权限、增量协议、限流/队列、跨用户在线隔离、并发、断线重连、
官方服务器持久化、最终排行榜内容、像素全等、孤立 surrogate 精确表示。
