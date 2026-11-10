# K4 text_indexOf 与媒体默认 reporter 第二组离线证据

新增独立生成器、原创 K4 `.bcm` 夹具、证据和 JS/Rust 测试；主会话已集成
`src/engine.rs` 的 TextIndex 数组分支。**保留 partial**。

## 只读官方定位

`K4_PLAYER_DIR=E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`，只读
`src/player/build/player_v2.2d180c468559fbd29528.js.orig`。
SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
偏移为 JS 解码字符串下标；不复制第三方实现或语料：

| 偏移（约） | 观察 |
| --- | --- |
| 1645599，oiyH/text_indexOf | FIRST/LAST 分别调用 VALUE.indexOf/lastIndexOf，然后加 1；没有 VALUE 类型保护或字符串化；无效 END 返回 undefined |
| 605546，Tn6a/translate_result | falsy text 走异步空字符串返回，不请求翻译 |
| 642021，get_recognition_result | 桌面读取扫描控制器结果，未扫描为空字符串 |
| 1772479，midi_get | 每次返回包含 id 属性的对象，id 来自 midi 参数 |
| 1772519，get_voice_answer | 未录音识别的空结果返回空字符串 |

`.orig` 带包装器 DI 暴露点，未独立认证等于线上发布版本。

## 夹具和实测

生成器：`tools/compat/k4-partial-text-2-fixtures.mjs`。
保存：`tests/fixtures/kitten4/partial-text-2-*.bcm`。
证据：`docs/kitten4-partial-text-2-evidence.json`。

`text_indexOf` 不在当前编辑器 block schema 中。生成器使用原创最小 legacy workspace descriptor
（以仓库 text block 的通用 workspace 属性为基础，只声明 END、VALUE、FIND），让官方
JSONEntityCompiler 真正编译并执行；不是从外部作品或内核抽取积木定义。

9 组分别录制；3 个正常组完成共 18 帧，6 个预期错误组在首帧完成前报错（完成 0 帧）。
全部无 pageErrors，外部请求动作全部 blocked，无凭据、无素材放行、无录音/扫描/硬件命令。
完整请求记录与错误 annotation 保存在证据 JSON，夹具 SHA-256 可复算。

### 字符串搜索：search（3 帧，26 个 reporter）

FIRST/LAST 都覆盖：重复/重叠匹配、未找到、比原串长、大小写敏感、组合字符、
中文加 emoji 的 UTF-16 位置、空 VALUE/空 FIND、number/bool/array FIND 隐式转换。

关键实际结果：

- `"ababa"` 找 `"aba"`：FIRST=1、LAST=3。
- `"猫😀abc😀"` 找 `"a"`：4；找 `"😀"`：FIRST=2、LAST=7。
- `"😀"` 找空串：FIRST=1、LAST=3（UTF-16 长度 2，再加 1）。
- 空串找空串：FIRST/LAST 都为 1；未找到为 0。
- `"x12x12"` 找 number 12：FIRST=2、LAST=5。
- `"truefalse"` 找 bool false：5。
- `"za,bza,b"` 找数组 `["a","b"]`：FIRST=2、LAST=6。

这里验证完整代理对及 UTF-16 code-unit 位置，不声称孤立 surrogate 字符串可被 Rust 精确表示。

### 数组 VALUE：array-value（3 帧，10 个 reporter）——发现真实缺口

官方并非“所有非字符串 VALUE 都报错”：数组也有 indexOf/lastIndexOf，执行的是严格类型的数组搜索。

- `text_split("a/b", "/")` 找 `"b"`：2；找不存在或空串：0。
- 官方 `text_split("1/2/1", "/")` 结果含 number（该 splitter 自身会转换数字项）；
  找 number 1：FIRST=1、LAST=3；找 string `"1"`：0。

原 `src/engine.rs::ValueExpr::TextIndex` 先要求 `Cell::Text`，数组会错误地失败。
**现已修复**：

1. 保留 VALUE/FIND typed evaluation。
2. VALUE 是 `Cell::List` 时，在数组原项上用严格 equality 查找 needle；FIRST 用 position，
   LAST 用 rposition，找到返回 index+1，未找到 0。
3. 该分支绝不把数组或 needle 转字符串，也不要用 K4 内容深相等替代 JS indexOf 的严格相等。
4. VALUE 是字符串时保持现有 UTF-16 与 FIND 字符串化规则；number/bool/普通对象继续报错。
5. 对应 Rust 测试已移除 known-gap ignore，纳入两种模式回归。

错误组另揭示赋值副作用：原 VM 在 reporter 设置 value_error 后仍把 Null 写入目标。
现已让 `Op::SetValue` 在 value_error 存在时跳过写入，保证失败赋值与 next 均不执行。
该规则有六组官方部分状态观察以及默认/禁用 JIT 回归，不仅检查错误字符串。
全量热 JIT 差分回归另检查列表越界：`h_assign_item` 与 numeric SetValue 生成路径
也必须在错误时跳过赋值，避免只有 cold side-exit 正确、hot native path 仍覆盖原值。

### 非字符串非数组 VALUE：6 个错误组

number、bool、midi_get 对象，分别 FIRST/LAST。
官方全部报 `HEART.SYSTEM`，annotation.block_type 为 text_indexOf；没有完成首帧。
只读错误边界 hook 记录：`before=1`、`result="unexecuted"`、`after="unexecuted"`。
因此证明失败赋值及 next 都未执行，不把 0 帧失败当作正常结果。

Rust 测试不要求内部错误字符串与官方完全一致，要求本地 type error 且相同部分变量状态；
默认 JIT 与禁用 JIT 各检查一次。

### 媒体默认值：media-defaults（12 帧）

- 未识别 voice、未扫描 scan：`""`。
- translate_result 的 text 为 `""`、number 0、bool false：`""`；没有调用真实翻译。
- midi dropdown `"60"` 返回对象 `{"id":"60"}`，转字符串为 `[object Object]`。
- 两个独立 midi_get 的 K4 logic_compare EQ 为 true（K4 内容比较，不是 JS `===` identity）。
- 最后 done=1，保证异步结果都已完成，不把还没执行的 sentinel 当默认值。

空 translate_result 仍是 async reporter。该组合官方第 4 帧 done=1，本地可能同步给值，
**Rust 只检查第 12 帧最终值，不验证调度等价**。非空翻译、缓存/失败回退、真实识别数据、
MIDI 发声、硬件配对及线上服务不在本轮范围；这些 reporter 不据此泛称完整支持。

## 回归

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-text-2-fixtures.mjs --record
node --test tests/k4-partial-text-2.test.mjs

# 交主会话统一执行；本轮未启动 Cargo
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:CARGO_BUILD_JOBS='1'
cargo test --test kitten4_partial_text_2 -- --nocapture
```

- 最终 JS **2/2 通过**，包含夹具再生成相等、SHA-256、网络隔离、正确值、错误首帧与部分状态检查。
- Rust 新增 4 个专项测试（无新增 ignored），每个都包含默认 JIT/禁用 JIT；最终结果见未提交 OC-REPORT.md。
- 不移除 partial：无效 END、孤立 surrogate、null/undefined 搜索参数和媒体在线/硬件分支均未完整验证。
