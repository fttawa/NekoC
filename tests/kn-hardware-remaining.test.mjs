import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { catalogTypes } from "../tools/compat/kn-catalog-manifest.mjs";

const evidence = JSON.parse(await fs.readFile(new URL("../docs/kn-hardware-remaining-evidence.json", import.meta.url), "utf8"));
const previous = JSON.parse(await fs.readFile(new URL("../docs/kn-hardware-evidence.json", import.meta.url), "utf8"));
const sync = ["microbit_change_bpm", "microbit_get_volume", "microbit_set_bpm"];
const sensors = ["microbit_accelerometer", "microbit_compass_heading", "microbit_light_level", "microbit_magnetometer", "microbit_rotation", "microbit_sound_level", "microbit_temperature"];
const events = ["microbit_button_when", "microbit_logo_when", "microbit_pin_when"];
const inputs = {
  microbit_change_bpm: ["offset"], microbit_get_volume: [], microbit_set_bpm: ["bpm"],
  microbit_led_clear: [], microbit_led_plot: ["x", "y"], microbit_led_plot_graph: ["value", "high"],
  microbit_led_show_custom: [], microbit_led_show_icon: [], microbit_led_show_number: ["num"],
  microbit_led_show_text: ["text"], microbit_led_toggle: ["x", "y"], microbit_led_unplot: ["x", "y"],
  microbit_pause_by_beats: ["beats"], microbit_pin_analog_write: ["value"], microbit_pin_digital_write: ["value"],
  microbit_pin_set_touch_mode: [], microbit_play_melody: [], microbit_play_tone_by_beats: ["note", "beats"],
  microbit_servo_set_angle_270: ["angle"], microbit_servo_set_pulse: ["pulse"],
  microbit_set_volume: ["volume"], microbit_stop: [],
};
const preGuardReads = {
  microbit_accelerometer: ["key"], microbit_magnetometer: ["key"], microbit_rotation: ["rotation"],
  microbit_pin_set_touch_mode: ["key", "mode"], microbit_led_show_custom: ["value"],
};

test("all 31 remaining catalog microbit types have individual official evidence and an explicit decision", () => {
  assert.equal(evidence.schema, "nekoc-kn-disconnected-microbit-remaining-v1");
  assert.equal(evidence.version, "0.27.4");
  assert.deepEqual(evidence.hardwareIds, []);
  assert.equal(evidence.hasMicrobit, false);
  assert.deepEqual(evidence.pageErrors, []);
  assert.ok(Object.values(evidence.checks).every(Boolean));
  const expected = catalogTypes.filter(n => n.startsWith("microbit_") && !previous.reporters.some(r => r.name === n));
  assert.equal(expected.length, 31);
  assert.deepEqual(evidence.remainingCatalog, expected);
  assert.deepEqual(evidence.blocks.filter(b => b.inCatalog).map(b => b.name).sort(), expected);
  assert.deepEqual(evidence.blocks.filter(b => b.classification === "synchronous-disconnected-candidate").map(b => b.name).sort(), sync);
  assert.equal(evidence.caseCount, 236);
  assert.equal(evidence.blocks.reduce((n, b) => n + b.cases.length, 0) + evidence.extraDomains.reduce((n, b) => n + b.cases.length, 0), evidence.caseCount);
});

