import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { targets, docs, samples, frontendFiles, checksums, packageRelease } from "../tools/package-release.mjs";

test("release manifest includes only supported platforms and redistributable assets", async () => {
  assert.equal(new Set(targets).size, 6);
  assert.ok(samples.includes("kitten-n-0.27.4.bcmkn"));
  assert.ok(samples.includes("basic.ts"));
  assert.ok(samples.includes("stage_demo.nk.ts"));
  assert.ok(docs.includes("install.md"));
  for (const file of [...docs.map(n => `docs/${n}`), ...samples.map(n => `samples/${n}`), ...frontendFiles.map(n => `ts/${n}`)]) {
    assert.ok((await fs.stat(new URL(`../${file}`, import.meta.url))).isFile(), file);
  }
});

test("checksums are sorted, cover archives only, and replace stale lists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nekoc-checksums-"));
  try {
    await fs.writeFile(path.join(dir, "z.zip"), "zip");
    await fs.writeFile(path.join(dir, "a.tar.gz"), "tar");
    await fs.writeFile(path.join(dir, "ignored.txt"), "ignore");
    await fs.writeFile(path.join(dir, "SHA256SUMS.txt"), "stale");
    await checksums(dir);
    const hash = text => createHash("sha256").update(text).digest("hex");
    assert.equal(await fs.readFile(path.join(dir, "SHA256SUMS.txt"), "utf8"),
      `${hash("tar")}  a.tar.gz\n${hash("zip")}  z.zip\n`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("packaging rejects unsupported targets before writing output", async () => {
  await assert.rejects(packageRelease("invalid", "missing"), /Usage/);
});

test("release workflow keeps draft releases tag-only, ships npm + extension, excludes Android", async () => {
  const workflow = await fs.readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  for (const target of targets) assert.ok(workflow.includes(`target: ${target}`), target);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /tags: \['v\*'\]/);
  assert.match(workflow, /github.event_name == 'push' && startsWith\(github.ref, 'refs\/tags\/v'\)/);
  assert.match(workflow, /gh release create .* --draft/);
  assert.match(workflow, /node tools\/package-release\.mjs/);
  // The wasm npm tarball and the extension zip are smoke tested and checksummed with the binaries.
  assert.match(workflow, /npm pack --ignore-scripts/);
  assert.match(workflow, /node tools\/build-extension\.mjs/);
  assert.match(workflow, /needs: \[build, web\]/);
  assert.doesNotMatch(workflow, /package-extension|\.apk|gradle/);
});

test("checksums cover npm tarballs and archives", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nekoc-sums-"));
  try {
    for (const name of ["a.zip", "b.tar.gz", "fttawa-nekoc-1.0.0.tgz", "notes.txt"]) await fs.writeFile(path.join(dir, name), name);
    await checksums(dir);
    const names = (await fs.readFile(path.join(dir, "SHA256SUMS.txt"), "utf8")).trim().split("\n").map(line => line.split("  ")[1]);
    assert.deepEqual(names, ["a.zip", "b.tar.gz", "fttawa-nekoc-1.0.0.tgz"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("frontend sources import nothing beyond node builtins, typescript and each other", async () => {
  for (const file of frontendFiles.filter(name => name.endsWith(".mjs"))) {
    const source = await fs.readFile(new URL(`../ts/${file}`, import.meta.url), "utf8");
    for (const [, specifier] of source.matchAll(/^import .* from "([^"]+)";$/gm)) {
      const local = specifier.startsWith("./") && frontendFiles.includes(specifier.slice(2));
      assert.ok(specifier.startsWith("node:") || specifier === "typescript" || local, `${file}: ${specifier}`);
    }
  }
});
