# Kitten 4 语义实测（4.11.20）

官方地址：https://kitten4.codemao.cn/ 。用无头 Edge、未修改的官方运行时，
通过 `openOfficial` / `loadOfficialProject` 加载手写工作区，再点击 `#btn_trigger`。
工具检查官方 Blockly 反序列化后的类型、字段、连接，读取实际运行时变量；
不是执行自行仿写的 JavaScript 来代替官方积木。八个作品都通过工作区检查，无运行时错误。
原始观测记录在 `tests/fixtures/kitten4/semantics-official.json`，包含时间、浏览器版本、
官方构建 URL、作品 SHA-256、各检查点变量与角色状态；离线测试核对这些哈希。

复现：

```powershell
node tools/semantics-kitten4.mjs --generate
node tools/semantics-kitten4.mjs --out dist/semantics/official.json
cargo test --test kitten4_semantics -- --nocapture
```

作品位于 `tests/fixtures/kitten4/semantics-*.bcm`，所有积木、SVG 资产都是本任务自写。
`--generate` 只生成这些指定文件；离线 JS 测试验证生成结果与提交的作品完全相同。

## 官方结果与 VM 对比

以下计数是本次观测值，不是固定帧率承诺。NekoC 测试用 60 Hz，官方后台调度更快；
对重复触发只比较单次在途、持续重复、停止等性质，不要求墙钟计数相等。

| 作品后缀 | 官方观测 | 修复前 NekoC | 修复后 NekoC |
| --- | --- | --- | --- |
| `when` | 条件两段为真各 0.7 秒、body 等待 0.15 秒。原角色进入/退出最终 `10/10`；首次采样 `3/2`。常真帽子持续增长（最终 `509`）。mirror 克隆体进入/退出 `0/0` | 只进入/退出 `2/2`，常真只运行一次 | 电平重复、body 单次在途，最终 `9/9`；常真 `150`；mirror `0/0` |
| `screen` | 当前 A：stay A=true、leave A=false；B 则反之。等待后不变。屏幕名 Scene A、编号 1 都匹配 A；编号 2 不匹配；不存在的屏幕 stay=false、leave=true | 只按 ID 比较，不识别名称、编号 | 与这些官方结果一致 |
| `dispose` | 原角色、mirror 克隆体删除前计数均为 1，删除后计数均为 0。原角色在舞台上已不存在，随后按键计数仍为 0 | 原角色不删，删除后计数为 1，仍响应按键 | 原角色与克隆体均删除、脚本停止，按键不再响应 |
| `costume` | attribute 4 返回“蓝色方块”/“第二个造型”；attribute 2 返回 1/2。`get_current_costume` 返回 `{style_id:"costume-a"}` / `{style_id:"costume-b"}`，不是编号，也不是裸字符串。对象可用于切换造型；文本拼接结果为 `[object Object]` | 名称错误地返回 1/2；dropdown 返回裸 ID | 返回名称、编号与专用造型对象，切换及文本结果一致 |
| `keys` | 已创建一个 mirror（cloneStarted=1）。按住 A：原角色进入/退出在 700ms 为 `5/4`、1200ms 为 `8/7`；释放后 `8/8`。mirror 一直 `0/0` | 原角色重复，mirror 错误触发一次 `1/1` | 原角色单次在途地重复，mirror `0/0`；60Hz 最终 `7/7` |
| `text` | `abcd` 单下标 -1/0/1/2/4/5 分别为 `""/""/"a"/"b"/"d"/""`。`A猫BC` 下标 2 为“猫”，空串下标 1 为空串 | 一致 | 未改动此积木实现，加入回归 |
| `when-split` | 用 clone 分裂且禁止递归分裂：原角色和分裂体都电平重复，各自最终 `10/10` | 编译失败 `unsupported fast-VM block kitten4::clone` | 仍不支持，明确保留兼容缺口 |
| `keys-split` | clone 分裂体不触发 mirror-start（cloneStarted=0），但按键与原角色同样重复：两者均为 `5/4` → `8/7` → 释放后 `8/8` | 编译失败 `unsupported fast-VM block kitten4::clone` | 仍不支持，明确保留兼容缺口 |

关键区别：`mirror` 是空代码克隆，执行专用克隆启动体；`clone` 是分裂角色，
复制普通事件代码。本次没有为原本不支持的 `clone` 新增整套生命周期实现，
不能把 mirror 的结果推广为所有复制体的结果。

## 官方源码定位（补充实测，不以第三方实现代替证据）

本次官方加载的构建：

- `https://creation.codemao.cn/kitten/build/kitten.99f88a64d495cf0e79d0.js`
- `https://creation.codemao.cn/kitten/build/vendors.5035cd22e77914a9f363.js`
- 运行时 webpack 模块 `Tn6a`：搜索 `check_screen:function`，按 `is_stay`、当前场景、UUID/屏幕名/1-based 编号判断；`get_current_costume:function` 直接返回 `{style_id:e.style_id}`；`dispose:function` 调用 `runtime_manager.destruct_entity`；`dispose_clone:function` 另外检查 clone ID。
- `Tn6a` 的 `mirror:function` 调用 `clone_entity(a,!0)`；与普通分裂不是同一种代码复制策略。
- 模块 `oiyH` 的 `when:function(e){return e.condition}`，配合 `iNFq` 的 dynamic/state responder 和 interpreter 在途检查实现重复、非重入触发。
- 可用 `node tools/semantics-kitten4.mjs --case screen --inspect --out dist/semantics/source-probe.json` 将匹配模块只读提取到 `dist/semantics/vendor-modules.json`。不替换任何官方模块。

## 尚未验证或未完成

- `clone` 分裂在官方已验证，但 NekoC 尚不支持；回归测试显式检查它仍报告编译缺口，而不是静默当作 mirror。
- 未验证：任意键帽子、按键释放帽子、其他事件的 mirror 行为、场景切换过程中的条件帽子生命周期。
- 未验证：单字符选择对非 BMP 字符的孤立 UTF-16 代理项、小数下标等边界。
- 未验证：dispose 删除原角色时，仍存活的其他克隆体是否联动删除；本作品先删除克隆体再删除原角色。
- 未验证：造型对象在所有比较、深复制、列表运算中的身份细节。实现只引入专用造型对象值，不扩展为通用 JS 对象系统。
- 不使用、不移植 HateNeko 逻辑。本次无 HateNeko 引用清单。
