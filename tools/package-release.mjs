import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const targets = [
  "x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin", "aarch64-apple-darwin",
];
export const docs = [
  "install.md", "syntax.md", "ts-support-audit.md", "api.md", "self-api.md",
  "operators.md", "web-studio.md", "cli-run.md", "pack.md", "extensions.md",
  "kitten-n-compatibility.md", "kitten4.md", "kitten4-block-coverage.md",
  "kn-block-coverage.md", "player-sdk.md",

];
export const samples = [
  "stage_demo.nk.ts", "basic.ts", "unit_tests.ts", "typed_self_api.ts", "kitten4-demo.ts",
  "kitten-n-0.27.4.bcmkn", "native-studio.bcmkn", "web-pen-stress.bcmkn",
  "pen_display.bcmkn", "pen_display_fast.bcmkn", "pen_display_columns.bcmkn",
  "three_body.bcmkn", "kitten4-demo.bcm",
];
// Showcase works from the NekoX-Lab/nekoc-works checkout (NEKOC_WORKS_DIR),
// shipped as works/<file> so the package can be tried straight away.
export const works = [
  "fangjie/fangjie.bcmkn", "pencraft/pencraft.bcmkn", "starhold/starhold.bcmkn", "tiny-lm/tiny_lm.bcmkn",
];
const root = fileURLToPath(new URL("../", import.meta.url));

// Double-click launchers: start the local Rust backend and open the player.
const url = "http://127.0.0.1:4173/play";
export const launchers = {
  windows: ["start.cmd", [
    "@echo off",
    "cd /d \"%~dp0\"",
    "echo NekoC: " + url,
    "echo Close this window to stop the backend.",
    `start "" cmd /c "timeout /t 2 /nobreak >nul & start ${url}"`,
    "web.exe --port 4173",
    "pause",
    "",
  ].join("\r\n")],
  unix: ["start.sh", [
    "#!/bin/sh",
    "cd \"$(dirname \"$0\")\" || exit 1",
    `echo "NekoC: ${url} (Ctrl+C stops the backend)"`,
    `(sleep 2; if command -v open >/dev/null 2>&1; then open ${url}; elif command -v xdg-open >/dev/null 2>&1; then xdg-open ${url}; fi) >/dev/null 2>&1 &`,
    "exec ./web --port 4173",
    "",
  ].join("\n")],
};

async function copyTree(source, destination) {
  await fs.cp(source, destination, { recursive: true, errorOnExist: false });
}

export async function checksums(directory) {
  const names = (await fs.readdir(directory)).filter(n => /\.(zip|tar\.gz|tgz)$/.test(n)).sort();
  if (!names.length) throw new Error("No release archives found");
  const lines = await Promise.all(names.map(async name =>
    `${createHash("sha256").update(await fs.readFile(path.join(directory, name))).digest("hex")}  ${name}\n`));
  await fs.writeFile(path.join(directory, "SHA256SUMS.txt"), lines.join(""));
}

// The frontend is plain ESM that only imports `typescript`, which has no
// dependencies of its own. Ship the sources plus the parts of the typescript
// package it loads at runtime: no bundler, no npm install for users.
export const frontendFiles = ["compile-ts.mjs", "test-ts.mjs", "kitten-n.mjs", "portable-path.mjs", "tsfeat-values.mjs", "tsfeat-sequences.mjs", "tsfeat-lowering.mjs", "tsfeat-methods.mjs", "nekoc.d.ts"];
const typescriptFiles = ["package.json", "LICENSE.txt", "ThirdPartyNoticeText.txt", "lib/typescript.js"];

async function copyFrontend(copy) {
  for (const file of frontendFiles) await copy(`ts/${file}`, `frontend/${file}`);
  const tsRoot = "node_modules/typescript";
  for (const file of typescriptFiles) await copy(`${tsRoot}/${file}`, `frontend/${tsRoot}/${file}`);
  for (const file of await fs.readdir(path.join(root, tsRoot, "lib"))) {
    if (/^lib\..*\.d\.ts$/.test(file)) await copy(`${tsRoot}/lib/${file}`, `frontend/${tsRoot}/lib/${file}`);
  }
}

export async function packageRelease(target, binDir, output = path.join(root, "dist/releases")) {
  if (!targets.includes(target) || !binDir) throw new Error("Usage: node tools/package-release.mjs <target> <binary-directory> [output-directory]");
  const version = process.env.RELEASE_VERSION ?? (await fs.readFile(path.join(root, "Cargo.toml"), "utf8")).match(/^version = "([^"]+)"/m)[1];
  if (!/^[\w.+-]+$/.test(version)) throw new Error("Invalid release version");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const name = `nekoc-${version}-${target}`;
  output = path.resolve(output);
  await fs.mkdir(output, { recursive: true });
  // A fresh staging directory prevents stale binaries/assets entering a package.
  const staging = await fs.mkdtemp(path.join(output, ".stage-"));
  const bundle = path.join(staging, name);
  try {
    await fs.mkdir(bundle);
    const copy = async (source, destination = source) => {
      const dest = path.join(bundle, destination);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(root, source), dest);
    };
    for (const bin of ["nekoc", "web"]) {
      const filename = bin + (target.includes("windows") ? ".exe" : "");
      await fs.copyFile(path.resolve(binDir, filename), path.join(bundle, filename));
      if (!target.includes("windows")) await fs.chmod(path.join(bundle, filename), 0o755);
    }
    await copyFrontend(copy);
    for (const file of docs) await copy(`docs/${file}`);
    for (const file of samples) await copy(`samples/${file}`);
    await copy("README.md");
    await copy("llms.txt");
    await copy("LICENSE");
    const [launcher, script] = launchers[target.includes("windows") ? "windows" : "unix"];
    await fs.writeFile(path.join(bundle, launcher), script);
    if (!target.includes("windows")) await fs.chmod(path.join(bundle, launcher), 0o755);
    // Optional extras, always present in CI release builds.
    const extension = process.env.NEKOC_EXTENSION_DIR;
    if (extension) await copyTree(path.resolve(extension), path.join(bundle, "extension"));
    const worksDir = process.env.NEKOC_WORKS_DIR;
    if (worksDir) {
      await fs.mkdir(path.join(bundle, "works"));
      for (const file of works) await fs.copyFile(path.resolve(worksDir, file), path.join(bundle, "works", path.basename(file)));
    }
    await fs.writeFile(path.join(bundle, "BUILD-INFO.json"), JSON.stringify({
      version, commit, target, builtAt: new Date().toISOString(),
    }, null, 2) + "\n");
    const archive = path.join(output, name + (target.includes("windows") ? ".zip" : ".tar.gz"));
    await fs.rm(archive, { force: true });
    if (target.includes("windows")) {
      if (process.platform !== "win32") throw new Error("Windows zip packaging requires PowerShell on Windows");
      const quote = value => "'" + value.replaceAll("'", "''") + "'";
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `Compress-Archive -LiteralPath ${quote(bundle)} -DestinationPath ${quote(archive)} -Force`], { stdio: "inherit" });
    } else {
      execFileSync("tar", ["-czf", archive, "-C", staging, name], { stdio: "inherit" });
    }
    await checksums(output);
    console.log(archive);
    return archive;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--checksums") await checksums(path.resolve(process.argv[3] ?? "dist/releases"));
  else await packageRelease(...process.argv.slice(2));
}
