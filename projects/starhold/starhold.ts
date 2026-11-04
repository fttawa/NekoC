// STARHOLD native battle controller. Bundle this file once before the UI.
// Every native procedure owns its warp: calls do not inherit the caller's warp.
// td tick consumes buildRequest / upgradeRequest / sellRequest / startWave before
// combat, even at dt=0. Public action procedures may also be called directly.
// All calls belong to the same controller; the UI only writes request flags.
// buildRequest is a 1-based pad; upgrade/sell use selectedPad. Calls clear flags.
// milestone=1: level 1, four waves, type-1 enemies/towers only.
// milestone=2: level 1, four waves, all four towers and all six enemy types.
// milestone>=3: the six levels in docs/tower-defense-design.md.
// Parent supplies immutable padX/padY (12 each); reset preserves those and records.
// Production padX: -330,-320,-310,-160,-160,15,15,180,180,245,-405,250.
// Production padY:  165,  25,-175, -35, 175,55,-175, 55,-175,165, -50,-25.
// Path: (-400,100),(-240,100),(-240,-110),(-70,-110),(-70,130),
//       (100,130),(100,-110),(250,-110). Length 1340, NOT 1310.
// Cumulative distances: 0,160,370,540,780,950,1190,1340.
// Additional readable state: alive, spawnLeft, waveSize, kills, sold, clock, notice.
// ready=1 between waves, 0 during waves/after settlement. tShot/eFlash/bossAlert
// are seconds remaining. simFrames counts positive-dt, unpaused simulation
// updates; frames belongs to the parent controller's render/update FPS meter.
// td* variables are controller scratch, except tdHealthScale (per-run constant).
// No native numbers loop has a dynamic/possibly-empty range: pools are 24 / 12.

function v(name: string): number { return getVar(name) as number; }
function l(name: string, index: number): number { return listItem(name,"any",index) as number; }
function r(name: string, index: number, value: number): void { replaceListItem(name,"any",index,value); }

defineProc("td reset",[],()=>{warp(()=>{
  setVar("level",floor(v("level")));
  if(v("level")<1 || v("level")>6 || v("milestone")<3) setVar("level",1);
  setVar("waves",4);setVar("gold",180);setVar("tdHealthScale",0.85);
  if(v("level")===2) {setVar("waves",5);setVar("gold",190);setVar("tdHealthScale",1);}
  if(v("level")===3) {setVar("waves",6);setVar("gold",210);setVar("tdHealthScale",1.15);}
  if(v("level")===4) {setVar("waves",7);setVar("gold",230);setVar("tdHealthScale",1.30);}
  if(v("level")===5) {setVar("waves",8);setVar("gold",250);setVar("tdHealthScale",1.48);}
  if(v("level")===6) {setVar("waves",10);setVar("gold",280);setVar("tdHealthScale",1.70);}
  setVar("mode",2);setVar("wave",0);setVar("lives",20);setVar("score",0);setVar("stars",0);
  setVar("paused",0);setVar("simFrames",0);setVar("clock",0);setVar("dt",0);setVar("ready",1);
  setVar("waveActive",0);setVar("bossAlert",0);setVar("shake",0);setVar("alive",0);
  setVar("spawnLeft",0);setVar("waveSize",0);setVar("spawnIndex",0);setVar("spawnTimer",0);
  setVar("kills",0);setVar("sold",0);setVar("selectedTower",1);setVar("selectedPad",0);
  setVar("startWave",0);setVar("buildRequest",0);setVar("upgradeRequest",0);setVar("sellRequest",0);
  setVar("notice","Choose a tower and an empty pad. SPACE starts the wave.");
  deleteListItem("eAlive","all",0);deleteListItem("eType","all",0);
  deleteListItem("eHP","all",0);deleteListItem("eMax","all",0);
  deleteListItem("eX","all",0);deleteListItem("eY","all",0);
  deleteListItem("eProgress","all",0);deleteListItem("eSlow","all",0);deleteListItem("eFlash","all",0);
  for(let tdResetEnemy=1;tdResetEnemy<=24;tdResetEnemy++) {
    appendList("eAlive",0);appendList("eType",0);appendList("eHP",0);appendList("eMax",0);
    appendList("eX",-400);appendList("eY",100);appendList("eProgress",0);appendList("eSlow",0);appendList("eFlash",0);
  }
  deleteListItem("tType","all",0);deleteListItem("tLevel","all",0);deleteListItem("tCooldown","all",0);
  deleteListItem("tShot","all",0);deleteListItem("tTargetX","all",0);deleteListItem("tTargetY","all",0);deleteListItem("tSpent","all",0);
  for(let tdResetTower=1;tdResetTower<=12;tdResetTower++) {
    appendList("tType",0);appendList("tLevel",0);appendList("tCooldown",0);appendList("tShot",0);
    appendList("tTargetX",0);appendList("tTargetY",0);appendList("tSpent",0);
  }
  for(let tdRecord=1;tdRecord<=6;tdRecord++) {
    if((listLength("bestScore") as number)<tdRecord) appendList("bestScore",0);
    if((listLength("bestStars") as number)<tdRecord) appendList("bestStars",0);
  }
});});

// Input tdType, tdLevel; output the current attack and next upgrade price.
defineProc("td tower stats",[],()=>{warp(()=>{
  setVar("tdCost",55);setVar("tdUpgrade",45);setVar("tdDamage",8);setVar("tdRange",135);setVar("tdInterval",0.60);
  if(v("tdType")===1) {
    if(v("tdLevel")===2) {setVar("tdUpgrade",70);setVar("tdDamage",14);setVar("tdRange",150);setVar("tdInterval",0.50);}
    if(v("tdLevel")===3) {setVar("tdDamage",23);setVar("tdRange",165);setVar("tdInterval",0.42);}
  }
  if(v("tdType")===2) {
    setVar("tdCost",70);setVar("tdUpgrade",55);setVar("tdDamage",4);setVar("tdRange",120);setVar("tdInterval",0.85);
    if(v("tdLevel")===2) {setVar("tdUpgrade",85);setVar("tdDamage",7);setVar("tdRange",135);setVar("tdInterval",0.75);}
    if(v("tdLevel")===3) {setVar("tdDamage",12);setVar("tdRange",150);setVar("tdInterval",0.65);}
  }
  if(v("tdType")===3) {
    setVar("tdCost",100);setVar("tdUpgrade",75);setVar("tdDamage",18);setVar("tdRange",145);setVar("tdInterval",1.45);
    if(v("tdLevel")===2) {setVar("tdUpgrade",110);setVar("tdDamage",30);setVar("tdRange",155);setVar("tdInterval",1.25);}
    if(v("tdLevel")===3) {setVar("tdDamage",48);setVar("tdRange",165);setVar("tdInterval",1.10);}
  }
  if(v("tdType")===4) {
    setVar("tdCost",125);setVar("tdUpgrade",90);setVar("tdDamage",32);setVar("tdRange",185);setVar("tdInterval",1.65);
    if(v("tdLevel")===2) {setVar("tdUpgrade",135);setVar("tdDamage",52);setVar("tdRange",205);setVar("tdInterval",1.40);}
    if(v("tdLevel")===3) {setVar("tdDamage",82);setVar("tdRange",225);setVar("tdInterval",1.20);}
  }
  if(v("tdLevel")>=3) setVar("tdUpgrade",0);
});});

defineProc("td build",[],()=>{warp(()=>{
  setVar("tdPad",v("buildRequest"));setVar("buildRequest",0);
  if(v("mode")===2 && v("paused")===0 && v("tdPad")>=1 && v("tdPad")<=12 && v("tdPad")===floor(v("tdPad"))) {
    setVar("selectedPad",v("tdPad"));
    if(l("tType",v("tdPad"))===0 && v("selectedTower")>=1 && v("selectedTower")<=4 && v("selectedTower")===floor(v("selectedTower"))) {
      if(v("milestone")>=2 || v("selectedTower")===1) {
        setVar("tdType",v("selectedTower"));setVar("tdLevel",1);callProc("td tower stats");
        if(v("gold")>=v("tdCost")) {
          changeVar("gold",0-v("tdCost"));r("tType",v("tdPad"),v("tdType"));r("tLevel",v("tdPad"),1);
          r("tSpent",v("tdPad"),v("tdCost"));r("tCooldown",v("tdPad"),0);r("tShot",v("tdPad"),0);
          r("tTargetX",v("tdPad"),l("padX",v("tdPad")));r("tTargetY",v("tdPad"),l("padY",v("tdPad")));
          setVar("notice","Tower ready. U upgrades; X sells.");
        } else setVar("notice","Not enough gold to build.");
      }
    }
  }
});});

defineProc("td upgrade",[],()=>{warp(()=>{
  setVar("upgradeRequest",0);setVar("tdPad",v("selectedPad"));
  if(v("mode")===2 && v("paused")===0 && v("tdPad")>=1 && v("tdPad")<=12 && v("tdPad")===floor(v("tdPad"))) {
    if(l("tType",v("tdPad"))>0 && l("tLevel",v("tdPad"))<3) {
      setVar("tdType",l("tType",v("tdPad")));setVar("tdLevel",l("tLevel",v("tdPad")));callProc("td tower stats");
      if(v("gold")>=v("tdUpgrade")) {
        changeVar("gold",0-v("tdUpgrade"));r("tSpent",v("tdPad"),l("tSpent",v("tdPad"))+v("tdUpgrade"));
        r("tLevel",v("tdPad"),v("tdLevel")+1);setVar("notice","Tower upgraded.");
      } else setVar("notice","Not enough gold to upgrade.");
    }
  }
});});

