// Original probes: observe metadata/readbacks, never serialize vendor code.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { transition10Fixtures } from './k4-partial-transition-10.mjs';
import { recordTransition9 } from './k4-partial-transition-9.mjs';
import { saveJson } from './k4-oracle.mjs';
import { readJson } from './k4-oracle.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';

export async function transition11Fixtures(){
  const previous=await transition10Fixtures(),cases={};
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}}),num=n=>b('','math_number',{NUM:String(n)});
  const chain=(...nodes)=>{nodes.slice(1).forEach((n,i)=>{nodes[i].next=n;});return nodes[0];};
  const fx=prefix=>[[0,65],[2,125],[3,9],[5,17],[6,60],[7,8]].map(([scope,v])=>b(`${prefix}-${scope}`,'self_set_effect_2',{scope:String(scope)},{val:num(v)}));
  for(const kind of ['slide','bounce','fadeInOut','distrot','none'])for(const direction of (['slide','bounce'].includes(kind)?['left','right','up','down']:['left'])){
    for(const both of [false,true]){
      const p=structuredClone(previous['slide-filters'].project),[a,c]=p.theatre.scenes_order;
      const nodes=[b('fx-start','start_on_click'),...fx('out')];
      if(both){
        nodes.push(b('prepare-switch','switch_to_screen',{}, {screen:num(2)}),...fx('in'),b('prepare-return','switch_to_screen',{}, {screen:num(1)}));
      }
      // A yielded setup update also provides a genuine outgoing renderer frame.
      nodes.push(b('setup-wait','wait',{}, {time:num(0)}),b('transition','set_scene_transition',{transition:kind,direction}),b('switch','switch_to_screen',{}, {screen:num(2)}));
      p.theatre.scenes[a].block_data_json=workspace([chain(...nodes)],schema);
      const name=`${kind}-${direction}-${both?'both':'out'}`;p.project_name=`NekoC transition 11 ${name}`;
      cases[name]={project:p,kind,direction,
        initialFrame:previous['slide-filters'].initialFrame,
        targetFrame:both?{sprites:[{id:c,style:'background-b',opacity:1,effects:[65,0,25,9,0,17,60,8]}],order:[]}:previous['slide-filters'].targetFrame};
    }
  }
  return cases;
}

export async function recordTransition11(name,spec,{diagnose=false}={}){
  const geometry=[],readbacks=[];
  const result=await recordTransition9(`${spec.kind??name.split('-')[0]}-${spec.direction??'left'}`,spec.project,{...spec,
    beforeStart:async page=>page.evaluate(()=>{
      const stage=window.__k4OracleRequire('a1xw').a(),fx=stage.get_scene_by_id(stage.core.scenes.get_current_scene()).get_effects().value;
      const proto=Object.getPrototypeOf(fx),get=proto.get_effect_filter;
      window.__transition11Passes=[];
      proto.get_effect_filter=function(index){const f=get.call(this,index);if(!f.__observed11){
        f.__observed11=true;const apply=f.apply;
        f.apply=function(manager,input,output,...args){
          // Complete one representative chain at each sampled timestamp. Bound
          // diagnostics without omitting the late slide clipping interval.
          const ms=window.__transitionNow??0;
          if(window.__transition11Passes.length<400&&!window.__transition11Passes.some(p=>p.ms===ms&&p.index===index))window.__transition11Passes.push({ms,index,input:[input.width,input.height],frame:{...input.filterFrame},output:output&&[output.width,output.height],offset:this.offset&&{x:this.offset.x,y:this.offset.y}});
          return apply.call(this,manager,input,output,...args);
        };
      }return f;};
    }),
    onInspect:async(page,frame)=>{
      if(frame===65)geometry.push(...await page.evaluate(()=>window.__transition11Passes));
      if(!diagnose||frame!==2)return;
      readbacks.push(await page.evaluate(()=>{
        const stage=window.__k4OracleRequire('a1xw').a(),app=stage.core.app.get_app(),r=window.__transition9Renderer;
        const read=(gl,texture,w,h)=>{const old=gl.getParameter(gl.FRAMEBUFFER_BINDING),fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);const bytes=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bytes);gl.bindFramebuffer(gl.FRAMEBUFFER,old);gl.deleteFramebuffer(fb);return bytes;};
        return [stage.core.scenes.transition.out_sprite,stage.core.scenes.transition.in_sprite].filter(Boolean).map((s,i)=>{
          const t=s.texture,a=read(app.renderer.gl,t.baseTexture._glTextures[app.renderer.CONTEXT_UID].texture,t.width,t.height),b=read(r.gl,r.sceneTransition.screenshots[i].texture,t.width,t.height);
          let changed=0,max=0,sum=0;const samples=[];for(let j=0;j<a.length;j++){const k=(t.height-1-Math.floor(j/4/t.width))*t.width*4+j%(t.width*4),d=Math.abs(a[k]-b[j]);sum+=d;max=Math.max(max,d);if(d>8){changed++;if(samples.length<10)samples.push({x:(j/4|0)%t.width,y:Math.floor(j/4/t.width),channel:j%4,a:a[k],b:b[j]});}}
          return {i,width:t.width,height:t.height,changedChannels:changed,max,mae:sum/a.length,samples};
        });
      }));
    }});
  return {...result,geometry,...(diagnose?{readbacks}:{} )};
}

async function main(){
  const rendererLfSha256=createHash('sha256').update((await readFile('web/renderer.js','utf8')).replaceAll('\r\n','\n')).digest('hex');
  const names=process.argv.slice(2).filter(s=>!s.startsWith('--'));
  for(const [name,spec]of Object.entries(await transition10Fixtures())){
    if(names.length&&!names.includes(name))continue;
    const result=await recordTransition11(name,spec,{diagnose:process.argv.includes('--diagnose')});
    const out=process.argv.includes('--record')?'docs/kitten4-partial-transition-11-':'dist/k4effects11/';
    await saveJson(`${out}${name}.json`,{schema:'nekoc-k4-transition-11-v1',scope:'official native VM/ticker vs independent renderer input; full 65 consecutive frames, RGB tolerance 8, no masks',rendererLfSha256,...result});
    console.log(name,JSON.stringify({maxChanged:Math.max(...result.pixels.map(p=>p.changedPixels)),maxMae:Math.max(...result.pixels.map(p=>p.mae)),readbacks:result.readbacks,geometry:result.geometry.slice(0,12)}));
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
