# K4 云变量、云列表和排行榜的本地模拟

## 官方证据及边界

只读检查 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`。
SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
下列位置为该 UTF-8 文件在 JS 字符串中的偏移，不是行号；只记录定位，不携带内核代码。
本包仍保留 DI 暴露点，未经独立认证等于线上发布版本。

| 位置 | 观察 |
|---|---|
| `TL4g/Ct`，约 569100 | 未登录、无作品 ID、无认证类型时调用普通 Start，不等待 WebSocket；已登录连接失败、认证失败回调也调用普通 Start。连接挂起期间有等待，完整超时/重连时序未验证 |
| `vxpV/I`，约 1723700 | Start 只将普通变量保存值与显式传入的服务端 specs 合并；不从 cloud_variables 的 value 取初值 |
| `O8fc/UserVariableImpl.get_var_or_list`，约 497300 | 未定义标量首次读为 0，列表首次读为空数组 |
| `TL4g/R`，约 554000 | 离线标量写入即时生效，接受 number/string；字符串上限 1024 UTF-16 单元；未登录不发送云写入。增加按 JS 加法，减少按数值减法（public 还执行 Number(x)\|\|x） |
| `TL4g/R.p`、`K.update_list_by_action`，约 554300、565000 | 无连接列表直接在本地 splice/push 并发通知；单项字符串上限 128；非正/非有限索引操作忽略；正小数截断，0<n<1 钳制到第 1 项；越界 replace/insert 追加，delete 忽略，read 返回空字符串 |
| `TL4g/ct.show_ranking`，约 566350 | 即使离线也先设显示状态；无作品 ID 提示加载错误；没有 socket 就不发送排名请求，不生成排名。hide 清状态 |
| `TL4g/socket.get_cloud_var_spec_list`，约 552900 | 真正的服务端返回值才覆盖 defaults；null 映射为 NaN，列表项同样处理 |

自有夹具 `cloud-{defaults,writes,limits,change,ranking}.bcm` 与录制结果见
`kitten4-cloud-evidence.json`。`defaults` 故意在云元数据中保存非零 value，实测仍为 0 / []；
其余验证未登录写入、splice 边界、类型/长度限制、字符串增加/数值减少、排行榜状态。
无真实登录、无凭据、外部请求全部拦截，**不能**据此声称验证了在线后端、排名内容或重连。

```powershell
$env:K4_PLAYER_DIR = '外部播放器/resources/app'
$env:NEKOC_NODE_MODULES = 'D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-cloud-fixtures.mjs --record
cargo test --test kitten4_cloud
```

oracle 改用播放器的 Start 入口 `vxpV.n`，不再绕过云初始化直接调用底层 `m`；
帧快照同时导出云变量/列表，但仍不将它们当作普通保存变量注入内核。

## 本地后端

默认不启用后端，保持官方匿名离线的 0 / [] 初值和会话内操作。
`CloudBackend` trait 的 `load/store` 是可选 HTTP 适配边界，未实现 HTTP，也不隐式联网。
内存和文件后端是**明确选择的本地模拟模式**，不是编程猫云服务器替身或登录。
排行榜仅有本地显示状态，无伪造用户、排名、分数；尚无排行榜 UI。

```powershell
# trace CLI：必须明确命名本地作品空间；本地用户不是编程猫身份
cargo run --bin k4-trace -- input.bcm --cloud-file dist/my-cloud.json --cloud-namespace my-work --cloud-user alice
# web：同一 host 内存实例在 HTTP / WebSocket 播放会话间共享
cargo run --bin web -- input.bcm --cloud-memory --cloud-namespace my-work --cloud-user alice
```

也可调用 `Engine::set_cloud_backend(Arc<dyn CloudBackend>, namespace, user)`。
私有标量的键为 namespace+cvid+本地 user；公共标量/列表不含 user。
namespace 完全由 host 指定，必须为不同作品分配不同值；不从不可信作品自动推断 ID。
文件路径只来自 CLI，不接受页面或作品指定路径。文件格式有版本号；JSON 损坏、类型错误、
读写权限错误显式返回错误，不默默归零覆盖。通过同目录临时文件刷新并替换，保留其他键。
文件后端现在支持本机跨进程共享；帧级文件锁、自动刷新及限制见 [本机共享后端](k4cloud-local-backend.md)。

后端在 attach 和每帧开始时读取、成功 frame 结束时保存变化，不逐积木访问网络/磁盘；
运行报错的半帧不提交。文件模式提供帧级互斥以支持本机并发增减，无实时订阅、崩溃原子多键事务、在线排队与限速。
这些是本地模拟的明确边界；未来 HTTP 实现需要独立设计异步同步协议，不能把帧边界存储冒称在线一致性。
JSON null 在模拟持久化协议表示 NaN（官方云 number/string 域没有合法 null）。
UTF-16 截断遇到孤立代理项按现有 VM 用替换字符表示，精确 JS 孤立代理字符串**未验证**。

## 214725822

作品的 BOSS 私有云元数据没有 value。不能凭作品后续按 `/` 分割取第 2 项的期待，
生成一个不存在的服务端值。默认离线仍保留普通列表越界异常，不以空字符串掩盖它。
本次在官方播放器匿名、禁云网络条件下实测，首帧未完成即报
`lists_get_value_bad_index`，索引 2，reporter 为 `EE5xZnTaOw8pcFzJ0t3K`，
所属赋值语句 `8pBbyMp94KX94H4C0g28`、hat `VQIXXMNirdJ1qh8Hu4GL`。
NekoC 修改前后同在该语句失败，`stage=run`，完成帧数 0；不是云初值兼容性修复后就应自动跑通的作品。
完整运行结果与前后 stage 见根目录未提交 `OC-REPORT.md`；第三方作品和轨迹只放忽略的 `dist/cloud/`。