defineProc("td sell",[],()=>{warp(()=>{
  setVar("sellRequest",0);setVar("tdPad",v("selectedPad"));
  if(v("mode")===2 && v("paused")===0 && v("tdPad")>=1 && v("tdPad")<=12 && v("tdPad")===floor(v("tdPad"))) {
    if(l("tType",v("tdPad"))>0) {
      changeVar("gold",floor(l("tSpent",v("tdPad"))*0.60));changeVar("sold",1);
      r("tType",v("tdPad"),0);r("tLevel",v("tdPad"),0);r("tSpent",v("tdPad"),0);
      r("tCooldown",v("tdPad"),0);r("tShot",v("tdPad"),0);r("tTargetX",v("tdPad"),0);r("tTargetY",v("tdPad"),0);
      setVar("notice","Sold for 60% of the total investment.");
    }
  }
});});

defineProc("td next wave",[],()=>{warp(()=>{
  setVar("startWave",0);
  if(v("mode")===2 && v("paused")===0 && v("waveActive")===0 && v("alive")===0 && v("wave")<v("waves")) {
    changeVar("wave",1);setVar("waveActive",1);setVar("ready",0);
    setVar("waveSize",6+v("wave")*2+floor((v("level")-1)*1.5));setVar("spawnLeft",v("waveSize"));
    setVar("spawnIndex",0);setVar("spawnTimer",0);setVar("spawnGap",0.90-v("wave")*0.035-v("level")*0.02);
    if(v("spawnGap")<0.45) setVar("spawnGap",0.45);
    setVar("notice","Wave incoming. Defend the core!");
  }
});});

// One spawn maximum per tick. A full pool defers the enemy, without building
// an unbounded catch-up debt or consuming spawnLeft/spawnIndex.
defineProc("td spawn",[],()=>{warp(()=>{
  if(v("spawnLeft")>0 && v("alive")<24) {
    setVar("tdFree",0);
    for(let tdSpawnSlot=1;tdSpawnSlot<=24;tdSpawnSlot++) {
      if(v("tdFree")===0 && l("eAlive",tdSpawnSlot)===0) setVar("tdFree",tdSpawnSlot);
    }
    if(v("tdFree")>0) {
      changeVar("spawnIndex",1);setVar("tdKind",1);
      if(v("milestone")>=2) {
        setVar("tdKinds",v("level")+1);
        if(v("tdKinds")>5 || v("milestone")===2) setVar("tdKinds",5);
        if(v("level")===1 && v("wave")===1 && v("milestone")>=3) setVar("tdKinds",1);
        setVar("tdKind",1+(v("spawnIndex")+v("wave")-2)%v("tdKinds"));
        if(v("wave")===v("waves") && (v("milestone")===2 || v("level")===3 || v("level")>=5)) {
          if(v("spawnIndex")===v("waveSize")) setVar("tdKind",6);
          if(v("level")===6 && v("spawnIndex")===v("waveSize")-1) setVar("tdKind",6);
        }
        if(v("level")===6 && v("wave")===5 && v("spawnIndex")===v("waveSize")) setVar("tdKind",6);
      }
      setVar("tdHP",36);
      if(v("tdKind")===2) setVar("tdHP",24);
      if(v("tdKind")===3) setVar("tdHP",105);
      if(v("tdKind")===4) setVar("tdHP",72);
      if(v("tdKind")===5) setVar("tdHP",150);
      if(v("tdKind")===6) {setVar("tdHP",650);setVar("bossAlert",2.4);setVar("notice","RIFT LORD incoming!");}
      setVar("tdHP",ceil(v("tdHP")*v("tdHealthScale")*(1+0.18*(v("wave")-1))));
      r("eAlive",v("tdFree"),1);r("eType",v("tdFree"),v("tdKind"));r("eHP",v("tdFree"),v("tdHP"));r("eMax",v("tdFree"),v("tdHP"));
      r("eX",v("tdFree"),-400);r("eY",v("tdFree"),100);r("eProgress",v("tdFree"),0);r("eSlow",v("tdFree"),0);r("eFlash",v("tdFree"),0);
      changeVar("alive",1);changeVar("spawnLeft",-1);changeVar("spawnTimer",v("spawnGap"));
    }
  }
  if(v("spawnTimer")<0) setVar("spawnTimer",0);
});});

defineProc("td move enemies",[],()=>{warp(()=>{
  for(let tdMoveSlot=1;tdMoveSlot<=24;tdMoveSlot++) {
    if(l("eAlive",tdMoveSlot)===1 && v("lives")>0) {
      setVar("tdKind",l("eType",tdMoveSlot));setVar("tdSpeed",38);
      if(v("tdKind")===2) setVar("tdSpeed",66);
      if(v("tdKind")===3) setVar("tdSpeed",27);
      if(v("tdKind")===4) setVar("tdSpeed",36);
      if(v("tdKind")===5) setVar("tdSpeed",32);
      if(v("tdKind")===6) setVar("tdSpeed",21);
      setVar("tdFrozen",l("eSlow",tdMoveSlot));
      if(v("tdFrozen")>v("dt")) setVar("tdFrozen",v("dt"));
      if(l("eSlow",tdMoveSlot)>0) r("eSlow",tdMoveSlot,l("eSlow",tdMoveSlot)-v("tdFrozen"));
      if(l("eFlash",tdMoveSlot)>0) {
        setVar("tdFlash",l("eFlash",tdMoveSlot)-v("dt"));if(v("tdFlash")<0) setVar("tdFlash",0);r("eFlash",tdMoveSlot,v("tdFlash"));
      }
      if(v("tdKind")===4 && l("eHP",tdMoveSlot)<l("eMax",tdMoveSlot) && v("tdFrozen")<v("dt")) {
        setVar("tdHP",l("eHP",tdMoveSlot)+3*(v("dt")-v("tdFrozen")));
        if(v("tdHP")>l("eMax",tdMoveSlot)) setVar("tdHP",l("eMax",tdMoveSlot));
        r("eHP",tdMoveSlot,v("tdHP"));
      }
      setVar("tdProgress",l("eProgress",tdMoveSlot)+v("tdSpeed")*(v("dt")-0.45*v("tdFrozen")));
      if(v("tdProgress")>=1340) {
        setVar("tdProgress",1340);r("eAlive",tdMoveSlot,0);r("eHP",tdMoveSlot,0);changeVar("alive",-1);
        setVar("tdLeak",1);if(v("tdKind")===5) setVar("tdLeak",2);if(v("tdKind")===6) setVar("tdLeak",5);
        changeVar("lives",0-v("tdLeak"));if(v("lives")<0) setVar("lives",0);
        if(v("quality")>0 && v("shakeEnabled")===1) setVar("shake",0.18);
      }
      r("eProgress",tdMoveSlot,v("tdProgress"));
      if(v("tdProgress")<160) {r("eX",tdMoveSlot,-400+v("tdProgress"));r("eY",tdMoveSlot,100);}
      else if(v("tdProgress")<370) {r("eX",tdMoveSlot,-240);r("eY",tdMoveSlot,260-v("tdProgress"));}
      else if(v("tdProgress")<540) {r("eX",tdMoveSlot,v("tdProgress")-610);r("eY",tdMoveSlot,-110);}
      else if(v("tdProgress")<780) {r("eX",tdMoveSlot,-70);r("eY",tdMoveSlot,v("tdProgress")-650);}
      else if(v("tdProgress")<950) {r("eX",tdMoveSlot,v("tdProgress")-850);r("eY",tdMoveSlot,130);}
      else if(v("tdProgress")<1190) {r("eX",tdMoveSlot,100);r("eY",tdMoveSlot,1080-v("tdProgress"));}
      else {r("eX",tdMoveSlot,v("tdProgress")-1090);r("eY",tdMoveSlot,-110);}
    }
  }
});});

// tdVictim receives tdDamage from tdType. Armor is applied per victim, so a
// splash hitting armor cannot accidentally reduce the next victim's damage.
defineProc("td damage",[],()=>{warp(()=>{
  if(l("eAlive",v("tdVictim"))===1) {
    setVar("tdHitDamage",v("tdDamage"));
    if(l("eType",v("tdVictim"))===3 && v("tdType")!==4) setVar("tdHitDamage",v("tdHitDamage")*0.65);
    r("eHP",v("tdVictim"),l("eHP",v("tdVictim"))-v("tdHitDamage"));r("eFlash",v("tdVictim"),0.14);callProc("td effects hit");
    if(v("tdType")===2) r("eSlow",v("tdVictim"),1.2);
    if(l("eHP",v("tdVictim"))<=0) {
      setVar("tdReward",9);
      if(l("eType",v("tdVictim"))===2) setVar("tdReward",8);
      if(l("eType",v("tdVictim"))===3) setVar("tdReward",16);
      if(l("eType",v("tdVictim"))===4) setVar("tdReward",13);
      if(l("eType",v("tdVictim"))===5) setVar("tdReward",22);
      if(l("eType",v("tdVictim"))===6) setVar("tdReward",100);
      r("eAlive",v("tdVictim"),0);r("eHP",v("tdVictim"),0);r("eSlow",v("tdVictim"),0);
      changeVar("alive",-1);changeVar("kills",1);changeVar("gold",v("tdReward"));changeVar("score",v("tdReward")*10);
    }
  }
});});

