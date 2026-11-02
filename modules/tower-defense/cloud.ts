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
