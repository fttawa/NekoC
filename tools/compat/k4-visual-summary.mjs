// Pair only matching works/frames/scopes; failed/masked captures never become 0%.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { distribution, rankWorks } from './k4-visual.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';

export function pairedSummary(before,after){
  if(JSON.stringify(before.captureFrames)!==JSON.stringify(after.captureFrames)||before.pixelTolerance!==after.pixelTolerance)throw Error('Incompatible capture settings');
  const old=new Map(before.works.map(w=>[path.basename(w.file),w]));
  const pairs=[],omitted=[];
  for(const work of after.works){
    const previous=old.get(path.basename(work.file));
    if(work.status!=='captured'||previous?.status!=='captured'){omitted.push({file:work.file,before:previous?.status??'missing',after:work.status});continue;}
    const compatible=work.frames.length===before.captureFrames.length&&work.frames.length===previous.frames.length&&work.frames.every((f,i)=>{
      const p=previous.frames[i];return f.frame===before.captureFrames[i]&&f.frame===p.frame&&f.pixels>0&&Number.isFinite(f.changedPercent)&&Number.isFinite(p.changedPercent)&&f.width===p.width&&f.height===p.height&&f.pixels===p.pixels&&f.maskedPixels===p.maskedPixels&&f.scope===p.scope&&(!f.maskedPixels||JSON.stringify(f.videoBounds)===JSON.stringify(p.videoBounds));
    });
    // A moving video mask can change the population even at fixed VM time.
    if(!compatible){omitted.push({file:work.file,reason:'different frame dimensions or comparison scope'});continue;}
    pairs.push({file:work.file,before:previous.frames,after:work.frames});
  }
  const current=new Set(after.works.map(w=>path.basename(w.file)));
  for(const work of before.works)if(!current.has(path.basename(work.file)))omitted.push({file:work.file,before:work.status,after:'missing'});
  const side=key=>pairs.map(p=>({file:p.file,status:'captured',frames:p[key]}));
  const stats=key=>{
    const works=side(key),values=works.flatMap(w=>w.frames.map(f=>f.changedPercent));
    return {...distribution(works),mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
  };
  return {captureFrames:before.captureFrames,pixelTolerance:before.pixelTolerance,works:pairs.length,before:stats('before'),after:stats('after'),ranking:rankWorks(side('before')),afterRanking:rankWorks(side('after')),pairs,omitted};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [before,after,out]=process.argv.slice(2);
  if(!out)throw Error('Usage: node tools/compat/k4-visual-summary.mjs before.json after.json dist/.../paired.json');
  const relative=path.relative(path.resolve('dist'),path.resolve(out));
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Output must be inside this worktree dist/');
  const report=pairedSummary(await readJson(before),await readJson(after));await saveJson(out,report);
  console.log(JSON.stringify({works:report.works,before:report.before,after:report.after,omitted:report.omitted},null,2));
}
