import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { catalogTypes, catalogSha256 } from "../tools/compat/kn-catalog-manifest.mjs";
import { apiAliasTypes, classifyPanelType } from "../tools/compat/kn-panel-probe.mjs";

const evidence = JSON.parse(fs.readFileSync(new URL("../docs/kn-panel-evidence.json", import.meta.url), "utf8"));
const groups = evidence.typeGroups;

test("panel evidence partitions exactly the 300 names without certifying retirement", () => {
  assert.equal(evidence.catalogSha256, catalogSha256);
  const all = Object.values(groups).flat();
  assert.equal(all.length, 300);
  assert.equal(new Set(all).size, 300);
  assert.deepEqual(all.toSorted(), catalogTypes);
  for (const [group, types] of Object.entries(groups)) {
    assert.deepEqual(types, types.toSorted(), group);
    assert.equal(evidence.counts[group], types.length, group);
  }
  assert.deepEqual(groups["code-api-alias-not-block"], apiAliasTypes);
  assert.deepEqual(evidence.certifiedUnofficialTypes, []);
  assert.deepEqual(evidence.certifiedRetiredTypes, []);
  assert.deepEqual(evidence.notFoundTypes, []);
  assert.equal(evidence.registration.registeredCount + evidence.registration.unregisteredCount, 300);
});

test("classification does not infer retirement from missing domain or block registry", () => {
  const base = { managerCategories: [], hardwareCategories: [], flyoutCategories: [], registered: false, apiAlias: false, defaultHidden: false, domainIndex: null };
  assert.equal(classifyPanelType(base), "not-found-in-audited-environment");
  assert.equal(classifyPanelType({ ...base, registered: true }), "registered-not-in-audited-panels");
  assert.equal(classifyPanelType({ ...base, hardwareCategories: ["wand_event"] }), "hardware-extension-config-not-installed");
  assert.equal(classifyPanelType({ ...base, apiAlias: true }), "code-api-alias-not-block");
  assert.equal(classifyPanelType({ ...base, registered: true, managerCategories: ["aiChat"], defaultHidden: true }), "panel-configurable-default-hidden");
  assert.equal(classifyPanelType({ ...base, registered: true, managerCategories: ["animation"] }), "panel-default");
  assert.equal(classifyPanelType({ ...base, registered: true, flyoutCategories: ["audio"] }), "panel-nested-or-dynamic");
  assert.ok(evidence.registration.registeredWithoutDomainIndex.includes("repeat_forever"));
  assert.ok(evidence.registration.registeredWithoutDomainIndex.includes("controls_while"));
});

test("all hardware candidates have current official extension panel metadata", () => {
  const configured = evidence.hardwareCatalogConfigs.flatMap(c => c.types).toSorted();
  assert.deepEqual(configured, groups["hardware-extension-config-not-installed"]);
  assert.ok(configured.includes("wand_coordinate"));
  assert.ok(configured.includes("get_robot_master_motor_power"));
  assert.ok(configured.includes("catbit_usb_button_when"));
  assert.ok(evidence.renderObservations.hardwareCardIdsNotRenderedInThisMode.includes("catbitUsb"));
  assert.ok(evidence.renderObservations.hardwareCardNamesRendered.includes("魔法棒"));
});

test("ordinary, configurable hidden, nested and non-panel registration remain distinct", () => {
  assert.ok(groups["panel-default"].includes("global_animation"));
  assert.ok(groups["panel-configurable-default-hidden"].includes("set_system_preset"));
  assert.ok(groups["panel-configurable-default-hidden"].includes("warp"));
  assert.ok(groups["registered-not-in-audited-panels"].includes("calculate"));
  assert.deepEqual(groups["panel-nested-or-dynamic"], ["get_play_audio"]);
  assert.equal(evidence.managerCategories.find(c => c.id === "animation").types.includes("global_animation"), true);
  assert.equal(evidence.managerCategories.find(c => c.id === "aiChat").types.includes("set_system_preset"), true);
  assert.equal(evidence.renderObservations.globalAnimationRenderedType, "global_animation");
  assert.equal(evidence.renderObservations.systemPresetRenderedType, "set_system_preset");
  assert.equal(evidence.renderObservations.managerCategoriesRendered, 19);
  assert.equal(evidence.managerCategories.filter(c => c.invisible).length, 1);
  assert.equal(evidence.managerCategories.find(c => c.invisible).id, "judge");
});

