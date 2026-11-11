# 其他硬件断连与 41 个非面板注册类型取证

官方 KN **0.27.4**；详见 [`kn-other-hardware-evidence.json`](kn-other-hardware-evidence.json)。本次只新增独立 JS 探针、证据、测试和说明，不实现或修改 Rust、不修改覆盖表。

## 可交给实现方的结论

- 22 个其他硬件类型中，**7 个是真正同步 reporter，12 个是 Promise command，3 个是事件帽**。没有异步 reporter，也没有同步 command。
- 同步 reporter 的断连候选：两个 Boolean 返回 `false`，五个 Number 返回 **数值 NaN**，不是字符串、零或 undefined。
- 12 个 command 即使断连也返回 **Promise，履行值 undefined**；不能因为最终“什么都没做”就当同步 no-op。未建立原生调度证据，均应继续保留缺失。
- 3 个事件规格的 `async:false` 描述响应器，不意味着它们是同步命令。没有真实事件派发/原生调度证据，不能据此补事件执行。
- `registered-not-in-audited-panels` 的 **41 项均已在当前 `src/engine.rs` 找到显式路径**，不是 41 个新缺失项。官方代码视图转换器无错误产生其中 36 项，证明“未列入常规面板”不等于不可达。其余 5 项本次未由作者代码成功产生，不推断不可达或废弃。

## 22 项逐项边界

下表“参数序”是官方 `args0` 中有名字段和输入的顺序；`[方括号]` 是需要求值的 value socket。它不是独立证明的原生子表达式求值序。

| 精确类型 | 参数序 | 调用种类 / 断连结果 |
|---|---|---|
| `catbit_button_is_pressed` | key | 同步 Boolean false |
| `catbit_button_when` | type, key | dynamic 事件帽，async:false |
| `catbit_usb_button_when` | type, key | dynamic 事件帽，async:false |
| `wand_coordinate` | key | 同步 Number NaN |
| `wand_rotation` | key | 同步 Number NaN |
| `wand_button_is_pressed` | key | 同步 Boolean false |
| `wand_reset_position` | 无 | Promise → undefined；保留缺失 |
| `wand_direction_when` | key | action 事件帽，async:false |
| `set_robot_master_light_color` | light, color | Promise → undefined；保留缺失 |
| `set_robot_master_light_color_duration` | light, color, [times] | Promise → undefined；保留缺失 |
| `stop_robot_master_light` | light | Promise → undefined；保留缺失 |
| `set_robot_master_motor_power_rotation` | motor, [power], direction | Promise → undefined；保留缺失 |
| `set_robot_master_motor_power_rotation_duration` | motor, [power], direction, [times] | Promise → undefined；保留缺失 |
| `change_robot_master_motor_power` | motor, method, [n] | Promise → undefined；保留缺失 |
| `stop_robot_master_motor` | motor | Promise → undefined；保留缺失 |
| `get_robot_master_motor_power` | motor | 同步 Number NaN |
| `get_robot_master_infrared_sensor_distance` | num | 同步 Number NaN |
| `set_robot2_master_motor_power_rotation` | [power], direction | Promise → undefined；保留缺失 |
| `set_robot2_master_motor_power_rotation_duration` | [power], direction, [times] | Promise → undefined；保留缺失 |
| `change_robot2_master_motor_power` | method, [n] | Promise → undefined；保留缺失 |
| `stop_robot2_master_motor` | 无 | Promise → undefined；保留缺失 |
| `get_robot2_master_motor_power` | 无 | 同步 Number NaN |

`robot_master` 对应官方扩展 ID **tudao**，`robot2_master` 对应 **tudao2**，不能从类型前缀猜硬件 ID。字段选项、默认样本和全部 167 次调用保存在 JSON 中。

### 参数、Promise 和异常边界

`catbit_button_is_pressed` 与三个 wand reporter **先读 `key`，后检查连接**。Proxy 实测读序为 `["key"]`；抛错 getter 和 null 参数对象均同步抛错，即使没有设备也如此。无效/空字符串或各菜单值本身不抛错，正常返回断连值。

robot 两代所有域函数先检查连接，断连不读取参数属性；Proxy 读序为 `[]`。包括抛错 getter 和 null 参数对象：读值函数仍同步返回 NaN，命令仍返回履行 undefined 的 Promise。wand reset 同样不读参数，返回 Promise。

