# 评分卡：官方 KN 七项探索计时方法

日期2026-11-12；NekoC基线`da8dc9c5c414a4b32c9239c33df437d6d8322cf1`。
这是本轮新增的**测量用本地脚本**，不修改NekoC运行时，不是沿用历史正式runner的复测。
仓库此前只有K4性能runner、KN语义probe、KN编辑器结构检查与第三方HateNeko/转换链计时。
因此任何这里得到的数字都不得替代“历史相同方法的官方KN七项性能”或直接授予跨内核倍数。

## 输入与复现入口

1. 先按[评分卡H命令](scorecard.md#测量身份复现命令与口径)或`--prepare-only`生成七份原创`.bcmkn`，
   `dist/bench/scorecard/hateneko/editor.json`须为官方编辑器`ok=true`。
2. 本轮本地脚本为`dist/scorecard-kn-official.mjs`，执行命令：
   `node dist/scorecard-kn-official.mjs`，输出`dist/bench/scorecard/kn-official/results.json`。
   完整本地脚本只在忽略目录；关键可重建流程如下。它不含官方源码或第三方作品。
3. Node用仓库`loadPlaywright()`，每个探针三次**全新Edge浏览器**，1440×1000、headless。
   调用前用`tools/bench/hateneko.mjs::assertIdle`检查竞争任务。
4. 输入仍为原始作品字节及SHA-256，不缩小循环、修改参数或修补官方域函数。
   空闲guard中断后，本地脚本读取已有报告，核对revision/method/输入hash，仅跳过已有repeat；
   每个新repeat仍启动全新浏览器。只增加恢复调度，不修改已有样本、计时包装或官方运行设置。

## 浏览器装载

复用`tools/compat/kn-hateneko-official-probe.mjs`中已使用的官方入口：

- 拦截`/static/js/(main|crc_libs).*\.js`，先`route.fetch()`并保存原始资源hash。
- 只在main的webpack bootstrap `var __webpack_exports__=`之前暴露
  `window.__nekocRequire=__webpack_require__`；不替换任何domain、配置、时钟或随机函数。
- 通过`https://kn.codemao.cn/editor?previewUrl=...`加载原始输入，preview URL由route返回作品JSON。
- 等待`__nekocRequire(91107).BcmInstance.getBcm().projectName`匹配、canvas出现、init-loading结束。
- 隐藏编辑器`#DialogContainer`，如有“完成”按钮先关闭；通过真实UI“开始”启动作品。

版本门禁使用已有官方归档的两个原始bundle：

| 资源 | SHA-256及出处 |
|---|---|
| `main.8ccf2442.js` | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`，见[KN覆盖表](kn-block-coverage.md) |
| `crc_libs.8196dbd1.js` | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7`，见[KN warp官方归档](kn-warp-official.json) |

作品模板`version=0.27.4`本身不是运行内核版本认证；两个bundle都匹配才给`status=ok`。
hash不符、pageerror、加载失败、超时均留在原始结果，不把耗时记为0或删除该次。

## 唯一计时包装

在点击“开始”前定位：

```js
const req = window.__nekocRequire;
const core = req(26921).cG.get_instance().getHeart().core;
const manager = core.get_runtime_manager().run_mgr;
const original = manager.update;
const sample = { frame_ms: [], warmup_ms: [], done: false };
manager.update = function (...args) {
  if (sample.done) return; // 仅在最后测量完成后冻结后续VM update
  const before = this.frames;
  const start = performance.now();
  const result = original.apply(this, args);
  const ms = performance.now() - start;
  if (this.frames !== before) {
    if (sample.warmup_ms.length < 10) sample.warmup_ms.push(ms);
    else sample.frame_ms.push(ms);
    if (sample.frame_ms.length === 60) {
      sample.done = true;
      sample.final_frame = this.frames;
      // encode recursively copies values now, preserving undefined/nonfinite
      // as {$undefined:true}/{$number:"NaN"|"Infinity"|"-Infinity"}; cycles
      // become {$cycle:true}. No runtime list references are retained.
      sample.variables = Object.fromEntries(
        Object.keys(req(91107).BcmInstance.variablesDict)
          .map(id => [id, encode(manager.get_variable(id))])
      );
    }
  }
  return result;
};
```

上述`encode`按数组/对象递归建立脱离运行时引用的新值，活动路径集合检测循环。
计时只包围原始同步`update`调用；采样数组分配、变量快照在计时结束之后。
不启用逐积木/逐循环observer，不对每帧导出全状态，不手动触发GC。
达到10预热+60有效update后冻结后续VM update，仅为了防协议往返期间终态继续变化；
这个结束动作仍可能影响随后渲染回调，因此不作像素或完整真实播放器时序认证。
每次记录`core.get_util().config.get()`，保留默认墙钟/warp切片，不设deterministic。

## 必须保留的不可比边界

- KN默认rAF与4ms warp墙钟切片未改为K4那样的受控连续rAF，也未改为NekoC固定dt。
  浏览器负载和编译热身可能改变一帧实际工作量，参见[官方warp证据](kn-warp.md)。
- 同一输入、相同update数、相同终值都不能自动证明相同迭代/过程调用/克隆次数。
  特别是收敛数值、每批重置字符串/列表可能遮蔽少执行的批次。
- 变量仅是**第70次有效update后的声明变量、未指定owner读取**，立即脱离引用；不是完整终态。
  actor/clone数量、属性、按owner私有值及生命周期均**未采集／未验证**。
  没有像素、声音、输入、任务栈或别名的配对。
- 本探索不发布导入/内存比；浏览器rAF外层绘制未纳入同步update计时，但同步画笔处理仍在内。
- 报告每次均值与三次中位数，保留所有运行状态和终值，不剔除慢帧或失败。
  该结果只填评分卡的“探索测得／正式等工作量未验证”栏，不升级全面兼容或性能领先。
