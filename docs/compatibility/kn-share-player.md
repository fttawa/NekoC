# Kitten N 分享播放器积木支持审计

取得日期：2026-11-14。结论只适用于下列固定字节，不代表后续 CDN 版本。
类型清单见 [kn-share-player-blocks.json](kn-share-player-blocks.json)，
完整差集、编译器类型清单、扫描结果及受控观察见
[kn-share-player-audit.json](kn-share-player-audit.json)。没有保存官方实现代码。

## 来源与方法

分享入口：`https://kn.codemao.cn/player?workId=0`。
无效作品号是有意使用的，不需要下载或发布第三方作品。
该页直接加载的 bundle 与 `/editor` 不同：

| 运行时 | 资源 | SHA-256 |
|---|---|---|
| 分享 | `main.0f3db563.js` | `42841119872219828a193880c7261774643e05e14848be58e6679d78b9add827` |
| 分享 PC 平台 chunk | `729.2da90667.chunk.js` | `5318c36868600e5864642a0a575a82b8f816c508667299b79e6c6a7ad9e3eec8` |
| 分享页异步 chunk | `375.04754b49.chunk.js` | `bdaef7439c398afa0b69da430096834ee55d69d783787657f05ae6dc53f15200` |
| 编辑器 | `main.8ccf2442.js` | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| 编辑器 Heart | `crc_libs.8196dbd1.js` | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` |
| 编辑器依赖 | `main-vendors.07f7dd7e.js` | `38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68` |

所有资源 URL 的共同前缀为：
`https://creation.bcmcdn.com/neko/web/release/static/js/`。
完整 URL、字节数、原始 bundle 字符偏移均在 JSON 中。
历史 `docs/kitten-n-source-audit.json` 的 main 哈希与本次当前编辑器 main
不同，本次没有冒称重现历史字节；Heart 与依赖哈希相同。

刷新工具匿名下载资源，原字节仅缓存于忽略的 `dist/knshare/refresh/`。
浏览器响应临时暴露 webpack loader、原生入口函数，观察 `RegistryImpl.register`；
创建 canvas，调用原生 `loadPlatform(); initRuntime(initStage());`，
随后读取**最终实例**的 `get_domain_function_types()`、responder 和 metadata 表。
未添加 handler，未使用另一实现代替官方 VM，未登录、未发布或提交 POST。
编辑器注册表由正常编辑器页面初始化得到。

分享实测：247 个 domain、8 个 responder，去重并集 252。
另外从直接编译分派表补齐 26 个尚未在该并集里的结构/原子类型，合计 **278**。
`procedures_2_stable_parameter` 单列为 **1 个参数元数据类型**，不是可执行 handler。
不能把所有 bundle 字符串都当作支持类型，也不能把缺少 domain 项直接当成不支持：
`math_number`、`text` 无同名 domain，但由原子节点编译路径处理且阳性对照可执行。
同理 `EVENT_BLOCKS` 中的名字**不自动补入清单**：`compile_event` 仍调用
`compile_domain_functions`，需要 handler；已注册的事件从实际注册表收集。

### 官方源码定位

偏移为未经插桩的 UTF-8 解码 JS 字符串、从零开始；这些定位处的字符/字节偏移相同。

| bundle | 位置/函数 | 字符偏移 | 用途 |
|---|---|---:|---|
| 分享 main | `RegistryImpl.register` | 4797824 | domain/responder/metadata 注册入口 |
| 分享 main | 插件注册函数 `k` | 2245717 | 把应用插件 domain 与事件绑定到 Heart |
| 分享 main | `get_domain_functions` | 4646572 | Heart 基础 domain 集合 |
| 分享 main | `BlockPredicatesImpl` 模块 | 4661771 | 结构/原子类型分派 |
| 分享 main | 常量模块 79224 | 4666739 | LOOP/IF/PROCEDURE/HAT/ATOMIC/SPECIAL 表 |
| 分享 main | `JSONEntityCompilerImpl.parse_kind` | 4675800 | 非特殊节点落入 domain 路径 |
| 分享 main | `json_procedure_2_definition_to_json` | 4679404 | 消费 stable parameter 元数据，不执行参数定义节点 |
| 分享 main | `compile_domain_functions` | 4768279 | 缺少 domain index 时产生 missing-domain 错误 |
| 分享 main | 原生 `yu` / `vu` / `au` | 12101464 / 12101626 / 12097644 | Heart/舞台/平台初始化 |
| 分享 main | webpack loader 暴露点 | 11196772 | 诊断访问模块导出 |
| 编辑器 crc_libs | `RegistryImpl.register` | 970926 | 编辑器实际注册观察点 |
| 编辑器 main | `_object_literal` handler 属性 | 2962498 | 返回由 key/value 插槽构成的对象 |
| 编辑器 main | `_object_get` / `_object_set` handler 属性 | 2960709 / 2960812 | 对象取值/赋值实现，实际也已注册 |