for (const block of evidence.blocks) test(`${block.name}: type, input order, boundary and unsupported status`, () => {
  assert.ok(block.source && block.source.excerptSha256);
  assert.deepEqual(block.inputs, inputs[block.name] || []);
  if (events.includes(block.name)) {
    assert.equal(block.kind, "event");
    assert.equal(block.classification, "unsupported-event-no-native-scheduling-evidence");
    assert.deepEqual(block.cases, []);
    assert.ok(evidence.events.actionSpecs.some(s => s.id === block.name));
    return;
  }
  const isSync = sync.includes(block.name), reads = preGuardReads[block.name] || [];
  const result = sensors.includes(block.name) ? { type: "number", value: "NaN" } : { type: "undefined" };
  assert.equal(block.promise, !isSync);
  assert.deepEqual(block.result, result);
  assert.deepEqual(block.argumentReads, reads);
  assert.equal(block.classification, isSync ? "synchronous-disconnected-candidate" : "unsupported-promise-no-native-scheduling-evidence");
  for (const c of block.cases) {
    assert.deepEqual(c.sideEffects, { runtimeActions: 0, domainErrors: 0, hardwareIds: [] });
    assert.equal(c.promise, !isSync);
    if (reads.length && ["null", "throwing argument getter"].includes(c.label)) {
      assert.equal(c.errorPhase, "rejection");
      assert.ok(c.error);
      assert.deepEqual(c.timeline, ["call", "returned", "rejected", "queued microtask"]);
    } else {
      assert.equal(c.error, undefined);
      assert.deepEqual(c.result, result);
      assert.deepEqual(c.timeline, isSync ? ["call", "returned"] : ["call", "returned", "fulfilled", "queued microtask"]);
    }
  }
});

test("fields are not value expressions; domain-only types are excluded from current panel/catalog", () => {
  const fields = name => evidence.blocks.find(b => b.name === name).fields.map(f => f.name);
  assert.deepEqual(fields("microbit_change_bpm"), ["change"]);
  assert.deepEqual(fields("microbit_led_show_custom"), ["value"]);
  assert.deepEqual(fields("microbit_led_show_icon"), ["icon"]);
  assert.deepEqual(fields("microbit_pin_set_touch_mode"), ["key", "mode"]);
  assert.deepEqual(fields("microbit_play_melody"), ["melody", "time"]);
  assert.deepEqual(evidence.extraDomains.map(d => d.name), ["microbit_pin_is_pressed", "microbit_servo_set_angle_360"]);
  for (const d of evidence.extraDomains) {
    assert.equal(d.inCurrentPanel, false);
    assert.equal(d.inCatalog, false);
    assert.equal(d.classification, "unsupported-domain-only");
  }
  const pin = evidence.extraDomains[0];
  assert.deepEqual(pin.cases.find(c => c.label === "argument access").argumentReads, ["key", "value"]);
  assert.equal(pin.cases.find(c => c.label === "null").errorPhase, "synchronous throw");
  assert.equal(pin.cases.find(c => c.label === "throwing argument getter").errorPhase, "synchronous throw");
  assert.deepEqual(pin.cases.find(c => c.label === "defaults").result, { type: "boolean", value: false });
  assert.match(evidence.sideEffects.guardCaveat, /toast/);
  assert.match(evidence.events.naturalDisconnectedReachability, /emitEvent itself has no connection guard/);
});

test("optional official bundle bytes reproduce complete module and registration anchors", async t => {
  const hash = value => createHash("sha256").update(value).digest("hex");
  const cache = new Map();
  assert.equal(evidence.sourceLocations.length, 51);
  for (const source of evidence.sourceLocations) {
    if (!cache.has(source.bundle)) {
      try { cache.set(source.bundle, await fs.readFile(new URL("../dist/kn-hardware-remaining/" + source.bundle, import.meta.url))); }
      catch (err) { if (err.code === "ENOENT") return t.skip("Run kn-hardware-remaining-probe.mjs for ignored official bytes"); throw err; }
    }
    const bytes = cache.get(source.bundle);
    assert.equal(hash(bytes), source.bundleSha256);
    const text = bytes.subarray(source.byteOffset).toString("utf8").slice(0, source.excerptCharacters);
    assert.equal(hash(text), source.excerptSha256, source.symbol);
    if (source.symbol.startsWith("microbit_")) assert.match(text, /^\(0,n.Z\)\(e,l.k./);
    if (source.symbol === "core:start") assert.match(text, /isConnected/);
    if (source.symbol === "hardware:guard") assert.match(text, /openToast/);
  }
});
