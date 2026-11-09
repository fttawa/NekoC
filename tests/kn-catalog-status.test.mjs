import assert from "node:assert/strict";
import test from "node:test";
import { dispatchEvidence } from "../tools/compat/kn-catalog-status.mjs";

test("inventory uses dispatch arms, not comments or incidental strings", () => {
  const result = dispatchEvidence(`
// "comment" => ignored
let name = "not-a-dispatch";
"first" | "second" => value,
"guarded" if condition => value,
/* "comment2" => ignored */
`, "fixture.rs");
  assert.deepEqual([...result.keys()], ["first", "second", "guarded"]);
  assert.match(result.get("first")[0], /^fixture\.rs:\d+$/);
});
