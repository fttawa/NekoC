// HUD uses text stamps only; battlefield graphics are native SVG costumes.
function uiV(name: string): number { return getVar(name) as number; }
function uiN(name: string, index: number): number { return listItem(name,"any",index) as number; }
function uiText(x: number,y: number,value: NekoValue,size: number): void {
  penUp();moveTo(x,y);stampText(value,size,"left");
}

defineProc("td hud",[],()=>{warp(()=>{
  clearDrawing();pointTowards(0);setPenColor("#d9eeff");
  if(uiV("mode")===2) {
    uiText(-420,250,join("STARHOLD  /  ",uiV("level"),"     WAVE ",uiV("wave"),"/",uiV("waves")),17);
    setPenColor("#ffd082");uiText(-50,250,join("G ",floor(uiV("gold"))),17);
    setPenColor("#82f0cf");uiText(100,250,join("CORE ",uiV("lives")),17);
    setPenColor("#9cb4ca");uiText(308,212,"BUILD ARRAY",15);
    uiText(308,158,"1 PULSE  55",14);uiText(308,99,"2 FROST  70",14);
    uiText(308,40,"3 NOVA  100",14);uiText(308,-19,"4 PRISM 125",14);
    setPenColor("#e9f4ff");uiText(308,-82,join("PAD ",uiV("selectedPad")),15);
    if(uiV("selectedPad")>0) {
      uiText(308,-110,join("LEVEL ",uiN("tLevel",uiV("selectedPad"))),14);
    }
    uiText(308,-150,"U  UPGRADE",13);uiText(308,-180,"X  SELL 60%",13);
    setPenColor("#91aabe");uiText(-420,-249,"CLICK PAD: BUILD / SELECT    SPACE: NEXT WAVE    P: PAUSE",13);
    uiText(-420,-269,join("TYPE ",uiV("selectedTower"),"  SCORE ",floor(uiV("score")),"  ",uiV("fps")," FPS"),11);
    if(uiV("waveActive")===0) {setPenColor("#ffd082");uiText(-125,205,"SPACE · DEPLOY WAVE",18);}
    if(uiV("bossAlert")>0 && uiV("milestone")>=4) {setPenColor("#ff6984");uiText(-185,188,"WARNING / RIFT LORD",21);}
    if(uiV("paused")===1) {setPenColor("#ffffff");uiText(-130,35,"SYSTEM PAUSED",24);uiText(-130,-5,"P / CLICK TO RESUME",15);uiText(-130,-45,"ESC · RETURN TO TITLE",13);}
  }
  if(uiV("mode")===0) {
    setPenColor("#bbd7e9");uiText(-148,-67,"ENTER / CLICK · PLAY",19);
    uiText(-145,-112,"H · GUIDE   O · SETTINGS",13);
    uiText(-145,-143,"L · LEADERBOARD   C · MESSAGES",11);
    uiText(-145,-210,"Native Kitten N  /  No bitmap pen display",11);
  }
  if(uiV("mode")===1) {
    setPenColor("#b8d6e8");uiText(-395,205,"SELECT SECTOR   /   KEYS 1—6",20);
    uiText(-395,-235,"ESC · BACK     ALL SECTORS AVAILABLE FOR PRACTICE",12);
    forRange("uiLevel",1,6,1,()=>{
      setVar("uiLX",-340+((rangeValue("uiLevel") as number)-1)%3*270);
      setVar("uiLY",75-floor(((rangeValue("uiLevel") as number)-1)/3)*145);
      uiText(uiV("uiLX"),uiV("uiLY"),join("SECTOR 0",rangeValue("uiLevel")),21);
      uiText(uiV("uiLX"),uiV("uiLY")-32,join("STARS ",uiN("bestStars",rangeValue("uiLevel") as number)," / 3"),13);
      uiText(uiV("uiLX"),uiV("uiLY")-57,join("BEST ",uiN("bestScore",rangeValue("uiLevel") as number)),11);
    });
  }
  if(uiV("mode")===3 || uiV("mode")===4) {
    setPenColor("#e4f3ff");if(uiV("mode")===3){uiText(-175,70,"SECTOR SECURED",26);}else{uiText(-175,70,"CORE LOST",26);}
    uiText(-175,20,join("SCORE ",floor(uiV("score")),"    STARS ",uiV("stars")," / 3"),17);
    uiText(-175,-25,join("CORE ",uiV("lives"),"    SECTOR ",uiV("level")),14);
    uiText(-175,-77,"R · RETRY    ENTER · SECTORS",14);
  }
  if(uiV("mode")===5) {
    setPenColor("#e4f3ff");uiText(-215,155,"FIELD MANUAL",24);
    uiText(-215,112,"1–4 choose a tower; click a hex pad to build.",14);
    uiText(-215,78,"Click a built tower, U upgrades, X sells (60%).",14);
    uiText(-215,44,"SPACE starts a wave. P pauses. ESC returns.",14);
    uiText(-215,10,"Frost slows; Nova splashes; Prism pierces armor.",14);
    uiText(-215,-24,"Keep 18+ core health without selling: 3 stars.",14);
    uiText(-215,-58,"Enemies: scout, runner, armor, regen, guard, boss.",13);
    uiText(-215,-114,"ESC / CLICK · BACK",14);
  }
  if(uiV("mode")===6) {
    setPenColor("#e4f3ff");uiText(-180,120,"SETTINGS",24);
    if(uiV("quality")===1){uiText(-180,65,"Q · QUALITY   HIGH",17);}else{uiText(-180,65,"Q · QUALITY   LOW",17);}
    if(uiV("shakeEnabled")===1){uiText(-180,15,"S · SCREEN SHAKE   ON",15);}else{uiText(-180,15,"S · SCREEN SHAKE   OFF",15);}
    uiText(-180,-35,"Low mode reduces particles and disables shake.",13);
    uiText(-180,-100,"ESC / CLICK · BACK",14);
  }
  if(uiV("mode")===7 || uiV("mode")===8) {
    setPenColor("#e4f3ff");if(uiV("mode")===7){uiText(-250,185,"SECTOR LEADERBOARDS",24);}else{uiText(-250,185,"PUBLIC MESSAGES",24);}
    uiText(-250,142,"OFFLINE / CLOUD NOT CONNECTED",14);
    uiText(-250,108,"Native cloud integration arrives at milestone 5.",13);
    uiText(-250,-190,"ESC / CLICK · BACK",14);
  }
});});

