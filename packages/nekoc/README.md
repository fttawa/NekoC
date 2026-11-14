# @nekox-lab/nekoc

用 Node.js 或浏览器把 TypeScript 编译为 Kitten N `.bcmkn`，检查代码、运行作品。
使用已构建的包**不需要 Rust、cargo 或原生扩展**。本包暂不发布。
运行时 npm 依赖只有 TypeScript。官方编辑器兼容检查另需开发环境提供 Playwright
及可用浏览器，不是本包的运行时依赖。

## 构建（仅维护者需要 Rust）

需要 wasm32-unknown-unknown target 和与 `Cargo.lock` 同版本的 wasm-bindgen CLI
（`cargo install wasm-bindgen-cli --version <版本> --locked`；不在 PATH 时用 `WASM_BINDGEN`
指定路径，版本不符直接报错）。在仓库根目录 `npm ci --ignore-scripts` 后，在此目录执行
`npm run build`：cargo 构建 `nekoc-wasm`，wasm-bindgen 生成 nodejs / web 两套绑定，
再复制 TypeScript 前端和类型检查用的声明文件到 `dist/`。
`npm pack --ignore-scripts` 可以检查独立分发包。无 postinstall，不在用户机器编译 Rust。

## Node.js 22+

```js
import { compile, check, createPlayer, importProject, validate } from '@nekox-lab/nekoc';

const files = { '/main.ts': 'onStart(() => { console.log("hello"); });' };
console.log(check('/main.ts', { files })); // { ok, diagnostics }
const { bcmkn, report } = compile('/main.ts', { files });
// bcmkn 是可 JSON.stringify 的作品对象；report 是前端 workspace report。
// template 可选：作品对象或 JSON 文本，默认内嵌 kitten-n-0.27.4 模板。
console.log(validate(bcmkn));
const { project } = importProject(bcmkn);
const player = createPlayer(project);
try {
  console.log(JSON.parse(player.ready()));
  const frame = player.handle({ dt: 1 / 60 }); // Uint8Array
  const snapshot = player.handle({ debug_snapshot: true }); // JSON 文本
} finally {
  player.free(); // 必须显式释放会话
}
```

`files` 支持对象或 Map，路径按区分大小写的 POSIX 虚拟绝对路径处理，
相对路径基于 `/`。入口和相对 import 完全从 files 读取，不访问真实文件系统。
check 包含 TypeScript 类型检查及 NekoC 兼容性检查，内置 NekoC 和 TS 标准声明。
二进制帧沿用 [player SDK 协议](../../docs/player-sdk.md)。

## 浏览器

支持 browser export condition 的 bundler 可直接导入同一个包；也可显式导入
`browser.mjs`。需要支持 ES modules、top-level await、WebAssembly，部署时保留
`dist/web/nekoc_wasm_bg.wasm` 并让 bundler 处理该 URL。TypeScript 是唯一 npm 依赖；
浏览器宿主的解析与类型检查不使用 Node fs。当前不切换仓库网页播放器。

## CLI

```sh
nekoc check main.ts --json
nekoc build main.ts -o main.bcmkn
nekoc run main.bcmkn --frames 120
```

源码 checkout 中可用 `node packages/nekoc/bin/nekoc.mjs ...`。run 是无头运行，打印日志，
不会显示舞台、播放声音或提供设备输入。wasm 不含 JIT、HTTP 服务、文件监听、子进程、
文件云存储；原生 Rust 默认仍有 JIT。wasm 深层递归受 WebAssembly 固定栈限制，
不支持原生 stacker 扩栈。时间预算是实际执行时钟预算，不保证逐帧与原生调度相同。

## 测试

先 build，再 `npm test`。集成测试调用 Rust CLI 对比产物和 `nekoc check --json` 的诊断，
属于维护者测试，不是用户运行依赖；根 CI 的 `wasm` job 会执行构建和这些测试。
样例产物连同积木 ID 都与原生 CLI 完全一致（组装器复用同一函数，ID 生成确定性），
测试不删除 ID 或弱化结构断言。播放器测试比较固定帧数内的日志序列，不断言墙钟耗时。
