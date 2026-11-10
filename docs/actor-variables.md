# 角色私有变量：Kitten 4 / Kitten N

## 证据与复现

本次依据官方源码和官方在线编辑器实测，没有参考或移植 HateNeko。以下偏移均为解码后的 **JavaScript 字符串字符偏移（从 0 开始）**，不是 UTF-8 字节偏移。官方 bundle 只保存于被忽略的 `dist/actorvars/`，未复制进跟踪路径。

| 来源 | SHA-256 |
| --- | --- |
| [K4 kitten.99f88a64d495cf0e79d0.js](https://creation.codemao.cn/kitten/build/kitten.99f88a64d495cf0e79d0.js)（4.11.20） | `1ffbfced591fd00d2ad604a00211cfcbd1a35e6ad3fcbe6ff7107a3ba76daaa2` |
| 本地只读 K4 播放器 `E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig` | `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160` |
| [KN main.8ccf2442.js](https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js)（编辑器 0.27.4） | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| [KN crc_libs.8196dbd1.js](https://creation.bcmcdn.com/neko/web/release/static/js/crc_libs.8196dbd1.js) | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` |
| [KN main-vendors.07f7dd7e.js](https://creation.bcmcdn.com/neko/web/release/static/js/main-vendors.07f7dd7e.js) | `38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68` |

本地播放器目录另有修改后的 `.js`、`.bak` 等文件，因此存储规则采用 `.orig` 核对，不把本地修改当作官方行为依据。

### K4 官方实现

- `kitten.*.js` 的 `O8fc` 模块，约 2149k–2152k：`UserVariableImpl.set_variable_specs` 将全局变量放入 `variables[id]`，`scope === VariableScope.entity` 则放入 `entity_variables[entity_id][id]`。变量规格和是否私有另有索引。
- `get_var_or_list`（约 2150k）、`set_variable`（2151060）：私有变量必须带目标实体 ID；不属于该实体或已经销毁的单元抛出 `entity_variable_operation_out_of_scope`，不能回落全局或自动新建。
- `clone_entity_variables`（约 2152k）：深复制 **源实体的当前变量表**，不从作品初始值重新初始化。列表及嵌套列表也独立；赋值时的引用语义不因此改变。`entity_disposed` 删除该实体的表。
- `RuntimeManager.clone_entity`（3661263）：以克隆请求的源实体 ID 调用上述复制，再添加克隆。因此“克隆一个克隆”复制的是该克隆当前值。
- 通用 `variables_get` / `variables_set` 将执行实体 ID 传到运行库；`change_variable` 同样先读后写。没有独立的“直接写任意克隆变量”积木；`tell` / 同步 tell 切换执行实体后，自身读写自然操作目标实体。
- `get_3`（2534808）：`__self` 解析为当前执行实体；UUID 属性用 `get_variable(uuid, undefined, entity_id)`。指定别的角色时读取那个原角色，指定自己时包括当前克隆。
- `get_clone_index_property`（2528395）：先找原型角色，再按编号选实体；0 是原角色；UUID 属性读所选实体的私有变量。不存在编号调用 `throw_clone_not_found_error`，不是读已经释放的表。
- 本地播放器 `.orig` 的 `get_var_or_list`（497245）、`clone_entity_variables`（498967）、`clone_entity` 内复制调用（1179285）、通用 `variables_get/set`（1647201）与上述存储/复制规则一致。

### KN 官方实现

- `main.*.js`（1855653 附近）将 `variablesDict` 中 `isGlobal` 真值项作为 global；否则用 `currentEntityId` 构造 `scope: entity, entity_id: ...`。这里的角色变量不同于持久化“本地变量”（`LocalVariable` 类型）及脚本局部变量。
- `crc_libs.*.js` 的 `UserVariableImpl`（1024017 附近）：与 K4 一样分离全局/实体表；`get_var_or_list`（1025407）、`set_variable`、`clone_entity_variables`（1027202）、`entity_disposed` 管理生命周期。
- 深复制函数来自模块 58121；`main-vendors.*.js`（1563416）将 `baseClone` 的 DEEP 和 SYMBOL 标志组合后导出，不是浅复制。
- `crc_libs.*.js`（995241）在克隆时复制实时表；通用变量读写（823524）带执行实体 ID。
- 实际编辑器覆盖的 `main.*.js` 变量函数（1647399–1651000）仍以当前实体调用运行库；克隆属性函数（1560300–1561900）对 UUID 调 `get_variable`。0 号同样是原角色。**当前 KN 找不到编号时添加控制台提示并返回 NaN，不抛出 K4 式停止异常。**
- 读另一角色私有变量可通过克隆属性积木的 0 号；写另一角色用 tell 上下文中的变量积木；写某克隆需在该克隆执行上下文中进行，而不是把原角色 UUID 当全局变量。

## 官方编辑器实测记录

完整观测、时间、浏览器版本、夹具 SHA-256、运行库值和 KN 编辑器兼容检查保存在 [`actor-variables-official.json`](actor-variables-official.json)。时间字段为机器报告的 UTC；本轮记录为 2026-11-09，主机本地日期为 2026-11-10。

自写夹具：

- `tests/fixtures/kitten4/actor-variables{,-deleted}.bcm`
- `tests/fixtures/actor-variables{,-deleted}.bcmkn`

它们没有第三方作品内容。脚本将私有初始值 5 改成 41 后克隆；克隆先报告继承值，再将自己改为 99；原角色读取自己、1 号克隆、另一角色的文本私有变量。

| 观测 | K4 | KN |
| --- | --- | --- |
| 克隆继承当前值，而非初始值 | 41 | 41 |
| 克隆修改后自身读取 | 99 | 99 |
| 原角色仍读自身当前值 | 41 | 41 |
| 原角色读取 1 号克隆私有变量 | 99 | 99 |
| 读取另一角色私有文本变量 | `other-value` | `other-value` |
| 删除克隆后读取 1 号 | “该编号的克隆体不存在”，停止 | “没有这个编号”提示，返回 NaN，继续 |

**观测陷阱：** KN 舞台监视器仅按变量 UUID 记录最后一次更新，因此监视器显示 99 不能说明原角色变量变为 99。本记录同时读取运行库中的原角色单元（41）和脚本报告值（41）。K4 错误停止后会清空运行库，再次读取全局变量会懒初始化为 0；记录中的 `beforeDelete` 是发生错误前的检查点，不将停止后全 0 误认为克隆未运行。

复现（需 Playwright + Edge；不提交/发布线上作品）：

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/probe-actor-variables.mjs generate
node tools/probe-actor-variables.mjs k4 tests/fixtures/kitten4/actor-variables.bcm
node tools/probe-actor-variables.mjs k4 tests/fixtures/kitten4/actor-variables-deleted.bcm
node tools/probe-actor-variables.mjs kn tests/fixtures/actor-variables.bcmkn
node tools/probe-actor-variables.mjs kn tests/fixtures/actor-variables-deleted.bcmkn
node tools/editor-compat.mjs tests/fixtures/actor-variables.bcmkn tests/fixtures/actor-variables-deleted.bcmkn --channel msedge --out dist/actorvars/editor-compat.json
node tools/probe-actor-variables.mjs archive
```

## NekoC 实现与边界

- VM 编译时将私有 UUID 映射为独立索引，不占用全局数值槽；实体拥有自己的 `BTreeMap<索引, Cell>`。自身赋值、增减、读取及指定克隆/角色读取接入解释器。
- mirror 和 K4 分裂统一走 `copy_actor_variables(source)` 接口深复制当前表；删除释放表；可复用的精灵槽位不保留旧表；重启从作品初值深复制。分裂事件、外观和 mirror 代码策略继续遵循 [kitten4-clone.md](kitten4-clone.md)。旧的 K4 全局槽覆盖表已移除，不存在两套 VM 私有变量存储。
- 私有列表使用表达式引用复用现有列表指令，不假装是全局列表；数值、布尔、文本、Null、列表的单元类型保持不变。列表深复制与重启隔离有回归测试，但嵌套列表的浏览器实测**未验证**，依据官方源码。
- JIT 现已允许含私有变量的程序：私有数值读写和比较通过当前执行实体索引访问实时单元，不缓存单元地址；非数值比较、指定克隆编号读取和复杂列表保留通用 evaluator。列表表达式递归检查 reporter 过程，可能挂起、切换实体或分配克隆的指令仍退出 native region。详细统计口径和验证边界见 [jit-coverage.md](jit-coverage.md)。
- K4 仅在 VM lowering 中改写 `get_3` 的 UUID 属性，保留原生积木和元数据；导出层不改，K4 自写夹具往返相等。KN 直接使用原有 `isGlobal/currentEntityId` 数据，不改持久化 schema。
- CLI 的旧参考解释器也分离私有标量/列表、复制和释放，支持私有克隆属性读取与 KN 克隆启动 hat；它不因此升级为 K4 官方运行库的完整替代品。
- 旧参考解释器原有的 tell 只作为控制结构执行，未实现 VM 的实体切换；因此本轮跨实体 tell 写入保证限定于 VM 解释器，旧参考解释器的 tell 私有变量写入仍有差异。
- 旧参考解释器读取无所属私有单元时仍可能返回 Null，克隆属性编号转换沿用旧实现，且 `start()` 不是重置接口；严格的作用域读取错误、删除后读取平台差异及重启恢复初值保证限定于 VM，不能据旧解释器的部分支持推断其与官方完整等价。
- VM 的 KN 删除后读取返回 NaN，但目前没有对应的官方样式控制台提示；K4 返回明确运行错误，但不模仿官方 UI 的错误后清空所有变量。
- 私有监视器读声明角色的当前值；**没有复刻 KN“最后更新者覆盖监视器”行为**。监视器 UI 差异不影响实际实体单元。
- 跨实体通过 tell 写入已由回归测试验证；官方浏览器端 tell 写入、原角色销毁后的私有读取、跨屏幕私有读写及高频克隆/删除编号顺序的完整行为**未验证**。不扩展物理、非有限数值体系或其他缺失积木。

## 语料与性能回归

### 53 份只读 K4 语料

基线为 `887f439`，对 `E:/nekoc/dist/kitten4-corpus/` 中全部 53 份 `.bcm` 使用 release CLI 的 `coverage --frames 1`；未将第三方作品复制进跟踪路径。原始结果位于本地忽略目录 `dist/actorvars/coverage-{before,after}.json`，可用以下命令复现（需保留对应前后版本的二进制）：

```powershell
node tools/probe-actor-variables.mjs coverage dist/actorvars/baseline-nekoc.exe E:/nekoc/dist/kitten4-corpus dist/actorvars/coverage-before.json
node tools/probe-actor-variables.mjs coverage target/release/nekoc.exe E:/nekoc/dist/kitten4-corpus dist/actorvars/coverage-after.json
```

| 阶段 | 修改前 | 修改后 |
| --- | ---: | ---: |
| `ran` | 38 | 38 |
| `compile` 失败 | 10 | 10 |
| `run` 失败 | 5 | 5 |

只有两份报告的首个阻塞点变化，其他 51 份报告不变：

- `303779283.bcm`：由 `unsupported clone attribute 1d352fd5-1312-4ce3-b828-32e1e94ad515`（块 `TKbu0sLZZJk4X4tW4oxl`），推进到角色“枪”的 `kitten4::self_flip`（块 `vG6maWAmdARTEKWTBTT4`）。私有 UUID 阻塞已解除，但作品仍不能完整编译，**不宣称已经可运行**。
- `326380741.bcm`：由 `kitten4::get_3`（块 `adsLU3nhr25CF62p6EPf`），推进到角色“侦察者”的 `kitten4::clone`（块 `Zr0cwtAIis9dyIT3xfqV`，分裂）；本轮不补分裂。

`ran` 仅代表原有 coverage 流程完成一帧，不代表全部脚本或画面与官方一致，也不消除报告中的既有物理 stub。

### 纯全局数值槽微基准

同一 Windows x86_64 主机，前后版本均以 release 构建，使用 `bench-engine --iterations 1000000 --rounds 9`；每次先预热一轮，取九轮 compiled 执行时间的中位数。交替运行前后版本各五组，避免将并发构建期间的早期噪声当成退化。各组中位数（毫秒）：

| 版本 | 1 | 2 | 3 | 4 | 5 | 五组中位数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 修改前 `887f439` | 3.0616 | 2.9131 | 3.1354 | 3.1212 | 2.9641 | 3.0616 |
| 修改后 | 3.2329 | 3.1333 | 2.9028 | 3.0317 | 2.9241 | 3.0317 |

变化为 **-0.98%**，在当次测量噪声范围内未观察到纯全局数值循环退化；不是显著提速结论。原始汇总为 `dist/actorvars/bench-paired.json`。这是启用私有变量 JIT **之前**的历史基准，只覆盖纯全局槽/JIT 热循环，不测 HTTP、GPU、完整作品或私有变量密集脚本，不能用该结果保证现有私有作品性能。
