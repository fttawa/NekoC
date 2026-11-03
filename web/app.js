import {StageRenderer,decodeFrame} from './renderer.js';
import {PlayerConnection} from './player.js';
import {ProjectAudio} from './audio.js';
import {StageInput} from './input.js';
const audio=new ProjectAudio(message=>log(message,true));
window.addEventListener('pointerdown',()=>audio.unlock(),{capture:true});
window.addEventListener('keydown',()=>audio.unlock(),{capture:true});
window.addEventListener('pagehide',()=>audio.stop());
const $=s=>document.querySelector(s);
for(const id of ['pause','stop','undo','redo'])$(`#${id}`).setAttribute('aria-label',$(`#${id}`).title);
const palette=[
  ['on_running_group_activated','当开始运行','event',{}],
  ['self_go_forward','移动步数','motion',{steps:10}],
  ['self_rotate','旋转角度','motion',{degrees:24}],
  ['self_move_to','移动到坐标','motion',{x:0,y:0}],
  ['repeat_n_times','重复执行','control',{times:15}],
  ['repeat_forever','持续执行','control',{}],
  ['warp','不刷新屏幕执行','control',{}],
  ['wait','等待秒数','control',{time:1}],
  ['self_pen_down','落下画笔','pen',{}],
  ['self_pen_up','抬起画笔','pen',{}],
  ['self_set_pen_color','设置画笔颜色','pen',{}],
  ['self_set_pen_size','设置画笔大小','pen',{size:4}],
  ['clear_drawing','清空画笔图层','pen',{}],
];
const labels=Object.fromEntries(palette.map(([type,name])=>[type,name]));
Object.assign(labels,{console_log:'输出到控制台',variables_set:'设置变量',change_variables:'改变变量',controls_if:'如果条件成立',self_point_towards:'面向方向',set_scale:'设置大小',stop:'停止脚本'});
Object.assign(labels,{on_keydown:'当按下按键',timer:'计时器',set_timer_state:'控制计时器',traverse_number:'遍历数值',traverse_number_value:'当前遍历值',traverse_number_param:'遍历变量',self_set_pen_color_property:'设置画笔属性',self_change_pen_color_property:'改变画笔属性',stamp:'文字印章',text_join:'连接文本',delete_list_item:'删除列表项',list_append:'添加列表项',list_length:'列表长度',list_item:'读取列表项',pure_list_get:'列表',procedures_2_callnoreturn:'调用自制积木',repeat_forever_until:'重复直到条件成立'});
Object.assign(labels,{script_variables:'定义脚本局部变量',script_variables_param:'局部变量名',script_variables_value:'读取局部变量',temporary_list:'临时列表',list_copy:'复制列表',list_insert_value:'插入列表项',replace_list_item:'替换列表项',text_select:'截取文字',convert_type:'转换类型',show_hide_timer:'显示 / 隐藏计时器',check_key:'按键是否按下'});
const fieldLabels={steps:'步数',degrees:'角度',times:'次数',size:'大小',color:'颜色',console_log:'内容',value:'值',time:'秒',x:'X',y:'Y',scale:'大小',variable:'变量',key:'按键',scope:'属性',val:'值',align:'对齐',text:'文字',from:'从',to:'到',by:'步长',list:'列表',list_index:'序号',list_item_value:'内容'};
const colors={event:['#ece9d9','#ddd7ba','#8c7d3f'],motion:['#e4edf4','#ccdce7','#4e7898'],control:['#ebe7f0','#d7cce3','#86709b'],pen:['#e6eee2','#cddfc3','#658052']};
const symbols={event:'⚑',motion:'↗',control:'↻',pen:'⌁'};
let project,owner='',selected='',dirty=false,undo=[],redo=[],renderer,input;
let running=false,started=false,inFlight=null,epoch=0,lastTick=0,lastFrame=null,lastBytes=0;
let player=null,starting=null;
const timerLabel=make('div','stage-timer');timerLabel.hidden=true;$('#stage').parentElement.append(timerLabel);
let pipeline={roundtripMs:0,decodeMs:0,completedFrames:0,transport:'websocket'};
let fps=0,frames=0,fpsStart=performance.now(),lastMonitor=0,history=[];
let categoryFilter='';
for(const [index,el]of [...document.querySelectorAll('.category-pills span')].entries()){
  el.tabIndex=0;el.role='button';
  const activate=()=>{categoryFilter=['','event','motion','pen'][index];for(const item of document.querySelectorAll('.category-pills span'))item.classList.toggle('chosen',item===el);renderPalette();};
  el.onclick=activate;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};
}
const api=async(path,data)=>{
  const response=await fetch(`/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data??{})});
  if(!response.ok){const value=await response.json();throw Error(value.error||`HTTP ${response.status}`);}
  return response;
};
function log(message,error=false){const node=document.createElement('p');node.textContent=`${error?'!':'›'} ${message}`;if(error)node.className='error';$('#logs .muted')?.remove();$('#logs').append(node);while($('#logs').children.length>100)$('#logs').firstChild.remove();$('#logs').scrollTop=$('#logs').scrollHeight;}
function notify(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('show'),3000);}
function markDirty(){dirty=true;$('#dirty').textContent='未保存更改';$('#compile-status').textContent='项目已修改，等待重新编译';}
function transaction(fn){if(started){notify('请先停止运行，再编辑项目');return;}const before=JSON.stringify(project);fn();if(JSON.stringify(project)!==before){undo.push(before);if(undo.length>80)undo.shift();redo=[];markDirty();}renderEditor();}
function find(id,value=entity()?.nekoBlockJsonList){if(!value||typeof value!=='object')return null;if(value.id===id&&value.type)return value;for(const v of Object.values(value)){const b=find(id,v);if(b)return b;}return null;}
function entity(){return project.actors?.actorsDict?.[owner]||project.scenes?.scenesDict?.[owner];}
function kitten4(value=project){return Object.hasOwn(value,'_nekocKitten4');}
function extension(value=project){return kitten4(value)?'bcm':'bcmkn';}
function chooseOwner(){if(!entity())owner=project.scenes?.scenesDict?.[project.scenes.currentSceneId]?.actorIds?.find(id=>project.actors.actorsDict[id])||project.scenes.currentSceneId||Object.keys(project.actors.actorsDict)[0]||Object.keys(project.scenes.scenesDict)[0]||'';}
function repair(block,parent=null){block.parent_id=parent;for(const map of [block.inputs,block.statements])for(const child of Object.values(map||{}))repair(child,block.id);if(block.next)repair(block.next,block.id);}
function newBlock([type,,category,args]){const block={id:crypto.randomUUID(),type,fields:{},inputs:{}};for(const [name,value]of Object.entries(args))block.inputs[name]={id:crypto.randomUUID(),type:'math_number',fields:{NUM:value}};if(type==='self_set_pen_color')block.fields.color='#608fee';if(['repeat_n_times','repeat_forever','warp'].includes(type))block.statements={};return block;}
function make(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function category(type){return palette.find(b=>b[0]===type)?.[2]||(type==='on_keydown'?'event':type==='stamp'||type.includes('_pen_')?'pen':type.startsWith('self_')?'motion':'control');}
function renderEntities(){
  for(const [selector,dict,scene]of [['#scenes',project.scenes.scenesDict,true],['#sprites',project.actors.actorsDict,false]]){
    const root=$(selector);root.replaceChildren();
    for(const [id,value]of Object.entries(dict)){
      const button=make('button',`entity ${owner===id?'active':''}`),thumb=make('span','thumb');
      const style=project.styles?.stylesDict?.[value.currentStyleId];if(style?.url){const img=make('img');img.src=style.url;img.alt='';thumb.append(img);}else thumb.textContent=scene?'▧':'◉';
      const name=make('span','',value.screenName||value.name||id);name.append(make('span','sub',scene?'SCENE':'SPRITE'));button.append(thumb,name,make('span','dots','···'));
      button.onclick=()=>{
        if(!started){const sceneId=scene?id:Object.entries(project.scenes.scenesDict).find(([,s])=>s.actorIds?.includes(id))?.[0];
          if(sceneId&&sceneId!==project.scenes.currentSceneId){transaction(()=>project.scenes.currentSceneId=sceneId);void renderer.load(project).catch(handleError);}}
        owner=id;selected='';renderEditor();
      };root.append(button);
    }
  }
}
function editInput(value,onChange,type='text'){
  const input=make('input');input.value=value;input.type=type;input.disabled=started;
  input.onclick=e=>e.stopPropagation();input.onchange=()=>transaction(()=>onChange(type==='number'?Number(input.value):input.value));return input;
}
function expressionText(b,depth=0){
  if(depth>12)return '…';if(b.type==='math_number')return String(b.fields?.NUM??0);
  if(b.type==='variables_get')return b.fields?.variable||'变量';
  const args=b.inputs||{},op=b.fields?.type||b.fields?.OP||'';
  if(args.A&&args.B)return `(${expressionText(args.A,depth+1)} ${{add:'+',minus:'−',multiply:'×',divide:'÷',EQ:'=',LT:'<',GT:'>'}[op]||op} ${expressionText(args.B,depth+1)})`;
  if(args.num)return `${op}(${expressionText(args.num,depth+1)})`;
  return labels[b.type]||b.type;
}
function blockNode(block,depth=0){
  if(depth>128)return make('div','','嵌套过深');
  const cat=category(block.type),[bg,border,ink]=colors[cat];
  const node=make('div',`block ${block.type.startsWith('on_')?'hat':''} ${selected===block.id?'selected':''}`);node.dataset.block=block.id;
  node.style.setProperty('--bg',bg);node.style.setProperty('--border',border);node.style.setProperty('--ink',ink);
  node.onclick=e=>{e.stopPropagation();selected=block.id;renderBlocks();};
  const title=make('div','block-label');title.append(make('span','symbol',symbols[cat]),make('span','',labels[block.type]||block.type));node.append(title);
  const fields=make('div','fields');
  for(const [key,value]of Object.entries(block.fields||{})){
    if(typeof value==='object')continue;
    const label=make('label','',fieldLabels[key]||key);const input=editInput(value,v=>block.fields[key]=v,key==='color'?'color':typeof value==='number'?'number':'text');label.append(input);fields.append(label);
  }
  for(const [key,value]of Object.entries(block.inputs||{})){
    if(['math_number','text'].includes(value.type)){
      const f=value.type==='text'?'TEXT':'NUM',label=make('label','',fieldLabels[key]||key),input=editInput(value.fields?.[f]??'',v=>value.fields[f]=v,value.type==='text'?'text':'number');
      if(value.type==='text')input.className='text-value';label.append(input);fields.append(label);
    }else{const label=make('label','',fieldLabels[key]||key),details=make('details','expression'),summary=make('summary','',expressionText(value));
      summary.onclick=e=>e.stopPropagation();details.append(summary);
      details.ontoggle=()=>{if(details.open&&details.children.length===1)details.append(blockNode(value,depth+1));};
      label.append(details);fields.append(label);}
  }
  if(fields.children.length)node.append(fields);
  const branches=block.statements||(['repeat_n_times','repeat_forever','warp'].includes(block.type)?{DO:null}:{});
  for(const [key,value]of Object.entries(branches)){
    const branch=make('div','branch');branch.append(make('div','branch-label',key==='DO'?'DO / 执行':key));
    if(value)renderChain(branch,value,depth+1);
    else branch.append(make('span','branch-label','选择此积木，然后从左侧添加动作'));
    node.append(branch);
  }
  if(block.statements&&!Object.keys(block.statements).length){const empty=make('div','branch','选择此积木后添加动作');empty.style.fontSize='10px';node.append(empty);}
  return node;
}
function renderChain(parent,block,depth){let n=0;while(block&&n++<5000){parent.append(blockNode(block,depth));block=block.next;}}
function renderBlocks(){const root=$('#blocks');root.replaceChildren();for(const block of entity()?.nekoBlockJsonList||[]){const stack=make('div','stack');renderChain(stack,block,0);root.append(stack);}if(!root.children.length)root.append(make('p','context-note','从左侧添加「当开始运行」积木。'));}
function renderProperties(){
  const root=$('#properties');root.replaceChildren();const a=entity();if(!a)return;
  const grid=make('div','property-grid');
  for(const [name,value,set]of [['X',a.position?.x??0,v=>{a.position??={};a.position.x=v;}],['Y',a.position?.y??0,v=>{a.position??={};a.position.y=v;}],['大小',a.scale??100,v=>a.scale=v]]){
    const label=make('label','',name);label.append(editInput(value,v=>{set(v);void renderer.load(project).catch(e=>log(e.message,true));},'number'));grid.append(label);
  }root.append(grid);
}
function renderEditor(){
  $('#project-name').value=project.projectName||'Untitled';$('#project-version').textContent=kitten4()?'Kitten4 · BCM':project.version||'?';$('#owner-name').textContent=entity()?.screenName||entity()?.name||'舞台';
  $('#save').replaceChildren(document.createTextNode(`导出 .${extension()} `),make('span','','↗'));
  $('#json-note').textContent=kitten4()?'内部规范 KN JSON：Kitten4 导入后在此编辑，导出还原为 .bcm。请保留 _nekocKitten4 保真元数据原样。':'规范 KN JSON · 导出为 .bcmkn';
  $('#stage-size').textContent=`${project.stageSize?.width||900} × ${project.stageSize?.height||562}`;
  $('#undo').disabled=!undo.length||started;$('#redo').disabled=!redo.length||started;
  renderEntities();renderBlocks();renderProperties();
}
function renderPalette(){
  const root=$('#palette');root.replaceChildren();for(const item of palette){if(categoryFilter&&item[2]!==categoryFilter)continue;if(!item[1].includes($('#search').value)&&!item[0].includes($('#search').value))continue;
    const button=make('button','palette-block',`${symbols[item[2]]}  ${item[1]}`);button.style.setProperty('--accent',colors[item[2]][2]);button.disabled=started;
    button.onclick=()=>transaction(()=>{
      const b=newBlock(item),target=find(selected);const a=entity();a.nekoBlockJsonList??=[];
      if(!target||b.type.startsWith('on_'))a.nekoBlockJsonList.push(b);
      else if(target.statements&&!target.statements.DO)target.statements.DO=b;
      else{let tail=target;while(tail.next)tail=tail.next;tail.next=b;}
      for(const block of a.nekoBlockJsonList)repair(block);selected=b.id;
    });root.append(button);
  }
}
function compiled(stats){$('#compile-status').textContent=`编译就绪 · ${kitten4()?'Kitten4 · ':''}Rust 运行时`;$('#instruction-count').textContent=`${stats.instructions} OPS · ${stats.expression_ops} EXPR`;}
async function start(){
  if(starting)return starting;
  starting=startRuntime().finally(()=>{starting=null;});return starting;
}
async function startRuntime(){
  if(running)return;await inFlight;
  if(!started){await api('project',project);audio.load(project);player=new PlayerConnection();const ready=await player.open();compiled(ready.stats);started=true;epoch++;input.reset();lastFrame=null;lastBytes=0;history=[];pipeline.completedFrames=0;renderEditor();renderPalette();}
  frames=0;fpsStart=performance.now();fps=0;
  running=true;audio.resume();lastTick=performance.now();state('运行中');$('#stage').focus();
}
function state(text){$('#runtime-state').replaceChildren(make('i'),document.createTextNode(text));$('#run').disabled=running;}
async function stop(){await starting;running=false;audio.stop();epoch++;player?.close();player=null;await inFlight;await api('stop');started=false;input.reset();timerLabel.hidden=true;await renderer.load(project);renderEditor();renderPalette();state('就绪');}
async function nextFrame(dt){
  const token=epoch,start=performance.now();let buffer;
  try{buffer=await player.frame({dt,...input.take()});}catch(error){if(token!==epoch)return;throw error;}if(token!==epoch)return;
  pipeline.roundtripMs=performance.now()-start;
  const decodeStart=performance.now(),{frame,lines}=decodeFrame(buffer);pipeline.decodeMs=performance.now()-decodeStart;lastBytes=buffer.byteLength;lastFrame=frame;
   renderer.apply(frame,lines);audio.apply(frame);for(const message of frame.logs)log(message);
  timerLabel.hidden=!frame.timer_visible;if(frame.timer_visible)timerLabel.textContent=`计时器 ${frame.timer.toFixed(2)}`;
  pipeline.completedFrames++;frames++;
}
function handleError(error){running=false;audio.pause();state('已暂停');log(error.message,true);$('#compile-status').textContent=error.message;notify(error.message);}
function monitor(now){
  if(now-fpsStart>=1000){fps=frames*1000/(now-fpsStart);frames=0;fpsStart=now;}
  if(now-lastMonitor<250)return;lastMonitor=now;
  $('#vm-time').textContent=lastFrame?(Number(lastFrame.execute_us)/1000).toFixed(2):'—';$('#render-time').textContent=renderer.stats.submitMs.toFixed(2);$('#fps').textContent=fps?fps.toFixed(0):'—';
  $('#ops').textContent=lastFrame?.instructions.toLocaleString()||'0';$('#bytes').textContent=lastBytes>1024?`${(lastBytes/1024).toFixed(1)} KB`:`${lastBytes} B`;$('#draws').textContent=renderer.stats.drawCalls;
  $('#roundtrip').textContent=`${pipeline.roundtripMs.toFixed(2)} ms`;$('#decode-time').textContent=`${pipeline.decodeMs.toFixed(2)} ms`;
  $('#gpu-time').textContent=renderer.stats.gpuMs==null?'不可用':`${renderer.stats.gpuMs.toFixed(2)} ms`;
  history.push(lastFrame?Number(lastFrame.execute_us)/1000:0);if(history.length>80)history.shift();
  const canvas=$('#chart'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#edf0e8';ctx.lineWidth=1;
  for(let y=12;y<h;y+=16){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  ctx.beginPath();history.forEach((v,i)=>{const x=i/79*w,y=h-5-Math.min(v,8)/8*(h-10);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.strokeStyle='#8ba97c';ctx.lineWidth=1.5;ctx.stroke();
}
function loop(now){
  if(running&&!inFlight){const dt=Math.min((now-lastTick)/1000,.25);lastTick=now;inFlight=nextFrame(dt).catch(handleError).finally(()=>{inFlight=null;});}
  renderer.render();renderer.collectGpuTimes();monitor(now);requestAnimationFrame(loop);
}
async function loadProject(value){
  await starting;
  const report=await(await api('import',value)).json();
  running=false;audio.stop();epoch++;player?.close();player=null;await inFlight;
  player?.close();player=null;input.reset();$('#logs').replaceChildren();
  started=false;lastFrame=null;lastBytes=0;timerLabel.hidden=true;pipeline.completedFrames=0;state('就绪');
  project=report.project;owner='';chooseOwner();selected='';undo=[];redo=[];dirty=false;$('#dirty').textContent='本地项目';
  renderEditor();renderPalette();await renderer.load(project);
  if(!$('#json-panel').hidden)$('#json-source').value=JSON.stringify(project,null,2);
  const counts=report.inspection.counts;log(`已载入 ${kitten4()?'Kitten4 .bcm':`.bcmkn ${project.version||''}`} · ${counts.scenes} 场景 / ${counts.actors} 角色 / ${counts.styles} 造型 / ${counts.variables} 变量`);
  if(!report.validation.ok)log(`结构检查：${report.validation.issues.length} 个问题（原始数据已保留）`,true);
  if(report.fast_runtime_ready)compiled(report.stats);else{
    $('#compile-status').textContent=`${kitten4()?'Kitten4 ':''}文件已载入 · 部分积木尚未适配高性能 VM`;$('#instruction-count').textContent=`${Object.keys(report.block_types).length} BLOCK TYPES`;
    for(const issue of report.script_diagnostics.slice(0,30))log(`[${issue.owner}] ${issue.message}${issue.affected_scripts>1?`（影响 ${issue.affected_scripts} 个脚本）`:''}`,true);
    if(!report.script_diagnostics.length)log(report.runtime_error,true);
  }
  window.nekoImportReport=report;
}
$('#run').onclick=()=>start().catch(handleError);
$('#pause').onclick=()=>{running=false;audio.pause();input.release();state('已暂停');};
$('#stop').onclick=()=>stop().catch(handleError);
$('#step').onclick=async()=>{try{await start();running=false;await inFlight;inFlight=nextFrame(1/60);await inFlight;inFlight=null;state('单步完成');}catch(e){inFlight=null;handleError(e);}};
$('#open').onclick=()=>$('#file').click();
async function openFile(file){if(!file)return;if(dirty&&!confirm('当前项目尚未导出。仍然打开其他项目？'))return;
  const button=$('#open');button.disabled=true;button.textContent='正在导入…';
  try{await loadProject(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));notify(`已导入 ${file.name}`);}
  finally{button.disabled=false;button.textContent='导入 .bcm / .bcmkn';}
}
$('#file').onchange=async e=>{try{await openFile(e.target.files[0]);}catch(e){handleError(e);}finally{$('#file').value='';}};
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();document.body.classList.add('file-drag');}});
window.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('file-drag');});
window.addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('file-drag');void openFile(e.dataTransfer.files[0]).catch(handleError);});
$('#save').onclick=async()=>{const button=$('#save'),snapshot=JSON.stringify(project),value=JSON.parse(snapshot);button.disabled=true;
  try{const exported=await(await api('export',value)).json();const url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'}));const a=make('a');a.href=url;a.download=`${value.projectName||'Untitled'}.${extension(value)}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);if(JSON.stringify(project)===snapshot){dirty=false;$('#dirty').textContent='已导出';}notify(`项目已导出为 .${extension(value)}`);}
  catch(e){handleError(e);}finally{button.disabled=false;}
};
$('#project-name').onchange=e=>transaction(()=>project.projectName=e.target.value);
$('#undo').onclick=()=>{if(!undo.length||started)return;redo.push(JSON.stringify(project));project=JSON.parse(undo.pop());markDirty();selected='';chooseOwner();renderEditor();if(!$('#json-panel').hidden)$('#json-source').value=JSON.stringify(project,null,2);void renderer.load(project).catch(handleError);};
$('#redo').onclick=()=>{if(!redo.length||started)return;undo.push(JSON.stringify(project));project=JSON.parse(redo.pop());markDirty();selected='';chooseOwner();renderEditor();if(!$('#json-panel').hidden)$('#json-source').value=JSON.stringify(project,null,2);void renderer.load(project).catch(handleError);};
$('#search').oninput=renderPalette;$('#deselect').onclick=()=>{selected='';renderBlocks();};$('#clear-console').onclick=()=>$('#logs').replaceChildren();
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b===button);const json=button.dataset.tab==='json';$('#blocks').hidden=json;$('#json-panel').hidden=!json;if(json)$('#json-source').value=JSON.stringify(project,null,2);};
$('#apply-json').onclick=async()=>{if(started||starting){notify('请先停止运行，再编辑项目');return;}const button=$('#apply-json');button.disabled=true;
  try{const value=JSON.parse($('#json-source').value);await api('project',value);transaction(()=>{project=value;chooseOwner();});await renderer.load(project);notify('内部规范 JSON 已应用');}
  catch(e){handleError(e);}finally{button.disabled=false;}
};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
try{renderer=new StageRenderer($('#stage'));input=new StageInput($('#stage'),renderer,()=>running);renderer.onError=message=>log(message,true);await loadProject(await(await fetch('/api/project')).json());requestAnimationFrame(loop);}catch(e){handleError(e);if(renderer)requestAnimationFrame(loop);}
// Read-only diagnostics for local performance/renderer verification.
window.nekoDiagnostics=()=>({renderer:{...renderer?.stats},sprites:renderer?.sprites,frame:lastFrame,bytes:lastBytes,running,started,pipeline:{...pipeline},framebuffer:[renderer?.canvas.width,renderer?.canvas.height]});
