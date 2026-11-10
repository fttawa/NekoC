#!/usr/bin/env node
// Prerequisite check only: never run the vendor build tool (it writes works/builds).
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { saveJson } from "../compat/k4-oracle.mjs";
import path from "node:path";

const [directory, out = "dist/bench/hateneko.json"] = process.argv.slice(2);
if (!directory || !path.resolve(out).startsWith(path.resolve("dist") + path.sep)) throw new Error("Usage: hateneko.mjs readonly-ref-dir dist/.../probe.json");
const files = {};
for (const file of ["VERSION", "player/main.lua", "player/tools/kn.py"]) {
  const bytes = await readFile(path.join(directory, file));
  files[file] = { sha256: createHash("sha256").update(bytes).digest("hex"), ...(file === "VERSION" ? { text: bytes.toString().trim() } : {}) };
}
const executables = {};
for (const command of ["love", "luajit", "lua"]) {
  try { executables[command] = execFileSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { executables[command] = null; }
}
const result = { status: "unverified", files, executables,
  reason: Object.values(executables).some(Boolean)
    ? "Executable discovered, but no validated K4-to-KN workload adapter. Do not claim a comparable timing."
    : "No Love2D/Lua/LuaJIT executable on PATH. Reference main.lua requires LoveHost; kn.py accepts bcmkn and writes vendor dirs. No vendor build was run." };
await saveJson(out, result);
console.log(JSON.stringify(result, null, 2));
