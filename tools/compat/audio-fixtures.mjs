// Original 100 ms sine-wave probes; no external work or media is copied.
import {readJson,saveJson} from './k4-oracle.mjs';
import {workspace} from './k4-scheduling-fixtures.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function tone() {
  const rate=8000,count=800,bytes=Buffer.alloc(44+count*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++)bytes.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
  return 'data:audio/wav;base64,'+bytes.toString('base64');
}
const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}});
const num=n=>b('','math_number',{NUM:String(n)});
const chain=(...nodes)=>{nodes.slice(1).forEach((n,i)=>nodes[i].next=n);return nodes[0];};

export async function audioFixtures() {
  const kn=await readJson('samples/kitten-n-0.27.4.bcmkn');
  const resource={id:'nekoc-tone',name:'NekoC tone',url:tone(),volume:.4,playback_rate:1};
  kn.projectName='NekoC original audio probe';
  kn.audios={audiosDict:{[resource.id]:resource},sortList:[resource.id],currentAudioId:resource.id};
  const aid=Object.keys(kn.actors.actorsDict)[0];
  let serial=0;
  function ids(block,parent=null) {
    block.id||=`audio-kn-${++serial}`;
    if(parent)block.parent_id=parent;
    for(const child of Object.values(block.inputs||{}))ids(child,block.id);
    if(block.next)ids(block.next,block.id);
    return block;
  }
  kn.actors.actorsDict[aid].nekoBlockJsonList=[ids(chain(
    b('audio-start','on_running_group_activated'),
    b('play-wait','play_audio_and_wait',{}, {audio_id:b('','get_play_audio',{audio_id:resource.id})}),
    b('after','console_log',{}, {console_log:b('','text',{TEXT:'audio finished'})}),
  ))];
  const k4=await readJson('tests/fixtures/kitten4/visual-stamp.bcm');
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  k4.project_name='NekoC original audio probe';delete k4.compile_result;
  k4.audio={[resource.id]:resource};k4.audio_order=[resource.id];
  for(const actor of Object.values(k4.theatre.actors))actor.block_data_json=workspace([],schema);
  for(const scene of Object.values(k4.theatre.scenes))scene.block_data_json=workspace([],schema);
  const actor=Object.values(k4.theatre.actors)[0];
  actor.block_data_json=workspace([chain(b('audio-start','start_on_click'),
    b('volume','set_volume_or_rate_2',{audio_key:'volume'},{audio:b('','get_audios',{sound_id:resource.name}),audio_value:num(25)}),
    b('rate','set_volume_or_rate_2',{audio_key:'rate'},{audio:b('','get_audios',{sound_id:resource.name}),audio_value:num(200)}),
    b('play-wait','play_audio_and_wait_2',{}, {audio:b('','get_audios',{sound_id:resource.name})}),
    b('after','variables_set',{VAR:'audio-after'}, {VALUE:num(1)}),
  )],schema);
  k4.variables={'audio-after':{id:'audio-after',name:'audio-after',value:0,is_global:true}};
  k4.variable_order=['audio-after'];
  return {kn,k4};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {kn,k4}=await audioFixtures();
  await saveJson('tests/fixtures/audio.bcmkn',kn);
  await saveJson('tests/fixtures/kitten4/audio.bcm',k4);
}
