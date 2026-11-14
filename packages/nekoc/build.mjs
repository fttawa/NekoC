// Builds dist/ for @fttawa/nekoc: the wasm module with Node and web
// bindings, the TypeScript frontend sources and the declaration files the
// type checker reads. Needs the wasm32-unknown-unknown target and the
// wasm-bindgen CLI matching Cargo.lock (WASM_BINDGEN or PATH).
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frontendFiles } from "../../tools/package-release.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const dist = path.join(here, "dist");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const lock = await readFile(path.join(root, "Cargo.lock"), "utf8");
const bindgenVersion = lock.match(/name = "wasm-bindgen"\r?\nversion = "([^"]+)"/)[1];
const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen";
const version = spawnSync(bindgen, ["--version"], { encoding: "utf8" });
if (version.error || !version.stdout.includes(bindgenVersion)) {
  throw new Error(`wasm-bindgen ${bindgenVersion} is required (cargo install wasm-bindgen-cli --version ${bindgenVersion} --locked); set WASM_BINDGEN to its path`);
}

const cargoArgs = ["build", "--release", "--locked", "--target", "wasm32-unknown-unknown", "-p", "nekoc-wasm"];
const cargoWrapper = process.env.NEKOC_CARGO_WRAPPER;
run(cargoWrapper ? "bash" : "cargo", cargoWrapper ? [cargoWrapper, ...cargoArgs] : cargoArgs);
const targetDir = process.env.CARGO_TARGET_DIR ? path.resolve(process.env.CARGO_TARGET_DIR) : path.join(root, "target");
const wasm = path.join(targetDir, "wasm32-unknown-unknown/release/nekoc_wasm.wasm");

await rm(dist, { recursive: true, force: true });
for (const target of ["nodejs", "web"]) {
  run(bindgen, [wasm, "--target", target, "--out-dir", path.join(dist, target)]);
}
// Node loads dist/web as ESM in tests and for bundlers that resolve it there.
await writeFile(path.join(dist, "web/package.json"), `${JSON.stringify({ type: "module" })}\n`);
await writeFile(path.join(dist, "nodejs/package.json"), `${JSON.stringify({ type: "commonjs" })}\n`);

const frontend = path.join(dist, "frontend");
await mkdir(frontend, { recursive: true });
// Same frontend module list as the release bundle, so new ts/*.mjs modules
// cannot be shipped in one package and missing from the other.
for (const name of frontendFiles.filter(name => name !== "test-ts.mjs")) {
  await copyFile(path.join(root, "ts", name), path.join(frontend, name));
}

// The type checker reads lib.*.d.ts through the host; browsers have no fs.
const libDir = path.dirname(createRequire(import.meta.url).resolve("typescript"));
const resources = {};
for (const name of await readdir(libDir)) {
  if (/^lib\..*\.d\.ts$/.test(name)) resources[name] = await readFile(path.join(libDir, name), "utf8");
}
resources["nekoc.d.ts"] = await readFile(path.join(root, "ts/nekoc.d.ts"), "utf8");
await writeFile(path.join(dist, "resources.mjs"), `export default ${JSON.stringify(resources)};\n`);
await copyFile(path.join(root, "LICENSE"), path.join(dist, "LICENSE"));
console.log(`built ${path.relative(root, dist)}`);