defineProc("td choose level",[],()=>{warp(()=>{
  if(uiV("level")<1) {setVar("level",1);}
  if(uiV("level")>6) {setVar("level",6);}
  callProc("td reset");setVar("mode",2);setVar("paused",0);
});});

defineProc("td click",[],()=>{warp(()=>{
  if(uiV("mode")===0) {
    if(uiV("milestone")<3) {setVar("level",1);setVar("chooseRequest",1);} else {setVar("mode",1);}
  } else if(uiV("mode")===1) {
    setVar("clickLevel",1+floor((uiV("clickX")+405)/270));
    if(uiV("clickY")<0) {changeVar("clickLevel",3);}
    if(uiV("clickLevel")>=1 && uiV("clickLevel")<=6) {setVar("level",uiV("clickLevel"));setVar("chooseRequest",1);}
  } else if(uiV("mode")===2) {
    if(uiV("paused")===1) {setVar("paused",0);} else {
      if(uiV("clickX")>295) {
        if(uiV("clickY")>110) {setVar("selectedTower",1);}
        else if(uiV("clickY")>51) {setVar("selectedTower",2);}
        else if(uiV("clickY")>-8) {setVar("selectedTower",3);}
        else if(uiV("clickY")>-64) {setVar("selectedTower",4);}
        else if(uiV("clickY")>-165) {setVar("upgradeRequest",1);}
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
  } else if(uiV("mode")===3 || uiV("mode")===4) {setVar("mode",1);}
  else {setVar("mode",0);}
});});
