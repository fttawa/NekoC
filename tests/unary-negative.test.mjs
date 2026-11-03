import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('computed negative coordinates retain connected operands', () => {
  const dir=fs.mkdtempSync('D:/AppData/Local/Temp/opencode/nekoc-negative-');
  try {
    fs.writeFileSync(path.join(dir,'main.ts'),'onStart(()=>{moveTo(-(getVar("width") as number)/2-12,0);});');
    execFileSync(process.execPath,[path.resolve('ts/compile-ts.mjs'),path.join(dir,'main.ts'),path.join(dir,'out.json')]);
    const {workspaceData:{blocks,connections}}=JSON.parse(fs.readFileSync(path.join(dir,'out.json'),'utf8'));
    const input=(b,name)=>blocks[Object.entries(connections[b.id]||{}).find(([,c])=>c.input_name===name)?.[0]];
    const unary=Object.values(blocks).find(b=>b.type==='math_arithmetic'&&input(b,'B')?.type==='variables_get');
    assert.ok(unary,'negative reporter has its variable connected');
    assert.equal(unary.fields.type,'minus');
    assert.equal(input(unary,'A').fields.NUM,'0');
    assert.equal(input(unary,'B').parent_id,unary.id);
    assert.equal(input(unary,'A').parent_id,unary.id);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('prefix negation retains its operand and parent links through nested boolean expressions', () => {
  const dir=fs.mkdtempSync('D:/AppData/Local/Temp/opencode/nekoc-negate-');
  try {
    fs.writeFileSync(path.join(dir,'main.ts'),'onStart(()=>{if (!keyPressed("32")) setVar("x",1);setVar("double",!!keyPressed("65"));});');
    execFileSync(process.execPath,[path.resolve('ts/compile-ts.mjs'),path.join(dir,'main.ts'),path.join(dir,'out.json')]);
    const {workspaceData:{blocks,connections}}=JSON.parse(fs.readFileSync(path.join(dir,'out.json'),'utf8'));
    const negations=Object.values(blocks).filter(b=>b.type==='logic_negate');
    assert.equal(negations.length,3);
    for(const negate of negations){
      const entry=Object.entries(connections[negate.id]||{}).find(([,c])=>c.input_name==='logic');
      assert.ok(entry,`negation ${negate.id} must connect its logic input`);
      assert.equal(entry[1].input_type,'value');
      assert.equal(blocks[entry[0]].parent_id,negate.id);
      assert.ok(['check_key','logic_negate'].includes(blocks[entry[0]].type));
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('dynamic changeVar and default held-key state compile to native inputs', () => {
  const dir=fs.mkdtempSync('D:/AppData/Local/Temp/opencode/nekoc-change-');
  try {
    fs.writeFileSync(path.join(dir,'main.ts'),'onStart(()=>{changeVar("x",(getVar("speed") as number)*-2);setVar("held",keyPressed("87"));});');
    execFileSync(process.execPath,[path.resolve('ts/compile-ts.mjs'),path.join(dir,'main.ts'),path.join(dir,'out.json')]);
    const {workspaceData:{blocks,connections}}=JSON.parse(fs.readFileSync(path.join(dir,'out.json'),'utf8'));
    const change=Object.values(blocks).find(b=>b.type==='change_variables');
    assert.equal(change.fields.method,'increase');
    const input=Object.entries(connections[change.id]).find(([,c])=>c.input_name==='value')[0];
    assert.equal(blocks[input].type,'math_arithmetic');
    assert.equal(Object.values(blocks).find(b=>b.type==='check_key').fields.type,'down');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('script-variable declarations retain each native mutator socket', () => {
  const dir=fs.mkdtempSync('D:/AppData/Local/Temp/opencode/nekoc-locals-test-');
  try {
    fs.writeFileSync(path.join(dir,'main.ts'),'onStart(()=>{scriptVars("x","y");setVar("result",scriptVar("x"));});');
    execFileSync(process.execPath,[path.resolve('ts/compile-ts.mjs'),path.join(dir,'main.ts'),path.join(dir,'out.json')]);
    const {workspaceData:{blocks,connections}}=JSON.parse(fs.readFileSync(path.join(dir,'out.json'),'utf8'));
    const declaration=Object.values(blocks).find(b=>b.type==='script_variables');
    for(let i=0;i<2;i++) {
      assert.ok(declaration.mutation.includes(`<arg name="PARAMS${i}"></arg>`));
      const id=Object.entries(connections[declaration.id]).find(([,c])=>c.input_name===`PARAMS${i}`)?.[0];
      assert.equal(blocks[id].fields.TEXT,['x','y'][i]);
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
