import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerFeedback} from '../web/player-feedback.js';

function fixture(){
  const elements=new Map();
  const root={querySelector(selector){
    if(!elements.has(selector))elements.set(selector,{hidden:true,textContent:'',attributes:new Map(),setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);},showModal(){this.open=true;},close(){this.open=false;}});
    return elements.get(selector);
  }};
  return {feedback:new PlayerFeedback(root),get:selector=>root.querySelector(selector)};
}
test('player feedback distinguishes unknown work from counted assets and clears busy state',()=>{
  const {feedback,get}=fixture();
  feedback.progress('读取');assert.equal(get('#load-progress').value,undefined);assert.equal(get('#viewport').attributes.get('aria-busy'),'true');
  feedback.progress('素材',1,3);assert.equal(get('#load-progress').max,3);assert.equal(get('#load-progress').value,1);assert.equal(get('#load-label').textContent,'素材 1 / 3');
  feedback.progress('素材',0,0);assert.equal(get('#load-progress').value,1);assert.equal(get('#load-progress').max,1);
  feedback.finish();assert.equal(get('#loading').hidden,true);assert.equal(get('#viewport').attributes.get('aria-busy'),'false');
});
test('diagnostics omit the project, aggregate errors and reset only for an accepted import',()=>{
  const {feedback,get}=fixture();
  feedback.reset({project:{projectName:'<img onerror=alert(1)>',secret:'inline media'},fast_runtime_ready:false,script_diagnostics:[{message:'unsupported'}]});
  feedback.resourceError('坏图 A');feedback.resourceError('坏图 B');feedback.resourceError('坏图 A');
  assert.equal(get('#notice-text').textContent,'坏图 A\n坏图 B');assert.equal(get('#coverage').disabled,false);
  const report=JSON.parse(feedback.reportText());assert.equal(report.project,undefined);assert.equal(report.projectName,'<img onerror=alert(1)>');assert.equal(report.fast_runtime_ready,false);assert.deepEqual(report.resource_errors,['坏图 A','坏图 B']);assert.match(report.scope,/未执行/);
  feedback.openReport();assert.equal(get('#coverage-dialog').open,true);assert.equal(get('#report-content').textContent,feedback.reportText());
  get('#dismiss').onclick();assert.equal(get('#notice').hidden,true);assert.equal(feedback.resourceErrors.length,2);
  feedback.reset({project:{projectName:'new'}});assert.deepEqual(feedback.resourceErrors,[]);assert.equal(get('#notice').hidden,true);
});
