import {v,item,cell,min,max} from "./state";

// Input qx/qy/qz -> block. Outside the finite island is a solid boundary.
defineProc("mc block",[],()=>{
  setVar("block",3);
  if(v("qx")>=0 && v("qx")<16 && v("qz")>=0 && v("qz")<16 && v("qy")>=0 && v("qy")<12) {
    setVar("block",toNumber(selectText(listItem("world","any",1+floor(v("qz"))+16*floor(v("qy"))),floor(v("qx"))+1,floor(v("qx"))+1)));
  }
  if(v("qy")>=12) setVar("block",0);
});
export function query(x:number,y:number,z:number):void {
  setVar("qx",x);setVar("qy",y);setVar("qz",z);callProc("mc block");
}

// Append a rectangle in direction-specific plane/u/v coordinates.
defineProc("mc surface",[],()=>{
  if(v("sw")>0 && v("sh")>0) {
    setVar("ax",v("su"));setVar("ay",v("sv"));setVar("az2",v("plane"));
    if(v("sd")<2) {setVar("ax",v("plane"));setVar("az2",v("su"));}
    else if(v("sd")<4) {setVar("ay",v("plane"));setVar("az2",v("sv"));}
    appendList("mx",v("ax"));appendList("my",v("ay"));appendList("mz",v("az2"));appendList("md",v("sd"));
    appendList("mu",v("sw"));appendList("mv",v("sh"));appendList("mt",v("sm"));appendList("ma",v("sa"));
    appendList("mc",floor(v("ax")/4)+4*floor(v("az2")/4));
  }
});

// Remove exactly one unit tile from a merged rectangle; retain up to four
// surrounding rectangles. Unaffected greedy surfaces remain merged forever.
defineProc("mc cut surface",[],()=>{
  setVar("cu0",v("cutx"));setVar("cv0",v("cuty"));setVar("cp0",v("cutz"));
  if(v("sd")<2) {setVar("cu0",v("cutz"));setVar("cp0",v("cutx"));}
  else if(v("sd")<4) {setVar("cv0",v("cutz"));setVar("cp0",v("cuty"));}
  setVar("ri",listLength("mx"));
  while(v("ri")>=1) {
    if(item("md",v("ri"))===v("sd")) {
      setVar("u0",item("mx",v("ri")));setVar("v0",item("my",v("ri")));setVar("plane",item("mz",v("ri")));
      if(v("sd")<2) {setVar("u0",item("mz",v("ri")));setVar("plane",item("mx",v("ri")));}
      else if(v("sd")<4) {setVar("v0",item("mz",v("ri")));setVar("plane",item("my",v("ri")));}
      setVar("w0",item("mu",v("ri")));setVar("h0",item("mv",v("ri")));
      if(v("plane")===v("cp0") && v("cu0")>=v("u0") && v("cu0")<v("u0")+v("w0") && v("cv0")>=v("v0") && v("cv0")<v("v0")+v("h0")) {
        setVar("sm",item("mt",v("ri")));setVar("sa",item("ma",v("ri")));
        deleteListItem("mx","any",v("ri"));deleteListItem("my","any",v("ri"));deleteListItem("mz","any",v("ri"));deleteListItem("md","any",v("ri"));
        deleteListItem("mu","any",v("ri"));deleteListItem("mv","any",v("ri"));deleteListItem("mt","any",v("ri"));deleteListItem("ma","any",v("ri"));deleteListItem("mc","any",v("ri"));
        setVar("su",v("u0"));setVar("sv",v("v0"));setVar("sw",v("cu0")-v("u0"));setVar("sh",v("h0"));callProc("mc surface");
        setVar("su",v("cu0")+1);setVar("sw",v("u0")+v("w0")-v("su"));callProc("mc surface");
        setVar("su",v("cu0"));setVar("sw",1);setVar("sh",v("cv0")-v("v0"));callProc("mc surface");
        setVar("sv",v("cv0")+1);setVar("sh",v("v0")+v("h0")-v("sv"));callProc("mc surface");
      }
    }
    changeVar("ri",-1);
  }
});

