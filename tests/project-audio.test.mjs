import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectAudio} from '../web/audio.js';

test('audio properties apply before play, clamp, support all, and do not stop a voice',()=>{
  const original=globalThis.Audio;
  globalThis.Audio=class {
    constructor(url){this.url=url;this.volume=1;this.playbackRate=1;this.currentTime=0;this.paused=true;}
    pause(){this.paused=true;}
    play(){this.paused=false;return Promise.resolve();}
    removeAttribute(){}
    load(){}
  };
  try {
    const errors=[],audio=new ProjectAudio(e=>errors.push(e));
    audio.load({audios:{audioIds:['a','b'],audiosDict:{a:{id:'a',name:'A',url:'a.wav'},b:{id:'b',name:'B',url:'b.wav'}}}});
    const apply=(target,rate,change,value)=>audio.apply({audio_commands:[{audio:target,property:{rate,change,value}}]});
    apply('all',false,false,0.5);
    assert.equal(audio.voices.get('a').element.volume,0.5);
    assert.equal(audio.voices.get('b').element.volume,0.5);
    audio.resume();
    audio.apply({audio_commands:[{audio:'a',play:true}]});
    apply('A',false,true,-0.2);
    assert.equal(audio.voices.get('a').element.volume,0.3);
    assert.equal(audio.voices.get('a').wanted,true);
    assert.equal(audio.voices.get('a').element.paused,false);
    apply(1,true,true,-10);
    assert.equal(audio.voices.get('a').element.playbackRate,0.05);
    apply(2,true,false,10);
    assert.equal(audio.voices.get('b').element.playbackRate,4);
    apply('missing',false,true,0.1);
    assert.deepEqual(errors,[]);
    audio.stop();
    audio.apply({audio_commands:[{audio:'a',play:true}]});
    assert.equal(audio.voices.get('a').element.volume,1);
  } finally {globalThis.Audio=original;}
});
