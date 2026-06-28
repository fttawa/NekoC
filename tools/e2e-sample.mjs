#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const crateRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(crateRoot, "..");
const smokeScript = path.join(workspaceRoot, "research", "kn-editor-local", "tools", "editor-smoke.mjs");

function usage() {
  console.error(`Usage:
  node tools/e2e-sample.mjs [sample-name]

Example:
  node tools/e2e-sample.mjs three_body

Environment:
  NEKOC_TEMPLATE       Template .bcmkn path. Default: samples/我的作品-原生.bcmkn
  NEKOC_SMOKE_TIMEOUT  Editor smoke timeout in ms. Default: 45000
`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n$ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, {
      cwd: options.cwd || crateRoot,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function main() {
  const sampleName = process.argv[2] || "three_body";
  if (sampleName === "--help" || sampleName === "-h") {
    usage();
    return;
  }

  const tsInput = path.join(crateRoot, "samples", `${sampleName}.ts`);
  const template = path.resolve(crateRoot, process.env.NEKOC_TEMPLATE || path.join("samples", "我的作品-原生.bcmkn"));
  const bcmknOut = path.join(crateRoot, "samples", `${sampleName}.compiled.bcmkn`);
  const validateOut = path.join(crateRoot, "samples", `${sampleName}.compiled.validate.json`);
  const smokeOut = path.join(crateRoot, "samples", `${sampleName}.compiled.smoke.json`);

  for (const [label, file] of [
    ["sample", tsInput],
    ["template", template],
    ["editor smoke script", smokeScript],
  ]) {
    if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
  }

  await run("cargo", [
    "run",
    "--",
    "compile-ts-bcmkn",
    tsInput,
    "--template",
    template,
    "--out",
    bcmknOut,
  ]);

  await run("cargo", [
    "run",
    "--",
    "validate",
    bcmknOut,
    "--out",
    validateOut,
  ]);

  await run("node", [
    smokeScript,
    "--input",
    bcmknOut,
    "--out",
    smokeOut,
    "--timeout-ms",
    process.env.NEKOC_SMOKE_TIMEOUT || "45000",
  ]);

  console.log(`\nE2E passed for ${sampleName}`);
  console.log(`- ${path.relative(crateRoot, bcmknOut)}`);
  console.log(`- ${path.relative(crateRoot, validateOut)}`);
  console.log(`- ${path.relative(crateRoot, smokeOut)}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
