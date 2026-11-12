# K4 本机共享云后端

默认不传云参数时，每个播放器保留独立的匿名离线内存状态：云标量从 `0` 开始、列表从 `[]` 开始；不会读取作品云元数据中的保存值，不连接编程猫服务。
积木的类型检查、UTF-16 长度限制和索引处理仍在 `src/engine/cloud.rs`，不会因选择后端改变。
官方离线证据的既有范围见 [kitten4-cloud.md](kitten4-cloud.md) 和 [第二组探针](kitten4-partial-cloud-2.md)。本机共享协议不是官方在线协议。

## 两个播放器共享

先创建用于存储的目录，然后在两个终端运行（端口必须不同）：

```powershell
cargo run --bin web -- game.bcm --port 4173 --cloud-file dist/room.json --cloud-namespace demo --cloud-user alice
cargo run --bin web -- game.bcm --port 4174 --cloud-file dist/room.json --cloud-namespace demo --cloud-user bob
```

两个实例必须使用**同一绝对文件路径**（例中从同一目录启动）、同一 namespace 和同一作品的云变量 ID。
公共标量和云列表共享；私有标量按 `cloud-user` 隔离。相同本地用户可在两个实例共享私有标量。
`cloud-user` 只是本机测试名称，不是账号、token 或登录身份。不同作品请用不同 namespace。

原生窗口使用相同 Rust VM / CloudSession：

```powershell
cargo run --features desktop --bin web -- game.bcm --desktop --cloud-file dist/room.json --cloud-namespace demo --cloud-user alice
# 导出的独立 exe 也接受 --cloud-file / --cloud-namespace / --cloud-user
```

`k4-trace` 接受相同云参数。`--cloud-memory` 只在同一个 web host 内共享，不在独立进程间共享。
后端选择仅由宿主命令行控制；页面、作品内容不能指定本地路径。排行榜只保留离线状态，不制造排名数据。
**已知舞台缺口：**官方匿名离线有“未登录用户 + loading”排行榜 DOM 壳，本地尚无该壳；云列表仍走通用 DOM 面板而非官方 PIXI 皮肤，不能声称像素一致。具体取证见 [官方离线证据](k4cloud-offline.md)。

## 同步、并发和故障

- `CloudBackend::load/store` 是可插拔接口；`lock_frame` 可提供持有至帧提交的独占视图。第三方适配器未实现它时，仅提供帧快照/最后提交者覆盖语义，不能声称原子增减。
- 文件后端用 `room.json.lock` 的操作系统独占锁。从每帧刷新到提交持锁，因此两个实例同时执行增减或列表追加不会从同一个旧值互相覆盖；另一个实例在下一次 `advance` 看到提交结果。
- 锁覆盖的是一次播放器 `advance`（可含宿主显式选择的多个 tick），不是逐积木广播或网络实时同步。暂停实例要在继续推进帧后才能刷新。
- 更新列表时原地替换内容，保留本地已经取得的列表引用。数据文件用同目录临时文件刷新替换。**运行时不要删除/替换 `.lock` 文件，也不要通过软/硬链接等不同路径别名访问同一数据文件。**
- 数据文件仍使用版本 1 的 JSON。无效 JSON、版本、值类型、目录和权限错误显式失败，不用空状态覆盖损坏文件。文件锁可由进程退出自动释放。
- 成功帧才写回；执行错误的半帧不会提交。逐键写入并非多键崩溃原子事务：进程在提交多个键之间崩溃可能只提交部分键。锁没有超时；另一个进程的慢帧会阻塞本进程。限本机磁盘，不承诺网络文件系统锁语义。
- JSON `null` 沿用既有本机协议表示 NaN；列表 undefined 与非有限数经 JSON 后不能完整区分，不把本机持久化称为官方在线值保真。孤立 UTF-16 surrogate 仍是 VM 已知限制，未验证。

回归：`cargo test --test cloud_shared` 会先启动两个已运行的读取 VM，再并发启动两个独立测试进程，各做 20 次公共/私有增减与列表追加，检查公共计数 40、列表 40 项、私有计数各 20，并验证读取实例无需重新 attach 即可刷新。