defineProc("td towers",[],()=>{warp(()=>{
  for(let tdTowerSlot=1;tdTowerSlot<=12;tdTowerSlot++) {
    if(l("tType",tdTowerSlot)>0) {
      if(l("tShot",tdTowerSlot)>0) {
        setVar("tdShot",l("tShot",tdTowerSlot)-v("dt"));if(v("tdShot")<0) setVar("tdShot",0);r("tShot",tdTowerSlot,v("tdShot"));
      }
      setVar("tdCooldown",l("tCooldown",tdTowerSlot));
      if(v("tdCooldown")>0) changeVar("tdCooldown",0-v("dt"));
      if(v("tdCooldown")<=0 && v("alive")>0) {
        setVar("tdType",l("tType",tdTowerSlot));setVar("tdLevel",l("tLevel",tdTowerSlot));callProc("td tower stats");
        setVar("tdTowerX",l("padX",tdTowerSlot));setVar("tdTowerY",l("padY",tdTowerSlot));
        setVar("tdRange2",v("tdRange")*v("tdRange"));setVar("tdTarget",0);setVar("tdBest",-1);
        for(let tdTargetSlot=1;tdTargetSlot<=24;tdTargetSlot++) {
          if(l("eAlive",tdTargetSlot)===1 && l("eProgress",tdTargetSlot)>v("tdBest")) {
            setVar("tdDX",l("eX",tdTargetSlot)-v("tdTowerX"));setVar("tdDY",l("eY",tdTargetSlot)-v("tdTowerY"));
            if(v("tdDX")*v("tdDX")+v("tdDY")*v("tdDY")<=v("tdRange2")) {
              setVar("tdTarget",tdTargetSlot);setVar("tdBest",l("eProgress",tdTargetSlot));
            }
          }
        }
        if(v("tdTarget")>0) {
          setVar("tdCooldown",v("tdCooldown")+v("tdInterval"));r("tShot",tdTowerSlot,0.16);
          setVar("tdAimX",l("eX",v("tdTarget")));setVar("tdAimY",l("eY",v("tdTarget")));
          r("tTargetX",tdTowerSlot,v("tdAimX"));r("tTargetY",tdTowerSlot,v("tdAimY"));
          if(v("tdType")===3) {
            for(let tdSplashSlot=1;tdSplashSlot<=24;tdSplashSlot++) {
              if(l("eAlive",tdSplashSlot)===1) {
                setVar("tdDX",l("eX",tdSplashSlot)-v("tdAimX"));setVar("tdDY",l("eY",tdSplashSlot)-v("tdAimY"));
                if(v("tdDX")*v("tdDX")+v("tdDY")*v("tdDY")<=2304) {
                  setVar("tdVictim",tdSplashSlot);callProc("td damage");
                }
              }
            }
          } else {setVar("tdVictim",v("tdTarget"));callProc("td damage");}
        }
      }
      if(v("tdCooldown")<0) setVar("tdCooldown",0);r("tCooldown",tdTowerSlot,v("tdCooldown"));
    }
  }
});});

defineProc("td defeat",[],()=>{warp(()=>{
  setVar("mode",4);setVar("lives",0);setVar("stars",0);setVar("waveActive",0);setVar("ready",0);setVar("spawnLeft",0);
  setVar("notice","Core lost. Try another tower layout.");
});});

defineProc("td end wave",[],()=>{warp(()=>{
  setVar("waveActive",0);setVar("ready",1);
  changeVar("gold",18+v("wave")*5+v("level")*2);changeVar("score",v("wave")*100+v("level")*50);
  setVar("notice","Wave cleared. Build, upgrade, then press SPACE.");
  if(v("wave")===v("waves")) {
    setVar("mode",3);setVar("ready",0);setVar("stars",1);
    if(v("lives")>=12) setVar("stars",2);
    if(v("lives")>=18 && v("sold")===0) setVar("stars",3);
    changeVar("score",v("lives")*100+v("level")*500);
    if(v("score")>l("bestScore",v("level"))) r("bestScore",v("level"),v("score"));
    if(v("stars")>l("bestStars",v("level"))) r("bestStars",v("level"),v("stars"));
    setVar("notice","Sector secured!");
  }
});});

defineProc("td tick",[],()=>{warp(()=>{
  if(v("dt")<0) setVar("dt",0);if(v("dt")>0.1) setVar("dt",0.1);
  if(v("mode")===2 && v("paused")===0) {
    if(v("buildRequest")!==0) callProc("td build");
    if(v("upgradeRequest")!==0) callProc("td upgrade");
    if(v("sellRequest")!==0) callProc("td sell");
    if(v("startWave")!==0) callProc("td next wave");
  }
  if(v("mode")===2 && v("paused")===0 && v("dt")>0) {
    changeVar("simFrames",1);changeVar("clock",v("dt"));
    if(v("bossAlert")>0) {changeVar("bossAlert",0-v("dt"));if(v("bossAlert")<0) setVar("bossAlert",0);}
    if(v("shake")>0) {changeVar("shake",0-v("dt"));if(v("shake")<0 || v("quality")===0 || v("shakeEnabled")!==1) setVar("shake",0);}
    if(v("alive")>0) callProc("td move enemies");
    if(v("lives")<=0) callProc("td defeat");
    if(v("mode")===2) {
      if(v("waveActive")===1 && v("spawnLeft")>0) {
        changeVar("spawnTimer",0-v("dt"));if(v("spawnTimer")<=0) callProc("td spawn");
      }
      callProc("td towers");
      if(v("waveActive")===1 && v("spawnLeft")===0 && v("alive")===0) callProc("td end wave");
    }
  }
});});

// HUD uses text stamps only; battlefield graphics are native SVG costumes.
function uiV(name: string): number { return getVar(name) as number; }
function uiN(name: string, index: number): number { return listItem(name,"any",index) as number; }
function uiText(x: number,y: number,value: NekoValue,size: number): void {
  penUp();moveTo(x,y);stampText(value,size,"left");
}

defineProc("td hud",[],()=>{warp(()=>{
  clearDrawing();pointTowards(0);callProc("td effects hud");callProc("td social hud");setPenColor("#d9eeff");
  if(uiV("mode")===2) {
    uiText(-420,250,join("STARHOLD  /  ",uiV("level"),"     WAVE ",uiV("wave"),"/",uiV("waves")),17);
    setPenColor("#ffd082");uiText(-50,250,join("G ",floor(uiV("gold"))),17);
    setPenColor("#82f0cf");uiText(100,250,join("CORE ",uiV("lives")),17);
    setPenColor("#9cb4ca");uiText(308,194,"BUILD ARRAY",13);
    uiText(308,158,"1 PULSE  55",14);uiText(308,99,"2 FROST  70",14);
    uiText(308,40,"3 NOVA  100",14);uiText(308,-19,"4 PRISM 125",14);
    setPenColor("#e9f4ff");uiText(308,-98,join("PAD ",uiV("selectedPad")),15);
    if(uiV("selectedPad")>0) {
      uiText(308,-122,join("LEVEL ",uiN("tLevel",uiV("selectedPad"))),14);
    }
    uiText(308,-161,"U  UPGRADE",13);uiText(308,-194,"X  SELL 60%",13);
    setPenColor("#91aabe");uiText(-420,-242,"CLICK PAD: BUILD / SELECT    SPACE: NEXT WAVE    P: PAUSE",13);
    uiText(-420,-260,join("TYPE ",uiV("selectedTower"),"  SCORE ",floor(uiV("score")),"  ",uiV("fps")," FPS"),11);
    if(uiV("waveActive")===0) {setPenColor("#ffd082");uiText(-125,205,"SPACE · DEPLOY WAVE",18);}
    if(false) {setPenColor("#ff6984");uiText(-185,188,"WARNING / RIFT LORD",21);}
    if(uiV("paused")===1) {setPenColor("#ffffff");uiText(-130,-22,"P / CLICK TO RESUME",15);uiText(-130,-65,"B · RETURN TO TITLE",13);}
  }
  if(uiV("mode")===0) {
    setPenColor("#bbd7e9");uiText(-148,-67,"ENTER / CLICK · PLAY",19);
    uiText(-145,-112,"H · GUIDE   O · SETTINGS",13);
    uiText(-145,-143,"L · LEADERBOARD   C · MESSAGES",11);
  }
  if(uiV("mode")===1) {
    setPenColor("#b8d6e8");uiText(-395,141,"KEYS 1–6 · SELECT SECTOR",11);
    uiText(-395,-235,"B · BACK     ALL SECTORS AVAILABLE FOR PRACTICE",12);
    forRange("uiLevel",1,6,1,()=>{
      setVar("uiLX",-328+((rangeValue("uiLevel") as number)-1)%3*240);
      setVar("uiLY",5-floor(((rangeValue("uiLevel") as number)-1)/3)*165);
      uiText(uiV("uiLX"),uiV("uiLY"),join("STARS ",uiN("bestStars",rangeValue("uiLevel") as number),"/3  BEST ",uiN("bestScore",rangeValue("uiLevel") as number)),10);
    });
  }
  if(uiV("mode")===3 || uiV("mode")===4) {
    setPenColor("#e4f3ff");uiText(-175,-25,join("SCORE ",floor(uiV("score")),"    STARS ",uiV("stars")," / 3"),17);
    uiText(-175,-58,join("CORE ",uiV("lives"),"    SECTOR ",uiV("level")),14);
    uiText(-175,-97,"R · RETRY    ENTER · SECTORS",13);
  }
  if(uiV("mode")===5) {
    setPenColor("#e4f3ff");uiText(-287,-151,"三星：胜利时核心至少18，且没有出售防御塔。",11);
    uiText(-95,-178,"B / CLICK · BACK",13);
  }
  if(uiV("mode")===6) {
    setPenColor("#e4f3ff");
    if(uiV("quality")===1){uiText(125,98,"Q  HIGH",15);}else{uiText(125,98,"Q  LOW",15);}
    if(uiV("shakeEnabled")===1){uiText(125,5,"S  ON",15);}else{uiText(125,5,"S  OFF",15);}
    uiText(-95,-174,"B / CLICK · BACK",13);
  }
  if(false) {
    setPenColor("#e4f3ff");uiText(-287,105,"OFFLINE / CLOUD NOT CONNECTED",14);
    uiText(-287,75,"Native cloud integration arrives at milestone 5.",12);
    uiText(-95,-174,"B / CLICK · BACK",13);
  }
});});

defineProc("td choose level",[],()=>{warp(()=>{
  if(uiV("level")<1) {setVar("level",1);}
  if(uiV("level")>6) {setVar("level",6);}
  changeVar("runId",1);callProc("td reset");setVar("mode",2);setVar("paused",0);
});});

