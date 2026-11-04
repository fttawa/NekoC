// Appended to the generated, specialized arithmetic kernel by build.py.
// Public lm_* controls/telemetry are shared; scratch data is script-local.
defineProc("lm attention",[],()=>{warp(()=>{
  for(let component=0;component<32;component++){
    setVar("cacheWrite",v("lm_layer")*2048+v("lm_position")*32+component+1);
    replaceListItem("lm_keys","any",v("cacheWrite"),item("lm_k",component+1));
    replaceListItem("lm_values","any",v("cacheWrite"),item("lm_v",component+1));
  }
  deleteListItem("lm_context","all",1);
  for(let head=0;head<2;head++){
    setVar("headBase",head*16);
    deleteListItem("lm_scores","all",1);setVar("scoreMax",-1000000000);
    for(let past=0;past<=v("lm_position");past++){
      setVar("cacheBase",v("lm_layer")*2048+past*32+v("headBase"));
      callProc("lm attention dot");appendList("lm_scores",v("score"));
      if(v("score")>v("scoreMax"))setVar("scoreMax",v("score"));
    }
    setVar("scoreSum",0);
    for(let scoreIndex=1;scoreIndex<=v("lm_position")+1;scoreIndex++){
      setVar("scoreExp",mathFunc("exp",item("lm_scores",scoreIndex)-v("scoreMax")));
      replaceListItem("lm_scores","any",scoreIndex,v("scoreExp"));changeVar("scoreSum",v("scoreExp"));
    }
    for(let channel=0;channel<16;channel++){
      setVar("contextValue",0);
      for(let contextPast=0;contextPast<=v("lm_position");contextPast++){
        setVar("cacheRead",v("lm_layer")*2048+contextPast*32+v("headBase")+channel+1);
        changeVar("contextValue",item("lm_scores",contextPast+1)/v("scoreSum")*item("lm_values",v("cacheRead")));
      }
      appendList("lm_context",v("contextValue"));
    }
  }
});});

defineProc("lm step",[],()=>{warp(()=>{
  setVar("lm_phase","EMBED");callProc("lm embed");
  setVar("lm_phase","LAYER 1 / 2");
  callProc("lm block 0 attention");callProc("lm block 0 residual");callProc("lm block 0 finish");
  setVar("lm_phase","LAYER 2 / 2");
  callProc("lm block 1 attention");callProc("lm block 1 residual");callProc("lm block 1 finish");
  callProc("lm norm final");callProc("lm logits");
  setVar("lm_last_input",v("lm_input_token"));setVar("lm_last_position",v("lm_position"));
  changeVar("lm_position",1);changeVar("lm_tokens_processed",1);changeVar("lm_frames",1);
});});

defineProc("lm sample",[],()=>{warp(()=>{
  setVar("bestScore",-1000000000);setVar("lm_next_token",1);
  for(let candidate=1;candidate<__VOCAB__;candidate++){
    setVar("candidateScore",item("lm_logits",candidate+1));
    if(v("candidateScore")>v("bestScore")){setVar("bestScore",v("candidateScore"));setVar("lm_next_token",candidate);}
  }
  if(v("lm_temperature")>0){
    deleteListItem("lm_probs","all",1);appendList("lm_probs",0);setVar("probSum",0);
    for(let sampleId=1;sampleId<__VOCAB__;sampleId++){
      setVar("prob",mathFunc("exp",(item("lm_logits",sampleId+1)-v("bestScore"))/v("lm_temperature")));
      appendList("lm_probs",v("prob"));changeVar("probSum",v("prob"));
    }
    setVar("lm_seed",(v("lm_seed")*48271)%2147483647);
    setVar("sampleThreshold",v("lm_seed")/2147483647*v("probSum"));setVar("cumulative",0);setVar("sampled",0);
    for(let sampleIndex=1;sampleIndex<__VOCAB__;sampleIndex++){
      changeVar("cumulative",item("lm_probs",sampleIndex+1));
      if(v("sampled")===0&&v("cumulative")>v("sampleThreshold")){setVar("lm_next_token",sampleIndex);setVar("sampled",1);}
    }
  }
  // Inspectable top-three logits, not canned predictions.
  deleteListItem("lm_top_ids","all",1);deleteListItem("lm_top_scores","all",1);
  for(let rank=0;rank<3;rank++){
    setVar("topScore",-1000000000);setVar("topId",1);
    for(let topCandidate=1;topCandidate<__VOCAB__;topCandidate++){
      if(!listContains("lm_top_ids",topCandidate)&&item("lm_logits",topCandidate+1)>v("topScore")){
        setVar("topScore",item("lm_logits",topCandidate+1));setVar("topId",topCandidate);
      }
    }
    appendList("lm_top_ids",v("topId"));appendList("lm_top_scores",v("topScore"));
  }
});});

