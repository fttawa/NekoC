# 安装预编译版

不需要 Rust。到 GitHub **Releases** 下载对应系统的包和同一 Release 的 `SHA256SUMS.txt`。

| 系统 | 文件 |
| --- | --- |
| Windows x64 | `nekoc-<版本>-x86_64-pc-windows-msvc.zip` |
| Windows ARM64 | `nekoc-<版本>-aarch64-pc-windows-msvc.zip` |
| Linux x64 | `nekoc-<版本>-x86_64-unknown-linux-gnu.tar.gz` |
| Linux ARM64 | `nekoc-<版本>-aarch64-unknown-linux-gnu.tar.gz` |
| macOS Intel | `nekoc-<版本>-x86_64-apple-darwin.tar.gz` |
| macOS Apple Silicon | `nekoc-<版本>-aarch64-apple-darwin.tar.gz` |

- Linux 包是 glibc 动态链接版本，在 Ubuntu 22.04 上构建，不适用于 Alpine / musl。
- macOS 最低 11.0。Windows 使用 MSVC 构建，缺 VC 运行库时安装 Visual C++ 2015–2022 Redistributable。
- 包没有代码签名或 Apple 公证。

## 校验并解压

- Linux：`sha256sum -c SHA256SUMS.txt --ignore-missing`
- macOS：`shasum -a 256 <文件>`，与 `SHA256SUMS.txt` 里同名文件比较
- Windows PowerShell：`Get-FileHash .\<文件> -Algorithm SHA256`

校验值不一致就不要运行。解压后整个目录一起使用，不要只复制 exe：`frontend/` 必须在 `nekoc` 旁边。

## 使用

编译 TypeScript 需要 **Node.js 18 或更高版本**在 PATH 里。TypeScript 前端是 JavaScript，包里已经带上它和 `typescript`，不需要 `npm install`。只运行作品（`run`、`web`）不需要 Node。

```sh
./nekoc check samples/stage_demo.nk.ts     # 只检查，不出包
./nekoc build samples/stage_demo.nk.ts     # 生成 samples/stage_demo.bcmkn
./nekoc run samples/stage_demo.bcmkn --ticks 60
./nekoc test samples/unit_tests.ts
./web samples/native-studio.bcmkn          # Web Studio，默认 http://127.0.0.1:4173
```

Windows 上把 `./nekoc` 换成 `.\nekoc.exe`。

前端查找顺序：环境变量 `NEKOC_FRONTEND` 指定的目录 → 可执行文件旁的 `frontend/` → 源码构建时的 `ts/`。目录里缺少需要的脚本就继续往后找。

包内 `BUILD-INFO.json` 记录版本、commit、target 和构建时间，反馈问题时请附上。Android APK 单独发布。

## 不依赖平台的包

同一个 Release 还有：

| 文件 | 用途 |
| --- | --- |
| `fttawa-nekoc-<版本>.tgz` | [`@fttawa/nekoc`](../packages/nekoc/README.md) npm 包：WASM 版编译器和播放器，Node.js 22+ 或浏览器，不需要 Rust。`npm install ./fttawa-nekoc-<版本>.tgz` 后用 `npx nekoc check/build/run`。 |
| `nekoc-pickcat-extension-<版本>.zip` | PICKCAT 浏览器扩展，解压后在扩展管理页「加载解压缩的扩展」。默认用 WASM 运行，见 [pickcat-extension.md](pickcat-extension.md)。 |

不想安装任何东西，可以直接用 GitHub Pages 上的在线编译页。

## 维护者：打包

```sh
npm ci --ignore-scripts
cargo build --locked --release --target x86_64-pc-windows-msvc --bin nekoc --bin web
node tools/package-release.mjs x86_64-pc-windows-msvc target/x86_64-pc-windows-msvc/release
node tools/smoke-release.mjs dist/releases/nekoc-<版本>-x86_64-pc-windows-msvc.zip
```

- `package-release.mjs <target> <二进制目录> [输出目录]` 只打包，不编译。它复制 `nekoc`、`web`、`ts/` 下的前端、`typescript` 包里运行时用到的文件（`lib/typescript.js`、`lib.*.d.ts`、许可证）、精选文档和示例。`RELEASE_VERSION` 可以覆盖 Cargo 版本号。
- `smoke-release.mjs` 把包解压到仓库外的临时目录，依次运行 check、build、run、test，验证类型报错和 `NEKOC_FRONTEND` 覆盖。用 `NEKOC_SMOKE_TEMP` 指定临时目录的父目录；父目录的上级里不能有 `node_modules`，以免借用开发机上的依赖。
- `.github/workflows/release.yml`：推送 `v*` tag 后，在六个平台的原生 runner 上构建并冒烟测试，另有一个 Linux job 构建 wasm、打 npm 包（安装到仓库外冒烟测试）和扩展 zip；全部通过后汇总 `SHA256SUMS.txt`，创建 **draft Release**，由人检查后发布。手动运行只产出 Actions artifacts。
