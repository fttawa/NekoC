# KN 部分语义削减：频率优先的非硬件修复

## 范围与结果

基线 `e63147f` 的117个部分语义项按[自有作品静态频率](kn-partial-priority.md)排序：
`convert_type` 在样例/项目出现6次，`mouse_down` 1次；克隆属性仅在回归夹具出现7次，
timer各1次。频率不代表运行次数，PENCRAFT重复版本及游离积木都单独注明。
HateNeko只用作名称/参考实现清单，不作官方行为证据；本轮没有移植HateNeko逻辑。

- `mouse_down`、`get_clone_index_property`：消除已知局部限制，改为**有执行路径／未完整验证**。
  这是覆盖表状态，不是完整兼容认证。
- `convert_type`：修复深度截断、循环列表、共享引用、非函数`toString`错误，
  见[转换专项](kn-partial-conversion.md)，因仍缺callable值/原型等保留部分语义。
- 其余非硬件服务、定时器和外观/气泡项不以空缓存/已有路径冒充完成；保留部分语义。
- **60个硬件扩展项全部保留部分语义**，逐项剩余差异仍在覆盖表和
  [kn-remaining.md](kn-remaining.md)：设备通信/真实传感器/事件后端未实现，
  仅无连接降级；Promise微任务与复杂调度组合仍未验证。

## 官方证据与复现

使用 `tools/semantics-kitten-n.mjs::probe` 加载完整原创工程，点击官方开始，
等待`done=1`后读取所有变量；没有替换域函数体。额外局部调用与浏览器鼠标观测
分别列在`domainCalls`/`pointerSamples`，不混称原生工程执行结果。

- URL：`https://kn.codemao.cn/editor`，editor-compat记录版本 **0.27.4**。
- 原创工程：`tests/fixtures/kn-semantics/partial-clone.bcmkn`。
- 结果及同SHA-256编辑器检查：`docs/kn-partial-official.json`。
- main：`main.8ccf2442.js`，SHA-256
  `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`。
- runtime：`crc_libs.8196dbd1.js`，SHA-256
  `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7`。
- 官方源码锚点（UTF-8零基byte）：main **1560338** 克隆查询、**1897852** 公共属性、
  **1576944** 鼠标域函数；具体既有定位见`kn-appearance-dialog.md`和`kn-pointer.md`。

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
node tools/compat/kn-partial-probe.mjs --generate
node tools/editor-compat.mjs tests/fixtures/kn-semantics/partial-clone.bcmkn --channel msedge --out dist/kn-partial/editor-compat.json
cargo build --bin kn-trace
node tools/compat/kn-partial-probe.mjs --archive
node --test tests/kn-partial.test.mjs
cargo test --test kn_partial --test kn_pointer --test actor_variables
```

只有完整变量匹配、无pageErrors、原生与官方均`done=1`、editor-compat同hash且
0.27.4成功时才允许归档。官方原始bundle只在忽略的`dist/`中，不入库。

## 修复细节

### 克隆属性

此前KN复用了历史数字编码，`0/1/2/4`被当作x/y/造型/名称，
导致官方`0..6`特效语义错误；x/y未做两位舍入，string/bool索引被数值强制转换。

新`kn_appearance::CloneProperty`保存带类型的索引：只接受number；0读原型，
正整数读对应克隆，文本`"1"`、true、负数、分数和缺失索引均为numeric NaN。
`0..6`现在统一读KN特效，命名坐标/宽高/方向/造型走公共getter，
UUID私有变量保留类型及克隆快照。原创工程覆盖14属性×原型/克隆、
原型99/克隆42私有值，以及5种非法索引。

官方局部调用确认`camp/distance/unknown/7/?`均NaN，本地不再编译拒绝或误读历史码。
scene查询fallthrough为undefined另经官方局部调用确认；不称作完整工程已实测。

透明度12.345的官方getter为12.34而非12.35：写入按`(100-v)/100`，
再按lodash十进制移位round。修复本地写入算式与Math.round模拟的二次舍入，
保留K4旧分支。`kn-trace`补充带类型私有变量观测，避免把仅支持全局的getter
返回null误报为语义不一致。

### 鼠标

非法角色/占位目标不再令整个工程编译失败，而返回boolean false；
官方局部调用与源码验证这一返回值。本地保留screen/当前实例/指定角色及其克隆区别。
完整工程验证无输入的9个boolean结果；独立浏览器观测验证screen held-down，
释放后pulse可能已过，**不按80ms采样声称准确click/up相位**。
本地回归继续覆盖down持有、up/click单帧pulse、restart及克隆目标。

## 未完成、风险与未验证

- 不复刻官方错误提示UI、警告积木高亮；非法JSON编译与官方交互编辑不是同一契约。
- 鼠标触摸/失焦、拖出舞台、隐藏/删除目标、跨场景及完整事件先后仍未验证。
- 克隆文本造型的保存缩放、跨场景、克隆删除/重新创建生命周期仍未验证。
- 其他特效写入的完整夹取/非有限/渲染差分不在本轮；有限14属性读回不等于全部渲染兼容。
- 转换异常线程停止/警告UI、callable原型和宿主服务仍未完成。
- JIT-enabled回归只证明开启JIT时可执行，不表示每个新helper都进入native热路径。
