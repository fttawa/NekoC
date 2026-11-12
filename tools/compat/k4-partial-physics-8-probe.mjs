// Read-only official configuration/contact observations on repository-original inputs.
import { runOracle, saveJson } from "./k4-oracle.mjs";
import { physicsTrajectoryFixtures, actorId } from "./k4-physics-trajectory-3-fixtures.mjs";
import { physicsRemainingFixtures } from "./k4-partial-physics-7-fixtures.mjs";
import { createHash } from "node:crypto";
const report = { schema: "nekoc-k4-contact-probe-8-v1", cases: {} };
for (const name of ["bounce", "friction", "right"]) {
  const project = name === "right" ? physicsRemainingFixtures()["modern-boundary-all_bounds"].project : physicsTrajectoryFixtures()[name];
  const observations = [];
  const trace = await runOracle(project, { frames: 60, virtualTime: true, onFrame: async (page, frame) => {
    observations.push(await page.evaluate(({ actorId, frame }) => {
      const lib = window.__k4OracleRequire("Pcni");
      const stage = window.__k4OracleRequire("a1xw").a();
      const adapterWorld = stage.core.physics.world_list.values().next().value;
      const adapter = adapterWorld?.body_list.get(actorId);
      const body = adapter?.physics_body.body;
      const fixtures = [];
      for (let f = body?.GetFixtureList(); f; f = f.GetNext()) {
        const shape = f.GetShape();
        fixtures.push({ radius: shape.m_radius, vertices: shape.m_vertices?.slice(0, shape.m_count), friction: f.GetFriction(), restitution: f.GetRestitution(), threshold: f.GetRestitutionThreshold?.() });
      }
      const contacts = [];
      for (let edge = body?.GetContactList(); edge; edge = edge.next) {
        const c = edge.contact;
        contacts.push({ touching: c.IsTouching(), manifold: c.GetManifold(), toi: c.m_toi, toiCount: c.m_toiCount });
      }
      return { frame, position: body?.GetPosition(), velocity: body?.GetLinearVelocity(), fixtures, contacts,
        config: Object.fromEntries(["linearSlop", "polygonRadius", "baumgarte", "toiBaumgarte", "maxLinearCorrection", "maxTranslation", "timeToSleep", "linearSleepTolerance"].map(k => [k, lib[k]])) };
    }, { actorId, frame }));
  } });
  report.cases[name] = { observations, errors: trace.errors, diagnostics: trace.diagnostics };
  await saveJson("dist/k4partial8/physics/official-contact-probe.json", report);
  await saveJson("docs/kitten4-partial-physics-8-config-evidence.json", {
    schema: "nekoc-k4-contact-config-8-v1",
    cases: Object.fromEntries(Object.entries(report.cases).map(([key, value]) => {
      const input = key === "right" ? physicsRemainingFixtures()["modern-boundary-all_bounds"].project : physicsTrajectoryFixtures()[key];
      return [key, { fixtureSha256: createHash("sha256").update(JSON.stringify(input, null, 2) + "\n").digest("hex"),
        config: value.observations[0].config,
        fixtures: value.observations.find(o => o.fixtures.length)?.fixtures,
        contacts: value.observations.filter(o => o.contacts.some(c => c.touching)).map(o => ({
          frame: o.frame, position: o.position, velocity: o.velocity,
          toiCounts: o.contacts.map(c => c.toiCount),
        })), errors: value.errors, assets: value.diagnostics.assets, pageErrors: value.diagnostics.pageErrors }];
    })),
  });
  console.log(name, JSON.stringify(observations.filter(o => o.contacts.some(c => c.touching)).map(o => ({frame:o.frame, position:o.position, velocity:o.velocity, toi:o.contacts.map(c=>c.toiCount)}))));
}
