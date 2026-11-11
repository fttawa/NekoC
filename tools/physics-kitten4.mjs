#!/usr/bin/env node
// Run actual Blockly workspaces in the unmodified official editor.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadPlaywright, openOfficial, loadOfficialProject, officialUrl } from "./probe-kitten4.mjs";
import { fixtures, actorId } from "./physics-fixtures.mjs";

const directory="tests/fixtures/kitten4";
const cases=fixtures();
if(process.argv.includes("--generate")) {
  await mkdir(directory,{recursive:true});
  for(const [name,project] of Object.entries(cases)) await writeFile(`${directory}/physics-${name}.bcm`,JSON.stringify(project,null,2)+"\n");
} else {
  const browser=await loadPlaywright().chromium.launch({headless:true,channel:"msedge"});
  const report={officialUrl,verifiedAt:new Date().toISOString(),browserVersion:browser.version(),cases:{}};
  try {
    const selected=process.argv.includes("--case")?[process.argv[process.argv.indexOf("--case")+1]]:Object.keys(cases);
    for(const name of selected) {
      const page=await browser.newPage();
      const result=report.cases[name]={checkpoints:[],pageErrors:[]};
      page.on("pageerror",e=>result.pageErrors.push(String(e)));
      try {
        await openOfficial(page);
        await page.evaluate(async()=>{await window.__nekocKitten4Require.e(6);});
        if(process.argv.includes("--inspect")) {
          const modules=await page.evaluate(()=>({scripts:[...document.scripts].map(s=>s.src).filter(Boolean),modules:Object.entries(window.__nekocKitten4Require.m).filter(([id,fn])=>["Pcni","49df","ucDc"].includes(id)||/physics2_|set_physics|physics_world/.test(String(fn))).map(([id,fn])=>({id,source:String(fn)}))}));
          await mkdir("dist/physics",{recursive:true});
          await writeFile("dist/physics/modules.json",JSON.stringify(modules,null,2));
        }
        const filename=`${directory}/physics-${name}.bcm`;
        const source=await readFile(filename,"utf8");
        const project=JSON.parse(source);
        result.fixture=filename;
        result.sha256=createHash("sha256").update(source).digest("hex");
        await loadOfficialProject(page,project);
        result.scripts=await page.evaluate(()=>[...document.scripts].map(s=>s.src).filter(Boolean));
        result.applicationVersion=await page.evaluate(()=>window.__nekocKitten4Require("3PHN").d().application_version);
        result.workspaceIssues=await page.evaluate(project=>{
          const issues=[],req=window.__nekocKitten4Require;
          for(const [owner,entity] of Object.entries(project.theatre.actors)) {
            req("Fye/").B.select_workspace_by_id(owner);
            const actual=Blockly.json.workspace_to_json(Blockly.mainWorkspace),wanted=entity.block_data_json;
            for(const [id,b] of Object.entries(wanted.blocks)) {
              if(actual.blocks[id]?.type!==b.type)issues.push(`${owner}/${id}: changed type`);
              for(const [k,v] of Object.entries(b.fields))if(String(actual.blocks[id]?.fields[k])!==String(v))issues.push(`${owner}/${id}.${k}: changed field`);
              for(const [child,edge] of Object.entries(wanted.connections[id]))if(Object.entries(edge).some(([k,v])=>actual.connections[id]?.[child]?.[k]!==v))issues.push(`${owner}/${id}->${child}: changed edge`);
            }
          }
          return issues;
        },project);
        if(result.workspaceIssues.length)throw new Error(result.workspaceIssues.join("; "));
        if(name === "soft" && await page.locator("#btn_trigger").count() === 0) {
          result.unsupportedEditor = await page.locator("body").innerText();
          throw new Error("Official editor does not expose the run button after loading soft-body blocks; see unsupportedEditor");
        }
        await page.locator("#btn_trigger").dispatchEvent("click", {timeout:5000});
        for(const delay of [150,500,650,1050,1800]) {
          await page.waitForTimeout(delay);
          result.checkpoints.push({afterDelayMs:delay,state:await page.evaluate(actorId=>{
            const req=window.__nekocKitten4Require,doc=req("TzHo").e.getDoc(),heart=req("JnWR").b(),manager=heart.get_runtime_manager(),stage=req("HP1x").a();
            return {variables:Object.fromEntries(Object.entries(doc.variables).map(([id,v])=>[id,manager.get_variable(id,undefined,v.current_entity)])),actors:Object.fromEntries(Object.keys(doc.theatre.actors).map(id=>[id,stage.get_actor_by_id(id)?.get_position()])),error:req("ALsR").a.get_state().error_state,running:heart.get_runtime_data().is_running()};
          },actorId)});
        }
      } catch(error) {
        result.error=String(error);
        if(name==="soft") result.unsupportedEditor=await page.locator("body").innerText().catch(()=>"Unavailable");
      }
      finally {await page.close();}
      console.log(JSON.stringify({name,...result},null,2));
    }
  } finally {await browser.close();}
  const passed=([name,r])=> {
    if(r.error||r.pageErrors.length||!r.checkpoints.length||r.checkpoints.some(p=>p.state.error.show_error)) return false;
    const v=r.checkpoints.at(-1).state.variables;
    // Floor scripts also set the shared done variable. Require the probe's
    // final observations rather than falsely accepting the floor's completion.
    const observed=name==="collision"?v.throughY< -80:name==="boundary"?v.throughY< -370:name==="friction"?v.slidingX>0&&v.slidingSpeed>0:name==="rotation"?Math.abs(v.rotation)>1:true;
    return v.done===1&&observed;
  };
  report.ok=Object.entries(report.cases).every(passed);
  const rigid=Object.entries(report.cases).filter(([name])=>name!=="soft");
  report.rigidOk=rigid.length?rigid.every(passed):null;
  const out=process.argv.includes("--out")?process.argv[process.argv.indexOf("--out")+1]:"dist/physics/official.json";
  await mkdir(out.slice(0,out.lastIndexOf("/"))||".",{recursive:true});
  await writeFile(out,JSON.stringify(report,null,2)+"\n");
  if(!report.ok)process.exitCode=1;
}