defineProc("td click",[],()=>{warp(()=>{
  if(uiV("mode")===0) {
    if(uiV("clickY")>-95) {
      if(uiV("milestone")<3) {setVar("level",1);setVar("chooseRequest",1);} else {setVar("mode",1);}
    } else if(uiV("clickY")>-130) {
      if(uiV("clickX")<-30){setVar("mode",5);}else{setVar("mode",6);}
    } else if(uiV("clickY")>-170) {
      if(uiV("clickX")<0){setVar("mode",7);}else{setVar("mode",8);}
    }
  } else if(uiV("mode")===1) {
    forRange("uiCard",1,6,1,()=>{
      setVar("uiCX",-240+((rangeValue("uiCard") as number)-1)%3*240);
      setVar("uiCY",55-floor(((rangeValue("uiCard") as number)-1)/3)*165);
      if(mathFunc("abs",uiV("clickX")-uiV("uiCX"))<=106 && mathFunc("abs",uiV("clickY")-uiV("uiCY"))<=66){
        setVar("level",rangeValue("uiCard"));setVar("chooseRequest",1);
      }
    });
  } else if(uiV("mode")===2) {
    if(uiV("paused")===1) {setVar("paused",0);} else {
      if(uiV("clickX")>295) {
        if(uiV("clickY")>110) {setVar("selectedTower",1);}
        else if(uiV("clickY")>51) {setVar("selectedTower",2);}
        else if(uiV("clickY")>-8) {setVar("selectedTower",3);}
        else if(uiV("clickY")>-64) {setVar("selectedTower",4);}
        else if(uiV("clickY")>-177) {setVar("upgradeRequest",1);}
        else {setVar("sellRequest",1);}
        if(uiV("milestone")<2) {setVar("selectedTower",1);}
      } else {
        forRange("uiPad",1,12,1,()=>{
          if((uiV("clickX")-uiN("padX",rangeValue("uiPad") as number))*(uiV("clickX")-uiN("padX",rangeValue("uiPad") as number))+
            (uiV("clickY")-uiN("padY",rangeValue("uiPad") as number))*(uiV("clickY")-uiN("padY",rangeValue("uiPad") as number))<900) {
            setVar("selectedPad",rangeValue("uiPad"));
            if(uiN("tType",rangeValue("uiPad") as number)===0) {setVar("buildRequest",rangeValue("uiPad"));}
          }
        });
      }
    }
  } else if(uiV("mode")===6 && uiV("clickY")>-80){
    if(uiV("clickY")>45){setVar("quality",1-uiV("quality"));}else{setVar("shakeEnabled",1-uiV("shakeEnabled"));}
  } else if(uiV("mode")===3 || uiV("mode")===4) {setVar("mode",1);}
  else {setVar("mode",0);}
});});

// M5 LOCAL session records only. Bundle once; no startup/key handlers here.
// Parent: init after its timer; increment runId on EVERY td reset (first = 1).
// Call tick every controller frame, after combat, including menus/settlement.
// Call hud instead of the old mode-7/8 placeholder, after the parent's clear.
// mode 7: parent keys 1..6 set level. mode 8: keys set messageChoice=1..6
// (one-shot send), or chatPreset=1..6 plus chatSend=1. No free-text send path.
// now is the unpaused timer in seconds, not dt/clock/frames. Do not reset init
// per run: its idempotence preserves scores, messages and the 30s cooldown.
// All tdSocial* scratch belongs to this single controller. No parallel callers.

function socialV(name: string): number { return getVar(name) as number; }
function socialS(name: string): string { return getVar(name) as string; }
function socialN(name: string,index: number): number { return listItem(name,"any",index) as number; }
function socialText(x: number,y: number,text: NekoValue,size: number): void {
  penUp();moveTo(x,y);stampText(text,size,"left");
}

defineProc("td social init",[],()=>{warp(()=>{
  setVar("cloudEnabled",0);setVar("cloudStatus","云端未配置 / 本地会话");
  if(socialV("tdSocialReady")!==1) {
    // randInt is supported by NekoC (native random_num), absent from its d.ts.
    // @ts-expect-error Native compiler builtin.
    setVar("socialId",randInt(100000,999999));
    // @ts-expect-error Native compiler builtin.
    setVar("socialSession",randInt(100000000,999999999));
    setVar("tdSocialRun",0);setVar("tdSocialRunActive",0);setVar("tdSocialRunLevel",0);
    setVar("socialRecordedRun",0);setVar("socialRecordCount",0);
    setVar("tdSocialLastNow",-1);setVar("tdSocialCooldownRemaining",0);
    setVar("socialCooldown",0);setVar("chatSequence",0);setVar("socialRejected",0);
    setVar("socialNotice","仅保留本地会话；留言不会发送");
    setVar("messageChoice",0);setVar("chatSend",0);setVar("chatPreset",1);setVar("chatInbound",0);
    setVar("inboundText","");setVar("inboundSender",0);setVar("inboundSession",0);setVar("inboundSequence",0);
    deleteListItem("scoreBank","all",0);deleteListItem("scoreNameBank","all",0);
    for(let socialInitSlot=1;socialInitSlot<=60;socialInitSlot++) {
      appendList("scoreBank",-1);appendList("scoreNameBank",0);
    }
    deleteListItem("chatTextBank","all",0);deleteListItem("chatSenderBank","all",0);
    deleteListItem("chatSequenceBank","all",0);
    setVar("tdSocialReady",1);callProc("td social clock");
  }
});});

// Timer rollback earns no credit; init/repeated frames cannot clear cooldown.
defineProc("td social clock",[],()=>{warp(()=>{
  setVar("tdSocialClockValid",0);
  if(socialV("now")>=0 && socialV("now")<=1000000000) {
    setVar("tdSocialClockValid",1);
    if(socialV("tdSocialLastNow")>=0 && socialV("now")>=socialV("tdSocialLastNow")) {
      changeVar("tdSocialCooldownRemaining",0-(socialV("now")-socialV("tdSocialLastNow")));
      if(socialV("tdSocialCooldownRemaining")<0) setVar("tdSocialCooldownRemaining",0);
    }
    setVar("tdSocialLastNow",socialV("now"));
  }
  setVar("socialCooldown",ceil(socialV("tdSocialCooldownRemaining")));
});});

// Exact six-phrase whitelist, used for sends, ingress and every displayed row.
// Never truncate before validation: a valid prefix plus an external link fails.
defineProc("td social validate text",[],()=>{warp(()=>{
  setVar("tdSocialTextOk",0);
  if(socialS("tdSocialText")==="加油" || socialS("tdSocialText")==="冰塔很有用" ||
       socialS("tdSocialText")==="守住核心" || socialS("tdSocialText")==="这关有点难" ||
       socialS("tdSocialText")==="祝你好运" || socialS("tdSocialText")==="谢谢帮助") {
    if((length(getVar("tdSocialText")) as number)>=1 && (length(getVar("tdSocialText")) as number)<=16) setVar("tdSocialTextOk",1);
  }
});});

// Local mailbox, not a network receiver or authentication boundary. A foreign
// session/sender, duplicate/out-of-order sequence or non-preset text is dropped.
// The same cooldown applies here, so direct mailbox calls cannot bypass it.
defineProc("td social receive",[],()=>{warp(()=>{
  callProc("td social clock");setVar("chatInbound",0);setVar("tdSocialAccepted",0);
  setVar("tdSocialText",getVar("inboundText"));callProc("td social validate text");
  if(socialV("tdSocialReady")===1 && socialV("mode")===8 && socialV("tdSocialClockValid")===1 &&
     socialV("tdSocialCooldownRemaining")===0 && socialV("tdSocialTextOk")===1 &&
     socialV("socialId")>=100000 && socialV("socialId")<=999999 && socialV("socialId")===floor(socialV("socialId")) &&
     socialV("inboundSession")===socialV("socialSession") && socialV("inboundSender")===socialV("socialId") &&
     socialV("inboundSequence")===socialV("chatSequence")+1 && socialV("inboundSequence")<=999999 &&
     socialV("inboundSequence")>=1 && socialV("inboundSequence")===floor(socialV("inboundSequence"))) {
    if((listLength("chatTextBank") as number)===(listLength("chatSenderBank") as number) &&
       (listLength("chatTextBank") as number)===(listLength("chatSequenceBank") as number) &&
       (listLength("chatTextBank") as number)<=12) {
      if((listLength("chatTextBank") as number)===12) {
        deleteListItem("chatTextBank","any",1);deleteListItem("chatSenderBank","any",1);deleteListItem("chatSequenceBank","any",1);
      }
      appendList("chatTextBank",getVar("tdSocialText"));appendList("chatSenderBank",socialV("socialId"));
      appendList("chatSequenceBank",socialV("inboundSequence"));setVar("chatSequence",socialV("inboundSequence"));
      setVar("tdSocialCooldownRemaining",30);setVar("socialCooldown",30);setVar("tdSocialAccepted",1);
      setVar("socialNotice","已加入本地留言（未发送）");
    }
  }
  if(socialV("tdSocialAccepted")===0) {
    changeVar("socialRejected",1);setVar("socialNotice","留言未加入：仅限本会话预设短语，间隔30秒");
  }
  setVar("inboundText","");setVar("inboundSender",0);setVar("inboundSession",0);setVar("inboundSequence",0);
  setVar("tdSocialText","");
});});

