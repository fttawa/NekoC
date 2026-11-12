import { transition9Fixtures } from './k4-partial-transition-9.mjs';
import { runOracle, saveJson } from './k4-oracle.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
const trace=await runOracle((await transition9Fixtures())['none-left'],{frames:3,blocks:true,virtualTime:true});
await saveJson('dist/partial-transition-10/order.json',trace);
const file='src/player/build/player_v2.2d180c468559fbd29528.js.orig';
if(!process.env.K4_PLAYER_DIR)throw Error('K4_PLAYER_DIR must point at the read-only official app');
const bytes=await readFile(path.join(process.env.K4_PLAYER_DIR,file)),source=bytes.toString('utf8');
const sha256=hash(bytes);
if(sha256!=='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160')throw Error('Unexpected official bundle');
// Metadata only: no official function bodies or resources enter the repository.
const anchors=Object.fromEntries(Object.entries({
  batch:'prototype.packInterleavedGeometry=function',
  packedColor:'function Nt(t,e){if(1===e)',
  matrixShader:'uniform float m[20]',
  hue:'prototype.hue=function',
  svgCanvas:'cn=function(t){function e(e,n)',
  svgRaster:'a.getContext("2d").drawImage(e,0,0,n,i,0,0,r,o)',
  distort:'set_distort_transition(t,e){',
  startActivation:'function ft(){var t;t=T.a.get_state().theatre_states.scenes_order[0]',
}).map(([name,needle])=>{
  const offset=source.indexOf(needle);if(offset<0)throw Error(`Missing ${name}`);
  return [name,{offset,anchorSha256:hash(needle),windowLength:256,windowSha256:hash(source.slice(offset,offset+256))}];
}));
await saveJson('docs/kitten4-partial-effects-10-source.json',{schema:'nekoc-k4-effects-10-source-v1',file,sha256,
  offsetUnit:'0-based UTF-16 code units after UTF-8 decoding; NOT file byte offsets',anchors,
  startOrder:{scope:'native runtime events, original none-left fixture, three updates, controlled clock',
    fixtureSha256:hash(JSON.stringify((await transition9Fixtures())['none-left'],null,2)+'\n'),
    starts:trace.events.filter(e=>e.event==='start'),
    oldActivationResumes:trace.events.filter(e=>e.event==='resume'&&e.hat==='old-activate').length,
    errors:trace.errors,assets:trace.diagnostics.assets,externalAllowed:trace.diagnostics.externalRequests.filter(r=>r.action!=='blocked').length}});
console.log('official source anchors and native Start order recorded');
