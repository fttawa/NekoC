#!/usr/bin/env node
// Verify source identities and write byte-addressed excerpts; never vendor a runtime.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const root = "dist/kncat";
const files = {
  main: "main.8ccf2442.js",
  vendors: "main-vendors.07f7dd7e.js",
  crc: "crc_libs.8196dbd1.js",
};
const expected = {
  main: "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165",
  vendors: "38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68",
  crc: "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7",
};
const sources = {};
for (const [key, file] of Object.entries(files)) {
  const bytes = await fs.readFile(`${root}/${file}`);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), expected[key]);
  sources[key] = bytes.toString("utf8");
}
const entries = [];
function excerpt(id, file, needle, size = 800, occurrence = 0) {
  const source = sources[file];
  let at = -1;
  for (let index = 0; index <= occurrence; index++) at = source.indexOf(needle, at + 1);
  assert.ok(at >= 0, `${id}: source anchor missing`);
  const text = source.slice(at, at + size);
  entries.push({ id, file: files[file], url: `https://creation.bcmcdn.com/neko/web/release/static/js/${files[file]}`, sha256: expected[file], byteOffset: Buffer.byteLength(source.slice(0, at)), byteLength: Buffer.byteLength(text), excerpt: text });
}
excerpt("break-api-alias", "main", "export type __break__", 100);
excerpt("break-api-annotations", "main", "#blockName break", 130);
excerpt("script-set-js-to-xml", "main", 'at="script_variables_set"', 1250);
excerpt("script-change-js-to-xml-bug", "main", 'W="change_script_variables"', 1280);
excerpt("script-change-runtime", "main", '(t,u.LO.changeVariables,(function(e,t,n,c,d,p)', 1000);
excerpt("script-set-runtime", "main", '(t,u.LO.variablesSet,(function(e,t,n,c,d,p)', 800);
excerpt("script-variable-type-tag", "main", 'var r="NEKO_SCRIPT_VARIABLE_TYPE', 80);
excerpt("execute-runtime", "main", '_execute:function(e){}', 30);
excerpt("array-runtime", "main", '_array_literal:function(e){return Object.values(e)}', 60);
excerpt("while-type", "vendors", "export type controls_while", 110);
excerpt("break-statement-type", "vendors", "export type _break_statement", 65);
excerpt("continue-statement-type", "vendors", "export type _continue_statement", 70);
excerpt("return-type", "vendors", "export type _return_statement", 90);
excerpt("while-to-js", "vendors", 'key:"convertWhileStatement"', 390, 1);
excerpt("break-to-js", "vendors", 'key:"convertBreakStatement"', 80, 1);
excerpt("continue-to-js", "vendors", 'key:"convertContinueStatement"', 90, 1);
excerpt("return-to-js", "vendors", 'key:"convertReturnStatement"', 250, 1);
excerpt("execute-unwrapping", "vendors", 'if("_execute"===e.attributes.type)', 260);
excerpt("array-to-js", "vendors", 'key:"convertArrayWith"', 560);
excerpt("break-block", "crc", 'type:"break"', 170);
excerpt("calculate-block", "crc", 'type:"calculate"', 245);
excerpt("calculate-runtime", "crc", 'calculate:function', 180);
excerpt("get-timer-block", "crc", 'type:"get_timer"', 150);
excerpt("reset-timer-block", "crc", 'type:"reset_timer"', 185);
excerpt("get-timer-runtime", "crc", 'get_timer:function', 110);
excerpt("reset-timer-runtime", "crc", 'reset_timer:function', 90);
excerpt("timer-run-origin", "crc", 'prototype.run=function(){this.timer_block_date', 140);
excerpt("timer-reset-origin", "crc", 'prototype.reset_timer=function(){this.timer_block_date', 80);
excerpt("timer-elapsed", "crc", 'prototype.get_timer_elapsed_s=function()', 100);
excerpt("break-compiler", "crc", 't.prototype.compile_break=function', 730);
await fs.writeFile(`${root}/oracle-source-locations.json`, JSON.stringify({ byteOffsetsAreZeroBased: true, entries }, null, 2));
console.log(`PASS: ${Object.keys(files).length} SHA-256 identities and ${entries.length} official source anchors`);