function label(x:number,y:number,text:NekoValue,size:number):void{penUp();moveTo(x,y);stampText(text,size,"left");}
defineProc("lm HUD",[],()=>{warp(()=>{
  penUp();clearDrawing();setPenColor("#09121f");setPenSize(562);
  moveTo(-450,0);penDown();moveTo(450,0);penUp();
  setPenColor("#65ead1");label(-420,237,"KITTEN N / TINY TRANSFORMER",26);
  setPenColor("#a8bed3");label(-420,198,"29,312 params | 2 layers | d32 | 2 heads | context 64",17);
  label(-420,170,"Native math + KV cache. Local weights. No model API.",16);
  setPenColor("#7e9ab6");label(-420,127,"PROMPT",14);
  setPenColor("#ecf6ff");label(-420,96,getVar("lm_prompt"),24);
  setPenColor("#7e9ab6");label(-420,53,"GENERATED / Chinese sentence-completion experiment",14);
  setPenColor("#65ead1");
  label(-420,18,selectText(getVar("lm_output"),1,26),24);
  label(-420,-18,selectText(getVar("lm_output"),27,52),24);
  setPenColor("#ecf6ff");label(-420,-72,join("Status: ",getVar("lm_status"),"  |  ",getVar("lm_phase")),16);
  label(-420,-101,join("Generated: ",v("lm_generated"),"  Context: ",v("lm_position"),"/64  Last token: ",floor(v("lm_last_seconds")*100)/100," s"),16);
  label(-420,-130,join("Temperature: ",v("lm_temperature"),"  Seed: ",v("lm_seed")),16);
  setPenColor("#7e9ab6");label(-420,-174,"1: 小猫   2: 今天是   3: 夜晚，   Enter: custom prompt",17);
  label(-420,-202,"R: regenerate   T: greedy / sample   Space: stop after token",17);
  label(-420,-242,"Real tiny language model, NOT a general-purpose chat assistant.",16);
});});

defineProc("lm begin",[],()=>{warp(()=>{
  setVar("lm_request",0);setVar("lm_running",0);setVar("lm_output","");setVar("lm_generated",0);
  setVar("lm_tokens_processed",0);setVar("lm_position",0);setVar("lm_last_seconds",0);
  setVar("lm_status","PREFILL");setVar("lm_phase","TOKENIZE");setVar("lm_prefill",1);
  deleteListItem("lm_prompt_tokens","all",1);appendList("lm_prompt_tokens",0);
  deleteListItem("lm_generated_ids","all",1);deleteListItem("lm_token_ms","all",1);
  setVar("validPrompt",1);
  if((getVar("lm_prompt") as string).length>48){setVar("validPrompt",0);setVar("lm_status","Prompt too long (max 48 chars)");}
  if((getVar("lm_prompt") as string).length>0){
    for(let charIndex=1;charIndex<=(getVar("lm_prompt") as string).length;charIndex++){
      setVar("promptChar",selectText(getVar("lm_prompt"),charIndex,charIndex));
      setVar("promptId",(listIndexOf("lm_vocabulary",getVar("promptChar")) as number)-1);
      if(v("promptId")<2){setVar("validPrompt",0);setVar("lm_status",join("Unsupported character: ",getVar("promptChar")));}
      appendList("lm_prompt_tokens",v("promptId"));
    }
  }
  setVar("promptCursor",1);
  if(v("validPrompt")===1){setVar("lm_running",1);setVar("lm_input_token",0);}
  callProc("lm HUD");
});});