// Private insertion: tick supplies the latched successful-run level and score.
// Flat indices (level-1)*10+rank, -1 score / 0 name means empty. Same pseudonym
// replaces its personal best; sort score descending then numeric pseudonym asc.
defineProc("td social record",[],()=>{warp(()=>{
  setVar("tdSocialBase",(socialV("tdSocialRunLevel")-1)*10);
  setVar("tdSocialExisting",0);setVar("tdSocialImprove",1);
  for(let socialFind=1;socialFind<=10;socialFind++) {
    if(socialN("scoreNameBank",socialV("tdSocialBase")+socialFind)===socialV("socialId")) {
      setVar("tdSocialExisting",socialFind);
      if(socialV("score")<=socialN("scoreBank",socialV("tdSocialBase")+socialFind)) setVar("tdSocialImprove",0);
    }
  }
  if(socialV("tdSocialImprove")===1) {
    if(socialV("tdSocialExisting")>0) {
      for(let socialRemove=1;socialRemove<=9;socialRemove++) {
        if(socialRemove>=socialV("tdSocialExisting")) {
          replaceListItem("scoreBank","any",socialV("tdSocialBase")+socialRemove,socialN("scoreBank",socialV("tdSocialBase")+socialRemove+1));
          replaceListItem("scoreNameBank","any",socialV("tdSocialBase")+socialRemove,socialN("scoreNameBank",socialV("tdSocialBase")+socialRemove+1));
        }
      }
      replaceListItem("scoreBank","any",socialV("tdSocialBase")+10,-1);replaceListItem("scoreNameBank","any",socialV("tdSocialBase")+10,0);
    }
    setVar("tdSocialInsert",0);
    for(let socialFindRank=1;socialFindRank<=10;socialFindRank++) {
      if(socialV("tdSocialInsert")===0) {
        if(socialV("score")>socialN("scoreBank",socialV("tdSocialBase")+socialFindRank) ||
          (socialV("score")===socialN("scoreBank",socialV("tdSocialBase")+socialFindRank) &&
           socialV("socialId")<socialN("scoreNameBank",socialV("tdSocialBase")+socialFindRank))) setVar("tdSocialInsert",socialFindRank);
      }
    }
    if(socialV("tdSocialInsert")>0) {
      for(let socialShift=1;socialShift<=9;socialShift++) {
        if(11-socialShift>socialV("tdSocialInsert")) {
          replaceListItem("scoreBank","any",socialV("tdSocialBase")+11-socialShift,socialN("scoreBank",socialV("tdSocialBase")+10-socialShift));
          replaceListItem("scoreNameBank","any",socialV("tdSocialBase")+11-socialShift,socialN("scoreNameBank",socialV("tdSocialBase")+10-socialShift));
        }
      }
      replaceListItem("scoreBank","any",socialV("tdSocialBase")+socialV("tdSocialInsert"),socialV("score"));
      replaceListItem("scoreNameBank","any",socialV("tdSocialBase")+socialV("tdSocialInsert"),socialV("socialId"));
    }
  }
});});

defineProc("td social tick",[],()=>{warp(()=>{
  callProc("td social init");callProc("td social clock");
  // runId is parent-owned, strictly increasing within this initialized session.
  if(socialV("mode")===2 && socialV("runId")>socialV("tdSocialRun") &&
     socialV("runId")<=999999999 && socialV("runId")===floor(socialV("runId"))) {
    setVar("tdSocialRun",socialV("runId"));setVar("tdSocialRunLevel",socialV("level"));setVar("tdSocialRunActive",1);
  }
  if((socialV("mode")===3 || socialV("mode")===4) && socialV("tdSocialRunActive")===1 && socialV("runId")===socialV("tdSocialRun")) {
    setVar("tdSocialRunActive",0); // Consume once, including invalid/defeated runs.
    if(socialV("mode")===3 && socialV("level")===socialV("tdSocialRunLevel") &&
       socialV("level")>=1 && socialV("level")<=6 && socialV("level")===floor(socialV("level")) &&
       socialV("score")>=0 && socialV("score")<=999999 && socialV("score")===floor(socialV("score")) &&
       socialV("socialId")>=100000 && socialV("socialId")<=999999 && socialV("socialId")===floor(socialV("socialId")) &&
       (listLength("scoreBank") as number)===60 && (listLength("scoreNameBank") as number)===60) {
      callProc("td social record");setVar("socialRecordedRun",socialV("tdSocialRun"));changeVar("socialRecordCount",1);
    }
  }
  if(socialV("chatInbound")!==0) callProc("td social receive");
  setVar("tdSocialChoice",socialV("messageChoice"));setVar("tdSocialSend",socialV("chatSend"));
  setVar("messageChoice",0);setVar("chatSend",0); // Requests never wait in menus/cooldown.
  if(socialV("tdSocialChoice")!==0 || socialV("tdSocialSend")!==0) {
    if(socialV("tdSocialChoice")===0) setVar("tdSocialChoice",socialV("chatPreset"));
    setVar("inboundText","");
    if(socialV("tdSocialChoice")===1) setVar("inboundText","加油");
    if(socialV("tdSocialChoice")===2) setVar("inboundText","冰塔很有用");
    if(socialV("tdSocialChoice")===3) setVar("inboundText","守住核心");
    if(socialV("tdSocialChoice")===4) setVar("inboundText","这关有点难");
    if(socialV("tdSocialChoice")===5) setVar("inboundText","祝你好运");
    if(socialV("tdSocialChoice")===6) setVar("inboundText","谢谢帮助");
    setVar("inboundSender",socialV("socialId"));setVar("inboundSession",socialV("socialSession"));
    setVar("inboundSequence",socialV("chatSequence")+1);callProc("td social receive");
  }
});});

// Stamps only. Does not clear the parent's canvas or draw lines/rectangles.
defineProc("td social hud",[],()=>{warp(()=>{
  if(socialV("mode")===7 || socialV("mode")===8) {
    setVar("cloudStatus","云端未配置 / 本地会话");setPenColor("#9cb4ca");
    socialText(-287,105,getVar("cloudStatus"),13);
    socialText(-287,-177,"B · 返回   /   关闭作品后不保留",12);
    setPenColor("#e4f3ff");
    if(socialV("mode")===7) {
      setVar("tdSocialViewLevel",1);
      if(socialV("level")>=1 && socialV("level")<=6 && socialV("level")===floor(socialV("level"))) setVar("tdSocialViewLevel",socialV("level"));
      socialText(110,105,join("关卡 ",socialV("tdSocialViewLevel")),15);
      socialText(80,52,"1—6 切换关卡",12);
      socialText(80,22,"同一标识仅保留最高分",12);
      for(let socialRow=1;socialRow<=10;socialRow++) {
        setVar("tdSocialRowText",join(socialRow,".   —"));
        setVar("tdSocialIndex",(socialV("tdSocialViewLevel")-1)*10+socialRow);
        if((listLength("scoreBank") as number)===60 && (listLength("scoreNameBank") as number)===60) {
          setVar("tdSocialRowScore",socialN("scoreBank",socialV("tdSocialIndex")));setVar("tdSocialRowName",socialN("scoreNameBank",socialV("tdSocialIndex")));
          if(socialV("tdSocialRowScore")>=0 && socialV("tdSocialRowScore")<=999999 && socialV("tdSocialRowScore")===floor(socialV("tdSocialRowScore")) &&
             socialV("tdSocialRowName")>=100000 && socialV("tdSocialRowName")<=999999 && socialV("tdSocialRowName")===floor(socialV("tdSocialRowName"))) {
            setVar("tdSocialRowText",join(socialRow,".   P",socialV("tdSocialRowName"),"     ",socialV("tdSocialRowScore")));
          }
        }
        socialText(-287,94-socialRow*22,getVar("tdSocialRowText"),14);
      }
      setPenColor("#ffd082");socialText(-287,-151,"本地会话最佳成绩；未连接在线排行榜",12);
    } else {
      socialText(105,105,"预设留言（不发送）",12);
      setPenColor("#82f0cf");
      socialText(115,68,"1  加油",14);socialText(115,40,"2  冰塔很有用",14);socialText(115,12,"3  守住核心",14);
      socialText(115,-16,"4  这关有点难",14);socialText(115,-44,"5  祝你好运",14);socialText(115,-72,"6  谢谢帮助",14);
      setPenColor("#ffd082");socialText(115,-112,join("冷却 ",socialV("socialCooldown")," 秒"),13);
      socialText(115,-137,"按1—6加入短语",12);
      setPenColor("#e4f3ff");
      for(let socialMessageRow=1;socialMessageRow<=12;socialMessageRow++) {
        setVar("tdSocialRowText",join(socialMessageRow,".   —"));
        if((listLength("chatTextBank") as number)===(listLength("chatSenderBank") as number) &&
           (listLength("chatTextBank") as number)===(listLength("chatSequenceBank") as number) &&
           (listLength("chatTextBank") as number)<=12 && socialMessageRow<=(listLength("chatTextBank") as number)) {
          setVar("tdSocialText",listItem("chatTextBank","any",socialMessageRow));callProc("td social validate text");
          if(socialV("tdSocialTextOk")===1 && socialN("chatSenderBank",socialMessageRow)===socialV("socialId") &&
             socialN("chatSequenceBank",socialMessageRow)>=1 && socialN("chatSequenceBank",socialMessageRow)<=socialV("chatSequence") &&
             socialN("chatSequenceBank",socialMessageRow)===floor(socialN("chatSequenceBank",socialMessageRow))) {
            setVar("tdSocialRowText",join(socialMessageRow,". P",socialV("socialId"),"  ",getVar("tdSocialText")));
          }
        }
        socialText(-287,92-socialMessageRow*19,getVar("tdSocialRowText"),12);
      }
      setVar("tdSocialText","");setPenColor("#9cb4ca");socialText(-287,-155,getVar("socialNotice"),10);
    }
  }
});});