清单只声明积木可用路径，不证明每个参数、错误分支、联网 AI、设备或画布行为一致。
可选硬件扩展及其他工具模式未加载，不在本次默认播放器注册集合的认证范围。

## 对象结论与运行观察

**三个 `_object_*` 在该分享运行时缺失 handler，不是已发现的“同名 handler 行为不同”。**
分享主包中的同名字符串来自 TS/JS 与积木转换器，不能抵消运行注册缺失。
当前编辑器实际注册表有这三项，且 main 中可定位对应实现。

Playwright（headless `msedge`）在真实分享页上下文中注入仓库自有最小 JSON，
走原生 `HandlerApi.playerLoadBcm`、`compileEntities(getUncompiledEntities())` 和
runtime `start(compiled)`。每项单独运行，以免第一个错误遮蔽后续积木。

| 探针 | 实际观察 |
|---|---|
| 阳性对照 | `before=17, result=2+3=5, done=1`，无运行错误 |
| `_object_literal` | `HEART.CLIENT`，错误 6，`No domain function of this type exists`，`ns_id=_object_literal` |
| `_object_get` | 同错误，`ns_id=_object_get` |
| `_object_set` | 同错误，`ns_id=_object_set` |
| `logic_ternary` | 同错误，`ns_id=logic_ternary`；独立输入为 true/23/42 |
| `math_trig_rad` | 同错误，`ns_id=math_trig_rad`；独立输入为 atan(1) |

五项错误的 `caught_at` 都是 `compile_domain_functions`，启动/spawn 时发生，
在 hat body 执行前终止。`lint` 对这些输入反而都没有报错，故 lint 成功不是支持证据。
原始输入 hash 和观察数据保存在审计 JSON；第三方函数体不入库。
原四个输入与补充三个输入（含各自阳性对照）共七份作品均经
`tools/editor-compat.mjs` 检查，**7/7 `ok:true`**、63 个积木，issues/pageErrors 均为空。

这是**官方分享运行时的受控本地注入实验**，不是把作品发布后打开真实 workId 的实测。
公开发布端到端、移动端、完全断网浏览器加载、未来 bundle 均为**未验证**。

## NekoC 影响与建议

从 `ts/compile-ts.mjs` 的 `type:` 字符串、条件分支、type 参数 helper 调用及
XML type 属性收集并排除字段枚举/过程元数据，共 177 个静态积木类型候选。
其中与本清单不相容的完整列表共 **5 个**，按实际作品覆盖和影响排序：

| 优先级 | 类型 | 影响/建议（本任务不改编译器） |
|---|---|---|
| 1 | `logic_ternary` | 样例 9 处，`projects/fangjie/fangjie.bcmkn` 37 处；建议以临时变量加 `controls_if` 分支降级，注意惰性求值和副作用顺序 |
| 2 | `_object_literal`、`_object_get`、`_object_set` | 普通 TS 对象会直接依赖它们；`js_compat` 分别 9/19/13 处；交给 knobject 任务处理对象表示和读写降级，须保留别名/嵌套/副作用语义 |
| 3 | `math_trig_rad` | `js_compat` 3 处；建议按 sin/cos/tan 与反三角分支正确转换度/弧度，并验证 atan2、NaN 等边界 |

扫描：

- 递归 45 个样例 TS 文件：43 个入口编译成功；`samples/typed_self_api.ts` 失败
  （`Expected a block arrow callback at offset 487`），`samples/project/lib/math.ts` 为库模块不单独构建。
- 43 个产物：42 个静态检查通过；仅 `js_compat.bcmkn` 含上述全部 5 类缺失。
- `samples/` 已有 10 个 `.bcmkn`：全部静态检查通过。
- `projects/` 的 16 个 `.bcmkn`：15 个静态检查通过；fangjie 包含 37 个 `logic_ternary`。
- 样例实际生成 161 种类型，都包含在静态候选集合中。

额外执行全部 43 份产物的官方编辑器兼容检查：**38 通过，5 失败**。
既有 `control_flow`（tell/sync_tell）、`event_bump_received`（on_bump_actor）、
`motion_actor`（self_rotate_around）把 `sprite=--self` 改为 `?`；
`lists` 的 delete_list_item、`sensing_input_time` 的 dispose_clone 有连接被改写。
没有修复或伪称这些产物可交付；原始结果在审计 JSON 的 `sampleEditorCheck`。
本任务不改生成器，这也说明“静态清单通过”不等于“编辑器/分享完整兼容”。

