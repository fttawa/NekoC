import {v,min,max,clamp} from "../../modules/voxel/state";
import "../../modules/voxel/world";
import "../../modules/voxel/render";
import "../../modules/voxel/game";

onStart(()=>{
  hide();penUp();hideTimer();timerStart();
  setVar("frames",0);setVar("fps",0);setVar("lastframes",0);setVar("fpsclock",0);setVar("lasttime",timerValue());
  setVar("clock",0);setVar("tool",0);setVar("durability",0);setVar("apples",3);setVar("selected",2);
  setVar("quality",10);setVar("view",9);setVar("help",1);setVar("paused",0);setVar("torch",0);setVar("ready",1);
  setVar("enemyalive",0);setVar("enemyspawn",0);setVar("edits",0);
  callProc("mc respawn");
  forever(()=>{warp(()=>{
    setVar("now",timerValue());setVar("elapsed",max(0,v("now")-v("lasttime")));setVar("lasttime",v("now"));
    if(v("paused")===0 && v("hp")>0) {
      // Collision uses bounded substeps; hunger/daylight use wall-clock time.
      setVar("simtime",min(0.4,v("elapsed")));setVar("steps",max(1,ceil(v("simtime")/0.05)));
      setVar("dt",v("simtime")/v("steps"));
      for(let physicsStep=1;physicsStep<=v("steps");physicsStep++) callProc("mc physics");
      setVar("dt",min(1,v("elapsed")));callProc("mc interact");callProc("mc survival");
    }
    if(v("respawn")===1) {setVar("respawn",0);callProc("mc respawn");}
    callProc("mc render");
    if(v("now")-v("fpsclock")>=1) {
      setVar("fps",floor((v("frames")-v("lastframes"))/(v("now")-v("fpsclock"))*10)/10);setVar("lastframes",v("frames"));setVar("fpsclock",v("now"));
    }
  });});
});
onKey("71",()=>{setVar("place",1);});onKey("67",()=>{setVar("craft",1);});
onKey("84",()=>{setVar("crafttorch",1);});onKey("69",()=>{setVar("eat",1);});
onKey("66",()=>{setVar("attack",1);});onKey("82",()=>{setVar("respawn",1);});
onKey("72",()=>{setVar("help",1-v("help"));});onKey("80",()=>{setVar("paused",1-v("paused"));});
onKey("76",()=>{if((listItem("bag","any",7) as number)>0) setVar("torch",1-v("torch"));});
onKey("86",()=>{setVar("quality",v("quality")+2);if(v("quality")>10) setVar("quality",2);});
onKey("78",()=>{setVar("view",v("view")+2);if(v("view")>15) setVar("view",7);});
onKey("49",()=>{setVar("selected",1);});onKey("50",()=>{setVar("selected",2);});onKey("51",()=>{setVar("selected",3);});
onKey("52",()=>{setVar("selected",4);});onKey("53",()=>{setVar("selected",5);});onKey("54",()=>{setVar("selected",6);});onKey("55",()=>{setVar("selected",7);});
