# 导入性能与行为回归

在 release 下测量（不要用 debug 耗时作为产品性能指标）：

```powershell
cargo build --release -j 1
target/release/nekoc.exe bench-import samples/kitten4-demo.bcm samples/pen_display_columns.bcmkn --out dist/import-timings.json
```

每个输入输出一条 JSON，`timings_ms` 为毫秒。`total` 包括文件读取、JSON
解析、格式导入、诊断、编译、VM/JIT 初始化及序列化回传；这些计时为**包含式**，
不要把所有列相加。`engine_compile_total` 包含 provenance 验证、start hats、
`lower_for_vm` 和 `engine_compile_canonical`。`compiled_work_native` 包括
published compile_result 重建、映射和稳定 ID 处理。JIT 是惰性的：默认只量初始化，
加 `--frames 10` 后，达到热阈值才会出现 `jit_compile_hot`。

诊断现在直接复用 `engine_prepare` 的结果，并调用 canonical 编译器；所以
`engine_compile_total` 不再包含这些直接调用，`engine_compile_canonical`
仍累计所有真正的字节码编译。K4 来源缓存为每线程最近一次成功导入，重复相同
输入是热缓存测量；测冷启动应每次启动一个新进程。Web 导入缓存另外按内容
SHA-256 复用原生输入/规范项目（浏览器整数浮点规范化也可命中），仅保留最近一个
作品，导入失败不替换旧缓存。

生成自有大作品（仅写入被忽略的 dist，不使用第三方作品）：

```powershell
pwsh -File tools/synthetic-import.ps1 -Scripts 200 -Length 24
target/release/bench-import.exe dist/import-synthetic.bcm
```

`nekoc bench-import` 和独立的 `bench-import` 二进制共用实现。fat LTO
并行链接在低内存机器可能 OOM；可用 `cargo build --release -j 1`，不改变
release 优化选项。

修改前、后分别用对应源码构建二进制并采集，然后比较：

```powershell
pwsh -File tools/compare-import.ps1 -Output dist/import-before
# 修改、重新构建后
pwsh -File tools/compare-import.ps1 -Output dist/import-after
pwsh -File tools/compare-import.ps1 -Mode compare
```

脚本覆盖本 worktree 的 `dist/kitten4-corpus/*.bcm`、仓库 K4 样本，及
`samples/`、`projects/` 各自最大的 `.bcmkn`。保存 coverage 原样输出和前
10 帧 VM 状态（固定随机种子、解释执行、固定指令预算）。比较只忽略
`timings_ms` 和采集时已去掉的 `execute_us`。时钟/外部服务输入仍可能不确定，
差异必须检查，不能自动抹平。未提供的语料不会自动下载或从其他 worktree 复制。

语料和二进制可以显式指定；脚本只读取输入，输出仅为报告与状态：

```powershell
pwsh -File tools/compare-import.ps1 -Corpus E:/nekoc/dist/kitten4-corpus -CorpusOnly -BinaryDirectory dist/baseline-src/target/release -Output dist/corpus-before
pwsh -File tools/compare-import.ps1 -Corpus E:/nekoc/dist/kitten4-corpus -CorpusOnly -Output dist/corpus-after
pwsh -File tools/compare-import.ps1 -Mode compare -Before dist/corpus-before -After dist/corpus-after
```

深层树的缓存来源、canonical baseline、Web 缓存和编译准备结果均以 `Json`
持有，释放不递归。导入移动子树，`next` 链迭代转换，不计入输入/语句的 64 层
嵌套上限；共享准备阶段与逐根诊断仍检查带积木 ID 的边界错误。

性能结果只说明 NekoC 的前后表现，不构成官方语义一致性证据。

测试 localhost 启动与 `/play` 再请求同一项目时的缓存命中：

```powershell
pwsh -File tools/bench-import-web.ps1 -InputFile dist/import-synthetic-large.bcm
```

可用 `-Executable <基线 web.exe>` 对比旧版本，`-TimeoutSeconds` 默认 900 秒，
允许很慢的基线完成而不误报退出；`startup_ms` 包括启动进程及健康检查探测。
Windows native 输出按 UTF-8 采集，避免 coverage 的中文错误信息损坏 JSON。

这测的是 Rust 导入/回传路径，不包括浏览器图片解码、远端素材下载和 WebGL
初始化；这些应另用浏览器性能工具验证。VM 仍按连接独立编译和初始化，不共享
可变的任务、列表或 JIT 状态。