sprite("Controller",{visible:false},()=>{
 onStart(()=>{
  hide();setPenLayer("peak","");setVar("milestone",5);setVar("ready",0);setVar("frames",0);
  setVar("mode",0);setVar("level",1);setVar("paused",0);setVar("quality",1);
  setVar("shakeEnabled",1);setVar("shake",0);setVar("selectedTower",1);setVar("selectedPad",0);
  setVar("chooseRequest",0);setVar("clickRequest",0);setVar("fps",0);
  timerReset();timerStart();setVar("lastTime",0);setVar("fpsTime",0);setVar("fpsFrame",0);
  setVar("hudTime",-1);setVar("ready",1);
  setVar("now",0);setVar("runId",0);setVar("socialTime",-1);callProc("td social init");
  callProc("td effects init");
  forever(()=>{warp(()=>{
    setVar("now",timerValue());setVar("dt",getVar("now") as number-getVar("lastTime") as number);
    setVar("lastTime",getVar("now"));
    if((getVar("dt") as number)>0.1){setVar("dt",0.1);}
    if((getVar("dt") as number)<0){setVar("dt",0);}
    if((getVar("chooseRequest") as number)===1){setVar("chooseRequest",0);callProc("td choose level");}
    if((getVar("clickRequest") as number)===1){setVar("clickRequest",0);callProc("td click");}
    if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){callProc("td tick");}
    callProc("td effects tick");
    if(v("now")-v("socialTime")>=0.2){callProc("td social tick");setVar("socialTime",v("now"));}
    if((getVar("now") as number)-(getVar("hudTime") as number)>=0.2){callProc("td hud");setVar("hudTime",getVar("now"));}
    changeVar("frames",1);
    if((getVar("now") as number)-(getVar("fpsTime") as number)>=1){
      setVar("fps",floor(((getVar("frames") as number)-(getVar("fpsFrame") as number))/((getVar("now") as number)-(getVar("fpsTime") as number))));
      setVar("fpsTime",getVar("now"));setVar("fpsFrame",getVar("frames"));
    }
  });});
 });
 onKey("Enter","up",()=>{
   if((getVar("mode") as number)===0 || (getVar("mode") as number)===3 || (getVar("mode") as number)===4){
     if((getVar("milestone") as number)<3){setVar("level",1);setVar("chooseRequest",1);}else{setVar("mode",1);}
   }
 });
 onKey("Space","up",()=>{setVar("startWave",1);});
 onKey("p","up",()=>{if((getVar("mode") as number)===2){setVar("paused",1-(getVar("paused") as number));}});
  onKey("Escape","up",()=>{setVar("mode",0);setVar("paused",0);});
  onKey("b","up",()=>{setVar("mode",0);setVar("paused",0);});
 onKey("u","up",()=>{setVar("upgradeRequest",1);});
 onKey("x","up",()=>{setVar("sellRequest",1);});
 onKey("r","up",()=>{if((getVar("mode") as number)===3 || (getVar("mode") as number)===4){setVar("chooseRequest",1);}});
 onKey("h","up",()=>{setVar("mode",5);});onKey("o","up",()=>{setVar("mode",6);});
 onKey("l","up",()=>{setVar("mode",7);});onKey("c","up",()=>{setVar("mode",8);});
 onKey("q","up",()=>{setVar("quality",1-(getVar("quality") as number));});
 onKey("s","up",()=>{if((getVar("mode") as number)===6){setVar("shakeEnabled",1-(getVar("shakeEnabled") as number));}});
onKey("49","up",()=>{if((getVar("mode") as number)===1){setVar("level",1);setVar("chooseRequest",1);}
          else if((getVar("mode") as number)===2 && 1<=4 && ((getVar("milestone") as number)>=2 || 1===1)){setVar("selectedTower",1);}
          else if(v("mode")===7){setVar("level",1);}else if(v("mode")===8){setVar("messageChoice",1);}
        });
onKey("50","up",()=>{if((getVar("mode") as number)===1){setVar("level",2);setVar("chooseRequest",1);}
          else if((getVar("mode") as number)===2 && 2<=4 && ((getVar("milestone") as number)>=2 || 2===1)){setVar("selectedTower",2);}
          else if(v("mode")===7){setVar("level",2);}else if(v("mode")===8){setVar("messageChoice",2);}
        });
onKey("51","up",()=>{if((getVar("mode") as number)===1){setVar("level",3);setVar("chooseRequest",1);}
          else if((getVar("mode") as number)===2 && 3<=4 && ((getVar("milestone") as number)>=2 || 3===1)){setVar("selectedTower",3);}
          else if(v("mode")===7){setVar("level",3);}else if(v("mode")===8){setVar("messageChoice",3);}
        });
onKey("52","up",()=>{if((getVar("mode") as number)===1){setVar("level",4);setVar("chooseRequest",1);}
          else if((getVar("mode") as number)===2 && 4<=4 && ((getVar("milestone") as number)>=2 || 4===1)){setVar("selectedTower",4);}
          else if(v("mode")===7){setVar("level",4);}else if(v("mode")===8){setVar("messageChoice",4);}
        });
onKey("53","up",()=>{if((getVar("mode") as number)===1){setVar("level",5);setVar("chooseRequest",1);}
          else if((getVar("mode") as number)===2 && 5<=4 && ((getVar("milestone") as number)>=2 || 5===1)){setVar("selectedTower",5);}
          else if(v("mode")===7){setVar("level",5);}else if(v("mode")===8){setVar("messageChoice",5);}
        });
onKey("54","up",()=>{if((getVar("mode") as number)===1){setVar("level",6);setVar("chooseRequest",1);}
          else if((getVar("mode") as number)===2 && 6<=4 && ((getVar("milestone") as number)>=2 || 6===1)){setVar("selectedTower",6);}
          else if(v("mode")===7){setVar("level",6);}else if(v("mode")===8){setVar("messageChoice",6);}
        });
});
sprite("Backdrop",{visible:true},()=>{
      onClick(()=>{setVar("clickX",mouseX());setVar("clickY",mouseY());setVar("clickRequest",1);});
      onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",0);show();moveTo(0,0);forever(()=>{moveTo(v("fxX"),v("fxY"));
        if((scriptVar("lastStyle") as number)!==(getVar("level") as number)) {setStyle(listItem("mapStyles","any",getVar("level")));setVar("lastStyle",getVar("level"));}
      });});
    });
    sprite("Menu",{visible:true},()=>{
      onClick(()=>{setVar("clickX",mouseX());setVar("clickY",mouseY());setVar("clickRequest",1);});
      onStart(()=>{scriptVars("renderStyle");setVar("renderStyle","");forever(()=>{warp(()=>{
        if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){hide();}
        else {show();moveTo(0,0);setStyle(listItem("menuStyles","any",(getVar("mode") as number)+1));}
      });});});
    });

sprite("Tower 01",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",1);if((listItem("tType","any",1) as number)===0){setVar("buildRequest",1);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(-330+v("fxX"),165+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",1) as number)>0){setVar("styleIndex",((listItem("tType","any",1) as number)-1)*3+(listItem("tLevel","any",1) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 02",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",2);if((listItem("tType","any",2) as number)===0){setVar("buildRequest",2);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(-320+v("fxX"),25+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",2) as number)>0){setVar("styleIndex",((listItem("tType","any",2) as number)-1)*3+(listItem("tLevel","any",2) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 03",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",3);if((listItem("tType","any",3) as number)===0){setVar("buildRequest",3);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(-310+v("fxX"),-175+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",3) as number)>0){setVar("styleIndex",((listItem("tType","any",3) as number)-1)*3+(listItem("tLevel","any",3) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 04",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",4);if((listItem("tType","any",4) as number)===0){setVar("buildRequest",4);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(-160+v("fxX"),-35+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",4) as number)>0){setVar("styleIndex",((listItem("tType","any",4) as number)-1)*3+(listItem("tLevel","any",4) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 05",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",5);if((listItem("tType","any",5) as number)===0){setVar("buildRequest",5);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(-160+v("fxX"),175+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",5) as number)>0){setVar("styleIndex",((listItem("tType","any",5) as number)-1)*3+(listItem("tLevel","any",5) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 06",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",6);if((listItem("tType","any",6) as number)===0){setVar("buildRequest",6);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(15+v("fxX"),55+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",6) as number)>0){setVar("styleIndex",((listItem("tType","any",6) as number)-1)*3+(listItem("tLevel","any",6) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 07",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",7);if((listItem("tType","any",7) as number)===0){setVar("buildRequest",7);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(15+v("fxX"),-175+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",7) as number)>0){setVar("styleIndex",((listItem("tType","any",7) as number)-1)*3+(listItem("tLevel","any",7) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 08",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",8);if((listItem("tType","any",8) as number)===0){setVar("buildRequest",8);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(180+v("fxX"),55+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",8) as number)>0){setVar("styleIndex",((listItem("tType","any",8) as number)-1)*3+(listItem("tLevel","any",8) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 09",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",9);if((listItem("tType","any",9) as number)===0){setVar("buildRequest",9);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(180+v("fxX"),-175+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",9) as number)>0){setVar("styleIndex",((listItem("tType","any",9) as number)-1)*3+(listItem("tLevel","any",9) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 10",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",10);if((listItem("tType","any",10) as number)===0){setVar("buildRequest",10);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(245+v("fxX"),165+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",10) as number)>0){setVar("styleIndex",((listItem("tType","any",10) as number)-1)*3+(listItem("tLevel","any",10) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 11",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",11);if((listItem("tType","any",11) as number)===0){setVar("buildRequest",11);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(-405+v("fxX"),-50+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",11) as number)>0){setVar("styleIndex",((listItem("tType","any",11) as number)-1)*3+(listItem("tLevel","any",11) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Tower 12",{visible:false},()=>{
 onClick(()=>{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){setVar("selectedPad",12);if((listItem("tType","any",12) as number)===0){setVar("buildRequest",12);}}});
 onStart(()=>{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2){
   show();moveTo(250+v("fxX"),-25+v("fxY"));setVar("styleIndex",0);
   if((listItem("tType","any",12) as number)>0){setVar("styleIndex",((listItem("tType","any",12) as number)-1)*3+(listItem("tLevel","any",12) as number));}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }
  }else{hide();}
 });wait(0.06);});});
});

