# Kitten 4 视频与非视频区域比较

## 实现范围

- `play_video`、`play_video_until_end`、`continue_pause_video`、`show_hide_video` 不再是 stub。
- `videos.videosDict` 保留作品的视频资源；VM 帧的 `videos` 输出位置、显示尺寸、缩放、可见性、播放状态、位置（秒）、时长和播放代次。
- 播放从 0 开始；重播释放前一次等待。暂停保留时间，隐藏不暂停，首次播放之前和结束后的“继续”无效。缺失视频不阻塞。
- web 使用 HTMLVideoElement 解码并上传 WebGL 纹理；视频中心使用舞台坐标，y 向上。成功解码后的原始尺寸乘缩放，**不会再乘保存的显示宽高**。实际尺寸和时长通过 `videos` 请求元数据回传 VM。
- 初始顺序为背景 → 视频 → 画笔/角色。`Ct.unset_brush_target` 解绑画笔后，官方会将画笔重新插入场景索引 1，变为背景 → 画笔 → 视频 → 角色；帧 `video_above_pen` 保留这一区别。切换场景重新插入媒体容器时恢复初始相对顺序。
- UI 暂停和单步冻结视频；更换项目取消旧加载并释放媒体源/纹理；迟到的解码错误和 seek 事件不会影响新作品。

## 官方证据及复验

只读离线包 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`（压缩源第 1 行）：

- 视频 domain block 工厂：`play_video` / `play_video_until_end` / `show_hide_video` / `continue_pause_video`（原始字符偏移约 625313）。
- `ki.play/resume/pause/set_position/set_pixi_scale`（约 956869）：播放先调用旧完成回调、重置 currentTime，resume 检查 is_played / paused / ended。
- `add_playable`（约 1023300–1025650）：成功加载后使用视频固有尺寸和 `e.scale`，取 `get_size` 返回显示尺寸。保存的宽高还用于加载失败的占位。
- `QqDm.h=1`、`zi.on_parent_scene_change`（约 990571）：媒体共享容器插入场景索引 1；`Ct`（约 803339）和 `Ct.unset_brush_target`（约 806955）决定画笔与媒体的相对顺序。

偏移只用于定位此包，不是稳定 API。oracle 的 diagnostics 记录实际资源 SHA-256；此离线包不等同于已独立认证的线上版本。

`tests/k4-video.test.mjs` 内含原创纯蓝色 64×48、0.4 秒 WebM（由 ffmpeg color 源生成），不含第三方作品。官方集成实测位置 `(17,-9)`、scale `2`、显示尺寸 `128×96`、媒体容器索引 `1`，并观察画笔解绑后低于视频。

```powershell
$env:K4_PLAYER_DIR = 'E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES = 'D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:K4_VISUAL_BROWSER = '1'
$env:K4_VIDEO_INTEGRATION = '1'
node --test tests/k4-video.test.mjs tests/k4-visual.test.mjs
```

## CLI 确定性与边界

VM 媒体时间只由 `advance(dt)` 推进，不访问网络、不读取真实媒体时钟。时长未知则不猜结束点，等待继续保持阻塞。
`k4-trace --videos metadata.json --render` 可以读取解码元数据数组：

```json
[{"id":"video-id","duration":0.4,"width":128,"height":96}]
```

无元数据时，几何采用作品保存值；这不证明缺尺寸或陈旧尺寸的作品在 CLI 下与官方成功解码结果一致。web 成功解码会回传真实尺寸。

**未验证**：HTML 媒体时钟与 VM 虚拟媒体时间严格同步、浏览器音视频实际输出时延、失败素材的官方灰色错误占位、移动端动画/伴随声音路径、媒体实际结束事件与虚拟时间结束的调度逐帧等价。浏览器自动播放限制会报错，不伪造播放成功。未参考或移植 HateNeko。

## 像素比较契约

`k4-visual` 在每个采样帧读取官方视频实际 backing-pixel bounds，并合并 VM 视频矩形（使用官方解码尺寸元数据），排除双方矩形的**并集**和 1 像素边缘。每帧记录 `scope`、`pixels`、`maskedPixels`、双方 `videoBounds`；MAE/RMSE/PSNR 的分母仅为剩余像素。

- 视频从隐藏变可见、位置/大小不一致均通过逐帧并集处理，不只看初始 visible。
- 保留原始双方 PNG，不把 mask 涂白伪造相同。
- `scope=non-video` 的 `captured` 仅表示剩余区域完成采样，**不表示视频像素相同，也不验证被视频矩形覆盖的角色/画笔**。
- 整屏视频使剩余像素为 0 时，指标为 null，作品为 `unverified`，原因 `video mask leaves no comparable pixels`，不纳入统计通过。
- 发现 `play_video_until_end` 时，即使剩余区域有像素，也保守标记 `unverified`：官方真实媒体结束可能改变后续非视频控制流，固定 VM 更新不能保证相同。探针覆盖等待后执行角色翻转，确认不会误标为 captured。
