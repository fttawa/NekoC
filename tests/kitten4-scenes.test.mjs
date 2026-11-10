import test from "node:test";
import assert from "node:assert/strict";
import { readJson, runOracle } from "../tools/compat/k4-oracle.mjs";
import { sceneFixtures, sceneA, sceneB, actorA } from "../tools/compat/scene-fixtures.mjs";

test("scene fixtures are reproducible repository-owned workspaces", async () => {
  for (const [name, project] of Object.entries(sceneFixtures())) {
    assert.deepEqual(await readJson(`tests/fixtures/kitten4/scenes/${name}.bcm`), project);
  }
});

test("offline scene selection, lifecycle and runtime (not editor) scene sampling", { skip: !process.env.K4_ORACLE_INTEGRATION }, async () => {
  for (const [name, project] of Object.entries(sceneFixtures())) {
    const trace = await runOracle(project, { frames: 180, seed: 1, channel: "msedge" });
    const last = trace.frames.at(-1);
    assert.equal(trace.frames[0].current_scene_id, name === "reordered" || name === "activationSwitch" ? sceneB : sceneA);
    if (name === "activationSwitch") assert.equal(last.variables.afterSwitch, 0);
    if (name === "sameScene") {
      assert.equal(last.variables.activationA, 1);
      assert.equal(last.variables.afterSwitch, 1);
    }
    if (name !== "lifecycle") continue;
    const away = trace.frames.find(frame => frame.current_scene_id === sceneB);
    assert.ok(away, "runtime scene must change even though editor store remains at scene A");
    assert.equal(away.variables.listenerTail, 0);
    assert.equal(away.variables.activationTail, 0);
    assert.equal(Object.keys(away.actors).length, 3);
    assert.equal(last.current_scene_id, sceneA);
    assert.deepEqual(last.actors, away.actors);
    assert.deepEqual(last.variables, { globalA: 1, globalB: 1, activationA: 2, activationB: 1, activationTail: 1,
      listenerEnter: 1, listenerTail: 1, afterSwitch: 1, cloneStarted: 1, done: 1 });
    const actor = last.actors[actorA];
    assert.deepEqual([actor.x, actor.y, actor.rotation, actor.scale, actor.scale_y, actor.current_style_id], [73, -29, 37, 135, 135, "costume-b"]);
    assert.equal(trace.errors.length, 0);
  }
});
