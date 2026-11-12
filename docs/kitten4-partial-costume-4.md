# K4 partial 第四轮：set_costume_by_id 动态 ID 离线调查

## 结果与范围

本专项新增原创生成器、25 份 `.bcm`、官方逐帧证据、JS 检查，以及独立 VM
模块/双 VM 集成测试，已完成导入和执行接线。语料频率为 0，但动态 `style_id`
是真实可执行的官方 legacy 输入，不再按 opaque 拒绝。
**25 例双 VM 回归通过，仍继续保留该项 partial**：仅移除动态 ID 不支持的
旧限制，不将有限输入证据泛化为资源加载、复杂对象与平台分支完整一致。

生成器：`tools/compat/k4-partial-costume-4-fixtures.mjs`。
夹具：`tests/fixtures/kitten4/partial-costume-4-*.bcm`。
证据：`docs/kitten4-partial-costume-4-evidence.json`。
测试：`tests/k4-partial-costume-4.test.mjs`。
实现：`src/engine/legacy_costume.rs`。
Rust 回归：`tests/kitten4_partial_costume_4.rs`。

当前编辑器 schema 对 `set_costume_by_id` 返回本地化消息参数错误；生成器以
仓库原创 `semantics-screen.bcm`、已有通用 workspace shape 和自己声明的
legacy `style_id` socket 构造可编辑工程，再由官方 JSONEntityCompiler 编译。
这证明播放器编译/执行可达性，**不证明当前编辑器面板可创建该积木**。
所有图片是已有仓库原创 inline SVG，未读取第三方作品或复制官方实现。

## 官方只读位置

外部 app：`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`。
文件：`src/player/build/player_v2.2d180c468559fbd29528.js.orig`。
SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
位置均为模块 factory 首字符起算的 0-based UTF-16 offset，仅记录独立结论：

| 位置 | 观察 |
| --- | --- |
| `Tn6a@33666` | alias 将已求值 `style_id` 包成带该属性的对象，再委派 set_costume |
| `Tn6a@32109` | 对象 ID 与数值索引、名称是不同分支；缺失 style_id 属性不等于空字符串 |
| `Tn6a@22419` | actor 改当前 style；scene 则更新背景并直接设置 texture |
| `Tn6a@8286` 附近 | player 对非法实体参数有忽略策略；不是无条件抛错 |
| `a1xw@59606` | actor 只查自己的 styles 与已加载纹理，找不到返回错误值 |

固定 `.orig` 含既有 wrapper 的 DI 暴露；不独立认证上游发布文件，也不把结论
扩展到所有版本、线上编辑器、资源加载失败或平台全集。

## 实测矩阵

使用原创 UUID `40000000-0000-4000-8000-000000000001/2` 表示角色造型 A/B，
末段 `3/4` 表示背景 G/H，末段 `99` 为不存在 ID。A/B 属于角色 styles，
G/H 属于场景 styles，全部有效资源均在全局 texture 表中。

| 情况 | 官方结果 |
| --- | --- |
| 动态 text(B)；字段 literal B | 首帧即切 B，后续不变 |
| 同时字段 A、输入 text(B) | **字段 A 胜出**；这是官方编译后的实际结果，不应假定 input 总覆盖 field |
| 变量 choice 在 B→A→B 之间变化 | 每次调用读取当前变量；八帧 style 为 B,B,A,A,B,B,B,B，phase 为 1,1,2,2,3,3,3,3 |
| number 2、boolean true | 角色无效果且继续尾部；不是索引 2，不强制变成名称 |
| get_current_costume(B) 返回的对象 | 角色无效果；不是递归解包对象中的 style_id |
| 单项数组 [B] | **成功切 B**；JavaScript 属性键转换使数组成为该 ID |
| 两项数组 [B,"x"] | actor `HEART.CLIENT`，client annotation id=`set_costume` |
| 空字符串、普通非法字符串、有效造型的名称 `Second` | 角色无效果且继续；名称不充当 ID |
| missing-parameter（既无字段也无连接） | 角色/场景均无效果且继续；不能等同 text("") |
| 不存在但合法 UUID、属于背景的 H | 角色 `HEART.CLIENT` / `set_costume`，不能取别的实体 styles |
| B 两侧带空格 | actor `HEART.CLIENT` / `set_costume`；不 trim 成有效 ID，UUID 识别也不是全串锚定 |
| scene 动态/字段 H | 首帧成功切背景 H，不报 actor-only 错误 |
| scene 使用属于角色的 B | **成功切到 B 纹理**，不要求 B 在场景 styles 中 |
| scene 不存在 UUID、number 2、true、空字符串、普通非法字符串 | `HEART.SYSTEM`；背景保持 G，尾部不执行 |

