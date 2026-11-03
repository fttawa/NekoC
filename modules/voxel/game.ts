import {v,item,cell,min,max,clamp} from "./state";
import {query} from "./world";

// AABB occupancy at testx/testy/testz. Eight corners, two vertical samples.
defineProc("mc collision",[],()=>{
  setVar("blocked",0);
  for(let cc=0;cc<8;cc++) {
    query(v("testx")-0.24+(cc%2)*0.48,v("testy")+0.05+floor(cc/4)*1.6,v("testz")-0.24+(floor(cc/2)%2)*0.48);
    if(v("block")>0) setVar("blocked",1);
  }
});
defineProc("mc respawn",[],()=>{
  setVar("px",7.5);setVar("pz",3.5);setVar("py",4);setVar("yaw",0);setVar("pitch",-12);
  setVar("hp",20);setVar("food",20);setVar("velocity",0);setVar("grounded",0);setVar("notice","H controls · Hold F to mine · G to build");
});

defineProc("mc physics",[],()=>{
  setVar("moveforward",0);setVar("moveside",0);
  if(keyPressed("87")) changeVar("moveforward",1);if(keyPressed("83")) changeVar("moveforward",-1);
  if(keyPressed("68")) changeVar("moveside",1);if(keyPressed("65")) changeVar("moveside",-1);
  if(keyPressed("37")) changeVar("yaw",-90*v("dt"));if(keyPressed("39")) changeVar("yaw",90*v("dt"));
  if(keyPressed("38")) changeVar("pitch",60*v("dt"));if(keyPressed("40")) changeVar("pitch",-60*v("dt"));
  setVar("pitch",clamp(v("pitch"),-75,75));setVar("yaw",(v("yaw")+360)%360);
  setVar("sy",trig("sin",v("yaw")));setVar("cy",trig("cos",v("yaw")));setVar("sp",trig("sin",v("pitch")));setVar("cp",trig("cos",v("pitch")));
  setVar("speed",2.8*v("dt"));
  if(v("moveforward")!==0 && v("moveside")!==0) setVar("speed",v("speed")*0.7071);
  setVar("testx",v("px")+(v("sy")*v("moveforward")+v("cy")*v("moveside"))*v("speed"));setVar("testy",v("py"));setVar("testz",v("pz"));
  if(v("moveforward")!==0 || v("moveside")!==0) {
    callProc("mc collision");if(v("blocked")===0) setVar("px",v("testx"));
    setVar("testx",v("px"));setVar("testz",v("pz")+(v("cy")*v("moveforward")-v("sy")*v("moveside"))*v("speed"));
    callProc("mc collision");if(v("blocked")===0) setVar("pz",v("testz"));
  }
  if(keyPressed("32") && v("grounded")===1) {setVar("velocity",5.8);setVar("grounded",0);}
  // Resting on a known support needs no repeated eight-corner query.
  if(v("grounded")===0 || v("moveforward")!==0 || v("moveside")!==0 || v("velocity")!==0 || v("supportedit")!==v("edits")) {
  setVar("supportedit",v("edits"));changeVar("velocity",-15*v("dt"));
  setVar("testx",v("px"));setVar("testz",v("pz"));setVar("testy",v("py")+v("velocity")*v("dt"));
  callProc("mc collision");
  if(v("blocked")===0) {setVar("py",v("testy"));setVar("grounded",0);}
  else {
    if(v("velocity")<0) {
      if(v("velocity")< -9) changeVar("hp",-floor((0-v("velocity")-9)*1.2));
      setVar("grounded",1);
    }
    setVar("velocity",0);
  }
  }
});

