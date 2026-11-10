# K4 剩余列表运行错误

## 证据范围

只读检查离线播放器 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`；资源 SHA-256 和八个自制探针的文件 SHA-256、四帧变量及任务边界见 [kitten4-run-error-evidence.json](kitten4-run-error-evidence.json)。不携带内核源码或第三方作品。没有使用/移植 HateNeko。

官方位置（webpack 模块 / 函数）：

- `Tn6a`：`f`、`math_arithmetic`、`change_variable`、`random`。增加与 ADD 的非纯数字情形走 JavaScript `+`；随机数采用 `floor(random*(b-a+1))+a`，不预先舍入端点。
- `Lcae/OptiRunner.step_iteration_yield`：非 warp 每轮让出；warp 对计数先检查 `> max` 再递增。`step` 在每次解释器执行前清零迭代计数，不是每帧一个共享计数。
- `LmbJ/OptiCompiler`（`compile_repeat_n_times/compile_repeat_forever_until/create_iteration_yield_point`）：循环体执行完再检查，包括 repeat 最后一轮。
- `TGGv/ConfigImpl.set` 的内核默认上限是 30000；**`KmiX` 启动配置在源码字符偏移约 435847 覆盖为 10000**，本包实际 runner 导出 `warpIterations:10000`。这不是泛化所有 K4 版本的固定常量。NekoC 本次对齐此离线播放器配置。

重新记录：

```powershell
$env:K4_PLAYER_DIR='外部播放器 app 路径'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-run-error-fixtures.mjs --record
cargo test --test kitten4_run_errors
```

## 两个根因

### 335327306（florr）

错误前首帧已经出现值级分歧：`dn3VUmIJT0EgTdvee77o` 的 `change_variable` 给数字 6 增加字符串 `",11.55"`。官方继续拼接逗号串，旧 VM 数值化得到 NaN。它被存入“旋转角度暂存”，第 5 帧 `PHQya6TAC4gOerdkNoxG` split 后只剩一项，`r5WpFLApOFAOR67chKu2` 才读第 2 项失败。不是该读取积木自身的错误，也不需要放宽索引检查。

修复 K4 的类型保留 ADD 和 change；不改变 KN。另一个独立的随机值分歧是小数端点被旧 VM 按 KN 规则舍入，按 `Tn6a/random` 修正。夹具覆盖数字相加、字符串与嵌套拼接、增加后 split、小数和反向随机端点。

### 305999424

首个与错误相关的执行边界分歧是初始化线程 `liunvhDthdi1RbN0iRJv`：官方在首帧大段 warp 循环中 yield，后面的 `g51eFHIrrDJUlOcKoguT` 才能通过 `o4hGuLFYmMpKxDa9Axds` 填入两个树木模版。旧 VM 同轮直接执行到 `N9k3sQ5kpqHqqlImQIA6`，模版仍空。不是云数据/存档初值或素材异步完成造成的空值。

按实际配置实现每解释器 warp 迭代上限，嵌套循环共享同一次 step 的计数。热 native 区域在循环边界前退出，由解释器完成计数和挂起，循环体仍能 JIT；回归直接断言已生成 native 区域。边界探针 10000、10001 当帧完成，10002 当帧停在 10002、下一帧完成；嵌套和 until 另有实测。

## 追踪与可复现性

- `k4-trace --seed <u64>` 原来已存在，现在异常 JSON 也附 fps、seed；coverage 新增可选 `--seed <u64>`，API 为 `coverage_with_seed`，旧 API 保留。
- 双方 `--blocks --block-filter id,id` 过滤积木，不过滤任务边界。官方对指定积木增加 `input/output`，即时深拷贝实参，不重跑 reporter 或更改列表。
- NekoC 事件上限与官方一样 500000，显式 `traceTruncated`；截断不干预运行，不可据截断后缺少事件推断没执行。
- oracle `--random-source nekoc` 是**诊断输入替换**：只在 random 积木调用期间使用 NekoC 的 xorshift64，UUID/渲染等随机调用不占用该流。默认仍为原有官方 PCG。它不是官方 PRNG 一致性的证据，也暂不覆盖随机移动/朝向目标。PCG 与 xorshift 的相同 seed 不等价。
- `node tools/compat/k4-run-error-corpus.mjs <只读语料目录> --official` 在 `dist/runerr/multiseed/` 保存 seed 1、6、42 全语料 60 帧 coverage；两个目标另保存过滤积木追踪（florr 8 帧、305999424 3 帧）。这是运行 stage 分布，不是全语料状态相等证明。

## 未验证/限制

仍未实现官方每解释器 50000 次 procedure step 上限、非 deterministic 的墙钟上限；同步 reporter 仍按 VM 的原有完整求值方式，不在表达式内部挂起。云/存档在线结果、用户交互、长时间完整作品一致性、绘图像素以及 Decimal 精度等不在本次证明范围内。全局与实例列表追踪仍不是完整值写日志。列表越界错误保持，已有自制非法读取测试继续断言失败。

## 本地全语料结果

53 件，只读语料、每件 60 帧、无交互，`coverage --seed`：

| seed | ran | run | import | compile |
|---|---:|---:|---:|---:|
| 1 | 52 | 1 | 0 | 0 |
| 6 | 52 | 1 | 0 | 0 |
| 42 | 52 | 1 | 0 | 0 |

两个目标在三种 seed 下均为 ran。唯一 run 为 `214725822`，`8pBbyMp94KX94H4C0g28` 第 2 项/长度 1；本任务未定位该额外错误。`ran` 不代表所有积木已完整实现，coverage 仍有独立 opaque/stubbed 字段，也不表示官方相等。

目标官方对照三种 seed 全部完成：florr 8 帧、305999424 3 帧，双方过滤追踪均未截断。305999424 双方首帧生成线程 yield 后树木模版长度从 0 到 2。florr seed 1 的首帧旋转缓存字串一致；seed 6 均保留七段，但有 `3.55` 与 `3.5500000000000007` 的浮点尾数差异；seed 42 本次未触发该类型，不能代替触发路径验证。完整作品最早的所有状态差异仍**未验证**，这里定位的是导致两处异常的首个相关语义/执行边界分歧。
