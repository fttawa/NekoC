# KN 官方当前编辑器：输入行为源码证据

调查时间：**2026-11-10 14:04:16 UTC**。对象是 `https://kn.codemao.cn/editor` 当时返回页面引用的官方公开发行包，最终页面地址为 `https://kn.codemao.cn/editor/`。不是 HateNeko、Scratch 或 K4 离线播放器的推测。

**本页是线上资源获取 + 官方 bundle 静态调用链检查；后续另已运行自编输入作品，见下节及 `input-kn-evidence.json`。** 本页静态结论不代表所有输入已经一致；仅打开编辑器读取 Webpack factory 的阶段不计行为验证。

### 后续原创作品实测

`tools/compat/kn-input-probe.mjs` 生成 `tests/fixtures/input-kn.bcmkn` 并在官方 KN 中运行。作品经 `editor-compat` 检查 `ok=true`、24 块、issues/pageErrors 为空，完整来源 hash、输入次数、计数快照和控制台错误保存在 `input-kn-evidence.json`。

一次 A-down（`repeat=false`）保持后，`a-down` 在约 180/780/1380 ms 时分别为 28/116/213；一次 A-up 后约 250/850 ms 均为 214，up 为 1。any 同步，证明短同步脚本持续按下会重触发，不依赖 OS 自动重复。角色短按有 click/up，第二次保持 1200 ms 后释放只有 up、没有新增 click。按住期间角色 down 持续增长。

这不是固定帧执行速率承诺；Rust `tests/input.rs` 只对相同状态/单实例/释放脉冲规则作回归。未测真机触屏、IME、失焦、多键或纹理边缘；其他静态推导仍以“未验证”为界。控制台存在原样保留的资源 401/403 等错误，无未捕获页面异常。

## 1. 获取与来源固定

工具：`tools/compat/kn-input-source.mjs`，仅新增本任务专用工具；不改现有公共探针。运行方式（PowerShell）：

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-input-source.mjs
node tools/compat/kn-input-source.mjs search onSwipe 700
node tools/compat/kn-input-source.mjs search is_touching 700
```

所有下载包、模块字符串及诊断清单写入 **本 worktree 的 `dist/kn-input-source/`**（已被 `.gitignore` 排除）；没有将第三方源码放入可提交文件。本调查未读取/修改 K4 离线包，亦未修改 `src`、`web` 或其他现有工具。

取证方法：先正常 GET 编辑器 HTML 与其四个 script 地址，保存原始响应字节并计算 SHA-256；再在独立 headless Edge **157.0.4341.42** 中用已保存字节加载。仅为主包的启动代码增加 `window.__nekocRequire` 引用，指向现有 `__webpack_require__`，不替换 factory，不更改输入逻辑。随后读取 `require.m` 中 factory 的 `toString()`，不主动执行这些 factory 或其导出函数。页面本身的正常初始化仍会执行模块。这是插入了可观察入口的会话，不是完全无插桩页面。

HTML SHA-256：`a75fff75978d7fff55e35fcab6331cffed36e9000d4961f949e1a42b9dafbbb4`。

以下文件都来自 `https://creation.bcmcdn.com/neko/web/release/static/js/`，由官方编辑器页面直接引用：

