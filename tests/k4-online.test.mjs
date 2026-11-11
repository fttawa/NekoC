import test from "node:test";
import assert from "node:assert/strict";
import { officialUrl, pageScripts, factoryTable, compareBundles } from "../tools/compat/k4-online.mjs";
import { allowedRead, publicRequestHeaders } from "../tools/compat/k4-online-trace.mjs";

test("online evidence only accepts anonymous official HTTPS origins", () => {
  for (const url of ["https://player.codemao.cn/new/1", "https://kn-cdn.codemao.cn/a.js", "https://creation.bcmcdn.com/a"]) {
    assert.equal(officialUrl(url).href, url);
  }
  for (const url of ["http://player.codemao.cn", "https://codemao.cn.evil.test/a", "https://user:secret@codemao.cn/a", "file:///a"]) {
    assert.throws(() => officialUrl(url));
  }
  assert.deepEqual(pageScripts('<script src="/a.js"></script><script>ignored()</script>', "https://player.codemao.cn/new/1"), ["https://player.codemao.cn/a.js"]);
  assert.deepEqual(pageScripts('<script>document.write(\'<script src="/conditional.js"><\\/script>\')</script>', "https://player.codemao.cn/new/1"), []);
});

test("live adapter never sends write requests or third-party tracking", () => {
  assert.equal(allowedRead("https://player.codemao.cn/new/1", "HEAD"), true);
  assert.equal(allowedRead("https://collection.codemao.cn/report/kitten", "POST"), false);
  assert.equal(allowedRead("https://pv.sohu.com/cityjson", "GET"), false);
  assert.equal(allowedRead("https://api.codemao.cn/example", "DELETE"), false);
  assert.equal(allowedRead("https://api.codemao.cn/example", "GET"), true);
  assert.deepEqual(publicRequestHeaders({ origin: "https://player.codemao.cn", cookie: "synthetic", authorization: "synthetic", referer: "synthetic" }),
    { Origin: "https://player.codemao.cn" });
  assert.deepEqual(publicRequestHeaders({ cookie: "synthetic" }), {});
});

const bundle = factories => `(window.webpackJsonp=window.webpackJsonp||[]).push([[1],{${factories}}]);`;
test("static factory comparison normalizes formatting without executing vendor code", () => {
  const a = bundle('A:function(m){throw Error("never execute")}, B:function(m){m.x=1}');
  const b = bundle('A: function (m) { /* whitespace */ throw Error("never execute"); }, B:function(m){m.x=2}');
  const result = compareBundles(a, b);
  assert.deepEqual(result.equal, ["A"]);
  assert.deepEqual(result.changed.map(x => x.id), ["B"]);
  assert.equal(factoryTable(a).size, 2);
  assert.throws(() => factoryTable("not a bundle"));
  assert.throws(() => factoryTable(bundle('A:function(){}, A:function(){}')));
});

test("factory diff records additions/removals and changed method names", () => {
  const result = compareBundles(bundle('A:function(m){m.go=function(){return 2}}, C:function(){}'),
    bundle('A:function(m){m.go=function(){return 1}}, B:function(){}'));
  assert.deepEqual(result.added, ["C"]);
  assert.deepEqual(result.removed, ["B"]);
  assert.deepEqual(result.changed[0].changedFunctions, ["m.go"]);
});