onStart(()=>{
  penUp();hide();timerStart();
  // The builder supplies the persisted trained lists, never runtime downloads.
  setVar("lm_weight_count",listLength("lm_weights"));setVar("lm_vocab_size",listLength("lm_vocabulary"));
  setVar("lm_parameters",__PARAMETERS__);setVar("lm_frames",0);setVar("lm_ready",0);
  setVar("lm_prompt","小猫");setVar("lm_temperature",0);setVar("lm_seed",7);
  setVar("lm_max_new_tokens",32);setVar("lm_request",1);setVar("lm_stop",0);
  setVar("lm_output","");setVar("lm_status","INITIALIZING");setVar("lm_phase","KV CACHE");
  setVar("lm_position",0);setVar("lm_generated",0);setVar("lm_last_seconds",0);callProc("lm HUD");
  warp(()=>{for(let cacheSlot=0;cacheSlot<4096;cacheSlot++){appendList("lm_keys",0);appendList("lm_values",0);}});
  setVar("lm_ready",1);
  forever(()=>{
    if(v("lm_request")===1){setVar("lm_stop",0);callProc("lm begin");}
    if(v("lm_running")===1){
      setVar("tokenStarted",timerValue());
      if(v("lm_prefill")===1)setVar("lm_input_token",item("lm_prompt_tokens",v("promptCursor")));
      callProc("lm step");
      if(v("lm_prefill")===1){
        changeVar("promptCursor",1);
        if(v("promptCursor")>(listLength("lm_prompt_tokens") as number))setVar("lm_prefill",0);
      }
      if(v("lm_prefill")===0){
        setVar("lm_status","GENERATING");callProc("lm sample");
        setVar("lm_last_seconds",(timerValue() as number)-v("tokenStarted"));
        if(v("lm_next_token")===1){setVar("lm_running",0);setVar("lm_status","DONE / EOS");}
        else {
          setVar("lm_output",join(getVar("lm_output"),listItem("lm_vocabulary","any",v("lm_next_token")+1)));
          appendList("lm_generated_ids",v("lm_next_token"));appendList("lm_token_ms",v("lm_last_seconds")*1000);
          changeVar("lm_generated",1);setVar("lm_input_token",v("lm_next_token"));
          if(v("lm_generated")>=v("lm_max_new_tokens")||v("lm_position")>=64){setVar("lm_running",0);setVar("lm_status","DONE / LIMIT");}
        }
      }
      if(v("lm_stop")===1){setVar("lm_running",0);setVar("lm_status","STOPPED");setVar("lm_stop",0);}
      setVar("lm_phase","READY");callProc("lm HUD");
    } else {changeVar("lm_frames",1);wait(0.1);}
  });
});

onKey("49","up",()=>{setVar("lm_prompt","小猫");setVar("lm_request",1);});
onKey("50","up",()=>{setVar("lm_prompt","今天是");setVar("lm_request",1);});
onKey("51","up",()=>{setVar("lm_prompt","夜晚，");setVar("lm_request",1);});
onKey("82","up",()=>{setVar("lm_request",1);});
onKey("84","up",()=>{setVar("lm_temperature",0.7-v("lm_temperature"));setVar("lm_request",1);});
onKey("32","up",()=>{setVar("lm_stop",1);});
onKey("13","up",()=>{ask("输入词表内的中文短句开头，例如：小猫、今天是、夜晚，");setVar("lm_prompt",answer());setVar("lm_request",1);});
