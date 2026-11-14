import test from "node:test";
import assert from "node:assert/strict";

// A stand-in for the module Worker: records posts, lets the test reply.
class FakeWorker {
  static last = null;
  constructor(url, options) { this.url = String(url); this.options = options; this.posts = []; FakeWorker.last = this; }
  postMessage(message) { this.posts.push(message); }
  reply(data) { this.onmessage({ data }); }
}
globalThis.Worker = FakeWorker;
const { httpBackend, wasmBackend } = await import("../web/backend.js");
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("wasm backend routes player API calls to the worker", async () => {
  const backend = wasmBackend(new URL("https://example.test/play/wasm-worker.js"));
  const worker = FakeWorker.last;
  assert.equal(backend.kind, "wasm");
  assert.deepEqual(worker.options, { type: "module" });

  const imported = backend.api("import-player", { projectName: "a" });
  assert.deepEqual(worker.posts[0], { call: 1, name: "importProject", value: { projectName: "a" } });
  worker.reply({ call: 1, value: { fast_runtime_ready: true, project: { projectName: "a" } } });
  assert.equal((await imported).fast_runtime_ready, true);

  const checked = backend.api("extension-check", { project: {}, extensions: [] });
  assert.equal(worker.posts[1].name, "checkExtensions");
  worker.reply({ call: 2, error: "bad schema" });
  await assert.rejects(checked, /bad schema/);
  await assert.rejects(backend.api("export", {}), /不支持 export/);
});

test("wasm backend sockets behave like the player WebSocket", async () => {
  const backend = wasmBackend();
  const worker = FakeWorker.last;
  assert.throws(() => backend.connect(null), /需要作品数据/);
  const socket = backend.connect({ projectName: "a" });
  const events = [];
  socket.onopen = () => events.push("open");
  socket.onmessage = event => events.push(event.data);
  socket.onclose = () => events.push("close");
  await tick();
  assert.deepEqual(events, ["open"]);

  socket.send("{\"handshake\":1}");
  const id = worker.posts.at(-1).socket;
  assert.deepEqual(worker.posts.at(-1), { socket: id, text: "{\"handshake\":1}" });
  worker.reply({ socket: id, message: "{\"ready\":true}" });
  const frame = new ArrayBuffer(4);
  worker.reply({ socket: id, message: frame });
  worker.reply({ socket: id, message: "{\"error\":\"boom\"}" });
  worker.reply({ socket: id, closed: true });
  assert.deepEqual(events, ["open", "{\"ready\":true}", frame, "{\"error\":\"boom\"}", "close"]);

  // A closed socket sends nothing more.
  const posts = worker.posts.length;
  socket.send("{}");
  socket.close();
  assert.equal(worker.posts.length, posts);
});

test("closing a wasm socket frees its player in the worker", async () => {
  const backend = wasmBackend();
  const worker = FakeWorker.last;
  const socket = backend.connect({});
  socket.send("{}");
  const id = worker.posts.at(-1).socket;
  socket.close();
  assert.deepEqual(worker.posts.at(-1), { socket: id, close: true });
});

test("http backend keeps the local Rust endpoints", () => {
  const backend = httpBackend("http://127.0.0.1:4173");
  assert.equal(backend.kind, "rust");
  assert.equal(backend.origin, "http://127.0.0.1:4173");
});