// Edit only the six touched interfaces, including chunk seams.
defineProc("mc edit",[],()=>{
  setVar("lampindex",listLength("lampx"));
  while(v("lampindex")>=1) {
    if(item("lampx",v("lampindex"))===v("ex") && item("lampy",v("lampindex"))===v("ey") && item("lampz",v("lampindex"))===v("ez")) {
      deleteListItem("lampx","any",v("lampindex"));deleteListItem("lampy","any",v("lampindex"));deleteListItem("lampz","any",v("lampindex"));
    }
    changeVar("lampindex",-1);
  }
  if(v("newblock")===7) {appendList("lampx",v("ex"));appendList("lampy",v("ey"));appendList("lampz",v("ez"));}
  setVar("editrow",listItem("world","any",1+v("ez")+16*v("ey")));
  setVar("prefix","");setVar("suffix","");
  if(v("ex")>0) setVar("prefix",selectText(getVar("editrow"),1,v("ex")));
  if(v("ex")<15) setVar("suffix",selectText(getVar("editrow"),v("ex")+2,16));
  replaceListItem("world","any",1+v("ez")+16*v("ey"),join(getVar("prefix"),v("newblock"),getVar("suffix")));
  for(let ed=0;ed<6;ed++) {
    setVar("neighborx",v("ex")+item("nx",ed+1));setVar("neighbory",v("ey")+item("ny",ed+1));setVar("neighborz",v("ez")+item("nz",ed+1));
    setVar("sd",ed);setVar("cutx",v("ex"));setVar("cuty",v("ey"));setVar("cutz",v("ez"));callProc("mc cut surface");
    setVar("sd",ed+1-2*(ed%2));setVar("cutx",v("neighborx"));setVar("cuty",v("neighbory"));setVar("cutz",v("neighborz"));callProc("mc cut surface");
    query(v("neighborx"),v("neighbory"),v("neighborz"));setVar("sm",0);
    if(v("newblock")>0 && v("block")===0) {setVar("sm",v("newblock"));setVar("sd",ed);setVar("cutx",v("ex"));setVar("cuty",v("ey"));setVar("cutz",v("ez"));}
    if(v("newblock")===0 && v("block")>0 && v("neighborx")>=0 && v("neighborx")<16 && v("neighbory")>=0 && v("neighbory")<12 && v("neighborz")>=0 && v("neighborz")<16) setVar("sm",v("block"));
    if(v("sm")>0) {
      setVar("su",v("cutx"));setVar("sv",v("cuty"));setVar("plane",v("cutz"));
      if(v("sd")<2) {setVar("su",v("cutz"));setVar("plane",v("cutx"));}
      else if(v("sd")<4) {setVar("sv",v("cutz"));setVar("plane",v("cuty"));}
      setVar("sw",1);setVar("sh",1);setVar("sa",1);callProc("mc surface");
    }
  }
  changeVar("edits",1);
});

// World-space line of sight for the hostile; solid blocks occlude it.
defineProc("mc enemy visibility",[],()=>{
  setVar("enemyvisible",1);setVar("raystep",0.3);
  setVar("raylength",mathFunc("sqrt",(v("enemyx")-v("px"))*(v("enemyx")-v("px"))+(v("enemyz")-v("pz"))*(v("enemyz")-v("pz"))));
  while(v("raystep")<v("raylength") && v("enemyvisible")===1) {
    setVar("raypart",v("raystep")/v("raylength"));
    query(v("px")+(v("enemyx")-v("px"))*v("raypart"),v("py")+1.55+(v("enemyy")+1-v("py")-1.55)*v("raypart"),v("pz")+(v("enemyz")-v("pz"))*v("raypart"));
    if(v("block")>0) setVar("enemyvisible",0);
    changeVar("raystep",0.3);
  }
});

// Ray march only for the interaction ray (not a screen/pixel renderer).
defineProc("mc target",[],()=>{
  setVar("hit",0);setVar("hitmat",0);setVar("prevx",floor(v("px")));setVar("prevy",floor(v("py")+1.55));setVar("prevz",floor(v("pz")));
  for(let rs=1;rs<=24;rs++) {
    if(v("hit")===0) {
      setVar("hx",floor(v("px")+v("sy")*v("cp")*rs*0.18));
      setVar("hy",floor(v("py")+1.55+v("sp")*rs*0.18));
      setVar("hz",floor(v("pz")+v("cy")*v("cp")*rs*0.18));
      query(v("hx"),v("hy"),v("hz"));
      if(v("block")>0) {
        setVar("hit",1);setVar("hitmat",v("block"));
      } else {
        setVar("prevx",v("hx"));setVar("prevy",v("hy"));setVar("prevz",v("hz"));
      }
    }
  }
});
