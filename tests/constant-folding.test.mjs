import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function compile(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nekoc-fold-"));
  try {
    fs.cpSync(path.join(root,"modules/pen-display"),path.join(dir,"display"),{recursive:true});
    fs.writeFileSync(path.join(dir,"main.ts"),source);
    execFileSync(process.execPath,[path.join(root,"ts/compile-ts.mjs"),path.join(dir,"main.ts"),path.join(dir,"out.json")]);
    return JSON.parse(fs.readFileSync(path.join(dir,"out.json"),"utf8"));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

test("constant folding crosses imported inline wrappers and preserves runtime reporters", () => {
  const report=compile(`
    import { rgb, pdMax, pdFloor } from "./display/state";
    onStart(() => {
      setVar("zero",pdMax(0,pdFloor(0)));
      setVar("rgb",rgb(8,12,24));
      setVar("clamped",rgb(-12,999,1.9));
      setVar("negative",floor(-1.2));
      setVar("absolute",mathFunc("abs",-7));
      setVar("dynamic",floor(timerValue() as number));
      setVar("random",randInt(1,2));
      setVar("divide",1 / 0);
      setPenColor(rgb(255,90,40));
      deleteListItem("queue","all",1);
    });`);
  const {blocks,connections}=report.workspaceData;
  const values=Object.values(blocks);
  const assigned = name => {
    const setter=values.find(b=>b.type==="variables_set" && b.fields.variable===name);
    return Object.entries(connections[setter.id]).map(([id])=>blocks[id]).find(b=>b.is_output);
  };
  for(const [name,value] of Object.entries({zero:0,rgb:527384,clamped:65281,negative:-2,absolute:7})) {
    assert.equal(assigned(name).type,"math_number",name);
    assert.equal(Number(assigned(name).fields.NUM),value,name);
  }
  assert.equal(assigned("dynamic").type,"math_round");
  assert.equal(assigned("random").type,"random_num");
  assert.equal(assigned("divide").type,"math_arithmetic");
  assert.equal(values.find(b=>b.type==="self_set_pen_color").fields.color,"#ff5a28");
  const clear=values.find(b=>b.type==="delete_list_item");
  assert.equal(clear.fields.item,"all");
  assert.ok(!Object.values(connections[clear.id]).some(c=>c.input_name==="list_index"));
  for(const [parent,edges] of Object.entries(connections)) {
    assert.ok(blocks[parent],`missing parent ${parent}`);
    for(const child of Object.keys(edges)) assert.ok(blocks[child],`dangling child ${child}`);
  }
});

test("native procedure call fields and mutation both use the definition ID", () => {
  const report=compile(`defineProc("draw rectangle",[],()=>{penDown();moveTo(10,20);penUp();});onStart(()=>{callProc("draw rectangle");});`);
  const call=Object.values(report.workspaceData.blocks).find(b=>b.type==="procedures_2_callnoreturn");
  assert.equal(call.fields.NAME,report.procedures[0].id);
  assert.ok(call.mutation.includes(`name="${report.procedures[0].id}"`));
});

test("statement argument capture preserves folded imported colors", () => {
  const report=compile(`import { rgb } from "./display/state";
function color(value:number){setPenColor(value);}
onStart(()=>{color(rgb(8,12,24));});`);
  assert.equal(Object.values(report.workspaceData.blocks).find(b=>b.type==="self_set_pen_color").fields.color,"#080c18");
});
