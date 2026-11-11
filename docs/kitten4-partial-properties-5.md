# K4 partial 第五轮：属性列表引用、惰性槽与无造型

## 选择与范围

`get_3` 在只读语料出现 2049 次，是第四轮遗留 partial 中最高频项；
`get_clone_index_property` 出现 162 次。相比物理求解器、在线云和跨平台滤镜，
这组 reporter 的列表引用、未知 UUID 和无造型 getter 可以独立实测和修复。
不移植官方实现，不使用第三方作品构建夹具，也未参考或移植 HateNeko。

## 官方实测与位置

外部只读包 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
定位按整个文件的 UTF-16 字符偏移（从 0 开始），不是字节偏移：

- `O8fc/UserVariableImpl.get_var_or_list`，约 497235：局部变量独立分派，
  全局缺失/nullish 值在读取时建立默认值；`get_variable` 的默认值是 0。
- `Tn6a/lt.get_3`，约 614282：UUID 属性经 runtime manager 取变量，
  非 UUID 属性经实体 getter；undefined 最终映射到 NaN。
- `Tn6a/Vt.get_scene_or_actor_property`，约 662539：角色无当前造型时
  style_index 没有返回值；场景背景仍返回 styles.indexOf(texture)+1；
  style_name 查找无匹配时没有返回值。

只记录源码定位和观察事实，没有复制官方函数或片段。固定包带 wrapper DI 暴露，
未独立认证它等同线上发布物，不将结果泛化到所有 K4 版本。

## 原创夹具和修复

生成器 `tools/compat/k4-partial-properties-5-fixtures.mjs` 只复用仓库原创骨架与
内联素材。八份夹具、每份 12 个实际 update，共 **96 官方帧**：

|夹具|实测约束|
|---|---|
|`get-list` / `get_2-list` / `get_3-list` / `get_clone_index_property-list`|UUID 属性返回原列表引用；property-based append 与普通 lists_get append 双向可见；此前已存进 result 的列表引用随修改同步变化；列表长度驱动角色 x=80→120→160|
|`get_3-lazy` / `get_clone_index_property-lazy`|等待期间未知 UUID 不存在；实际读取后原生 get_global_variable 可见 0；false 分支里的另一个 UUID 始终不存在|
|`no-costume-actor`|造型编号和造型名为 NaN；坐标、缩放、透明度和效果默认值不变|
|`no-costume-scene`|造型编号为 0，造型名为 NaN；不能与角色分支合并|

`docs/kitten4-partial-properties-5-evidence.json` 保存 fixture SHA-256、官方资源
SHA-256、每帧变量/角色、只读 `get_global_variable` 存在性和返回值类型。
NaN 另记录类型标签，不单凭 JSON null 推断。正常用例 runtime/page errors 均为空，
外网放行均为 0。

实现集中于 `src/engine/k4_properties.rs`；`src/engine.rs` 仅新增独立惰性槽状态、
重启清理及只读诊断/API 的接线，不改表达式编译结构、公共 chain 或调度。
已声明全局列表直接返回原 `Rc`，不是复制或字符串化。未知属性槽不在编译时创建，
重启清空；普通已声明数值/文本及局部变量继续走既有路径。

Rust 回归 `tests/kitten4_partial_properties_5.rs` 在默认 JIT 和禁用 JIT 下逐帧比较，
每种路径重启两次；比较 result、共享列表、角色坐标和未知槽存在性，原生 Cell
额外检查无造型结果确为 NaN。原 22 份属性夹具回归仍保留。

## 像素对比

同一八份原创夹具在 update **1/3/5/9/12** 逐帧截图，共 **40 对画布**，
每对 1280×720、921600 个有效像素，无 video mask、无 overlay、RGB 容差 8。
**全部 changedPixels=0、MAE=0、RMSE=0**，本组不只是容差内相似。
列表长度驱动角色位置，因此列表语义进入实际 VM 渲染输出；惰性槽的不可见状态
仍以只读观察为主要证据，不以白底像素替代状态验证。
事实摘要见 `docs/kitten4-partial-properties-5-pixels.json`，PNG 和运行输入仅位于
ignored `dist/partial-properties-5-pixels/`。

## 复验

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:CARGO_BUILD_JOBS='1'
node tools/compat/k4-partial-properties-5-fixtures.mjs --record --visual
cargo test --test kitten4_partial_properties_5 --test kitten4_partial_properties
node --test tests/k4-partial-properties-5.test.mjs
```

## 保留 partial / 未验证

- 非有限位置/缩放污染底层场景、iOS ASCII、复杂效果/物理体、删除克隆与同帧
  读取竞争仍**未验证**，不能将四个类型全部去 partial。
- 初始声明 value=null 会在该离线包 project-assets 阶段超时，本轮没有将其算作
  正常帧，也没有凭源码推断修改全局 nullish 读取策略；这部分**未验证**。
- 未声明 UUID 同时被普通变量写入、跨场景/云变量/局部变量与该 UUID 冲突，
  以及更多无效资源 ID，不由这八个夹具证明。普通编译槽与 property 的同名查找
  保持共享，但其所有惰性分配时机仍**未验证**。
- 无造型证据仅覆盖 styles=[]、current_style_id=""；未知非空资源、异步加载失败
  及其他版本加载策略**未验证**。
- 96 帧和 40 对像素一致仅适用于本页固定包、输入、采样窗口，不等于全语料兼容率。
