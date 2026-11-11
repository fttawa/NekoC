import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {StageRenderer} from '../web/renderer.js';
import {drawK4PenLines} from '../web/pen-k4.js';

const source = fs.readFileSync(new URL('../web/renderer.js', import.meta.url), 'utf8');
// Test the actual private helper, without changing the renderer's public API.
const {actorGeometry} = vm.runInNewContext(source.replace("import { drawK4PenLines } from './pen-k4.js';", '').replaceAll('export ', '') + '\n({actorGeometry})', {drawK4PenLines});
const cases = JSON.parse(fs.readFileSync(new URL('./pivot-cases.json', import.meta.url), 'utf8'));
const close = (a, b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);

test('renderer and VM share pivot geometry fixtures, including K4 angle and mirroring', () => {
  const image = {width:20,height:12,centerPoint:{x:10,y:6}};
  for (const c of cases) {
    const actor = {...c,x:30,y:40,direction:c.direction-c.turn};
    const g = actorGeometry(actor,image);
    [g.x,g.y,g.width,g.height,g.angle*180/Math.PI].forEach((v,i)=>close(v,[...c.center,...c.drawn][i]));
    const ex=Math.abs(g.width*Math.cos(g.angle))/2+Math.abs(g.height*Math.sin(g.angle))/2;
    const ey=Math.abs(g.width*Math.sin(g.angle))/2+Math.abs(g.height*Math.cos(g.angle))/2;
    [g.x-ex,g.x+ex,g.y-ey,g.y+ey].forEach((v,i)=>close(v,c.bounds[i]));
    const zero=actorGeometry(actor,{...image,centerPoint:{x:0,y:0}});
    assert.equal(zero.x,actor.x);assert.equal(zero.y,actor.y);
    // Image stamps must retain actor coordinates: drawImageStamp applies the pivot once.
    let drawn;
    StageRenderer.prototype.drawImageStamp.call({images:new Map([['style',image]]),drawTexture:(...args)=>{drawn=args;}},{...actor,style:'style'});
    drawn.slice(1,6).forEach((v,i)=>close(v,[g.x,g.y,g.width,g.height,g.angle][i]));
  }
});

test('costumeInfo sends unscaled pixel pivot alongside dimensions, alpha mask and colours', () => {
  const images=new Map([['pivot',{width:2,height:1,centerPoint:{x:10,y:-6},alpha:new Uint8Array([255,0]),rgb:new Uint8Array([255,0,0,0,0,0])}],['zero',{width:1,height:1,alpha:new Uint8Array([255])}]]);
  const info=StageRenderer.prototype.costumeInfo.call({images},true);
  assert.deepEqual(info[0].centerPoint,{x:10,y:-6});
  assert.equal(info[0].width,2);assert.equal(info[0].height,1);
  assert.equal(info[0].mask,'AQ==');assert.equal(info[0].rgb,'/wAAAAAA');
  assert.deepEqual(info[1].centerPoint,{x:0,y:0});
});