| 文件 | 响应字节数 | SHA-256 |
|---|---:|---|
| `base.f158ddbf.js` | 949823 | `724251e202e9dac074241e6296f3bbf3773c420141516764c8434dd17eb113e7` |
| `crc_libs.8196dbd1.js` | 1297643 | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` |
| `main-vendors.07f7dd7e.js` | 6460489 | `38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68` |
| `main.8ccf2442.js` | 5594327 | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |

### 关键模块定位

下表偏移是**原始 JS 文本的 0-based UTF-16 字符偏移**，不是响应字节偏移。工具保存的 `module-<id>.js` 是单个 factory 的原始字符串；后文局部偏移相对该字符串，二者相加即可回到 bundle。完整模块 hash/符号命中清单见本地 `dist/kn-input-source/manifest.json`。

| 模块 | 包 | factory 起点 | 作用 |
|---|---|---:|---|
| 26921 | main | 1837668 | DOM/舞台事件到运行器 action 的桥接 |
| 46501 | main | 1583958 | action/responder 配置，积木行为注册 |
| 19519 | main | 1570569 | 检查按键、鼠标状态/坐标、碰鼠标报告器 |
| 11937 | main | 5368109 | 可用 keyCode 白名单（导出 N2） |
| 61248 | crc_libs | 1094004 | 舞台/角色事件、点击判定、像素 hit area |
| 1753 | crc_libs | 1090073 | 坐标逆变换、碰撞采样分辨率 |
| 8541 | crc_libs | 980458 | action 队列及三类 responder 调度 |
| 9425 | crc_libs | 813493 | action 状态存储及自动过渡 |
| 4097 | main-vendors | 1192404 | Hammer 2.0.7 手势识别器 |
| 18701 | main-vendors | 618059 | Pixi 交互树命中及 pointer 分发 |

例如模块 26921 的 factory SHA-256 为 `6f16025415f134f4e3bae321cea709ec0680b32f39225974dc096d3f1b50d51c`；模块 61248 为 `5ad537fad305c291b2d8a5b8cec3dc01632dbcff7da84a830da2e8815d169688`。它们可与清单中的完整包 hash 交叉复核。

## 2. 键盘：不是只触发一次的 keydown 帽

定位：模块 **26921** 的 `onKeyDown`、`onKeyUp`、`switchKeyEventListeners`、`keyCodeProcess`、`sendKeyboardAction`；模块 **11937** 的 `P`（局部偏移 7058）；模块 **46501** 局部偏移约 122736 的 `on_keydown` 注册；模块 **8541** 的 `create_state_responder_interpreters`（11700 附近）。

- 运行开始时在 `document.body` 增加 `keydown` / `keyup` 监听，停止时移除。处理前检查运行中且当前场景存在。
- 使用旧 DOM **`keyCode`**，不是 `KeyboardEvent.code` 或 `key`。数字小键盘 96–105 减 48，归一为 48–57，随后转字符串。
- 白名单是方向键 37–40、数字 48–57、字母 65–90、小键盘数字 96–105、回车 13、空格 32。桥接层归一后再检查白名单。Shift/Ctrl/Esc 等不在该白名单。
- 每个允许的事件按顺序发送两个 `on_keydown` action：一个 `sub_type` 为该键码，一个为 `any`；`value` 为 `down` 或 `up`。`any` 因此是显式状态，不宜直接假设为“当前按下键集合非空”。例如放开 A 同时仍按住 B 时，桥接仍会发送 `any/up`；最终帽执行结果待多键实测。
- 该桥接函数没有基于 `event.repeat` 去重，也没有在这两个回调中按输入框焦点过滤。是否有其他上层 DOM 组件阻止冒泡，不能仅由此排除。
- 注册类别是 **State**，`async: false`。默认值为空串，`up` 在下一次状态更新自动变为空串；`down` 没有自动清空配置。
- 运行器每次更新检查 State responder；匹配当前值且该 responder 没有仍存活的同步解释器，才创建解释器。因此静态证据支持“按住期间，短脚本完成后有机会再次触发”，不是仅 OS keydown 上升沿。长脚本存活时不会据此每帧叠加同一同步帽实例。
- `checkKey` 报告器（19519，约 7000）查询同一个 `on_keydown` 状态，以字段 `key` 为 `sub_type`、字段 `type` 为期望值。

**未验证**：真实键盘自动重复、IME、窗口失焦/blur、焦点在输入框、同时按多键、down/up 同一运行器更新内到达、虚拟键盘 UI 对这些条件的实际影响。

## 3. 鼠标/触摸：全局状态、角色状态、点击脉冲分开

定位：模块 **26921** 的 `initListener`、`onActorMouseDown/Up/UpOutside`、同名 Scene/Stage 回调；模块 **46501** 局部偏移 121600–123400 的注册；模块 **19519** 局部偏移 6400–7500 的报告器。

### 平台分支与坐标

- `__IS_MOBILE__` 分支将 actor/scene/stage 的 touchstart、touchend、touchendoutside 接到鼠标语义回调；非移动分支用 mousedown、mouseup、mouseupoutside，舞台移动对应 touchmove 或 mousemove。
- 底层模块 61248 的 `emit_mouse_event`（6774）从 `getLocalPosition(stage)` 得到坐标，将 y 取负后发出舞台事件；舞台原点按渲染器宽/高的一半设置。不是直接把 DOM clientX/clientY 当成积木坐标。
- `onStageMouseDown` 更新位置并发送 `global_tap = mouse_down`。`onStageMouseMove` 更新位置，不要求运行中。
- `onStageMouseUp` 发送 `global_tap = mouse_up`；PC 保留释放位置，非 PC 将位置置为 `{x:NaN,y:NaN}`。outside 释放发送空串而非 mouse_up，移动平台同时将坐标置 NaN。
- `getMouseInfo` 从缓存位置读取，缺失时用 NaN 坐标；调用两位小数格式化辅助函数。没有证据支持缺失时一律返回 0。

### 角色/场景按下与释放

- actor/scene 的 down 回调先取消旧 `sendActionReq`，登记当前按下目标并启动 **requestAnimationFrame 循环**，循环发送该目标的 `sprite_on_tap = mouse_down`。不是在该回调开头立即发送一次；极短按下在首个 rAF 前释放的结果必须实测。
- actor 和 scene 共用桥接对象上的一个 `sendActionReq`，因此不能仅从目标结构推断其按下重发是完全独立的多个计时器。
- 正常 up 取消该循环、清空相应当前目标，并发送 `sprite_on_tap = mouse_up`。
- upoutside 也取消循环/清空目标，但发送空串，**不等价于正常 mouse_up**。
- 实体 action 包含 `entity_id` 和同值 `sub_type`。`sprite_on_tap` 帽注册为 **Dynamic**，不是简单地看到 action 就无条件触发。`--self`、具体角色/克隆、`--screen` 有专门解析；屏幕分支读取 `global_tap/global_click`，并非只读背景实体的状态。
- 实体 mouse_up 和全局 mouse_up 的自动过渡都是下一次更新回到空串；mouse_down 保留直到被写入别的值。

### 点击是另一条路径，含时间门槛

- 底层模块 **61248**：Stage 的 `emit_mouse_event`、Scene 的 `emit_mouse_event`（47756）在 down 记录 `Date` 毫秒值；正常 up 与 down 时间差 **严格小于 1000 ms** 才先产生 click，再发 up。
- Actor 的 `drag_start` 同样记录 down 时间，即使运行时被设为不可拖拽也会记录。`drag_end`（约 63300）排除 mouseupoutside/touchendoutside，时间差严格小于 1000 ms 时产生 actor:click。在这个函数中没有位移容差检查，不能自行添加“拖动 N 像素必定不点击”的保证。
- 全局 stage:click 直接发送 `global_click = mouse_click`，配置为 one_frame。
- actor:click / scene:click 将目标写入 `isMouseClickTargets`；`sprite_on_tap` 的 click 分支和鼠标点击报告器读取这张表，运行器 **after_update** 清空它。因此实体点击不是持久按下状态。
- Pixi 自身也有 click/tap 分发，但这里角色运行输入读取的是上述库自定义 actor:click 路径，不能仅用 Pixi click 的惯常语义代替。

### 多点触摸与 cancel 的限制

- 26921 在移动分支给 document 增加 capture touchstart 监听：取消共用的 rAF 请求，并将之前 currentTouchDownActorId/SceneId 的实体状态发送为空串后清空。这不是已验证的独立多指持久按下模型。
- 61248 提供可配置 `cancel_multi_touch`；舞台事件发出后，若原始事件是 touch 且 touches 多于 1，会发 break。该配置在库层默认 false；本轮没有追完编辑器所有构造参数，**不宣称线上编辑器一定开启该配置**。
- 18701 的 Pixi 交互层确实识别 touchcancel 并分发；但本轮检查的 26921 运行输入 `initListener` 中没有与 touchcancel 同等的释放处理，61248 Stage/Actor 的运行事件转发也只显式列出 end/endoutside。不能由“底层支持 cancel”推出“积木状态必定正确清除”。

## 4. on_swipe：两级筛选，且方向比较不是绝对值主轴

调用链：**61248** 创建 Hammer Manager（局部偏移约 3700）→ `stage:swipe` → **26921** `onSwipe`（4396）→ `sendSwipeAction` 发出 **`onSwipe`** action → **46501** 将积木 **`on_swipe`** 注册为 **Action** responder（122626）。动作名和积木类型名大小写/下划线不同，不可混为一项。

1. Hammer 模块 **4097** 明示版本 2.0.7。创建 Manager 时只装 Swipe recognizer、direction 设为 DIRECTION_ALL。
2. Swipe 默认配置是 distance threshold **10**、velocity **0.3**、pointers **1**；`attrTest` 要求距离严格大于阈值、绝对速度严格大于阈值、maxPointers 匹配且处于结束事件。源码使用 overall velocity；这不是“只要拖过 50 就触发”。
3. 只有 Hammer 已识别 swipe 后，编辑器读取事件 `deltaX = dx`、`deltaY = dy`，再判断：

| 发出的方向 | 精确条件（源码的有符号比较） |
|---|---|
| up | `dy < -50` 且 `dy < dx` |
| left | `dx < -50` 且 `dx < dy` |
| right | `dx > 50` 且 `dx > dy` |
| down | `dy > 50` 且 `dy > dx` |

这些条件是多个独立判断，发送顺序为 up、left、right、down，**不是** `abs(dx)` 与 `abs(dy)` 最大轴的互斥选择。例如静态代入 `dx=100,dy=-100` 同时满足 up 和 right；而 `dx=100,dy=100` 两者严格比较不成立。只有在真实 Hammer 事件到达且运行中时才会走此处；本轮没有用手势实测证明这些代入例在设备上产生几个帽执行。

注册的 Action responder 是非 entity_specific、`async:false`，按积木字段 `type` 过滤 action 的 value，且不配置 statefulness。这与键盘按下保持状态的帽不同。慢拖、多指、恰好 50、斜向相等、鼠标模拟手势及手势/点击并存都是待验案例。

## 5. 命中测试：矩形粗判 + 降采样纹理 alpha，不是单纯包围盒

定位：模块 **61248** 的 `pt.contains`（约 51600）、Actor 初始化 hitArea（约 64000）、`hit_test`（73906）、`is_touching`（78698）、`set_points_data`；模块 **1753** 的 `Ri` / `OX` / `$1` 辅助函数；模块 **18701** 的 `recursiveFindHit`（约 3180）。

- Actor `interactive=true`，自定义 hitArea 的 contains 先把局部点变到全局，调用 Pixi `actor.containsPoint` 做矩形粗判，再调用像素判定；舞台宽高一半被扣除，使点落入舞台坐标系。
- `hit_test(x,y)` 的独立报告器路径把 y 取负，再调用同一个 `is_touching`。碰鼠标报告器还会先要求目标是 Actor 且 visible。
- `is_touching` 缺少 current_style 或对应纹理颜色数据就返回 false。坐标经逆旋转、pivot/scale（包括负 scale）补偿并 round 后，进入降采样纹理坐标。
- **采样比例为 0.7**：1753 的宽高函数对原宽高乘 0.7 后 floor；点坐标也乘 0.7 后 floor。不能视作原图逐像素无损检测。
- 纹理数据来自将原 drawable source 画进此降采样 canvas，再 `getImageData` 包装为 Uint32Array 缓存；是否命中看采样元素的最高 8 位 **大于 0**，即非全透明。不使用“alpha > 127”之类阈值。
- `is_touching` 这条路径未读取 actor 的整体系数 alpha 或视觉效果 filter；它取的是原纹理采样数据。故不能宣称“角色透明度降至 0 自动不可点击”，也不能把视觉滤镜输出直接当此处掩码。真实交互还受父树/visible/命中目标约束，需分开实测。
- 边界代码比较的是 `x > width` / `y > height`，不是 `>=`；随后是一维数组索引。边缘 round、采样缩放、透明洞、纹理尺寸很小等应专门做差分，不应擅自将边界解释为标准半开矩形。
- 18701 的交互树先排除 invisible，子项按数组末端到开头查找，首次确定 target 后下层其他候选不再获得同等 hit；祖先仍走回调。因此证据支持“按层级选最上命中目标，再传播”的路径，**不支持向所有重叠角色广播点击**。实际场景容器排序、遮挡和克隆插入顺序仍需作品验证。
- `hit_test` 本身不会替调用者检查 visible，鼠标碰撞报告器在外层补了检查；不要把独立几何查询与完整 pointer 选择流程混同。

## 6. 状态更新顺序与可验证边界

模块 **8541** `send_action`（9746）在停止态不入队，否则把 action 加入队列。`update_actions`（约 13650）顺序为：处理 Action responder → 更新状态存储 → 检查 State responder → 检查 Dynamic responder → 清空 action 队列。模块 **9425** 每次状态更新先做自动过渡，再按队列顺序写入本次 action。

由此，**物理 DOM 事件次数、action 次数、帽启动次数不是同一个计数**。同一帧 down/up 合并、按住时同步帽重启、实体持续按下的 rAF 与运行器 rAF 先后顺序，都必须在真实运行器作品中观测，不能凭“发送两次 action”就宣称积木执行两次。

静态源码调查阶段没有（后续键盘/鼠标最小实测已见上节）：

- 与 NekoC 的 Rust/Web 输入实现比较；未作任何移植或实现注释。
- 自编 `.bcmkn` 作品编辑器检查、执行日志或帧级 oracle。
- 移动设备/触屏真机、触摸模拟、失焦/切场景/弹窗期间的输入验证。
- 穷尽懒加载 chunk、离线播放器或其他官方版本；URL 的 release 内容未来可能更新，应每次重新计算 hash。

可将上述来源固定与精确条件用于实现设计、生成只读 oracle 场景；**不能把已测试的键盘/鼠标最小规则推广成所有 KN 输入一致**。
