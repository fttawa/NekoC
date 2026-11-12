// Observe native pass targets and projections without reading pixels or changing
// math, framebuffer state, shader precision, filter inputs or native arguments.
import { createHash } from 'node:crypto';
import { partialEffects9Fixtures } from './k4-partial-effects-9-fixtures.mjs';
import { runOracle, saveJson } from './k4-oracle.mjs';
const fixtures=await partialEffects9Fixtures(),report={};
for(const name of process.argv.slice(2)){
 const spec=fixtures[name],samples=[];
 const trace=await runOracle(spec.project,{frames:spec.frames,virtualTime:true,seed:1,
  beforeStart:page=>page.evaluate(aid=>{
   const stage=window.__k4OracleRequire('a1xw').a(),fx=stage.get_actor_by_id(aid).get_effects().value,p=Object.getPrototypeOf(fx),get=p.get_effect_filter;window.samples9=[];
   p.get_effect_filter=function(index){const f=get.call(this,index);if(!f.__probe9){f.__probe9=true;const apply=f.apply;
    f.apply=function(m,input,output,...rest){
     const result=apply.call(this,m,input,output,...rest),r=m.renderer;
     if(window.frame9!=null)window.samples9.push({frame:window.frame9,index,inputSize:[input.width,input.height],inputFrame:input.filterFrame&&{x:input.filterFrame.x,y:input.filterFrame.y,width:input.filterFrame.width,height:input.filterFrame.height},outputSize:output?[output.width,output.height]:null,projection:[...r.projection.projectionMatrix.toArray(true)],filterArea:[...m.globalUniforms.uniforms.filterArea],vertex:[...m.quadUv.vertices],uv:[...m.quadUv.uvs],fragmentPrecision:/precision (\w+) float/.exec(this.program.fragmentSrc)?.[1]});
     return result;
    };
   }return f;};
  },spec.aid),
  onFrame:async(page,frame)=>{
   await page.evaluate(frame=>{window.frame9=frame;const app=window.__k4OracleRequire('a1xw').a().core.app.get_app();app.renderer.render(app.stage);window.frame9=null;},frame);
   samples.push(...await page.evaluate(()=>window.samples9.splice(0)));
  }});
 report[name]={fixtureSha256:createHash('sha256').update(JSON.stringify(spec.project,null,2)+'\n').digest('hex'),samples,assets:trace.diagnostics.assets,errors:trace.errors,pageErrors:trace.diagnostics.pageErrors,externalRequests:trace.diagnostics.externalRequests};
 console.log(name,samples.length,'unmodified native pass observations');
}
await saveJson('docs/kitten4-partial-effects-9-geometry.json',report);
