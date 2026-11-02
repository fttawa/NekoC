"""Bounded native-sprite effects. No pen drawing or runtime code injection."""

def emit(pad_x, pad_y):
    source='''
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
'''
    for i in range(1,13):
        def item(name):return f'(listItem("{name}","any",{i}) as number)'
        source+=f'''
sprite("Projectile {i:02d}",{{visible:false}},()=>{{
 onStart(()=>{{scriptVars("lastStyle","fxAngle");setVar("lastStyle",-1);forever(()=>{{warp(()=>{{
  if((getVar("mode") as number)===2 && {item('tShot')}>0 && (getVar("milestone") as number)>=4){{
   show();moveTo(v("fxX")+{pad_x[i-1]}+({item('tTargetX')}-({pad_x[i-1]}))*(1-{item('tShot')}/0.16),
      v("fxY")+{pad_y[i-1]}+({item('tTargetY')}-({pad_y[i-1]}))*(1-{item('tShot')}/0.16));
   setVar("fxAngle",90);if({item('tTargetY')}<{pad_y[i-1]}){{setVar("fxAngle",-90);}}
   if({item('tTargetX')}!={pad_x[i-1]}){{setVar("fxAngle",mathFunc("atan",({item('tTargetY')}-({pad_y[i-1]}))/({item('tTargetX')}-({pad_x[i-1]}))));}}
   if({item('tTargetX')}<{pad_x[i-1]}){{setVar("fxAngle",(scriptVar("fxAngle") as number)+180);}}
   pointTowards(scriptVar("fxAngle"));
   if((scriptVar("lastStyle") as number)!=={item('tType')}){{setStyle(listItem("bulletStyles","any",{item('tType')}));setVar("lastStyle",{item('tType')});}}
   if((getVar("quality") as number)===0){{setScale(45);}}else{{setScale(75);}}
  }}else{{hide();}}
 }});wait(0.035);}});}});
}});
sprite("Impact {i:02d}",{{visible:false}},()=>{{
 onStart(()=>{{scriptVars("fxLevel","fxUpgrade");setVar("fxLevel",0);setVar("fxUpgrade",0);forever(()=>{{warp(()=>{{
  if((scriptVar("fxLevel") as number)!=={item('tLevel')}){{
   if({item('tLevel')}>0){{setVar("fxUpgrade",v("now")+0.6);}}
   setVar("fxLevel",{item('tLevel')});
  }}
  if(v("mode")===2 && v("quality")===1 && (scriptVar("fxUpgrade") as number)>v("now")){{
   show();moveTo({pad_x[i-1]}+v("fxX"),{pad_y[i-1]}+v("fxY"));setScale(80+(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*80);setEffect("1",(0.6-((scriptVar("fxUpgrade") as number)-v("now")))*130);
  }}else if((getVar("mode") as number)===2 && {item('tShot')}>0 && (getVar("quality") as number)===1 && (getVar("milestone") as number)>=4){{
   show();moveTo({item('tTargetX')}+v("fxX"),{item('tTargetY')}+v("fxY"));setScale(25+(0.16-{item('tShot')})*450);
   setEffect("1",(0.16-{item('tShot')})*400);
  }}else{{hide();}}
 }});if(v("quality")===0){{wait(0.2);}}else{{wait(0.035);}}}});}});
}});
'''
    source+='''sprite("Boss Warning",{visible:false},()=>{
 onStart(()=>{forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (getVar("bossAlert") as number)>0 && (getVar("milestone") as number)>=4){
   show();moveTo(-65,185);setScale(100);
  }else{hide();}
 });wait(0.1);});});
});
'''
    return source
