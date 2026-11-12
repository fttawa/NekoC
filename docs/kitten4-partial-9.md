# K4 partial 第九轮：过渡、soft、ASCII组合和shake原点

基线 `565edb0`，与开始任务时 `oc/integrate` 一致。本轮**无类型升级**：partial仍54项，
冻结95项频率加权3191。不是作品通过率，也不是“全部任务已达一致”。

| 项目 | 已完成与证据 | 仍未完成/负例 |
| --- | --- | --- |
| set_scene_transition（215） | [14件910连续update/全画布](kitten4-partial-transition-9.md)，distort双截图径向扭曲，严格完成端点后下个update激活，旧组过渡期间保留 | 全画布有栅格残差；none启动先后负例；真实时钟、竞争切场、动态离场内容未验证 |
| physics2_set_texture / flexibility | [4件420官方update](kitten4-partial-physics-9.md)，确认粒子模型而非弹簧网格；重复soft幂等、strength同组修改、scale同帧重建清速适配 | **未实现真实粒子形变和soft渲染**；impact25/90任何刚体拟合误差下界3.386681/16.340179px，矩形输入首帧超时。保持rigid-fallback显式诊断 |
| 五项set/change effect | [9件64对画布](kitten4-partial-effects-9.md)，修复ASCII最终pass额外POT投影；twist组合和舞台外字形负例消除 | 全链仍65像素/hue仍1像素超差（RGB容差8）；ripple官方位移素材缺失单列例外；不升级 |
| self_shake | [4件×4原点640官方update](kitten4-shake-9.md)，显式shake-only时钟原点；同原点双VM逐帧变量/坐标一致，重启保留配置 | 默认0不等于任意浏览器墙钟原点；物理、并发与设备相位未验证；不升级 |

所有夹具均为仓库原创工作区和inline SVG；官方包、只读语料和HateNeko均未复制/移植。
JS历史证据不重录掩盖旧负例；当前renderer由第九轮证据绑定。

通用Rust/JS门禁、三seed语料结果和target清理记录在不提交的根目录 `OC-REPORT.md`。
