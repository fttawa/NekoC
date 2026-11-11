#!/usr/bin/env node
// Read-only source identity check; official bundles must stay outside git.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const source = {
  url: "https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js",
  sha256: "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165",
  anchors: [
    { byteOffset: 1158568, text: 'mouseDown,message0:(0,x.HR)("MOUSEDOWN")' },
    { byteOffset: 1576944, text: '.mouseDown,(function(t,n,r,i,a,o){var s=t.type,c=t.sprite;' },
    { byteOffset: 1720624, text: 'getActorIdsFromOption:function(e)' },
  ],
};

export function check(bytes) {
  if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) {
    throw new Error("Official KN main bundle identity changed; re-audit pointer evidence");
  }
  for (const { byteOffset, text } of source.anchors) {
    if (!bytes.subarray(byteOffset).toString("utf8").startsWith(text)) {
      throw new Error(`KN pointer source anchor changed at byte ${byteOffset}`);
    }
  }
  return { ok: true, sha256: source.sha256, anchors: source.anchors.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(check(fs.readFileSync(process.argv[2] ?? "dist/kncat3/main.8ccf2442.js")));
}
