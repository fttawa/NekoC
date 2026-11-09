import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixtures } from "../tools/physics-fixtures.mjs";
test("physics fixtures are reproducible original workspaces", async () => {
  for(const [name,project] of Object.entries(fixtures())) {
    assert.equal(await readFile(`tests/fixtures/kitten4/physics-${name}.bcm`,"utf8"),JSON.stringify(project,null,2)+"\n");
  }
});