上述“参数属性未读”只描述直接域函数。作品执行前若输入表达式有副作用/异常，不能被编译器省略。也未通过伪造硬件或更换连接 guard 测试连接分支异常；不对其同步抛出/Promise 拒绝方式作延伸保证。

### 事件不是返回 false 的命令

catbit 蓝牙与 USB 的官方 dynamic trigger 读取当前 action 数据数组，按事件 ID、`sub_type`（key）、`value`（type）匹配。实测 undefined、空数组、不匹配数据均 false；作者构造的精确匹配数据为 true。后者只是隔离谓词测试，没有向运行中的工程注入事件，也不是断连设备能够触发的证据。statefulness 为默认空串、`one_frame`、`use_sub_type:true`。

wand direction 是 action responder，filter 为 `value:key`、`sub_type:none`，无自定义 trigger。只能证明规格存在，不能声称已经测得断连触发频率或真实派发语义。

## 41 项的可达性及现有 VM 路径

每项 JSON 行保留：官方积木 definition 是否注册、实际构造结果、域索引、代码声明、输入/字段、成功或失败的转换样本，以及官方源码引用模块锚点。另有本地 `src/engine.rs` SHA-256 与每项精确名字所在行。**这里只证明分支存在，不把名字命中当完整语义认证，也不要求本地文件未来保持原哈希。**

无错误转换得到的 36 项包括：

- 数组/对象和脚本局部值：`_array_literal`、`_object_literal`、`_object_get`、`_object_set`、`_variable_get`、`_variable_set`、`_execute`。
- 控制/逻辑/过程：`_break_statement`、`_continue_statement`、`controls_while`、`logic_ternary`、`logic_to_boolean`、`procedures_2_defnoreturn`。
- 所有 7 种 `math_*` 自增/自减/复合赋值，以及 `math_trig_rad`。
- `atob`、`btoa`、`parseFloat`、`parseInt`、`isFinite`、`isNaN`、`setTimeout`、`clearTimeout`、`setInterval`、`clearInterval`。
- 回调/动态上下文：`on_bump_actor_value`、`script_variables_value`、`self_listen_value`、`traverse_number_param`、`traverse_number_value`。

本次未由代码样本成功产生的 5 项：`_return_statement`、`calculate`、`get_timer`、`reset_timer`、`start_on_click`。它们仍全部注册且可构造；后四项有真实域索引，`_return_statement` 无域索引但已有本地控制流程分支。官方 `function audit() { return 4; }` 产生的是 `procedures_2_return_value`，不能假称产生了 `_return_statement`。把 `calculate(1)` 等当未知函数转换，得到 generic call，不是同名类型可达性的证据。

另观察到 `console_log(!!1)` 触发官方转换器异常；如实保留，不据此判定 Boolean/negate 本身不可达。对三元表达式单独取样可以正常产生 `logic_ternary`。

### `get_sprite_property` 的特殊地位

它有官方代码 API 声明，但 **definition=false、构造失败、domainIndex=null**：不是待实现的同名 VM 积木。

- `get_sprite_property('--self', 'x')` 无错误转换为 `coordinate_of_sprite`。
- 属性 `color` 无错误转换为 `effect_of_sprite`。
- 属性 `size` 报不支持属性错误，虽然错误转换结果带 `get_sprite_property` XML，也不能当注册/可运行证据。

## 复现与证据卫生

```powershell
npm install --prefix dist/kn-other-hardware/deps --no-audit --no-fund playwright
node tools/compat/kn-other-hardware-probe.mjs --record
node --test tests/kn-other-hardware.test.mjs
```

可用 `NEKOC_NODE_MODULES` 指定已有依赖目录。探针使用系统 Edge、全新匿名官方页面；只暴露 webpack loader，不修改实际官方域函数、硬件 map、连接 guard、事件规格或转换器。加载模块不等于安装扩展，没有尝试连接设备。

下载的官方 bundle、函数体和原始报告仅在 git 忽略的 `dist/kn-other-hardware/`；跟踪文件只保存作者代码、观察、名字、输入元数据、哈希/偏移。76 个官方源码锚点可由可选本地原字节测试复核。未使用 HateNeko、未复制官方内核或语料进源码。
