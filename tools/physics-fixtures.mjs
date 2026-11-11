// Original minimal workspaces and SVGs, never copied from the corpus.
import { readFileSync } from "node:fs";
const schema = JSON.parse(readFileSync(new URL("../docs/kitten4-block-schema.json", import.meta.url)));
export const actorId = "20000000-0000-4000-8000-000000000001";
export const floorId = "20000000-0000-4000-8000-000000000002";
const scene = "10000000-0000-4000-8000-000000000001";
const empty = () => ({ blocks: {}, connections: {}, comments: {} });
const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
const n = value => b("math_number", { NUM: String(value) });
const p = (type, fields = {}, values = {}) => b(`physics2_${type}`, fields, Object.fromEntries(Object.entries(values).map(([k,v]) => [k,n(v)])));
const wait = time => b("wait", {}, { time: n(time) });
const get = property => p("get_property", { sprite: "__self", property });
const set = (name, value) => b("variables_set", { VAR: name }, { VALUE: value });
const coordinate = axis => b("get_3", { sprite: "__self", attribute: axis === "x" ? "0" : "1" });
const sample = label => [set(`${label}X`,coordinate("x")),set(`${label}Y`,coordinate("y")),set(`${label}Speed`,get("speed")),set(`${label}Dir`,get("speed_dir"))];
const gravity = (value = 0) => p("set_gravity", {}, { value, dir: -90 });
const speed = (value = 2, dir = 0) => p("set_speed", {}, { value, dir });
const forceable = value => p("enable_force", { is_enable: String(value) });
const collidable = value => p("set_actor_as", { physics_body_type: value ? "attend_physics_world" : "exit_physics_world" });
const chain = blocks => { for (let i=1;i<blocks.length;i++) blocks[i-1].next=blocks[i]; return blocks[0]; };
function workspace(blocks, prefix = "probe") {
  let serial=0;
  const graph=empty();
  function add(node,parent=null) {
    const id=`physics-${prefix}-${++serial}`;
    graph.blocks[id]={...structuredClone(schema.blocks[node.type].defaults),id,parent_id:parent,location:[0,0],fields:{...schema.blocks[node.type].defaults.fields,...node.fields}};
    graph.connections[id]={};
    for (const [name,child] of Object.entries(node.inputs)) graph.connections[id][add(child,id)]={type:"input",input_type:"value",input_name:name};
    if(node.next)graph.connections[id][add(node.next,id)]={type:"next"};
    return id;
  }
  add(chain([b("start_on_click"),...blocks,set("done",n(1))]));
  return graph;
}
function project(name,blocks,{floor=false,box=false,actorX=0,actorY=0}={}) {
  const entity=(id,name,style,x=0,y=0) => ({id,name,styles:[style],current_style_id:style,x,y,scale:100,rotation:0,rotation_type:0,draggable:false,visible:true,workspace_offset:{x:0,y:0},block_data_json:empty()});
  const style=(id,w,h) => ({id,name:id,width:w,height:h,adaptive:false,pivot:{x:0,y:0},rotate_center:{x:0,y:0},cdn_url:"",url:`data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#3388aa"/></svg>`).toString("base64")}`});
  const actors={ [actorId]:{...entity(actorId,"Probe","probe-style",actorX,actorY),scene,lock:false,editable_in_tuition_mode:true,user_change_r_c:false,block_data_json:workspace(blocks)} };
  if(floor) actors[floorId]={...entity(floorId,"Floor","floor-style",0,-80),scene,lock:false,editable_in_tuition_mode:true,user_change_r_c:false,block_data_json:workspace([forceable(false),collidable(true)], "floor")};
  const variables={done:0};
  for(const block of Object.values(actors[actorId].block_data_json.blocks)) if(block.type==="variables_set") variables[block.fields.VAR]=0;
  return {
    hidden_toolbox:{toolbox:[],blocks:[]},work_source_label:1,version:25,application_version:"4.11.20",work_type:"KITTEN",size:{width:1280,height:720},type:1,project_name:`NekoC physics ${name}`,
    theatre:{current_entity:actorId,current_scene:scene,scenes_order:[scene],scenes:{[scene]:{...entity(scene,"Background","background"),actors:Object.keys(actors),screen_name:"Physics",group_order:["group"]}},actors,groups:{group:{id:"group",name:"",is_fold:false,is_group:false,actors:Object.keys(actors),scene,visible:true}},styles:{background:style("background",1280,720),"probe-style":style("probe-style",20,20),"floor-style":style("floor-style",box?20:400,20)},videos:{},timer:{}},
    variables:Object.fromEntries(Object.entries(variables).map(([id,value])=>[id,{id,name:id,value,type:"any",is_global:true,current_entity:actorId,visible:false,position:{x:0,y:0}}])),variable_order:Object.keys(variables),cloud_variables:{},audio:{},audio_order:[],midimusic:[],midi_order:[],matrix:{},models:{},toolbox:{current_type:"event",pen:false},toolbox_order:["event","control","action","appearance","sensing","operator","data"],last_toolbox_order:[],hardware_type:"",is_partial:false,ai_lab:{},broadcasts:{},painter:{color:[]},
  };
}
export function fixtures() {
  const cases={
    speed:[gravity(),speed(99,0),...sample("initial"),wait(.25),...sample("moving"),speed(-2,90),wait(.25),...sample("vertical")],
    default:[collidable(true),set("mass",get("mass")),set("friction",get("friction")),set("restitution",get("restitution")),wait(.25),...sample("falling")],
    gravity:[gravity(2),wait(.25),...sample("falling"),gravity(),speed(0),wait(.25),...sample("stopped")],
    flags:[gravity(),speed(),collidable(false),wait(.25),...sample("sensor"),forceable(false),wait(.25),...sample("static"),forceable(true),speed(),wait(.25),...sample("again"),forceable(false),collidable(false),wait(.25),...sample("disabled")],
    properties:[gravity(),p("set_mass",{},{mass:2}),p("set_roughness",{},{friction:2}),p("set_resilience",{},{restitution:-1}),p("allow_rotate",{is_allow:"true"}),p("allow_rotate",{is_allow:"false"}),p("set_texture",{texture_type:"hard"}),set("mass",get("mass")),set("friction",get("friction")),set("restitution",get("restitution")),set("flexibility",get("flexibility"))],
    force:[gravity(),p("set_mass",{},{mass:2}),p("set_force",{},{value:12,dir:0}),wait(.25),...sample("pushed")],
    timed:[gravity(),p("set_mass",{},{mass:2}),p("set_force_in_time",{},{time:1,value:1,dir:0}),...sample("complete"),wait(.25),...sample("coasting")],
    fractional:[gravity(),p("set_force_in_time",{},{time:.5,value:1,dir:0}),set("passed",n(1)),wait(.25),...sample("unchanged")],
    boundary:[gravity(2),p("set_boundary",{physics_bound_type:"bottom_bound"}),p("set_resilience",{},{restitution:0}),wait(3),...sample("resting"),set("touching",b("bump",{sprite1:"__self",sprite2:"__edge_bottom"})),p("forbid_bump_with",{sprite:"__edge_bottom",is_bump:"false"}),wait(.5),...sample("through")],
    collision:[gravity(2),p("set_resilience",{},{restitution:0}),wait(1.0),...sample("resting"),set("touching",b("bump",{sprite1:"__self",sprite2:floorId})),p("forbid_bump_with",{sprite:floorId,is_bump:"false"}),wait(.5),...sample("through"),p("forbid_bump_with",{sprite:floorId,is_bump:"true"})],
    bounce:[gravity(2),p("set_boundary",{physics_bound_type:"bottom_bound"}),p("set_resilience",{},{restitution:1}),b("wait_until",{},{condition:b("logic_compare",{OP:"GT"},{A:get("speed_dir"),B:n(0)})}),...sample("bounced")],
    friction:[gravity(2),p("set_roughness",{},{friction:1}),wait(1),speed(2),wait(.5),...sample("sliding")],
    rotation:[gravity(2),p("allow_rotate",{is_allow:"true"}),wait(1),set("rotation",b("get_3",{sprite:"__self",attribute:"3"})),...sample("tipped")],
    soft:[gravity(),p("set_texture",{texture_type:"soft"}),p("set_flexibility",{},{value:75}),wait(.25),set("flexibility",get("flexibility"))],
  };
  return Object.fromEntries(Object.entries(cases).map(([name,blocks])=>[name,project(name,blocks,{floor:["collision","friction","rotation"].includes(name),box:name==="rotation",actorX:name==="rotation"?12:0})]));
}
