import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, normalizeNeko, compareStates, summarize, summaryTable, startServer, installOfficialProbe } from "../tools/compare-kitten4-official.mjs";
import { PlayerConnection } from "../web/player.js";

test("comparison arguments validate duration, including zero", () => {
  assert.equal(parseArgs(["dist/out", "corpus", "--seconds", "0"]).seconds, 0);
  assert.equal(parseArgs(["dist/out", "corpus"]).seconds, 4);
  for (const value of ["NaN", "-1", "301"]) assert.throws(() => parseArgs(["out", "work", "--seconds", value]));
  assert.throws(() => parseArgs([]));
});

test("raw VM heading is converted once, axes stay distinct, circular angles compare", () => {
  const raw = { actors: { a: { x: 1, y: 2, direction: 90, visible: true, scale: 50, size_x: 200, size_y: 50, costume: "c" } }, variables: { n: "text" }, lists: { l: [1, "two"] } };
  const copy = structuredClone(raw), state = normalizeNeko(raw);
  assert.deepEqual(raw, copy);
  assert.deepEqual(state.actors.a, { x: 1, y: 2, angle: 0, visible: true, scaleX: 100, scaleY: 25, costume: "c" });
  const other = structuredClone(state);
  other.actors.a.angle = 360;
  assert.deepEqual(compareStates(state, other), []);
  other.actors.a.x += 0.00000001;
  assert.deepEqual(compareStates(state, other), []);
  other.actors.a.x = 4;
  other.actors.a.angle = 359;
  other.variables.n = 0;
  other.lists.l.push(3);
  const differences = compareStates(state, other);
  assert.equal(differences.find(d => d.field === "actors.a.x").delta, 3);
  assert.equal(differences.find(d => d.field === "actors.a.angle").delta, -1);
  assert.equal(differences.find(d => d.field === "variables.n").official, "text");
  assert.equal(differences.find(d => d.field === "lists.l.2").missing, "official");
  assert.equal(summarize(differences).x.maxAbsDelta, 3);
  assert.match(summaryTable([{ id: "1", official: { initial: {} }, nekoc: { initial: {} }, differences: { initial: differences, later: [] }, summary: { initial: summarize(differences), later: {} } }]), /x:1 \(max Δ 3\)/);
});

test("missing actors and type changes never silently disappear", () => {
  const result = compareStates({ actors: { a: { visible: false } }, variables: { v: 1 } }, { actors: {}, variables: { v: "1" } });
  assert.equal(result.length, 2);
  assert.equal(result[0].missing, "nekoc");
  assert.equal(result[1].nekoc, "1");
});

test("official zero probe reads before first update and forwards exactly once", () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  let tick = 0;
  const manager = { update(value) { tick++; return value; }, get_elapsed_frames: () => tick, get_global_variable: () => tick };
  const actor = { get_position: () => ({ x: tick, y: 2 }), get_scale: () => ({ x: 1, y: 2 }), get_rotation: () => 0, get_visible: () => true, get_current_style: () => ({ style_id: "c" }) };
  const stage = { get_actor_by_id: () => actor };
  const req = id => id === "stage" ? { a: () => stage } : { b: () => ({ get_runtime_manager: () => manager }) };
  req.m = { stage: function get_actor_by_id() {} };
  globalThis.window = { webpackJsonp: { push: ([, modules]) => Object.values(modules)[0](null, null, req) } };
  globalThis.document = { scripts: [{ src: "https://official/script.js" }] };
  try {
    const original = manager.update;
    installOfficialProbe({ actorIds: ["a"], variableIds: ["v"], listIds: [] });
    assert.equal(manager.update(42), 42);
    assert.equal(window.nekoOfficialProbe.zero.actors.a.x, 0);
    assert.equal(window.nekoOfficialProbe.zero.variables.v, 0);
    assert.equal(window.nekoOfficialProbe.zeroFrames, 0);
    assert.equal(manager.update, original);
    assert.equal(tick, 1);
    assert.equal(window.nekoOfficialProbe.read().actors.a.x, 1);
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test("server launch errors fail fast instead of navigating to an unready port", async () => {
  await assert.rejects(startServer("unused.bcm", { executable: "this-web-binary-does-not-exist", timeout: 1000 }), /ENOENT/);
});

test("snapshot and binary frame responses share one bounded connection without mixing", async () => {
  const previous = globalThis.WebSocket;
  let socket;
  globalThis.WebSocket = class {
    constructor() { socket = this; queueMicrotask(() => this.onmessage({ data: '{"ready":true}' })); }
    send(text) { this.payload = JSON.parse(text); }
    close() {}
  };
  const connection = new PlayerConnection();
  try {
    await connection.open(null, "http://127.0.0.1:1234");
    const read = connection.snapshot();
    assert.deepEqual(socket.payload, { debug_snapshot: true });
    await assert.rejects(connection.frame({ dt: 1 }), /已有运行帧/);
    socket.onmessage({ data: '{"snapshot":{"sequence":0,"actors":{}}}' });
    assert.deepEqual(await read, { sequence: 0, actors: {} });
    const frame = connection.frame({ dt: 0.016 });
    const bytes = new ArrayBuffer(8);
    socket.onmessage({ data: bytes });
    assert.equal(await frame, bytes);
    assert.equal(connection.pending, null);
    assert.equal(connection.ready, true);
  } finally { connection.close(); globalThis.WebSocket = previous; }
});
