// Original audio-wait -> restart and timer-driven costume probes. No corpus assets.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tone} from './audio-fixtures.mjs';
import {readJson,saveJson} from './k4-oracle.mjs';
import {workspace} from './k4-scheduling-fixtures.mjs';

const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}});
const num=n=>b('','math_number',{NUM:String(n)});
const chain=(...nodes)=>{nodes.slice(1).forEach((n,i)=>nodes[i].next=n);return nodes[0];};
const svg=(width,height,body)=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`).toString('base64');

export async function audioWaitFixture(){
  const project=await readJson('tests/fixtures/kitten4/visual-upright.bcm');
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  project.project_name='NekoC original audio wait restart visual probe';
  project.application_version='4.11.19';
  project.size={width:960,height:720};
  delete project.compile_result;
  project.variables={};project.variable_order=[];project.cloud_variables={};
  const scene=Object.values(project.theatre.scenes)[0],actor=Object.values(project.theatre.actors)[0];
  project.theatre.styles={
    background:{id:'background',name:'background',rotate_center:{x:0,y:0},url:svg(960,720,'<rect width="960" height="720" fill="#fff"/>')},
    'audio-before':{id:'audio-before',name:'before',rotate_center:{x:0,y:0},url:svg(80,40,'<rect width="80" height="40" fill="#e84030"/>')},
    'audio-after':{id:'audio-after',name:'after',rotate_center:{x:0,y:0},url:svg(40,80,'<rect width="40" height="80" fill="#20b060"/>')},
  };
  Object.assign(actor,{x:0,y:0,rotation:0,rotation_type:0,scale:100,visible:true,styles:['audio-before','audio-after'],current_style_id:'audio-before'});
  Object.assign(scene,{current_style_id:'background',styles:['background'],scale:100});
  // Extend the repository's original 100 ms PCM tone to two seconds. x-wav is
  // browser-decodable but intentionally outside the CLI's narrow inline WAV
  // parser, reproducing unknown-duration fallback without a network dependency.
  const short=Buffer.from(tone().split(',')[1],'base64'),pcm=short.subarray(44);
  const wav=Buffer.concat([short.subarray(0,44),...Array(20).fill(pcm)]);
  wav.writeUInt32LE(wav.length-8,4);wav.writeUInt32LE(wav.length-44,40);
  // Native .1x playback keeps the two-second decoded source alive for twenty
  // wall seconds, so browser screenshot overhead cannot finish this 60-update
  // probe. Metadata remains the measured TWO seconds, not rate-adjusted twenty.
  project.audio={'audio-wait-tone':{id:'audio-wait-tone',name:'Original two second tone',volume:.1,playback_rate:.1,
    url:'data:audio/x-wav;base64,'+wav.toString('base64')}};
  project.audio_order=['audio-wait-tone'];
  scene.block_data_json=workspace([chain(b('audio-wait-start','start_on_click'),
    b('audio-wait-play','play_audio_and_wait_2',{}, {audio:b('','get_audios',{sound_id:'Original two second tone'})}),
    b('audio-wait-restart','restart'))],schema);
  actor.block_data_json=workspace([chain(b('audio-animation-start','start_on_click'),
    b('audio-clock-start','set_timer_state',{actions:'start'}),
    b('audio-clock-hide','show_hide_timer',{state:'hide'}),
    b('audio-initial-costume','set_costume',{}, {index:b('','get_current_costume',{style_id:'audio-before'})}),
    b('audio-animation-wait','wait_until',{}, {condition:b('','logic_compare',{OP:'GTE'},{A:b('','get_timer'),B:num(.1)})}),
    b('audio-changed-costume','set_costume',{}, {index:b('','get_current_costume',{style_id:'audio-after'})}))],schema);
  return project;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await saveJson('tests/fixtures/kitten4/audio-wait-restart.bcm',await audioWaitFixture());
}
