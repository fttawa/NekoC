import {v,item,min,max,clamp,text} from "./state";

// World vertex wx/wy/wz -> camera coordinates tx/ty/tz.
defineProc("mc transform",[],()=>{
  setVar("dx",v("wx")-v("px"));setVar("dy",v("wy")-v("py")-1.55);setVar("dz",v("wz")-v("pz"));
  setVar("tx",v("dx")*v("cy")-v("dz")*v("sy"));
  setVar("forward",v("dx")*v("sy")+v("dz")*v("cy"));
  setVar("ty",v("dy")*v("cp")-v("forward")*v("sp"));
  setVar("tz",v("dy")*v("sp")+v("forward")*v("cp"));
});

// Sutherland-Hodgman clipping against the near plane, then perspective.
// Clipping is necessary when walking right up to a block or standing on it.
defineProc("mc polygon",[],()=>{
  deleteListItem("sx","all",1);deleteListItem("sy2","all",1);
  setVar("lastVertex",4);
  for(let cv=1;cv<=4;cv++) {
    setVar("az",item("vz",v("lastVertex")));setVar("bz",item("vz",cv));
    if((v("az")>=0.12 && v("bz")<0.12)||(v("az")<0.12 && v("bz")>=0.12)) {
      setVar("alpha",(0.12-v("az"))/(v("bz")-v("az")));
      appendList("sx",(item("vx",v("lastVertex"))+(item("vx",cv)-item("vx",v("lastVertex")))*v("alpha"))*300/0.12);
      appendList("sy2",(item("vy",v("lastVertex"))+(item("vy",cv)-item("vy",v("lastVertex")))*v("alpha"))*300/0.12);
    }
    if(v("bz")>=0.12) {appendList("sx",item("vx",cv)*300/v("bz"));appendList("sy2",item("vy",cv)*300/v("bz"));}
    setVar("lastVertex",cv);
  }
  setVar("npoly",listLength("sx"));
  if(v("npoly")>=3) {
    setVar("ymin",180);setVar("ymax",-180);setVar("xmin",320);setVar("xmax",-320);
    for(let bv=1;bv<=v("npoly");bv++) {
      setVar("bx",item("sx",bv));setVar("by",item("sy2",bv));
      if(v("by")<v("ymin")) setVar("ymin",v("by"));if(v("by")>v("ymax")) setVar("ymax",v("by"));
      if(v("bx")<v("xmin")) setVar("xmin",v("bx"));if(v("bx")>v("xmax")) setVar("xmax",v("bx"));
    }
    if(v("xmax")>-320 && v("xmin")<320 && v("ymax")>-180 && v("ymin")<180 && v("ymax")>v("ymin")) {
      // Convex polygon: walk the two monotone edge chains once. All division
      // and vertex-list reads happen at edge transitions, not per scan band.
      setVar("bottom",v("ymin"));if(v("bottom")< -180) setVar("bottom",-180);
      setVar("top",v("ymax"));if(v("top")>180) setVar("top",180);
      // Fit an integral number of bands, so the final band reaches the edge.
      setVar("band",(v("top")-v("bottom"))/ceil((v("top")-v("bottom"))/v("quality")));
      setPenSize(v("band")+1);
      setVar("scan",v("bottom")+v("band")/2);
      setVar("lowest",1);
      for(let low=2;low<=v("npoly");low++) {
        if(item("sy2",low)<item("sy2",v("lowest"))) setVar("lowest",low);
      }
      setVar("li",v("lowest"));setVar("ri2",v("lowest"));
      setVar("ly1",item("sy2",v("li")));setVar("ry1",v("ly1"));
      while(v("scan")<v("top")) {
        while(v("ly1")<=v("scan")) {
          setVar("lx0",item("sx",v("li")));setVar("ly0",v("ly1"));
          setVar("li",v("li")%v("npoly")+1);setVar("ly1",item("sy2",v("li")));
          if(v("ly1")>v("scan")) {
            setVar("lslope",(item("sx",v("li"))-v("lx0"))/(v("ly1")-v("ly0")));
            setVar("xa",v("lx0")+(v("scan")-v("ly0"))*v("lslope"));
            setVar("lstep",v("lslope")*v("band"));
          }
        }
        while(v("ry1")<=v("scan")) {
          setVar("rx0",item("sx",v("ri2")));setVar("ry0",v("ry1"));
          setVar("ri2",(v("ri2")+v("npoly")-2)%v("npoly")+1);setVar("ry1",item("sy2",v("ri2")));
          if(v("ry1")>v("scan")) {
            setVar("rslope",(item("sx",v("ri2"))-v("rx0"))/(v("ry1")-v("ry0")));
            setVar("xb",v("rx0")+(v("scan")-v("ry0"))*v("rslope"));
            setVar("rstep",v("rslope")*v("band"));
          }
        }
        setVar("left",v("xa"));setVar("right",v("xb"));
        if(v("xa")>v("xb")) {setVar("left",v("xb"));setVar("right",v("xa"));}
        if(v("left")< -320) setVar("left",-320);if(v("right")>320) setVar("right",320);
        if(v("right")>v("left")) {
          setVar("inset",v("band")*0.25);
          if(v("right")-v("left")<v("band")/2) setVar("inset",(v("right")-v("left"))/2);
          moveTo(v("left")+v("inset"),v("scan"));penDown();moveTo(v("right")-v("inset"),v("scan"));penUp();
          changeVar("strokes",1);
        }
        changeVar("scan",v("band"));changeVar("xa",v("lstep"));changeVar("xb",v("rstep"));
      }
      changeVar("faces",1);
      // Fine perimeter bridges the round-cap scallops at shared face edges.
      setPenSize(1.5);setVar("edgex",item("sx",v("npoly")));setVar("edgey",item("sy2",v("npoly")));
      for(let pe=1;pe<=v("npoly");pe++) {
        setVar("nextx",item("sx",pe));setVar("nexty",item("sy2",pe));
        // Avoid huge offscreen pen segments after near-plane clipping.
        if(mathFunc("abs",v("nextx"))<1000 && mathFunc("abs",v("nexty"))<1000 && mathFunc("abs",v("edgex"))<1000 && mathFunc("abs",v("edgey"))<1000) {
          moveTo(v("edgex"),v("edgey"));penDown();moveTo(v("nextx"),v("nexty"));penUp();
        }
        setVar("edgex",v("nextx"));setVar("edgey",v("nexty"));
      }
    }
  }
});