sprite("Enemy 01",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",1) as number)===1){
   show();moveTo((listItem("eX","any",1) as number)+v("fxX"),(listItem("eY","any",1) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",1) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",1) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",1) as number)));setVar("lastStyle",(listItem("eType","any",1) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 02",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",2) as number)===1){
   show();moveTo((listItem("eX","any",2) as number)+v("fxX"),(listItem("eY","any",2) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",2) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",2) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",2) as number)));setVar("lastStyle",(listItem("eType","any",2) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 03",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",3) as number)===1){
   show();moveTo((listItem("eX","any",3) as number)+v("fxX"),(listItem("eY","any",3) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",3) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",3) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",3) as number)));setVar("lastStyle",(listItem("eType","any",3) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 04",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",4) as number)===1){
   show();moveTo((listItem("eX","any",4) as number)+v("fxX"),(listItem("eY","any",4) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",4) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",4) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",4) as number)));setVar("lastStyle",(listItem("eType","any",4) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 05",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",5) as number)===1){
   show();moveTo((listItem("eX","any",5) as number)+v("fxX"),(listItem("eY","any",5) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",5) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",5) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",5) as number)));setVar("lastStyle",(listItem("eType","any",5) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 06",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",6) as number)===1){
   show();moveTo((listItem("eX","any",6) as number)+v("fxX"),(listItem("eY","any",6) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",6) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",6) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",6) as number)));setVar("lastStyle",(listItem("eType","any",6) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 07",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",7) as number)===1){
   show();moveTo((listItem("eX","any",7) as number)+v("fxX"),(listItem("eY","any",7) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",7) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",7) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",7) as number)));setVar("lastStyle",(listItem("eType","any",7) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 08",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",8) as number)===1){
   show();moveTo((listItem("eX","any",8) as number)+v("fxX"),(listItem("eY","any",8) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",8) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",8) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",8) as number)));setVar("lastStyle",(listItem("eType","any",8) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 09",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",9) as number)===1){
   show();moveTo((listItem("eX","any",9) as number)+v("fxX"),(listItem("eY","any",9) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",9) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",9) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",9) as number)));setVar("lastStyle",(listItem("eType","any",9) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 10",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",10) as number)===1){
   show();moveTo((listItem("eX","any",10) as number)+v("fxX"),(listItem("eY","any",10) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",10) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",10) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",10) as number)));setVar("lastStyle",(listItem("eType","any",10) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 11",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",11) as number)===1){
   show();moveTo((listItem("eX","any",11) as number)+v("fxX"),(listItem("eY","any",11) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",11) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",11) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",11) as number)));setVar("lastStyle",(listItem("eType","any",11) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 12",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",12) as number)===1){
   show();moveTo((listItem("eX","any",12) as number)+v("fxX"),(listItem("eY","any",12) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",12) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",12) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",12) as number)));setVar("lastStyle",(listItem("eType","any",12) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 13",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",13) as number)===1){
   show();moveTo((listItem("eX","any",13) as number)+v("fxX"),(listItem("eY","any",13) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",13) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",13) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",13) as number)));setVar("lastStyle",(listItem("eType","any",13) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 14",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",14) as number)===1){
   show();moveTo((listItem("eX","any",14) as number)+v("fxX"),(listItem("eY","any",14) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",14) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",14) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",14) as number)));setVar("lastStyle",(listItem("eType","any",14) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 15",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",15) as number)===1){
   show();moveTo((listItem("eX","any",15) as number)+v("fxX"),(listItem("eY","any",15) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",15) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",15) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",15) as number)));setVar("lastStyle",(listItem("eType","any",15) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 16",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",16) as number)===1){
   show();moveTo((listItem("eX","any",16) as number)+v("fxX"),(listItem("eY","any",16) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",16) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",16) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",16) as number)));setVar("lastStyle",(listItem("eType","any",16) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 17",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",17) as number)===1){
   show();moveTo((listItem("eX","any",17) as number)+v("fxX"),(listItem("eY","any",17) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",17) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",17) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",17) as number)));setVar("lastStyle",(listItem("eType","any",17) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 18",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",18) as number)===1){
   show();moveTo((listItem("eX","any",18) as number)+v("fxX"),(listItem("eY","any",18) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",18) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",18) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",18) as number)));setVar("lastStyle",(listItem("eType","any",18) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 19",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",19) as number)===1){
   show();moveTo((listItem("eX","any",19) as number)+v("fxX"),(listItem("eY","any",19) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",19) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",19) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",19) as number)));setVar("lastStyle",(listItem("eType","any",19) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 20",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",20) as number)===1){
   show();moveTo((listItem("eX","any",20) as number)+v("fxX"),(listItem("eY","any",20) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",20) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",20) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",20) as number)));setVar("lastStyle",(listItem("eType","any",20) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 21",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",21) as number)===1){
   show();moveTo((listItem("eX","any",21) as number)+v("fxX"),(listItem("eY","any",21) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",21) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",21) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",21) as number)));setVar("lastStyle",(listItem("eType","any",21) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 22",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",22) as number)===1){
   show();moveTo((listItem("eX","any",22) as number)+v("fxX"),(listItem("eY","any",22) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",22) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",22) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",22) as number)));setVar("lastStyle",(listItem("eType","any",22) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 23",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",23) as number)===1){
   show();moveTo((listItem("eX","any",23) as number)+v("fxX"),(listItem("eY","any",23) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",23) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",23) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",23) as number)));setVar("lastStyle",(listItem("eType","any",23) as number));}
  }else{hide();}
 });wait(0.025);});});
});

sprite("Enemy 24",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("eAlive","any",24) as number)===1){
   show();moveTo((listItem("eX","any",24) as number)+v("fxX"),(listItem("eY","any",24) as number)+v("fxY"));setScale(100+(listItem("eFlash","any",24) as number)*65);
   if((scriptVar("lastStyle") as number)!==(listItem("eType","any",24) as number)){setStyle(listItem("enemyStyles","any",(listItem("eType","any",24) as number)));setVar("lastStyle",(listItem("eType","any",24) as number));}
  }else{hide();}
 });wait(0.025);});});
});
sprite("Selection",{visible:false},()=>{
 onStart(()=>{forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (getVar("selectedPad") as number)>0){show();moveTo(listItem("padX","any",getVar("selectedPad")),listItem("padY","any",getVar("selectedPad")));}
  else{hide();}
 });});});
});

defineProc("td effects init",[],()=>{warp(()=>{
 setVar("fxX",0);setVar("fxY",0);setVar("fxLowTime",0);setVar("fxAutoLow",0);setVar("fxCursor",0);
 deleteListItem("fxLife","all",0);deleteListItem("fxDamage","all",0);deleteListItem("fxDX","all",0);deleteListItem("fxDY","all",0);
 for(let fxInit=1;fxInit<=6;fxInit++){appendList("fxLife",0);appendList("fxDamage",0);appendList("fxDX",0);appendList("fxDY",0);}
});});
defineProc("td effects hit",[],()=>{warp(()=>{
 if(v("quality")===1){
  setVar("fxCursor",v("fxCursor")%6+1);r("fxLife",v("fxCursor"),0.55);r("fxDamage",v("fxCursor"),ceil(v("tdHitDamage")));
  r("fxDX",v("fxCursor"),l("eX",v("tdVictim")));r("fxDY",v("fxCursor"),l("eY",v("tdVictim")));
 }
});});
defineProc("td effects tick",[],()=>{warp(()=>{
 setVar("fxX",0);setVar("fxY",0);
 if(v("mode")===2 && v("paused")===0){
  if(v("quality")===1 && v("shakeEnabled")===1 && v("shake")>0){setVar("fxX",mathFunc("sin",v("now")*1700)*3);setVar("fxY",mathFunc("cos",v("now")*1300)*2);}
  for(let fxTick=1;fxTick<=6;fxTick++){if(l("fxLife",fxTick)>0)r("fxLife",fxTick,l("fxLife",fxTick)-v("dt"));}
  if(v("fps")>0 && v("fps")<30 && v("quality")===1){changeVar("fxLowTime",v("dt"));}else{setVar("fxLowTime",0);}
  if(v("fxLowTime")>=3){setVar("quality",0);setVar("fxAutoLow",1);setVar("fxLowTime",0);}
 }
});});
defineProc("td effects hud",[],()=>{warp(()=>{
 if(v("mode")===2 && v("quality")===1){
  setPenColor("#ffe2a8");
  for(let fxText=1;fxText<=6;fxText++){if(l("fxLife",fxText)>0){penUp();moveTo(l("fxDX",fxText),l("fxDY",fxText)+22+(0.55-l("fxLife",fxText))*22);stampText(join("-",l("fxDamage",fxText)),12,"center");}}
 }
});});

sprite("Projectile 01",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",1) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+-330+((listItem("tTargetX","any",1) as number)-(-330))*(1-(listItem("tShot","any",1) as number)/0.16),
      v("fxY")+165+((listItem("tTargetY","any",1) as number)-(165))*(1-(listItem("tShot","any",1) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",1) as number)<165){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",1) as number)!=-330){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",1) as number)-(165))/((listItem("tTargetX","any",1) as number)-(-330))));}
   if((listItem("tTargetX","any",1) as number)<-330){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",1) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",1) as number)));setVar("lastStyle",(listItem("tType","any",1) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 01",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",1) as number)){
   if((listItem("tLevel","any",1) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",1) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(-330+v("fxX"),165+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",1) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",1) as number)+v("fxX"),(listItem("tTargetY","any",1) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",1) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",1) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 02",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",2) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+-320+((listItem("tTargetX","any",2) as number)-(-320))*(1-(listItem("tShot","any",2) as number)/0.16),
      v("fxY")+25+((listItem("tTargetY","any",2) as number)-(25))*(1-(listItem("tShot","any",2) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",2) as number)<25){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",2) as number)!=-320){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",2) as number)-(25))/((listItem("tTargetX","any",2) as number)-(-320))));}
   if((listItem("tTargetX","any",2) as number)<-320){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",2) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",2) as number)));setVar("lastStyle",(listItem("tType","any",2) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 02",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",2) as number)){
   if((listItem("tLevel","any",2) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",2) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(-320+v("fxX"),25+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",2) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",2) as number)+v("fxX"),(listItem("tTargetY","any",2) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",2) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",2) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 03",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",3) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+-310+((listItem("tTargetX","any",3) as number)-(-310))*(1-(listItem("tShot","any",3) as number)/0.16),
      v("fxY")+-175+((listItem("tTargetY","any",3) as number)-(-175))*(1-(listItem("tShot","any",3) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",3) as number)<-175){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",3) as number)!=-310){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",3) as number)-(-175))/((listItem("tTargetX","any",3) as number)-(-310))));}
   if((listItem("tTargetX","any",3) as number)<-310){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",3) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",3) as number)));setVar("lastStyle",(listItem("tType","any",3) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 03",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",3) as number)){
   if((listItem("tLevel","any",3) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",3) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(-310+v("fxX"),-175+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",3) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",3) as number)+v("fxX"),(listItem("tTargetY","any",3) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",3) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",3) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 04",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",4) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+-160+((listItem("tTargetX","any",4) as number)-(-160))*(1-(listItem("tShot","any",4) as number)/0.16),
      v("fxY")+-35+((listItem("tTargetY","any",4) as number)-(-35))*(1-(listItem("tShot","any",4) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",4) as number)<-35){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",4) as number)!=-160){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",4) as number)-(-35))/((listItem("tTargetX","any",4) as number)-(-160))));}
   if((listItem("tTargetX","any",4) as number)<-160){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",4) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",4) as number)));setVar("lastStyle",(listItem("tType","any",4) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 04",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",4) as number)){
   if((listItem("tLevel","any",4) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",4) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(-160+v("fxX"),-35+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",4) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",4) as number)+v("fxX"),(listItem("tTargetY","any",4) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",4) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",4) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 05",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",5) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+-160+((listItem("tTargetX","any",5) as number)-(-160))*(1-(listItem("tShot","any",5) as number)/0.16),
      v("fxY")+175+((listItem("tTargetY","any",5) as number)-(175))*(1-(listItem("tShot","any",5) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",5) as number)<175){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",5) as number)!=-160){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",5) as number)-(175))/((listItem("tTargetX","any",5) as number)-(-160))));}
   if((listItem("tTargetX","any",5) as number)<-160){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",5) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",5) as number)));setVar("lastStyle",(listItem("tType","any",5) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 05",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",5) as number)){
   if((listItem("tLevel","any",5) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",5) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(-160+v("fxX"),175+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",5) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",5) as number)+v("fxX"),(listItem("tTargetY","any",5) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",5) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",5) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 06",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",6) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+15+((listItem("tTargetX","any",6) as number)-(15))*(1-(listItem("tShot","any",6) as number)/0.16),
      v("fxY")+55+((listItem("tTargetY","any",6) as number)-(55))*(1-(listItem("tShot","any",6) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",6) as number)<55){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",6) as number)!=15){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",6) as number)-(55))/((listItem("tTargetX","any",6) as number)-(15))));}
   if((listItem("tTargetX","any",6) as number)<15){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",6) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",6) as number)));setVar("lastStyle",(listItem("tType","any",6) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 06",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",6) as number)){
   if((listItem("tLevel","any",6) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",6) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(15+v("fxX"),55+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",6) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",6) as number)+v("fxX"),(listItem("tTargetY","any",6) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",6) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",6) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 07",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",7) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+15+((listItem("tTargetX","any",7) as number)-(15))*(1-(listItem("tShot","any",7) as number)/0.16),
      v("fxY")+-175+((listItem("tTargetY","any",7) as number)-(-175))*(1-(listItem("tShot","any",7) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",7) as number)<-175){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",7) as number)!=15){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",7) as number)-(-175))/((listItem("tTargetX","any",7) as number)-(15))));}
   if((listItem("tTargetX","any",7) as number)<15){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",7) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",7) as number)));setVar("lastStyle",(listItem("tType","any",7) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 07",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",7) as number)){
   if((listItem("tLevel","any",7) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",7) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(15+v("fxX"),-175+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",7) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",7) as number)+v("fxX"),(listItem("tTargetY","any",7) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",7) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",7) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 08",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",8) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+180+((listItem("tTargetX","any",8) as number)-(180))*(1-(listItem("tShot","any",8) as number)/0.16),
      v("fxY")+55+((listItem("tTargetY","any",8) as number)-(55))*(1-(listItem("tShot","any",8) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",8) as number)<55){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",8) as number)!=180){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",8) as number)-(55))/((listItem("tTargetX","any",8) as number)-(180))));}
   if((listItem("tTargetX","any",8) as number)<180){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",8) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",8) as number)));setVar("lastStyle",(listItem("tType","any",8) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 08",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",8) as number)){
   if((listItem("tLevel","any",8) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",8) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(180+v("fxX"),55+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",8) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",8) as number)+v("fxX"),(listItem("tTargetY","any",8) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",8) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",8) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 09",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",9) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+180+((listItem("tTargetX","any",9) as number)-(180))*(1-(listItem("tShot","any",9) as number)/0.16),
      v("fxY")+-175+((listItem("tTargetY","any",9) as number)-(-175))*(1-(listItem("tShot","any",9) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",9) as number)<-175){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",9) as number)!=180){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",9) as number)-(-175))/((listItem("tTargetX","any",9) as number)-(180))));}
   if((listItem("tTargetX","any",9) as number)<180){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",9) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",9) as number)));setVar("lastStyle",(listItem("tType","any",9) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 09",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",9) as number)){
   if((listItem("tLevel","any",9) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",9) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(180+v("fxX"),-175+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",9) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",9) as number)+v("fxX"),(listItem("tTargetY","any",9) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",9) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",9) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 10",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",10) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+245+((listItem("tTargetX","any",10) as number)-(245))*(1-(listItem("tShot","any",10) as number)/0.16),
      v("fxY")+165+((listItem("tTargetY","any",10) as number)-(165))*(1-(listItem("tShot","any",10) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",10) as number)<165){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",10) as number)!=245){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",10) as number)-(165))/((listItem("tTargetX","any",10) as number)-(245))));}
   if((listItem("tTargetX","any",10) as number)<245){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",10) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",10) as number)));setVar("lastStyle",(listItem("tType","any",10) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 10",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",10) as number)){
   if((listItem("tLevel","any",10) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",10) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(245+v("fxX"),165+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",10) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",10) as number)+v("fxX"),(listItem("tTargetY","any",10) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",10) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",10) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 11",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",11) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+-405+((listItem("tTargetX","any",11) as number)-(-405))*(1-(listItem("tShot","any",11) as number)/0.16),
      v("fxY")+-50+((listItem("tTargetY","any",11) as number)-(-50))*(1-(listItem("tShot","any",11) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",11) as number)<-50){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",11) as number)!=-405){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",11) as number)-(-50))/((listItem("tTargetX","any",11) as number)-(-405))));}
   if((listItem("tTargetX","any",11) as number)<-405){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",11) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",11) as number)));setVar("lastStyle",(listItem("tType","any",11) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 11",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",11) as number)){
   if((listItem("tLevel","any",11) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",11) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(-405+v("fxX"),-50+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",11) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",11) as number)+v("fxX"),(listItem("tTargetY","any",11) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",11) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",11) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});

sprite("Projectile 12",{visible:false},()=>{
 onStart(()=>{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (listItem("tShot","any",12) as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(v("fxX")+250+((listItem("tTargetX","any",12) as number)-(250))*(1-(listItem("tShot","any",12) as number)/0.16),
      v("fxY")+-25+((listItem("tTargetY","any",12) as number)-(-25))*(1-(listItem("tShot","any",12) as number)/0.16));
   setVar("fxAngle",90);if((listItem("tTargetY","any",12) as number)<-25){setVar("fxAngle",-90);}
   if((listItem("tTargetX","any",12) as number)!=250){setVar("fxAngle",mathFunc("atan",((listItem("tTargetY","any",12) as number)-(-25))/((listItem("tTargetX","any",12) as number)-(250))));}
   if((listItem("tTargetX","any",12) as number)<250){setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!==(listItem("tType","any",12) as number)){setStyle(listItem("bulletStyles","any",(listItem("tType","any",12) as number)));setVar("lastStyle",(listItem("tType","any",12) as number));}
   if((getVar("quality") as number)===0){setScale(45);}else{setScale(75);}
  }else{hide();}
 });wait(0.035);});});
});
sprite("Impact 12",{visible:false},()=>{
 onStart(()=>{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{warp(()=>{
  if((scriptVar("fxLevel") as number)!==(listItem("tLevel","any",12) as number)){
   if((listItem("tLevel","any",12) as number)>0){setVar("fxUpgrade",v("now")+0.6);}
   setVar("fxLevel",(listItem("tLevel","any",12) as number));
  }
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){
   show();moveTo(250+v("fxX"),-25+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }else if((getVar("mode") as number)===2 && (listItem("tShot","any",12) as number)>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){
   show();moveTo((listItem("tTargetX","any",12) as number)+v("fxX"),(listItem("tTargetY","any",12) as number)+v("fxY"));setScale(25+(0.16-(listItem("tShot","any",12) as number))*450);
   setEffect("1",(0.16-(listItem("tShot","any",12) as number))*400);
  }else{hide();}
 });if(v("quality")===0){wait(0.2);}else{wait(0.035);}});});
});
sprite("Boss Warning",{visible:false},()=>{
 onStart(()=>{forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (getVar("bossAlert") as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(-65,185);setScale(100);
  }else{hide();}
 });wait(0.1);});});
});
