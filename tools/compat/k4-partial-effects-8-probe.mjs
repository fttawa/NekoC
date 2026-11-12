// Read-only native filter geometry observations; no replacement of native math.
import { partialEffects7Fixtures } from './k4-partial-effects-7-fixtures.mjs';
import { partialEffects8Fixtures } from './k4-partial-effects-8-fixtures.mjs';
import { runOracle, saveJson } from './k4-oracle.mjs';
import { createHash } from 'node:crypto';
const fixtures={...await partialEffects7Fixtures(),...await partialEffects8Fixtures()},report={};
for(const name of process.argv.slice(2)){
  const spec=fixtures[name],samples=[];
  const result=await runOracle(spec.project,{frames:spec.frames,virtualTime:true,seed:1,
    beforeStart:page=>page.evaluate(({aid,sid,scene})=>{
      const stage=window.__k4OracleRequire('a1xw').a(),target=scene?stage.get_scene_by_id(sid):stage.get_actor_by_id(aid);
      const fx=target.get_effects().value,proto=Object.getPrototypeOf(fx),original=proto.get_effect_filter;
      window.filterSamples=[];
      proto.get_effect_filter=function(index){const filter=original.call(this,index);if(!filter.__observed8){
        filter.__observed8=true;const apply=filter.apply;
        filter.apply=function(manager,input,output,...args){window.filterSamples.push({index,frame:window.frame8,input:{width:input.width,height:input.height,filterFrame:input.filterFrame},size:this.size,angle:this.angle,radius:this.radius,offset:this.offset,padding:this.padding,filterArea:[...manager.globalUniforms.uniforms.filterArea]});return apply.call(this,manager,input,output,...args);};
      }return filter;};
    },{aid:spec.aid,sid:spec.sid,scene:name.startsWith('scene-')}),
    onFrame:async(page,frame)=>{
      await page.evaluate(frame=>{window.frame8=frame;const stage=window.__k4OracleRequire('a1xw').a(),app=stage.core.app.get_app();app.renderer.render(app.stage);},frame);
      samples.push(...await page.evaluate(()=>window.filterSamples.splice(0)));
    }});
  report[name]={fixtureSha256:createHash('sha256').update(JSON.stringify(spec.project,null,2)+'\n').digest('hex'),samples,errors:result.errors,assets:result.diagnostics.assets,pageErrors:result.diagnostics.pageErrors,externalRequests:result.diagnostics.externalRequests};
  console.log(name,`${samples.length} native filter observations`);
}
await saveJson('dist/partial-effects-8/probe.json',report);
await saveJson('docs/kitten4-partial-effects-8-geometry.json',report);
