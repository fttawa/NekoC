// Explicitly failed input, not counted as completed official frames.
import { createHash } from "node:crypto";
import { physicsSoftBlockedFixture } from "./k4-partial-physics-9-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";
const project=physicsSoftBlockedFixture(),fixture="tests/fixtures/kitten4/partial-physics-9-rectangle-blocked.bcm";
await saveJson(fixture,project);
const result={schema:"nekoc-k4-soft-blocked-9-v1",fixture,sha256:createHash("sha256").update(JSON.stringify(project,null,2)+"\n").digest("hex"),watchdogMs:10000};
try {
  const trace=await runOracle(project,{frames:2,virtualTime:true,wallTimeoutMs:result.watchdogMs,beforeStart:async page=>{
    result.environment=await page.evaluate(()=>{
      const gl=document.createElement("canvas").getContext("webgl");
      return {uniformVectors:gl?.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)};
    });
  }});
  Object.assign(result,{status:"completed",frames:trace.frames.length,errors:trace.errors,diagnostics:trace.diagnostics});
} catch(error) {
  Object.assign(result,{status:error.diagnostics?.watchdog?"unverified-timeout":"unverified-error",frames:error.diagnostics?.partialTrace?.frames?.length||0,error:error.message,diagnostics:error.diagnostics});
}
await saveJson("docs/kitten4-partial-physics-9-blocked-evidence.json",result);
console.log(result.status,result.frames,result.diagnostics?.watchdog);
