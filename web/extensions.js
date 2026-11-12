// Trusted host registrations only. Never import extension code named by a project.
export const API_VERSION=2;
export const SUPPORTED_API_VERSIONS=Object.freeze([2,1]);
export function negotiateVersion(versions){
  if(!Array.isArray(versions)||versions.some(v=>!Number.isInteger(v)||v<0||v>0xffffffff))throw Error('Invalid extension API versions');
  const version=SUPPORTED_API_VERSIONS.find(v=>versions.includes(v));
  if(version===undefined)throw Error('No supported extension API version');
  return version;
}
const types=new Set(['number','string','boolean','list','any']);
function valueType(type,value,depth=0){
  if(depth>32)throw Error('Extension value exceeds depth 32');
  if(value===null){if(type!=='any')throw Error(`Extension expected ${type}`);return;}
  if(Array.isArray(value)){
    if(value.length>4096)throw Error('Extension list exceeds 4096 items');
    for(const item of value)valueType('any',item,depth+1);
  }else if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw Error('Extension value must be finite JSON scalar/list');
  if(type!=='any'&&(type==='list'?!Array.isArray(value):typeof value!==type))throw Error(`Extension expected ${type}`);
  if(new TextEncoder().encode(JSON.stringify(value)).length>65536)throw Error('Extension value exceeds 64 KiB');
}

export class ExtensionRegistry {
  constructor({timeoutMs=1000}={}){
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw Error('Extension timeoutMs must be an integer from 1 to 60000');
    this.entries=new Map();this.timeoutMs=timeoutMs;
  }
  register(schema,handler){
    if(!schema||typeof schema!=='object'||Array.isArray(schema))throw Error('Invalid extension schema');
    const allowed=new Set(['api_version','opcode','parameters','returns','blocking','network']);
    if(schema.api_version===2){allowed.add('kind');allowed.add('metadata');}
    if(Object.keys(schema).some(key=>!allowed.has(key))||schema.network!==undefined&&typeof schema.network!=='boolean')throw Error('Invalid extension schema fields');
    if(!SUPPORTED_API_VERSIONS.includes(schema.api_version)||typeof schema.opcode!=='string'||schema.opcode.length>128||!schema.opcode.includes('.')||!/^[\w.-]+$/.test(schema.opcode))throw Error('Invalid extension schema/version');
    const kind=schema.kind===undefined?'command':schema.kind;
    if(!['command','reporter','boolean','hat'].includes(kind))throw Error('Invalid extension kind');
    if(schema.metadata!==undefined){
      const metadata=schema.metadata;
      if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).some(key=>key!=='name'&&key!=='category'))throw Error('Invalid extension metadata');
      for(const key of ['name','category'])if(typeof metadata[key]!=='string'||!metadata[key].length||new TextEncoder().encode(metadata[key]).length>128)throw Error('Invalid extension metadata name/category');
    }
    if(schema.network)throw Error('Extension network capability is disabled');
    if(schema.returns!==null&&!types.has(schema.returns))throw Error('Invalid extension return type');
    if(!Array.isArray(schema.parameters)||schema.parameters.length>32)throw Error('Invalid extension parameters');
    const names=new Set();
    for(const p of schema.parameters){
      if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Invalid extension parameter');
      if(Object.keys(p).some(key=>key!=='name'&&key!=='value_type'))throw Error('Invalid extension parameter fields');
      if(typeof p.name!=='string'||!p.name.length||new TextEncoder().encode(p.name).length>64||names.has(p.name)||!types.has(p.value_type))throw Error('Invalid extension parameter');
      names.add(p.name);
    }
    if(kind==='reporter'||kind==='boolean'){
      if(schema.blocking!==true||schema.returns===undefined||schema.returns===null||kind==='boolean'&&schema.returns!=='boolean')throw Error('Invalid extension reporter/boolean schema');
    }
    if(kind==='hat'){
      if(schema.returns!==null||schema.blocking!==false||schema.parameters.length||handler!==undefined)throw Error('Extension hats require no handler, no parameters, null returns and blocking false');
    }else if(schema.blocking!==true||typeof handler!=='function')throw Error('Web extension command/reporter/boolean blocks must be blocking and have a handler');
    if(this.entries.has(schema.opcode)||this.entries.size>=256)throw Error('Duplicate/invalid extension handler');
    // Detach registration metadata from the caller's mutable objects.
    this.entries.set(schema.opcode,{schema:JSON.parse(JSON.stringify(schema)),handler});
    return this;
  }
  schemas(){return [...this.entries.values()].map(e=>JSON.parse(JSON.stringify(e.schema)));}
  palette(){
    const categories=new Map();
    for(const schema of this.schemas()){
      const category=schema.metadata?.category||schema.opcode.split('.')[0];
      if(!categories.has(category))categories.set(category,{category,blocks:[]});
      categories.get(category).blocks.push({kind:schema.kind||'command',name:schema.metadata?.name||schema.opcode,opcode:schema.opcode,parameters:schema.parameters,returns:schema.returns});
    }
    return [...categories.values()];
  }
  session(){return new ExtensionSession(new Map(this.entries),this.timeoutMs);}
}