defineProc("mc face",[],()=>{
  setVar("fi",item("order",v("oi")));setVar("dir",item("md",v("fi")));
  setVar("fx",item("mx",v("fi")));setVar("fy",item("my",v("fi")));setVar("fz",item("mz",v("fi")));
  setVar("fu",item("mu",v("fi")));setVar("fv",item("mv",v("fi")));setVar("mat",item("mt",v("fi")));
  deleteListItem("vx","all",1);deleteListItem("vy","all",1);deleteListItem("vz","all",1);
  // A merged face is an affine rectangle: transform its origin once and
  // derive the other corners from two camera-space edge vectors.
  setVar("wx",v("fx"));setVar("wy",v("fy"));setVar("wz",v("fz"));
  if(v("dir")<2) {
    if(v("dir")===0) changeVar("wx",1);
    setVar("tux",-v("sy")*v("fu"));setVar("tuy",-v("cysp")*v("fu"));setVar("tuz",v("cycp")*v("fu"));
    setVar("tvx",0);setVar("tvy",v("cp")*v("fv"));setVar("tvz",v("sp")*v("fv"));
  } else {
    setVar("tux",v("cy")*v("fu"));setVar("tuy",-v("sysp")*v("fu"));setVar("tuz",v("sycp")*v("fu"));
    if(v("dir")<4) {
      if(v("dir")===2) changeVar("wy",1);
      setVar("tvx",-v("sy")*v("fv"));setVar("tvy",-v("cysp")*v("fv"));setVar("tvz",v("cycp")*v("fv"));
    } else {
      if(v("dir")===4) changeVar("wz",1);
      setVar("tvx",0);setVar("tvy",v("cp")*v("fv"));setVar("tvz",v("sp")*v("fv"));
    }
  }
  callProc("mc transform");
  appendList("vx",v("tx"));appendList("vy",v("ty"));appendList("vz",v("tz"));
  appendList("vx",v("tx")+v("tux"));appendList("vy",v("ty")+v("tuy"));appendList("vz",v("tz")+v("tuz"));
  appendList("vx",v("tx")+v("tux")+v("tvx"));appendList("vy",v("ty")+v("tuy")+v("tvy"));appendList("vz",v("tz")+v("tuz")+v("tvz"));
  appendList("vx",v("tx")+v("tvx"));appendList("vy",v("ty")+v("tvy"));appendList("vz",v("tz")+v("tvz"));
  setVar("bright",item("shade",v("dir")+1)*v("daylight")*item("ma",v("fi"))/100);
  // Warm player torch: local radial contribution, independent of sun level.
  if(v("torch")===1) setVar("bright",max(v("bright"),85-item("depth",v("oi"))*11));
  // Native range blocks count backwards for 1..0; guard empty banks.
  if(v("daylight")<70 && (listLength("lampx") as number)>0) {
    for(let lamp=1;lamp<=(listLength("lampx") as number);lamp++) {
      setVar("lampdistance",mathFunc("abs",v("fx")-item("lampx",lamp))+mathFunc("abs",v("fy")-item("lampy",lamp))+mathFunc("abs",v("fz")-item("lampz",lamp)));
      if(v("lampdistance")<5) {
        setVar("lamplight",95-v("lampdistance")*16);
        if(v("lamplight")>v("bright")) setVar("bright",v("lamplight"));
      }
    }
  }
  if(v("mat")===7) setVar("bright",95);
  setVar("fog",clamp(item("depth",v("oi"))/v("view"),0,1));
  setPenEffect("hue",item("hue",v("mat")));
  setPenEffect("saturation",item("sat",v("mat"))*(1-v("fog")*0.5));
  setPenEffect("brightness",clamp(v("bright")*item("value",v("mat"))/100,8,100));
  callProc("mc polygon");
});

