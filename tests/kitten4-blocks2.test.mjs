import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {blockCases} from '../tools/semantics-kitten4-blocks2.mjs';

test('blocks2 official observations match the exact self-authored probe graphs',async()=>{
  const report=JSON.parse(await readFile(new URL('fixtures/kitten4/blocks2-official.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(report.cases),Object.keys(blockCases()));
  for(const [name,input]of Object.entries(blockCases())){
    const result=report.cases[name];
    assert.equal(createHash('sha256').update(JSON.stringify(input)).digest('hex'),result.inputSha256,name);
    assert.deepEqual(result.workspaceIssues,[],name);
    for(const entity of [...Object.values(input.theatre.actors),...Object.values(input.theatre.scenes)]){
      const graph=entity.block_data_json;
      for(const [id,edges]of Object.entries(graph.connections)){
        assert.ok(graph.blocks[id]);
        for(const child of Object.keys(edges))assert.equal(graph.blocks[child].parent_id,id);
      }
    }
    assert.ok(result.state.scripts.some(url=>url.endsWith('kitten.99f88a64d495cf0e79d0.js')));
    if(name!=='invalid-list')assert.equal(result.state.error.show_error,false,name);
  }
  const state=name=>report.cases[name].state;
  assert.equal(state('invalid-list').error.show_error,true);
  assert.match(state('invalid-list').error.error_string,/仅支持列表/);
  assert.equal(state('invalid-list').running,false);
  assert.equal(state('invalid-list').variables.after,0);
  const costume=state('costume').variables;
  assert.deepEqual([costume.wrap,costume.number,costume.fraction,costume.after,costume.name],[2,1,2,2,1]);
  assert.equal(state('negative-list').variables.value,30);
  assert.deepEqual(state('flip').flip,{x:true,y:true});
  assert.equal(state('flip').variables.width,80);
  assert.equal(state('backdrop').variables.activated,7);
});
