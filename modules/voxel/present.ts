import {v,item} from "./state";

// The builder routes render.ts pen operations here. Geometry is computed
// into a native command list while the previous complete frame stays visible.
export function queueCommand(qop:number,qa:NekoValue,qb:NekoValue,qc:NekoValue,qd:NekoValue):void {
  appendList("paintop",qop);appendList("painta",qa);appendList("paintb",qb);appendList("paintc",qc);appendList("paintd",qd);
}
export function queueClear():void {
  deleteListItem("paintop","all",1);deleteListItem("painta","all",1);deleteListItem("paintb","all",1);deleteListItem("paintc","all",1);deleteListItem("paintd","all",1);
  setVar("paintdown",0);setVar("paintmoved",0);
}
export function queueMove(qmx:number,qmy:number):void {
  setVar("paintnextx",qmx);setVar("paintnexty",qmy);callProc("mc queue move");
}
defineProc("mc queue move",[],()=>{
  if(v("paintdown")===1) {
    queueCommand(1,v("paintx"),v("painty"),v("paintnextx"),v("paintnexty"));setVar("paintmoved",1);
  }
  setVar("paintx",v("paintnextx"));setVar("painty",v("paintnexty"));
});
export function queueDown():void {setVar("paintdown",1);setVar("paintmoved",0);}
export function queueUp():void {
  callProc("mc queue up");
}
defineProc("mc queue up",[],()=>{
  if(v("paintdown")===1 && v("paintmoved")===0) queueCommand(1,v("paintx"),v("painty"),v("paintx"),v("painty"));
  setVar("paintdown",0);
});
export function queueSize(qsize:NekoValue):void {queueCommand(3,qsize,0,0,0);}
export function queueColor(qh:number,qs:number,qv:number):void {queueCommand(4,qh,qs,qv,0);}
export function queueEffect(qeffect:string,qvalue:NekoValue):void {
  if(qeffect==="hue") queueCommand(5,qvalue,0,0,0);
  if(qeffect==="saturation") queueCommand(6,qvalue,0,0,0);
  if(qeffect==="brightness") queueCommand(7,qvalue,0,0,0);
}
export function queueText(qtext:NekoValue,qtsize:NekoValue,qtalign:string):void {queueCommand(2,v("paintx"),v("painty"),qtext,qtsize);}

// One command has no loops or waits. The builder adds a bounded binary call
// tree: <=8192 commands with stack depth 14, no native loop-yield boundary.
// This uses public blocks, not a change to the runtime's scheduling budget.
defineProc("mc paint command",[],()=>{
  if(v("paintindex")<=v("paintcount")) {
    setVar("paintcode",item("paintop",v("paintindex")));
    if(v("paintcode")===1) {
      moveTo(item("painta",v("paintindex")),item("paintb",v("paintindex")));penDown();
      moveTo(item("paintc",v("paintindex")),item("paintd",v("paintindex")));penUp();
    } else if(v("paintcode")===2) {
      moveTo(item("painta",v("paintindex")),item("paintb",v("paintindex")));
      stampText(listItem("paintc","any",v("paintindex")),item("paintd",v("paintindex")),"left");
    } else if(v("paintcode")===3) setPenSize(item("painta",v("paintindex")));
    else if(v("paintcode")===4) {
      setPenEffect("hue",item("painta",v("paintindex")));setPenEffect("saturation",item("paintb",v("paintindex")));setPenEffect("brightness",item("paintc",v("paintindex")));
    } else if(v("paintcode")===5) setPenEffect("hue",item("painta",v("paintindex")));
    else if(v("paintcode")===6) setPenEffect("saturation",item("painta",v("paintindex")));
    else if(v("paintcode")===7) setPenEffect("brightness",item("painta",v("paintindex")));
    changeVar("paintindex",1);
  }
});

defineProc("mc present",[],()=>{
  setVar("paintcount",listLength("paintop"));setVar("paintindex",1);
  // Reject an oversized frame before clearing; never show a truncated frame.
  if(v("paintcount")<=8192) {
    // Begin with a fresh interpreter step, below its 50000-call budget.
    // Yield while the previous frame is still intact, never after clear.
    wait(0);
    setVar("presenting",1);penUp();clearDrawing();
    callProc("mc paint tree 13");
    changeVar("frames",1);setVar("presenting",0);
  } else setVar("notice","Frame too complex: increase V band width or reduce N view.");
});
