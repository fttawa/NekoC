# Kitten 4 离线硬件积木边界

## 实现与接入

- `src/kitten4/devices.rs` 精确列举官方 `ls7Z` 模块的 **74** 个积木，不使用 `microbit_` 等前缀通配，未知硬件名仍拒绝编译。
- 接入方在 `src/kitten4.rs` 声明 `mod devices;`，并在 `lower_block` 的现有分支之前调用 `if devices::lower_devices(block) { return; }`。只在 opaque VM lowering 路径调用，不要在可编辑 AST 的 `translate` 中调用。
- 41 项 reporter 降为数值 `NaN`（包括名称以 `is_` 开头的项，不是 `false` / `0` / 文本）；30 项提示命令无设备效果并继续执行；3 项事件帽不注册、不执行 body。
- 源积木在导入后仍是 `kitten4::<原名>`；VM lowering 不修改源 AST 或原生快照，workspace 与 published 可原样 roundtrip。
- 官方 `inF4` 执行器在 domain 调用前计算参数。这里用 `temporary_list` 顺序求值所有动态输入，再返回 `NaN` 或继续执行。松散命令根保持休眠；事件帽连动态参数也不执行。

## 不应声称实现的部分

本实现是固定官方离线包的**无设备降级**，不是 Arduino、WeeeMake 或 micro:bit 模拟器，也不提供串口、蓝牙、联网或实际传感器数据。

30 项官方命令会请求 `hardware/blocks_running_notice` 提示；NekoC 当前仅保留无硬件效果和继续执行，不展示这个 toast，也没有复刻提示的多语言、去重或关闭时序。不得把这些命令标为完整硬件支持或完全语义一致。

`is_digital_port_status` 和 `get_analog_port_value` 虽像 reporter，官方函数实际只提示并返回 `undefined`。本次将其作为无结果命令降级；如果作为值插入表达式，编译仍明确失败，不会编造 `NaN` / `0` / 空串。官方执行器对无返回值表达式有错误路径；这里不承诺相同错误类别、提示或发生时刻。

3 个 `microbit_when_*` 在 `ls7Z` 中为空 handler，`VlbI/d` 还会在运行前删除对应 published 根。本次 lowering 丢弃这些 VM 根的 `next` / `statements`，不把它们变成启动事件。原始 AST 与导出仍保留其所有 body、字段与扩展元数据。

未验证：真实硬件、浏览器实跑、完整错误与禁用参数路径、官方线程让出频率、参数求值与官方随机流的跨运行时相同结果、非标准 event 嵌套/多 body 的编辑器可达性。参数随机测试只证明 NekoC 内部没有跳过或重复求值，不是官方随机算法差分。

## 验证

独立回归：`tests/kitten4_devices.rs`，全部合成项目，不读取/复制官方作品。

- 74 类型分类数与不重叠检查。
- 每个 `NaN` 项数值/真假性检查，每个提示命令 continuation 检查。
- 每个硬件事件根挂未知参数、未知 next/body，确认不可达子树不编译、不执行。
- 每个普通硬件项动态参数求值一次、松散根休眠检查。
- 两个提示型 sensor 的表达式拒绝；未知硬件名保持 unsupported。
- 每个场景都覆盖 workspace / published、原样 roundtrip、解释器 / 默认 JIT 路径，并检查运行不修改 AST。

接入后运行并通过：

```powershell
cargo test --test kitten4_devices
cargo test --test kitten4_catalog
```

`kitten4_devices`：`8 passed; 0 failed`；`kitten4_catalog`：`23 passed; 0 failed`。另通过 `rustfmt --edition 2024 --check src/kitten4/devices.rs tests/kitten4_devices.rs`；只读 Node 校验将官方 factory 的 74 个属性、返回分类与本模块分派、测试类型数组、本文每条 offset 交叉比较，全部通过（41 / 30 / 3）。

## 只读官方证据

- 官方文件：`src/player/build/player_v2.2d180c468559fbd29528.js.orig`，播放器 app 目录为 `E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`。
- 文件 SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
- `ls7Z` factory 字符串 SHA-256：`b384094958f87737c8fe2c6b39edb58b7dbb62b967b4369605af26f48b71b0cd`。
- 位置统一为 `factory.toString()` 中从 `function` 开头计的 **0-based JavaScript UTF-16 offset**；不是整包偏移、Unicode code point 或文件字节。
- 官方表由 catalog 的 `webpackModules` 函数在单次 Node 进程内提取研究。未执行工厂/播放器入口，未写出官方代码，下面仅记录类型、分类和位置。
- 注册链：`VlbI@388` 的 `h` 遍历 `ls7Z.a` 注册 domain；`VlbI@319` 的 `l` 调用提示；`VlbI@518` 的 `d` 删除三类硬件事件根。
- 参数执行证据：`inF4@16337` 的 `eval_domain` 在调用 handler 前执行参数求值；无值结果的 `has_value` 为 false。该偏移仅是函数起点，不是每个内部调用位置。

