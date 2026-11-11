# Kitten N 运行时语义实测

## 范围和证据

对象是官方在线 [KN 编辑器](https://kn.codemao.cn/editor) **0.27.4**，不是 K4，也不是 HateNeko。
使用 `tools/semantics-kitten-n.mjs` 生成的原创、无外部素材夹具，匿名浏览器加载到编辑器后点击“开始”，直接读取 runtime manager 中的全局值。
没有上传、发布作品或依赖变量监视器显示值。所有 `.bcmkn` 均经过 `tools/editor-compat.mjs`，要求 `ok: true`。

可复验观测、浏览器版本、时间、夹具 SHA-256、官方 bundle URL/SHA-256、VM 对照结果及编辑器兼容检查见 [`kn-semantics-official.json`](kn-semantics-official.json)。
该记录比较**带类型的最终变量值及脚本写出的先后顺序**，不是逐帧一致性证明。
非有限数字用 `{"$number":"NaN"}` / `Infinity` / `-Infinity` 编码，不与字符串 `"NaN"` 或 JSON null 混淆。

官方源码定位（从解码后的 JavaScript 字符串起始处计算，0-based 字符偏移）：

| 来源 | SHA-256 | 定位 |
| --- | --- | --- |
| `https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js` | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` | `convertType,(function` 1633578；`listItem,(function` 1662815；列表索引 helper `h` 1662100 附近 |
| `https://creation.bcmcdn.com/neko/web/release/static/js/crc_libs.8196dbd1.js` | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` | `text_join:function` 822263；广播等待管理 `broadcaster_sending_message` 998k 附近 |

源码仅下载到忽略目录 `dist/kn-semantics/`；不入库。编辑器覆盖了部分 crc 通用函数，**不能只看 crc 的旧列表读取函数推断 KN 列表越界会停止**。
本轮没有参考或移植 HateNeko 代码。

## 实测结果与修复

每行是独立夹具；日志通过 `trace = 连接(trace, token)` 写入。

| 夹具 | 官方观测 | NekoC |
| --- | --- | --- |
| `scheduling` | 两个启动脚本分别 A/wait(0)/a 和 B/wait(0)/b：`ABab` | 一致 |
| `broadcast` | 发送者 A/异步广播/B/wait/C，接收者 R/wait(0)/r：`ABRrC` | 一致 |
| `broadcast-wait` | A/广播并等待/B，接收者 R/wait(0)/r：`ARrB` | 一致 |
| `clone` | A/克隆/B，克隆启动 K/wait(0)/k，稍后广播报告自身编号：`ABKk01` | 一致；克隆接收广播，但没有重跑普通启动脚本 |
| `yield` | 两个三次循环分别追加 A/B，循环后追加 a/b：`ABABABab` | 原为 `ABABAaBb`，已修复最后一次普通迭代遗漏 yield |
| `yield-warp` | 原子执行三次 A，再追加 a；另一个普通三次 B 循环：`AAAaBBBb` | 保持原子循环，不添加最终 yield |
| `wait-negative` | wait(-1) 与另一个 wait(0) 并行：`ABab` | 一致；这里只证明让出执行，不证明毫秒精度 |
| `conversion-boolean` | true/false 转数字得到**字符串** `"true"` / `"false"` | 原为 1/0，已修复 |
| `conversion` | 空串/空白→0；0x10→16；0b11→3；1e2→100；bad→原文本；NaN→数字 NaN；Infinity→数字 Infinity | 一致（另含布尔修复回归） |
| `conversion` 文本拼接 | 数字 1e21、布尔和嵌套列表拼接：`1e+21\|true\|1,猫,2,3` | 一致 |
| `list` | `[10,20,30]` 的 1/-1/0/4/1.5/-4 号：10/10/10/NaN/20/10，随后 done=1 | 一致；负数/零钳到首项，正小数按 Math.round，越界继续执行 |

修改限定在 VM 最后迭代的 yield 判定和 KN 数字转换的布尔分支；K4 原来就做最终 yield，且 K4 转换使用独立 `Kitten4Convert` 分支，不受布尔转换修改影响。
新增 `kn-trace` 直接 `Program::compile` 原生 KN，不调用 K4 importer 或旧参考解释器；固定虚拟时钟运行 180 次 1/60 秒 update，并拒绝预算 yield。
Rust 回归通过 `bcmkn::import`，分别打开/关闭 JIT 配置，与归档的官方类型值比较。短夹具未达到 500 次热度阈值，**未验证热编译路径**。

## 复现

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/semantics-kitten-n.mjs --generate
cargo build --bin kn-trace
$fixtures = (Get-ChildItem tests/fixtures/kn-semantics/*.bcmkn).FullName
node tools/editor-compat.mjs @fixtures --channel msedge --out dist/kn-semantics/editor-compat.json
node tools/semantics-kitten-n.mjs --out dist/kn-semantics/compare-after.json --nekoc target/debug/kn-trace.exe
node tools/semantics-kitten-n.mjs --archive dist/kn-semantics/compare-after.json
cargo test --test kn_semantics
node --test tests/kn-semantics.test.mjs
```

`--case yield` 可以单独复测，但不能将不完整的报告归档。`--archive` 重新计算双边相等性，拒绝失败、非双边比较、夹具 hash 过期或缺失编辑器检查的记录；编辑器检查按输入 SHA-256 绑定，不接受同路径的旧检查。
工具需要联网及 Edge/Playwright；webpack marker、固定模块 ID 和 UI 文案是 **0.27.4 专用接口**，升级后必须重新核对，失败不视作通过。

## 未验证及风险

- 调度只测单角色的少量启动脚本与有限循环；多角色/多场景、嵌套广播、同名广播重入、带参广播、同步广播与克隆删除组合、无限循环/嵌套 warp 的调度仍**未验证**。
- wait 使用墙钟等待 done，再延迟 150ms 等待短并行脚本收尾；没有劫持官方 rAF/Clock。没有宣称 wait(0) 精确耗费几帧、真实计时器一致或所有刷新率均一致。
- 列表只测读取，不覆盖增删改、空列表、Infinity/NaN/字符串索引。数值转换只覆盖表列输入，列表转数字、Null、Boolean 目标、转换警告 UI 仍**未验证**；本轮不扩大修改范围。
- 最终变量相同不是执行轨迹全部等价；日志顺序只覆盖夹具实际观测点。长运行、性能、物理、音视频及云功能不在本次结论范围。
- NekoC 不复刻官方“布尔转数字失败”和非法索引的控制台提示，保证限定于返回值与是否继续执行。
- `Engine::variable_value` 返回当前全局标量/列表的 Cell（列表保留共享引用），用于类型保真诊断；不提供私有变量读取，不应用于无边界的循环列表序列化。
