import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const project=JSON.parse(readFileSync(new URL('../samples/starhold.bcmkn',import.meta.url),'utf8'));
function* blocks(value){
  if(!value||typeof value!=='object')return;
  if(value.id&&value.type)yield value;
  for(const child of Object.values(value))yield* blocks(child);
}
test('delivery embeds every costume and uses no pen lines or external resource references',()=>{
  assert.equal(project.toolType,'KN');
  assert.deepEqual(project.stageSize,{width:900,height:562});
  const styles=Object.values(project.styles.stylesDict);
  assert.ok(styles.length>=30);
  for(const style of styles){
    assert.match(style.url,/^data:image\/svg\+xml;base64,/);
    const svg=Buffer.from(style.url.split(',')[1],'base64').toString('utf8');
    assert.doesNotMatch(svg,/<script|<foreignObject|(?:href|src)=["']https?:/i);
  }
  for(const block of blocks(project))assert.notEqual(block.type,'self_pen_down','battlefield must not use a pen framebuffer');
});
test('every actor costume and script parent points to a present native object',()=>{
  for(const actor of Object.values(project.actors.actorsDict)){
    assert.ok(actor.styles.includes(actor.currentStyleId));
    for(const style of actor.styles)assert.ok(project.styles.stylesDict[style]);
    const all=[...blocks(actor.nekoBlockJsonList)];const ids=new Set(all.map(b=>b.id));
    assert.equal(ids.size,all.length,`duplicate IDs in ${actor.name}`);
    for(const block of all)if(block.parent_id)assert.ok(ids.has(block.parent_id),`${actor.name}: dangling ${block.parent_id}`);
  }
});
test('native expression sockets never contain statement conditionals',()=>{
  for(const block of blocks(project))for(const child of Object.values(block.inputs||{}))
    assert.notEqual(child?.type,'controls_if',`invalid expression in ${block.id}`);
});
