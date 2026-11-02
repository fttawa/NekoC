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
    if(uiV("bossAlert")>0 && uiV("milestone")>=4) {setPenColor("#ff6984");uiText(-185,188,"WARNING / RIFT LORD",21);}
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
  if(uiV("mode")===7 || uiV("mode")===8) {
    setPenColor("#e4f3ff");uiText(-287,105,"OFFLINE / CLOUD NOT CONNECTED",14);
    uiText(-287,75,"Native cloud integration arrives at milestone 5.",12);
    uiText(-95,-174,"B / CLICK · BACK",13);
  }
});});

defineProc("td choose level",[],()=>{warp(()=>{
  if(uiV("level")<1) {setVar("level",1);}
  if(uiV("level")>6) {setVar("level",6);}
  callProc("td reset");setVar("mode",2);setVar("paused",0);
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