| type | ls7Z offset | 官方离线分类 |
| --- | ---: | --- |
| `set_digital_port_status` | 133 | 提示/无结果 |
| `set_pwm_port_value` | 183 | 提示/无结果 |
| `is_digital_port_status` | 228 | 提示/无结果 |
| `get_analog_port_value` | 277 | 提示/无结果 |
| `servo_motor_angle` | 325 | 提示/无结果 |
| `led_light` | 369 | 提示/无结果 |
| `led_light_intensity` | 405 | 提示/无结果 |
| `dc_single_motor_turn` | 451 | 提示/无结果 |
| `dc_single_motor_speed` | 498 | 提示/无结果 |
| `dc_both_motor_turn` | 546 | 提示/无结果 |
| `dc_both_motor_speed` | 591 | 提示/无结果 |
| `buzzer_sound` | 637 | 提示/无结果 |
| `shake_sensor` | 676 | 提示/无结果 |
| `shake_sensor_intensity` | 715 | 提示/无结果 |
| `is_get_sound` | 764 | NaN |
| `get_sound_intensity` | 800 | NaN |
| `is_get_light` | 843 | NaN |
| `get_light_sensor_intensity` | 879 | NaN |
| `is_switch_on` | 929 | NaN |
| `is_button_pressed` | 965 | NaN |
| `infrared_sensor_switch` | 1006 | NaN |
| `is_sensor_get_line` | 1052 | NaN |
| `is_get_sport` | 1094 | NaN |
| `is_get_high_temp` | 1130 | NaN |
| `is_get_magnetic` | 1170 | NaN |
| `hcsr04_get_distance` | 1209 | NaN |
| `dht11_get_temp_humi` | 1252 | NaN |
| `get_press_intensity` | 1295 | NaN |
| `soil_sensor_get_humi` | 1338 | NaN |
| `grayscale_sensor_get` | 1382 | NaN |
| `get_potentiometer_turn_angle` | 1426 | NaN |
| `get_resistance_intensity` | 1478 | NaN |
| `joystick_get_x_value` | 1526 | NaN |
| `joystick_get_y_value` | 1570 | NaN |
| `is_joystick_pressed` | 1614 | NaN |
| `led_light_on` | 1661 | 提示/无结果 |
| `car_light_on` | 1700 | 提示/无结果 |
| `digital_show` | 1739 | 提示/无结果 |
| `buzzer_play_midi` | 1778 | 提示/无结果 |
| `fan_speed` | 1821 | 提示/无结果 |
| `steering_angle` | 1857 | 提示/无结果 |
| `rgb_light_color` | 1898 | 提示/无结果 |
| `rgb_light_color_digital` | 1940 | 提示/无结果 |
| `weeemake_motor_turn_speed` | 1990 | 提示/无结果 |
| `get_distance` | 2042 | NaN |
| `sensor_get_light_intensity` | 2078 | NaN |
| `sensor_get_sound_intensity` | 2128 | NaN |
| `get_temp_humi` | 2178 | NaN |
| `weeemake_get_potentiometer_angle` | 2215 | NaN |
| `weeemake_get_double_line` | 2271 | NaN |
| `weeemake_joystick_get_x_value` | 2319 | NaN |
| `weeemake_joystick_get_y_value` | 2372 | NaN |
| `is_touch_sensor_switch` | 2425 | NaN |
| `is_infrared_control` | 2471 | NaN |
| `weeemake_is_get_sport` | 2514 | NaN |
| `microbit_when_press_key` | 2563 | 空事件 |
| `microbit_when_incline` | 2600 | 空事件 |
| `microbit_when_be_operated` | 2635 | 空事件 |
| `microbit_display_lattice_image` | 2674 | 提示/无结果 |
| `microbit_display_custom_lattice_image` | 2731 | 提示/无结果 |
| `microbit_display_text` | 2795 | 提示/无结果 |
| `microbit_set_light_intensity` | 2843 | 提示/无结果 |
| `microbit_set_xy_light_intensity` | 2898 | 提示/无结果 |
| `microbit_turn_off_xy_light` | 2956 | 提示/无结果 |
| `microbit_clear_screen` | 3009 | 提示/无结果 |
| `microbit_is_press_key` | 3057 | NaN |
| `microbit_is_incline` | 3102 | NaN |
| `microbit_get_incline_angle` | 3145 | NaN |
| `microbit_get_acceleration` | 3195 | NaN |
| `microbit_get_light_intensity` | 3244 | NaN |
| `microbit_get_temperature` | 3296 | NaN |
| `microbit_get_compass_heading` | 3344 | NaN |
| `microbit_get_compass_field_strength` | 3396 | NaN |
| `microbit_is_pin_level` | 3455 | NaN |