defineProc("mc render",[],()=>{
  setVar("phase",1);
  clearDrawing();penUp();setVar("faces",0);setVar("strokes",0);
  setVar("cysp",v("cy")*v("sp"));setVar("cycp",v("cy")*v("cp"));
  setVar("sysp",v("sy")*v("sp"));setVar("sycp",v("sy")*v("cp"));
  // Sky itself is two broad native strokes, rather than hundreds of pixels.
  setPenColor("#76b9d7");setPenEffect("brightness",25+v("daylight")*0.65);setPenSize(640);
  moveTo(0,-180);penDown();moveTo(0,180);penUp();
  deleteListItem("order","all",1);deleteListItem("depth","all",1);
  for(let mi=1;mi<=(listLength("mx") as number);mi++) {
    setVar("dir",item("md",mi));setVar("fx",item("mx",mi));setVar("fy",item("my",mi));setVar("fz",item("mz",mi));
    setVar("visible",0);
    if(v("dir")===0 && v("px")>v("fx")+1) setVar("visible",1);
    if(v("dir")===1 && v("px")<v("fx")) setVar("visible",1);
    if(v("dir")===2 && v("py")+1.55>v("fy")+1) setVar("visible",1);
    if(v("dir")===3 && v("py")+1.55<v("fy")) setVar("visible",1);
    if(v("dir")===4 && v("pz")>v("fz")+1) setVar("visible",1);
    if(v("dir")===5 && v("pz")<v("fz")) setVar("visible",1);
    if(v("visible")===1) {
      setVar("wx",v("fx")+0.5);setVar("wy",v("fy")+0.5);setVar("wz",v("fz")+0.5);
      if(v("dir")<2) {setVar("wz",v("fz")+item("mu",mi)/2);setVar("wy",v("fy")+item("mv",mi)/2);}
      else if(v("dir")<4) {setVar("wx",v("fx")+item("mu",mi)/2);setVar("wz",v("fz")+item("mv",mi)/2);}
      else {setVar("wx",v("fx")+item("mu",mi)/2);setVar("wy",v("fy")+item("mv",mi)/2);}
      callProc("mc transform");
      setVar("radius",(item("mu",mi)+item("mv",mi))/2);
      if(v("tz")+v("radius")>0.12 && v("tz")<v("view") && mathFunc("abs",v("tx"))<v("tz")*1.1+v("radius") && mathFunc("abs",v("ty"))<v("tz")*0.65+v("radius")) {
        // Binary insertion: O(log visible faces) native comparisons per face.
        setVar("lo",1);setVar("hi",listLength("order"));
        while(v("lo")<=v("hi")) {
          setVar("mid",floor((v("lo")+v("hi"))/2));
          if(item("depth",v("mid"))<v("tz")) setVar("hi",v("mid")-1);
          else setVar("lo",v("mid")+1);
        }
        insertList("order",v("lo"),mi);insertList("depth",v("lo"),v("tz"));
      }
    }
  }
  setVar("phase",2);
  if((listLength("order") as number)>0) {
    for(let draw=1;draw<=(listLength("order") as number);draw++) {setVar("oi",draw);callProc("mc face");}
  }
  callProc("mc enemy draw");
  setVar("phase",3);callProc("mc hud");changeVar("frames",1);setVar("phase",4);
});