16 个正常用例各完成 8 帧，共 **128 完整帧**；9 个错误用例均在首个 update 内
失败，完成 0 帧。所有 25 例均记录直接只读原生 actor style/scene texture：错误例
也在 `onFrame` 读取失败时状态，并在原生 report_error_and_stop 边界记录
`before=1, after=-1`，不是把 0 帧误当成功。全部 pageErrors 为空，外部请求全部
blocked；未设置 allowAssets，未放行任何素材或凭据。

## 实现与回归

已新增 `src/engine/legacy_costume.rs`：

- `Compiler::legacy_costume(&mut self, b: &Value) -> Result<Op>`：字段优先，
  动态输入其次，缺失为 `Cell::Undefined` 的普通 ValueExpr 常量；返回
  `Op::LegacyCostume(value)`。
- `Engine::set_legacy_costume(&mut self, actor: usize, value: usize, pc: usize)
  -> Result<()>`：先求值，reporter 错误不产生造型副作用；Undefined noop；
  JS 属性键转换（含单项数组）；actor 查自身 styles、scene 查全局
  `program.costumes/style_names`；成功设置 style 并标记 dirty；错误携带
  HEART.CLIENT/HEART.SYSTEM、set_costume 和源 block ID，失败不改变状态。
- 没有更改普通 `Op::Style`；全局资源元数据只能代表已知纹理，
  不模拟浏览器资源异步加载失败。

共享文件已完成接线：

1. `src/engine.rs` 加 `mod legacy_costume;`。
2. `enum Op` 加 `LegacyCostume(usize)`；它仍可保持 Copy。
3. 命令 compiler match 加
   `"kitten4_legacy_costume" => self.legacy_costume(b)?,`。
4. `step` 的 match 加
   `Op::LegacyCostume(value) => self.set_legacy_costume(actor, value, pc)?,`。
   helper 自己设置 dirty，无需把此 Op 加入通用 dirty 提前标记列表。
5. `src/kitten4/aliases.rs` 的 `set_costume_by_id` 分支不再拒绝动态输入、
   不再构造静态 CostumeLiteral。直接保留字段与输入，设置 block type 为
   `kitten4_legacy_costume` 后 return true（不要再调用 translate/lower_block
   将内部指令变回 opaque）。所有 ID 入口都应经过新指令，包括 literal。
6. JIT 原生支持白名单当前默认拒绝未知 Op，新指令保持 side-exit；不要标为
   可原生执行。若主会话修改了 exhaustive match，再补对应分支。
7. `cargo test --test kitten4_partial_costume_4 --test kitten4_catalog` 已通过，
   全量门禁结果见未提交的 `OC-REPORT.md`。

新增 Rust integration test 对照 25 份证据：正常 16 例核对全部 8 帧变量、
actor style 和 scene texture delta，默认 JIT/解释器各跑两次 Start；9 个错误例
核对类别、源 block、before/after 部分状态和角色 style 不变。scene setter
错误发生在赋值前；失败时不额外 advance 伪造完整 frame。

## 后续语义注意事项

1. 输入与字段同时存在时，当前实现使用已测得的字段优先级；被覆盖 socket
   是否有求值副作用仍未验证，不据此泛化自制 reporter 的所有调度情况。
2. 普通 `Op::Style` 仍按原本名称/索引规则工作，legacy 独立命令保留 typed
   输入，再按 JS 属性键转换做 ID 选择，不把数字当成造型索引。
3. 场景 foreign texture 查全局已知资源，元数据不等于浏览器已成功加载纹理，
   未加载、失败与跨 scene 资源时序仍需专项验证。
4. legacy 错误路径使用已核对的非锚定 UUID 识别；不修改普通 Style 指令的
   历史 UUID 策略，避免把此处有限证据扩大到另一类积木。
5. 本证据覆盖 workspace；既有 `kitten4_catalog` 还验证 workspace/published
   两种导入的 literal 与动态 text，以及原样 roundtrip。克隆专有纹理未验证。

仍未实测：null 显式输入、嵌套数组/自定义对象属性键、getter 副作用、未加载
纹理、跨 scene 导入时序、动态 ID 指向克隆专有资源、ELASTIC 体造型重建、
未知背景的 viewer 异步加载与滤镜像素。这些是明确保留的 partial 边界；不能因
25 例通过或本轮 camp 去 partial，就同时将 costume 标为完全一致。

## 复现

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-costume-4-fixtures.mjs --record
node --test tests/k4-partial-costume-4.test.mjs
```

JS 检查覆盖夹具确定性、SHA-256、全帧动态/常量状态、预期错误类别和 attribution、
尾部未执行及外网隔离。已实际运行，**3 passed，0 failed**。
Rust 专项 **2 passed，0 failed**，既有 catalog **33 passed，0 failed**；
全量门禁最终结果见 `OC-REPORT.md`。