动态 `spec.type`、字符串拼接等没有完整跨过程求值；“全部 5 个”指本次静态可收集集合
及已编译样例，不宣称对未来动态生成路径进行形式化证明。扫描路径、每类次数和所有
177 个候选名在审计 JSON 中。`projects/` 的作品内容没有复制到跟踪路径。

## 编辑器与分享集合的完整差异

本次当前编辑器：425 个 domain、8 个 responder；分享：247 个 domain、8 个 responder。
**178 个 editor-only domain，0 个 share-only domain，responder 集合相同。**
其中 `math_number`、`text` 在分享中由结构路径接受，不能报不支持。
扣除这两项后，下列 **176 个类型**没有本次分享注册/结构执行路径。
这是集合差异证据，并非每一项都独立做过运行实验。
旧 420 项编辑器源码审计集合与分享清单的另外一份完整差集（175 项）在
审计 JSON 的 `oldEditorAuditMissing`；它混有代码 API 名，不等价于本次真实 handler 差集。

```text
Array.concat Array.filter Array.forEach Array.from Array.includes Array.indexOf
Array.isArray Array.join Array.lastIndexOf Array.map Array.of Array.pop Array.push
Array.reverse Array.shift Array.slice Array.splice Array.unshift

Date.UTC Date.constructor Date.getDate Date.getDay Date.getFullYear Date.getHours
Date.getMilliseconds Date.getMinutes Date.getMonth Date.getSeconds Date.getTime
Date.now Date.parse Date.setDate Date.setFullYear Date.setHours Date.setMilliseconds
Date.setMinutes Date.setMonth Date.setSeconds Date.setTime Date.toDateString
Date.toISOString Date.toJSON Date.toLocaleDateString Date.toLocaleString
Date.toLocaleTimeString Date.toTimeString

JSON.parse JSON.stringify

Math.E Math.LN10 Math.LN2 Math.LOG10E Math.LOG2E Math.PI Math.SQRT1_2 Math.SQRT2
Math.abs Math.acos Math.acosh Math.asin Math.asinh Math.atan Math.atan2 Math.atanh
Math.cbrt Math.ceil Math.clz32 Math.cos Math.cosh Math.exp Math.expm1 Math.floor
Math.fround Math.hypot Math.imul Math.log Math.log10 Math.log1p Math.log2 Math.max
Math.min Math.pow Math.random Math.round Math.sign Math.sin Math.sinh Math.sqrt
Math.tan Math.tanh Math.trunc

Number.EPSILON Number.MAX_SAFE_INTEGER Number.MAX_VALUE Number.MIN_SAFE_INTEGER
Number.MIN_VALUE Number.NEGATIVE_INFINITY Number.NaN Number.POSITIVE_INFINITY
Number.isFinite Number.isInteger Number.isNaN Number.toFixed Number.toPrecision
Number.toString

Object.assign Object.entries Object.hasOwnProperty Object.keys Object.toString
Object.values
RegExp.constructor RegExp.create RegExp.exec RegExp.test

String.charAt String.charCodeAt String.codePointAt String.concat String.endsWith
String.includes String.indexOf String.lastIndexOf String.match String.matchAll
String.padEnd String.padStart String.repeat String.replace String.replaceAll
String.search String.slice String.split String.startsWith String.substr
String.substring String.toLowerCase String.toUpperCase String.trim String.trimEnd
String.trimStart

_array_literal _execute _object_get _object_literal _object_set _variable_get
_variable_set ai_text_actor ai_text_photo ai_text_result ai_text_result_check
atob btoa clearInterval clearTimeout console.error console.info console.log
console.warn isFinite isNaN logic_ternary logic_to_boolean math_add_assign
math_decrement math_div_assign math_increment math_mod_assign math_mul_assign
math_sub_assign math_trig_rad parseFloat parseInt setInterval setTimeout
```

## 使用与刷新

```powershell
node tools/compat/kn-share-player-check.mjs path/to/work.bcmkn
$env:NEKOC_NODE_MODULES = 'D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-share-player-refresh.mjs --channel msedge
node --test tests/kn-share-player.test.mjs
```

刷新只更新分享清单；本次编辑器对比、运行观察和扫描是单独的历史证据，不随刷新自动背书。
发现原生入口/注册接口变化时脚本会拒绝继续，须重新审计适配器，不能把字符串检索当作回退。