defineProc("mc interact",[],()=>{
  callProc("mc target");
  if(v("hit")===1 && keyPressed("70") && v("hy")>0 && v("hx")>=0 && v("hx")<16 && v("hz")>=0 && v("hz")<16) {
    setVar("targetid",cell(v("hx"),v("hy"),v("hz")));
    if(v("targetid")!==v("oldtarget")) setVar("mining",0);
    setVar("oldtarget",v("targetid"));setVar("hardness",0.7);
    if(v("hitmat")===3) setVar("hardness",3);
    if(v("hitmat")===4) setVar("hardness",1.6);
    if(v("hitmat")===6) setVar("hardness",5);
    changeVar("mining",v("dt")*(1+v("tool")*1.7)/v("hardness"));
    if(v("mining")>=1) {
      if(v("hitmat")===6 && v("tool")<2) {setVar("notice","Iron needs a stone pick (C)");setVar("mining",0);}
      else {
        replaceListItem("bag","any",v("hitmat"),item("bag",v("hitmat"))+1);
        if(v("hitmat")===5) changeVar("apples",1);
        setVar("ex",v("hx"));setVar("ey",v("hy"));setVar("ez",v("hz"));setVar("newblock",0);callProc("mc edit");
        setVar("mining",0);changeVar("food",-0.08);setVar("notice","Block collected. G places selected block.");
        if(v("tool")>0) {changeVar("durability",-1);if(v("durability")<=0) {setVar("tool",0);setVar("notice","Pick broke. C to craft another.");}}
      }
    }
  } else {setVar("mining",0);}
  if(v("place")===1) {
    setVar("place",0);
    if(v("hit")===1 && item("bag",v("selected"))>0 && v("prevx")>=0 && v("prevx")<16 && v("prevz")>=0 && v("prevz")<16 && v("prevy")>0 && v("prevy")<12) {
      if(mathFunc("abs",v("prevx")+0.5-v("px"))>0.74 || mathFunc("abs",v("prevz")+0.5-v("pz"))>0.74 || v("prevy")+1<=v("py") || v("prevy")>=v("py")+1.7) {
        setVar("ex",v("prevx"));setVar("ey",v("prevy"));setVar("ez",v("prevz"));setVar("newblock",v("selected"));callProc("mc edit");
        replaceListItem("bag","any",v("selected"),item("bag",v("selected"))-1);setVar("notice","Placed. Local surfaces updated.");
      }
    }
  }
  if(v("craft")===1) {
    setVar("craft",0);
    if(v("tool")<1 && item("bag",4)>=3) {replaceListItem("bag","any",4,item("bag",4)-3);setVar("tool",1);setVar("durability",40);setVar("notice","Crafted WOOD PICK · 40 uses");}
    else if(v("tool")<2 && item("bag",3)>=3 && item("bag",4)>=1) {replaceListItem("bag","any",3,item("bag",3)-3);replaceListItem("bag","any",4,item("bag",4)-1);setVar("tool",2);setVar("durability",100);setVar("notice","Crafted STONE PICK · 100 uses");}
    else if(v("tool")<3 && item("bag",6)>=3 && item("bag",4)>=1) {replaceListItem("bag","any",6,item("bag",6)-3);replaceListItem("bag","any",4,item("bag",4)-1);setVar("tool",3);setVar("durability",220);setVar("notice","Crafted IRON PICK · 220 uses");}
    else {setVar("notice","Recipe: 3 wood / 3 stone + wood / 3 iron + wood");}
  }
  if(v("crafttorch")===1) {
    setVar("crafttorch",0);
    if(item("bag",4)>=1) {replaceListItem("bag","any",4,item("bag",4)-1);replaceListItem("bag","any",7,item("bag",7)+4);setVar("torch",1);setVar("notice","4 lantern blocks crafted. L toggles held light.");}
    else {setVar("notice","Torch recipe: 1 wood -> 4 lanterns");}
  }
  if(v("eat")===1) {setVar("eat",0);if(v("apples")>0) {changeVar("apples",-1);setVar("food",min(20,v("food")+5));setVar("notice","Ate an apple. Leaves supply food.");}else {setVar("notice","No apples: collect leaves");}}
});

defineProc("mc survival",[],()=>{
  changeVar("clock",v("dt"));setVar("daylight",clamp(55+55*trig("cos",v("clock")*2),14,100));
  changeVar("food",-v("dt")*0.045);setVar("food",max(0,v("food")));
  if(v("food")===0) changeVar("hp",-v("dt")*0.3);
  if(v("food")>15) setVar("hp",min(20,v("hp")+v("dt")*0.07));
  if(v("daylight")<30 && v("enemyalive")===0 && v("clock")>v("enemyspawn")) {
    setVar("enemyalive",1);setVar("enemyhp",6);setVar("enemyx",12.5);setVar("enemyz",12.5);setVar("enemyy",11);
    setVar("findingground",1);
    while(v("enemyy")>1 && v("findingground")===1) {
      query(v("enemyx"),v("enemyy")-1,v("enemyz"));
      if(v("block")===0) changeVar("enemyy",-1);else setVar("findingground",0);
    }
    setVar("notice","Nightfall: a hostile is approaching. B attacks.");
  }
  if(v("enemyalive")===1) {
    setVar("edx",v("px")-v("enemyx"));setVar("edz",v("pz")-v("enemyz"));
    setVar("edist",max(0.1,mathFunc("sqrt",v("edx")*v("edx")+v("edz")*v("edz"))));
    setVar("enextx",v("enemyx")+v("edx")/v("edist")*v("dt")*0.65);
    setVar("enextz",v("enemyz")+v("edz")/v("edist")*v("dt")*0.65);
    query(v("enextx"),v("enemyy")+0.1,v("enextz"));
    if(v("block")===0) {setVar("enemyx",v("enextx"));setVar("enemyz",v("enextz"));}
    else {
      query(v("enextx"),v("enemyy")+1.1,v("enextz"));
      if(v("block")===0) {changeVar("enemyy",1);setVar("enemyx",v("enextx"));setVar("enemyz",v("enextz"));}
    }
    query(v("enemyx"),v("enemyy")-0.05,v("enemyz"));
    if(v("block")===0) setVar("enemyy",max(floor(v("enemyy")-0.05),v("enemyy")-v("dt")*2));
    if(v("edist")<2.8) {
      callProc("mc enemy visibility");
      if(v("enemyvisible")===1) {
        if(v("edist")<1.3 && mathFunc("abs",v("py")-v("enemyy"))<1.5 && v("clock")>v("nextdamage")) {changeVar("hp",-2);setVar("nextdamage",v("clock")+1);}
        if(v("attack")===1 && mathFunc("abs",v("py")-v("enemyy"))<2) {changeVar("enemyhp",-2-v("tool"));setVar("notice","Hit hostile");}
      }
    }
    if(v("enemyhp")<=0 || v("daylight")>45) {setVar("enemyalive",0);setVar("enemyspawn",v("clock")+25);}
  }
  setVar("attack",0);setVar("hp",max(0,v("hp")));
});