class ExtensionSession {
  constructor(entries,timeoutMs){this.entries=entries;this.timeoutMs=timeoutMs;this.calls=new Map();this.results=[];this.closed=false;}
  update(requests){
    if(this.closed)return;
    if(!Array.isArray(requests)||requests.some(r=>!r||!Number.isSafeInteger(r.id)||r.id<0))throw Error('Invalid extension requests');
    const active=new Set(requests.map(r=>r.id));
    for(const [id,call] of this.calls)if(!active.has(id)){clearTimeout(call.timer);call.controller.abort();this.calls.delete(id);}
    for(const request of requests){
      if(this.calls.has(request.id))continue;
      const controller=new AbortController(),call={controller,done:false,timer:null,started:performance.now()};this.calls.set(request.id,call);
      // Timers can abort asynchronous work, but cannot preempt synchronous JS.
      call.timer=setTimeout(()=>{
        this.finish(request.id,call,{error:`Extension call timed out after ${this.timeoutMs} ms`});
        controller.abort();
      },this.timeoutMs);
      Promise.resolve().then(()=>{
        if(this.closed||this.calls.get(request.id)!==call||call.done||controller.signal.aborted)return;
        const entry=this.entries.get(request.opcode);if(!entry)throw Error(`Unregistered extension ${request.opcode}`);
        if(entry.schema.kind==='hat')throw Error('Extension hats cannot be called');
        if(!Array.isArray(request.arguments)||request.arguments.length!==entry.schema.parameters.length)throw Error('Extension argument count mismatch');
        entry.schema.parameters.forEach((p,i)=>valueType(p.value_type,request.arguments[i]));
        return entry.handler(request.arguments,{id:request.id,actor:request.actor,signal:controller.signal});
      }).then(value=>{
        if(this.closed||this.calls.get(request.id)!==call||call.done||controller.signal.aborted)return;
        // Promise microtasks run before overdue timers. Reject a synchronous
        // handler's late result too, once control returns to the host.
        if(performance.now()-call.started>=this.timeoutMs){
          this.finish(request.id,call,{error:`Extension call timed out after ${this.timeoutMs} ms`});
          controller.abort();return;
        }
        const schema=this.entries.get(request.opcode).schema;
        if(schema.returns===null){if(value!==null)throw Error('Extension command must return null');}
        else valueType(schema.returns,value);
        this.finish(request.id,call,{value:JSON.parse(JSON.stringify(value))});
      }).catch(error=>{
        let message='Extension handler failed';
        try{message=String(error?.message||error).slice(0,4096);}catch{}
        this.finish(request.id,call,{error:message});
      });
    }
  }
  finish(id,call,result){
    if(this.closed||this.calls.get(id)!==call||call.done||call.controller.signal.aborted)return;
    clearTimeout(call.timer);call.timer=null;call.done=true;
    // Keep a completed tombstone until the runtime retires the request ID.
    this.results.push({kind:'extension_result',id,...result});
  }
  emit(opcode,payload=null){
    if(this.closed)throw Error('Extension session is closed');
    if(this.entries.get(opcode)?.schema.kind!=='hat')throw Error('Extension events require a registered hat');
    valueType('any',payload);
    this.results.push({kind:'extension_event',opcode,value:JSON.parse(JSON.stringify(payload))});
  }
  drain(){return this.results.splice(0,256);}
  close(){this.closed=true;for(const c of this.calls.values()){clearTimeout(c.timer);c.controller.abort();}this.calls.clear();this.results=[];}
}

export function registerJsonParse(registry){
  return registry.register({api_version:1,opcode:'example.json.parse',parameters:[{name:'text',value_type:'string'}],returns:'any',blocking:true,network:false},([text])=>JSON.parse(text));
}

// The bundled players share this opt-in registry; empty unless host code registers.
export const playerExtensions=new ExtensionRegistry();