defineProc("mc enemy draw",[],()=>{
  // Billboard body with a world-space occlusion ray; never show through walls.
  if(v("enemyalive")===1) {
    setVar("wx",v("enemyx"));setVar("wy",v("enemyy")+0.8);setVar("wz",v("enemyz"));callProc("mc transform");
    if(v("tz")>0.5 && v("tz")<v("view")) {
      setVar("enemyscreenx",v("tx")*300/v("tz"));setVar("enemyscreeny",v("ty")*300/v("tz"));
      if(mathFunc("abs",v("enemyscreenx"))<300 && mathFunc("abs",v("enemyscreeny"))<150) {
        setVar("enemysize",min(65,95/v("tz")));callProc("mc enemy visibility");
        if(v("enemyvisible")===1) {
          setPenColor("#354559");setPenSize(v("enemysize")*0.45);
          moveTo(v("enemyscreenx")-v("enemysize")*0.25,v("enemyscreeny")-v("enemysize"));penDown();moveTo(v("enemyscreenx")-v("enemysize")*0.25,v("enemyscreeny"));penUp();
          moveTo(v("enemyscreenx")+v("enemysize")*0.25,v("enemyscreeny")-v("enemysize"));penDown();moveTo(v("enemyscreenx")+v("enemysize")*0.25,v("enemyscreeny"));penUp();
          setPenColor("#568868");setPenSize(v("enemysize"));moveTo(v("enemyscreenx"),v("enemyscreeny"));penDown();moveTo(v("enemyscreenx"),v("enemyscreeny")+v("enemysize")*0.65);penUp();
          setPenColor("#9bb277");setPenSize(v("enemysize")*0.7);moveTo(v("enemyscreenx"),v("enemyscreeny")+v("enemysize")*1.35);penDown();penUp();
          setPenColor("#ffb17c");text(v("enemyscreenx")-v("enemysize")*0.24,v("enemyscreeny")+v("enemysize")*1.4,"··",v("enemysize")*0.8);
        }
      }
    }
  }
});

defineProc("mc hud",[],()=>{
  setPenColor("#101b29");setPenSize(36);moveTo(-320,164);penDown();moveTo(320,164);penUp();
  setPenSize(42);moveTo(-320,-164);penDown();moveTo(320,-164);penUp();
  setPenColor("#eaf5ed");text(-305,166,join("PENCRAFT  /  HP ",floor(v("hp")),"  FOOD ",floor(v("food")),"  DAY ",floor(v("clock")/180)+1),12);
  text(150,166,join(v("fps")," FPS / ",v("faces")," F"),12);
  text(-305,-157,join("[",v("selected"),"] ",listItem("names","any",v("selected"))," x",item("bag",v("selected")),"   PICK ",v("tool")," / ",v("durability"),"   APPLES ",v("apples")),12);
  setPenColor("#93cbbd");text(-305,-175,getVar("notice"),10);
  callProc("mc crosshair");
  if(v("help")===1) callProc("mc help");
});

defineProc("mc crosshair",[],()=>{
  setPenColor("#ffffff");setPenSize(1.5);moveTo(-5,0);penDown();moveTo(5,0);penUp();moveTo(0,-5);penDown();moveTo(0,5);penUp();
  if(v("hit")===1) {setPenColor("#e3bc79");text(10,-12,join(listItem("names","any",v("hitmat"))," ",floor(v("mining")*100),"%"),10);}
  if(v("hp")<=0) {setPenColor("#ff9e8b");text(-130,30,"YOU DIED · R TO RESPAWN",19);}
});

defineProc("mc help",[],()=>{
    setPenColor("#142333");setPenSize(190);moveTo(-145,10);penDown();moveTo(145,10);penUp();
    setPenColor("#eaf5ed");text(-210,76,"WASD move / arrows look / SPACE jump",14);
    text(-210,50,"Hold F mine / G place / 1-7 select",14);
    text(-210,24,"C craft pick / T craft torch / E eat",14);
    text(-210,-2,"B attack / L torch / H help / R respawn",14);
    text(-210,-28,"V quality / N view distance / P pause",14);
    text(-210,-54,"Collect wood > stone > iron. Survive night.",13);
});
