# K4 第七轮：文本搜索与MIDI纯数据/等待

## 主路径证据

`tools/compat/k4-partial-data-7-fixtures.mjs` 新增9份原创作品；其中6份成功主路径
各24帧，共144个官方update；另3份抖动负例72帧，**不混入一致数量**。
证据 `kitten4-partial-data-7-evidence.json` 绑定fixture SHA-256、资源SHA-256和完整逐帧变量。
官方 errors/pageErrors=[]，外网放行0。无 MIDI 发声、账户或硬件请求。

指定官方只读包与前轮相同：`player_v2.2d180c468559fbd29528.js.orig`，SHA-256
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`；
Clock原点固定1024ms，60Hz/seed1，不替换任何积木或task实现。
不移植官方或 HateNeko 源码。

| 类型 | 新增逐帧主路径 | 仍未验证 |
| --- | --- | --- |
| `text_indexOf` | FIRST/LAST跨帧切换；emoji UTF-16位置、空needle、数组严格number搜索；结合第二轮26字符串/10数组及6错误用例 | 孤立surrogate、无效END、nullish参数、对象副作用 |
| `midi_get` | 0/39/60/87四个下拉值的id对象、赋值保存、跨帧重复取值的K4内容比较、字符串转换；没有异步翻译混在同一脚本 | 宿主对象属性/identity、畸形参数，不含MIDI发声 |
| `midi_wait` | .04与.08拍串联、零/负数/文本beats；每帧阻塞和后续phase逐一比较 | 精确截止浮点相位、非60Hz、非有限数/长时等待及暂停重启 |

`midi_wait(.04)` phase前9帧 `1,1,1,2,2,2,2,2,3`。
零/负数/文本第一段也阻塞到第3帧，不伪装成同步noop。
`tests/kitten4_partial_data_7.rs` 用默认/禁用JIT比较6件全144帧typed变量。
这与第二轮媒体组合“只比最终值”不同，新的纯MIDI夹具没有翻译async干扰。
原先错误赋值无副作用与数组严格搜索回归不作放宽。

官方定位沿用第二轮整包UTF-16 offset：1645599 `oiyH/text_indexOf`、
1772479 `xQfl/midi_get`；等待通过真实播放器采样，不以实现映射代替时序证据。

## 明确保留的抖动负例

`self_shake` 三件 .14/.23/.4秒：官方task在帧尾更新，结束后下一update续接。
本地 AnimStep 在脚本阶段更新并在完成帧立刻续接。例如 .14秒官方第10帧归位但
phase仍1，第11帧才2；本地第10帧已2。第4帧首次5px移动也存在浮点阈值差异。
已单独归档所有位置，不将最终归位相同当作一致；维持partial。
Rust负例明确钉住完成续接差异，不隐藏失败帧，也不声称本轮消除此类差异。

```powershell
node tools/compat/k4-partial-data-7-fixtures.mjs --record
cargo test --test kitten4_partial_data_7 --test kitten4_partial_text_2
node --test tests/k4-partial-data-7.test.mjs
```