test("authored API conversion observations retain success and failure distinctions", () => {
  const conversions = evidence.authoredConversions;
  assert.deepEqual(conversions.find(c => c.code.includes("'x'")).blockTypes, ["_execute", "coordinate_of_sprite"]);
  assert.deepEqual(conversions.find(c => c.code.includes("'color'")).blockTypes, ["_execute", "effect_of_sprite"]);
  assert.equal(conversions.find(c => c.code.includes("'size'")).errorCount, 1);
  assert.deepEqual(conversions.find(c => c.code.startsWith("change_script_variables")).blockTypes, ["variables_set"]);
  assert.deepEqual(conversions.find(c => c.code === "break_loop();").blockTypes, ["break"]);
});

test("tracked evidence contains metadata only, not third-party function bodies or assets", () => {
  const inspect = value => {
    if (Array.isArray(value)) return value.forEach(inspect);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["source", "runtimeFunctions", "xml", "cardImage", "previewImage"].includes(key), key);
      if (typeof child === "string") assert.ok(!child.startsWith("data:image/"));
      inspect(child);
    }
  };
  inspect(evidence);
  assert.deepEqual(evidence.pageErrors, []);
  for (const location of evidence.sourceLocations) {
    assert.ok(evidence.bundles.some(b => b.name === location.bundle));
    assert.ok(Number.isInteger(location.byteOffset) && location.byteOffset >= 0);
    assert.match(location.evaluatedFactorySha256, /^[0-9a-f]{64}$/);
  }
});

const rawUrl = new URL("../dist/kn-panel/report.json", import.meta.url);
test("optional downloaded live result agrees with the tracked metadata snapshot", { skip: !fs.existsSync(rawUrl) }, () => {
  const raw = JSON.parse(fs.readFileSync(rawUrl, "utf8"));
  assert.equal(raw.ok, true);
  assert.deepEqual(raw.typeGroups, groups);
  assert.deepEqual(raw.manager.categories, evidence.managerCategories);
  assert.deepEqual(raw.initial.categories.map(c => c.id), evidence.initialCategoryIds);
  assert.deepEqual(raw.initial.hiddenCategories, evidence.initialHiddenCategoryIds);
  assert.equal(raw.rows.filter(r => r.registered).length, evidence.registration.registeredCount);
  assert.deepEqual(raw.rows.filter(r => r.registered && r.domainIndex === null).map(r => r.type), evidence.registration.registeredWithoutDomainIndex);
  assert.ok(raw.managerRendered.find(c => c.id === "animation").types.includes("global_animation"));
  assert.ok(raw.managerRendered.find(c => c.id === "aiChat").types.includes("set_system_preset"));
  assert.deepEqual(raw.managerRendered.find(c => c.id === "procedure").types, []);
  for (const name of evidence.renderObservations.hardwareCardNamesRendered) {
    assert.ok(raw.hardwareCardsRendered.some(text => text.startsWith(name)), name);
  }
  for (const conversion of evidence.authoredConversions) {
    const actual = raw.editor.conversions.find(c => c.code === conversion.code);
    assert.deepEqual(actual.blockTypes, conversion.blockTypes);
    assert.equal(actual.errors.length, conversion.errorCount);
  }
  for (const config of evidence.hardwareCatalogConfigs) {
    const actual = raw.editor.hardwareConfigs.find(c => c.id === config.id);
    assert.ok(actual, config.id);
    assert.deepEqual(actual.types.filter(t => catalogTypes.includes(t)), config.types);
  }
  for (const bundle of evidence.bundles) {
    const bytes = fs.readFileSync(new URL(`../dist/kn-panel/${bundle.name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), bundle.sha256);
  }
  for (const loc of evidence.sourceLocations) {
    const bytes = fs.readFileSync(new URL(`../dist/kn-panel/${loc.bundle}`, import.meta.url));
    assert.equal(bytes.subarray(loc.byteOffset, loc.byteOffset + loc.moduleId.length + 10).toString(), `${loc.moduleId}:function(`);
    assert.deepEqual(raw.sourceLocations.find(row => row.moduleId === loc.moduleId), { ...loc, bundleSha256: evidence.bundles.find(b => b.name === loc.bundle).sha256 });
  }
});
