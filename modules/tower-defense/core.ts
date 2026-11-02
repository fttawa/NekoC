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

export function v(name: string): number { return getVar(name) as number; }
export function l(name: string, index: number): number { return listItem(name,"any",index) as number; }
export function r(name: string, index: number, value: number): void { replaceListItem(name,"any",index,value); }

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
    r("eHP",v("tdVictim"),l("eHP",v("tdVictim"))-v("tdHitDamage"));r("eFlash",v("tdVictim"),0.14);
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
