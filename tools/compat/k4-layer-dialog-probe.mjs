// Capture only owned probe observations; vendor implementation stays external.
import { runOracle, saveJson } from './k4-oracle.mjs';
import { layerDialogFixtures } from './k4-layer-dialog-fixtures.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function probe(name,project){
  const observations=[];
  const trace=await runOracle(project,{frames:8,onFrame:async(page,frame)=>{
    observations.push(await page.evaluate(frame=>{
      const stage=window.__k4OracleRequire('a1xw').a();
      const scene=stage.get_scene_by_id(stage.core.scenes.get_current_scene());
      const d=stage.core.components.get_stage_dialog();
      const order=scene.get_actor_ids().map(id=>{
        const actor=stage.get_actor_by_id(id),original=actor.get_prototype_actor_id();
        if(!original)return id;
        const clones=window.__k4Oracle.heart.get_runtime_data().get_sprite_clones(original);
        return original+'#'+(clones.indexOf(id)+1);
      });
      const state={frame,order,variables:window.__k4Oracle.snapshot().variables,
        penLayer:scene.get_brush_target()?scene.get_brush_target().get_z_index()+1:0,
        dialog:{visible:d.visible,printing:d.is_printing,text:d.content.text,name:d.target_name.text}};
      // First click while printing completes text; second acknowledges. For a
      // multipage dialog subsequent releases must turn pages, not unlock early.
      if(d.visible&&(frame===2||frame===3||frame===4||frame===5||frame===6))d.on_mouse_up();
      return state;
    },frame));
    if(frame===3&&name.startsWith('clone-'))await page.keyboard.down('a');
    if(frame===4&&name.startsWith('clone-'))await page.keyboard.up('a');
  }});
  return {observations,errors:trace.errors,kernelAssets:trace.diagnostics.assets};
}

// Discard incidental typewriter progress; retain reproducible semantic evidence.
export function summarizeProbe(probe){
  return {
    orders:probe.observations.map(o=>o.order),
    penLayers:probe.observations.map(o=>o.penLayer),
    variables:probe.observations.map(o=>o.variables),
    visible:probe.observations.map(o=>o.dialog.visible),
    printingAfterFirstClick:probe.observations[2].dialog.printing,
    firstCompletedText:probe.observations[2].dialog.text,
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result={};
  for(const [name,p]of Object.entries(await layerDialogFixtures())){
    console.error(name);result[name]=await probe(name,p);
  }
  await saveJson('dist/visual2/layer-dialog-official.json',result);
  if(process.argv.includes('--evidence'))await saveJson('docs/kitten4-layer-dialog-evidence.json',{
    kernel:result.chain.kernelAssets.find(a=>a.source.endsWith('.orig')),
    cases:Object.fromEntries(Object.entries(result).map(([name,p])=>[name,summarizeProbe(p)])),
  });
}
