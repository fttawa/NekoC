# K4 第三轮：入口清零与语义边界

## 证据

只读核对固定离线 `player_v2.2d180c468559fbd29528.js.orig`，SHA-256 为
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
下文均为 webpack factory 开头起算的 **0-based UTF-16 offset**。没有复制官方实现或第三方作品。
这些是源码推导回归，不是本轮官方浏览器逐帧实测，不保证线上版本行为。

媒体设备 24 项和物理 7 项逐项证据及测试分别见
[媒体](kitten4-third-media.md)、[物理](kitten4-third-physics.md)。

## 本模块 16 个原缺失入口

| type | 官方定位 | 行为与回归 |
|---|---|---|
| get_choice | Tn6a@33908 | 调用 get_choice_or_index 但没有 return；命令正常，表达式报 undefined |
| get_choice_index | Tn6a@33969 | 强制 select_index 后调用，但同样没有 return；命令正常，表达式报 undefined |
| get_cur_frames | oiyH@3936；iNFq@18518 | 返回已完成 update 数，首帧 0；启动重置 |
| reset_timer | oiyH@5191；iNFq@18580 | 重置独立运行计时，不改舞台计时器控件；本地 VM 时钟仍不同于官方墙钟 |
| destruct | oiyH@5254；iNFq/destruct_entity | 销毁当前实体、停止其线程 |
| incompatible_block | Tn6a@2245 | 明确抛错，不是 noop |
| incompatible_output_block | Tn6a@2290 | 明确抛错，支持表达式错误传播 |
| block_on_break | Qeyy@676 | 枚举有名，但固定包没有 domain 注册；执行时 missing handler 错误 |
| mouse_on_emit | Qeyy@639 | 同上，不凭名称伪装鼠标监听 |
| player_position_on_change | Qeyy@578 | 同上，不凭名称伪装位置监听 |
| controls_if_dropdown | Qeyy@405；DmFr@2910；inF4@8973 | 字段字符串指定 domain，不能按非空字符串取真；发布 AST 的 if_dropdown_conditions 保留 |
| procedures_defnoreturn | Qeyy@784；DmFr@4835 | 旧定义 mutation 的 name 列表作为参数键 |
| procedures_callnoreturn | Qeyy@839；DmFr@5886（委派 return 版本） | 旧 ARGn 按 mutation 名称重排；语句调用 |
| procedures_callreturn | Qeyy@896；DmFr@5521 | 同协议，返回值调用 |
| procedures_return_value | Qeyy@949；inF4@13765 | 使用 VALUE 返回 |
| procedures_parameter | Qeyy@1006；inF4@13011 | 使用 param_name 读取当前调用参数 |

前三个旧事件的官方无 handler 证据：catalog 完整注册并集无其 domain/responder；
inF4 的 eval_event 调用 eval_domain，后者在 domain_functions 缺键时抛 missing_domain_function。
本地错误文案不等于官方完整异常对象；它们虽有执行映射，**不代表可用的新事件功能**。

回归集中在 `tests/kitten4_catalog.rs` 的 `third_round_*`，覆盖 workspace/published、
解释器/默认 JIT、原样往返及错误后不执行 next。旧过程两种调用形式均回归。
未更改作品的原样导出直接返回保留的 source，仍拒绝不能导出的已编辑发布作品。
旧定义编辑后导出目前仍拒绝，不能据此声称完整编辑器支持。

## 高频 partial

- get_3 在语料 2049 次。Tn6a@38280、@86537 的属性分派与 get/get_2 委派一起核对：
  get_2 不再仅支持坐标/角度；新增完整委派及未知属性 NaN，补 ASCII 属性 14 的默认 0 查询。
  ASCII scope=7 设置与渲染仍不支持，不能将默认查询视为 ASCII 效果已实现。
  属性 6(volume)、15(speed) 并不在该 handler 的有效分支，不能误返回 0。
  位置、造型、方向、大小、效果与实体变量沿用已有路径。场景滤镜、悬空对象及非有限状态仍未逐项实测，继续 partial。
- text_indexOf 的非字符串 VALUE 原先错误地强制转文本；按 oiyH@2414 的直接方法调用改为类型错误。
  保留 UTF-16 FIRST/LAST、空 needle 与数值 FIND 的 JS 文本转换回归。
- 物理质量/惯量重算、非法 speed/gravity 的 body 分配及 strength adapter 见物理专题。

## 未验证与限制

- controls_if_dropdown 只支持可被现有 lowering 明确识别的 domain；自定义注入 domain 不支持。
- 与官方队列、Promise、场景退场、销毁阶段的逐帧错误时序仍未验证。
- 媒体 API 需要宿主接入，不会凭空提供识别、扫码、录音或 MIDI 声音；未接入时阻塞请求不会自行成功。
- 软体粒子与形变未实现；flexibility 不再纯 stub，但只实现官方硬体 adapter 边界，必须保留 partial。
- 覆盖表清零表示固定清单均有显式处理，不表示全部 377 种完整语义等价。
