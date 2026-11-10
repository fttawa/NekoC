// Trusted host registrations only. Never import extension code named by a project.
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
  constructor(){this.entries=new Map();}
  register(schema,handler){
    const allowed=new Set(['api_version','opcode','parameters','returns','blocking','network']);
    if(Object.keys(schema).some(key=>!allowed.has(key))||schema.network!==undefined&&typeof schema.network!=='boolean')throw Error('Invalid extension schema fields');
    if(schema.api_version!==1||typeof schema.opcode!=='string'||schema.opcode.length>128||!schema.opcode.includes('.')||!/^[\w.-]+$/.test(schema.opcode))throw Error('Invalid extension schema/version');
    if(schema.blocking!==true)throw Error('Web extensions must be blocking');
    if(schema.network)throw Error('Extension network capability is disabled');
    if(schema.returns!==null&&!types.has(schema.returns))throw Error('Invalid extension return type');
    if(!Array.isArray(schema.parameters)||schema.parameters.length>32)throw Error('Invalid extension parameters');
    const names=new Set();
    for(const p of schema.parameters){
      if(Object.keys(p).some(key=>key!=='name'&&key!=='value_type'))throw Error('Invalid extension parameter fields');
      if(typeof p.name!=='string'||!p.name.length||new TextEncoder().encode(p.name).length>64||names.has(p.name)||!types.has(p.value_type))throw Error('Invalid extension parameter');
      names.add(p.name);
    }
    if(typeof handler!=='function'||this.entries.has(schema.opcode)||this.entries.size>=256)throw Error('Duplicate/invalid extension handler');
    // Detach registration metadata from the caller's mutable objects.
    this.entries.set(schema.opcode,{schema:JSON.parse(JSON.stringify(schema)),handler});
    return this;
  }
  schemas(){return [...this.entries.values()].map(e=>JSON.parse(JSON.stringify(e.schema)));}
  session(){return new ExtensionSession(new Map(this.entries));}
}

class ExtensionSession {
  constructor(entries){this.entries=entries;this.calls=new Map();this.results=[];this.closed=false;}
  update(requests){
    const active=new Set(requests.map(r=>r.id));
    for(const [id,call] of this.calls)if(!active.has(id)){call.controller.abort();this.calls.delete(id);}
    for(const request of requests){
      if(this.calls.has(request.id))continue;
      const controller=new AbortController(),call={controller};this.calls.set(request.id,call);
      Promise.resolve().then(()=>{
        if(this.closed||this.calls.get(request.id)!==call||controller.signal.aborted)return;
        const entry=this.entries.get(request.opcode);if(!entry)throw Error(`Unregistered extension ${request.opcode}`);
        if(request.arguments.length!==entry.schema.parameters.length)throw Error('Extension argument count mismatch');
        entry.schema.parameters.forEach((p,i)=>valueType(p.value_type,request.arguments[i]));
        return entry.handler(request.arguments,{id:request.id,actor:request.actor,signal:controller.signal});
      }).then(value=>{
        const schema=this.entries.get(request.opcode).schema;
        if(schema.returns===null){if(value!==null)throw Error('Extension command must return null');}
        else valueType(schema.returns,value);
        this.finish(request.id,call,{value:JSON.parse(JSON.stringify(value))});
      }).catch(error=>this.finish(request.id,call,{error:String(error?.message||error).slice(0,4096)}));
    }
  }
  finish(id,call,result){
    if(!this.closed&&this.calls.get(id)===call&&!call.controller.signal.aborted)this.results.push({kind:'extension_result',id,...result});
  }
  drain(){return this.results.splice(0,256);}
  close(){this.closed=true;for(const c of this.calls.values())c.controller.abort();this.calls.clear();this.results=[];}
}

export function registerJsonParse(registry){
  return registry.register({api_version:1,opcode:'example.json.parse',parameters:[{name:'text',value_type:'string'}],returns:'any',blocking:true,network:false},([text])=>JSON.parse(text));
}

// The bundled players share this opt-in registry; empty unless host code registers.
export const playerExtensions=new ExtensionRegistry();
