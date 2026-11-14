import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

// Intentionally extract outside the checkout, with no node_modules ancestors.
const archive = path.resolve(process.argv[2]);
const temp = await fs.mkdtemp(path.join(process.env.NEKOC_SMOKE_TEMP ?? os.tmpdir(), "nekoc-release-"));
if (archive.endsWith(".zip")) {
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(temp)}`]);
} else {
  execFileSync("tar", ["-xzf", archive, "-C", temp]);
}
const [name] = await fs.readdir(temp);
const bundle = path.join(temp, name);
const info = JSON.parse(await fs.readFile(path.join(bundle, "BUILD-INFO.json"), "utf8"));
if (!info.version || !/^[a-f0-9]{40}$/.test(info.commit) || !info.target || !Number.isFinite(Date.parse(info.builtAt))) {
  throw new Error("Incomplete BUILD-INFO.json");
}
const allowed = new Set(["nekoc", "web", "nekoc.exe", "web.exe", "frontend", "docs", "samples", "README.md", "llms.txt", "LICENSE", "BUILD-INFO.json",
  "start.cmd", "start.sh", "extension", "works"]);
const entries = await fs.readdir(bundle);
for (const entry of entries) {
  if (!allowed.has(entry)) throw new Error(`Unexpected package entry: ${entry}`);
}
if (!entries.includes(process.platform === "win32" ? "start.cmd" : "start.sh")) throw new Error("missing launcher");
// Release builds must ship the extension and the showcase works (NEKOC_SMOKE_FULL=1).
if (process.env.NEKOC_SMOKE_FULL) {
  JSON.parse(await fs.readFile(path.join(bundle, "extension/manifest.json"), "utf8"));
  for (const name of ["play.html", "backend.js", "wasm-worker.js"]) await fs.access(path.join(bundle, "extension", name));
  const shipped = await fs.readdir(path.join(bundle, "works"));
  if (shipped.length < 4) throw new Error(`works/ is incomplete: ${shipped}`);
  const nekoc = path.join(bundle, process.platform === "win32" ? "nekoc.exe" : "nekoc");
  // The works print a lot; only the exit status matters here.
  for (const work of shipped) execFileSync(nekoc, ["run", `works/${work}`, "--ticks", "3"], { cwd: bundle, stdio: "ignore" });
}
for (let ancestor = bundle; ; ancestor = path.dirname(ancestor)) {
  try {
    await fs.access(path.join(ancestor, "node_modules"));
    throw new Error(`Smoke directory has a node_modules ancestor: ${ancestor}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (path.dirname(ancestor) === ancestor) break;
}
const exe = path.join(bundle, process.platform === "win32" ? "nekoc.exe" : "nekoc");
// A missing override directory must fall through to the bundled frontend.
const env = { ...process.env, NEKOC_FRONTEND: path.join(temp, "missing"), NODE_PATH: "" };
const run = args => execFileSync(exe, args, { cwd: bundle, env, stdio: "inherit" });
run(["check", "samples/stage_demo.nk.ts"]);
run(["build", "samples/stage_demo.nk.ts", "-o", "stage.bcmkn"]);
run(["run", "stage.bcmkn", "--ticks", "10"]);
run(["compile-ts-bcmkn", "samples/basic.ts", "--template", "samples/kitten-n-0.27.4.bcmkn", "--out", "x.bcmkn"]);
run(["run", "x.bcmkn"]);
run(["test", "samples/unit_tests.ts"]);

// Type errors are reported by the bundled TypeScript without node_modules.
const invalid = path.join(temp, "invalid.ts");
await fs.writeFile(invalid, 'const value: number = "wrong";\n');
let typeError = false;
try {
  execFileSync(exe, ["check", "--json", invalid], { cwd: temp, env, encoding: "utf8", stdio: "pipe" });
} catch (error) {
  const report = JSON.parse(error.stdout);
  typeError = !report.ok && report.diagnostics.some(d => d.code === "TS2322");
}
if (!typeError) throw new Error("bundled frontend did not report a TypeScript type error");

// NEKOC_FRONTEND wins over the bundled frontend when it exists.
const override = path.join(temp, "override");
await fs.mkdir(override);
await fs.writeFile(path.join(override, "compile-ts.mjs"), 'console.error("NEKOC_OVERRIDE_SELECTED"); process.exit(23);\n');
let selected = false;
try {
  execFileSync(exe, ["build", "samples/basic.ts", "-o", "override.bcmkn"], {
    cwd: bundle, env: { ...env, NEKOC_FRONTEND: override }, encoding: "utf8", stdio: "pipe",
  });
} catch (error) {
  selected = error.stderr?.includes("NEKOC_OVERRIDE_SELECTED");
}
if (!selected) throw new Error("NEKOC_FRONTEND did not override the bundled frontend");
console.log(`smoke passed: ${bundle}`);
