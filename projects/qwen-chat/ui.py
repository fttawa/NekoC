"""聊天界面积木：消息气泡、滚动、输入和多轮记忆管理。由 gen_ts.py 拼进作品。"""

BG, LINEC = '#f6f6f6', '#dddddd'
TEXT, MUTED, SOFT = '#222222', '#777777', '#aaaaaa'
USER_BG, INPUT_BG = '#e2e2e2', '#ebebeb'
X1, X2, TOP = -410, 410, 222
ROWS, LINE, FONT, CHAR = 14, 27, 16, 16.5
USER_COLS, BOT_COLS = 34, 48
MAX_INPUT = 60
RESERVE = 100  # 生成前至少留给回复的上下文
TEMPERATURE = 0.7
PRESETS = ['你好，你是谁？', '推荐一部好看的电影', '最近总是失眠怎么办？']
R = 14


def quote(t): return '"' + t + '"'
def color(c): return f'setPenColor("{c}");'


def label(x, y, text, size, align='left', c=None):
    return (color(c) if c else '') + f'penUp();moveTo({x},{y});stampText({text},{size},"{align}");'


def build(ctx, NL, KVD, d):
    frame = [color(BG), 'setPenSize(562);penUp();moveTo(-450,0);penDown();moveTo(450,0);penUp();',
             label(X1, 256, quote('迷你 Qwen'), 16, 'left', TEXT),
             color(LINEC), f'setPenSize(1);penUp();moveTo(-450,238);penDown();moveTo(450,238);penUp();',
             color(INPUT_BG), f'setPenSize(38);penUp();moveTo({X1 + 18},-200);penDown();moveTo({X2 - 18},-200);penUp();',
             color(LINEC), 'setPenSize(1);penUp();moveTo(-450,-232);penDown();moveTo(450,-232);penUp();']
    row_procs = f'''defineProc("lm row",["i"],()=>{{warp(()=>{{
  setVar("row",v("first")+param("i"));
  if(v("row")<=(listLength("lm_lines") as number)){{
    setVar("rowY",{TOP - 26}-param("i")*{LINE});setVar("rowText",listItem("lm_lines","any",v("row")));
    setVar("rowW",length(getVar("rowText"))*{CHAR}+8);
    if(item("lm_roles",v("row"))===0){{
      setPenColor("{USER_BG}");setPenSize({LINE});penUp();moveTo({X2 - 12}-v("rowW"),v("rowY"));penDown();moveTo({X2 - 12},v("rowY"));penUp();
      setPenColor("{TEXT}");moveTo({X2 - 12}-v("rowW")+4,v("rowY"));stampText(getVar("rowText"),{FONT},"left");
    }} else {{
      setPenColor("{TEXT}");moveTo({X1},v("rowY"));stampText(getVar("rowText"),{FONT},"left");
    }}
  }}
}});}});'''
    rows = f'for(let i=0;i<{ROWS};i++){{callProc("lm row",i);}}'
    # 正在生成的回复临时折到列表尾部，每次重绘先截回已定稿的行
    content = f'''
  repeatUntil((listLength("lm_lines") as number)<=v("committed"),()=>{{deleteListItem("lm_lines","last",0);deleteListItem("lm_roles","last",0);}});
  if(v("lm_running")===1)callProc("lm wrap",join(getVar("lm_reply"),"▍"),1);
  setVar("first",(listLength("lm_lines") as number)-{ROWS}+1-v("lm_scroll"));if(v("first")<1)setVar("first",1);
  {rows}
'''
    stats = [label(X1 + 20, -200, 'v("lm_running")===1?"回复中，按空格停止":"按回车或点这里输入  ·  N 新对话  ·  T 切换解码"', 14, 'left', MUTED)]
    # 底部调试条：上面一行小字是名称，下面一行是数值
    fields = [('状态', 'getVar("lm_status")'), ('阶段', 'getVar("lm_phase")'),
                               ('上下文', f'join(v("lm_position")," / {ctx}")'), ('轮次', 'v("lm_turns")'),
                               ('本轮生成', 'join(v("lm_generated")," token")'), ('上一 token', 'join(floor(v("lm_last_seconds")*1000)," ms")'),
                               ('生成速度', 'join(floor(v("lm_rate")*10)/10," token/s")'), ('解码', 'v("lm_temperature")===0?"贪心":join("采样 ",v("lm_temperature"))'),
                               ('种子', 'v("lm_seed")')]
    for i, (name, value) in enumerate(fields):
        x = X1 + i * (X2 - X1) / len(fields)
        stats += [label(x, -245, quote(name), 10, 'left', SOFT), label(x, -263, value, 12, 'left', TEXT)]
    bar = []
    return f'''defineProc("lm wrap",["text","role"],()=>{{warp(()=>{{
  setVar("line","");setVar("wrapCols",param("role")===0?{USER_COLS}:{BOT_COLS});
  for(let i=1;i<=length(param("text"));i++){{
    setVar("line",join(getVar("line"),selectText(param("text"),i,i)));
    if(length(getVar("line"))>=v("wrapCols")){{appendList("lm_lines",getVar("line"));appendList("lm_roles",param("role"));setVar("line","");}}
  }}
  if(length(getVar("line"))>0){{appendList("lm_lines",getVar("line"));appendList("lm_roles",param("role"));}}
}});}});
defineProc("lm HUD frame",[],()=>{{warp(()=>{{
  {''.join(frame)}
}});}});
{row_procs}
defineProc("lm HUD rows",[],()=>{{warp(()=>{{
  {content}
}});}});
defineProc("lm HUD stats",[],()=>{{warp(()=>{{
  {''.join(stats)}
  {''.join(bar)}
}});}});
defineProc("lm HUD",[],()=>{{warp(()=>{{
  penUp();clearDrawing();
  callProc("lm HUD frame");callProc("lm HUD rows");callProc("lm HUD stats");
}});}});
defineProc("lm new chat",[],()=>{{warp(()=>{{
  setVar("lm_running",0);setVar("lm_reply","");setVar("lm_generated",0);setVar("lm_position",0);setVar("lm_turns",0);setVar("lm_scroll",0);
  setVar("lm_last_seconds",0);setVar("lm_rate",0);setVar("genSeconds",0);setVar("lm_cursor",1);setVar("committed",0);
  deleteListItem("lm_hist","all",1);deleteListItem("lm_lines","all",1);deleteListItem("lm_roles","all",1);
  setVar("lm_status","等你开口");setVar("lm_phase","就绪");
}});}});
defineProc("lm trim",[],()=>{{warp(()=>{{
  if((listLength("lm_hist") as number)+{RESERVE}>{ctx}){{
    repeatUntil((listLength("lm_hist") as number)+{RESERVE}<={ctx},()=>{{
      deleteListItem("lm_hist","any",1);
      repeatUntil((listLength("lm_hist") as number)===0||item("lm_hist",1)===0,()=>{{deleteListItem("lm_hist","any",1);}});
    }});
    setVar("lm_position",0);setVar("lm_cursor",1);setVar("lm_phase","忘掉最旧的轮次");
  }}
}});}});
defineProc("lm submit",[],()=>{{warp(()=>{{
  setVar("lm_request",0);setVar("validPrompt",1);
  if(length(getVar("lm_prompt"))===0){{setVar("validPrompt",0);setVar("lm_status","没有输入内容");}}
  if(length(getVar("lm_prompt"))>{MAX_INPUT}){{setVar("validPrompt",0);setVar("lm_status","最多 {MAX_INPUT} 字");}}
  deleteListItem("lm_prompt_tokens","all",1);
  for(let i=1;i<=length(getVar("lm_prompt"));i++){{
    setVar("ch",selectText(getVar("lm_prompt"),i,i));
    setVar("id",(listIndexOf("lm_vocabulary",getVar("ch")) as number)-1);
    if(v("id")<3){{setVar("validPrompt",0);setVar("lm_status",join("词表外的字：",getVar("ch")));}}
    appendList("lm_prompt_tokens",v("id"));
  }}
  if(v("validPrompt")===1){{
    appendList("lm_hist",0);
    for(let i=1;i<=(listLength("lm_prompt_tokens") as number);i++){{appendList("lm_hist",item("lm_prompt_tokens",i));}}
    appendList("lm_hist",2);
    callProc("lm trim");
    callProc("lm wrap",getVar("lm_prompt"),0);setVar("committed",listLength("lm_lines"));
    setVar("lm_reply","");setVar("lm_generated",0);setVar("lm_scroll",0);setVar("genSeconds",0);changeVar("lm_turns",1);
    setVar("lm_rng",v("lm_seed")*7919%2147483647+1);changeVar("lm_seed",1);
    setVar("lm_status","思考中");setVar("lm_stop",0);setVar("lm_running",1);
  }}
}});}});
defineProc("lm finish",[],()=>{{warp(()=>{{
  setVar("lm_running",0);setVar("lm_phase","就绪");
  repeatUntil((listLength("lm_lines") as number)<=v("committed"),()=>{{deleteListItem("lm_lines","last",0);deleteListItem("lm_roles","last",0);}});
  callProc("lm wrap",getVar("lm_reply"),1);setVar("committed",listLength("lm_lines"));
}});}});

onStart(()=>{{
  penUp();hide();timerStart();
  setVar("lm_temperature",{TEMPERATURE});setVar("lm_seed",7);setVar("lm_stop",0);setVar("gotToken",0);setVar("lm_request",0);setVar("lm_reset",0);setVar("mouseWas",0);
  callProc("lm new chat");setVar("lm_status","初始化中");setVar("lm_phase","准备记忆缓存");callProc("lm HUD");
  warp(()=>{{
    deleteListItem("lm_kc","all",1);deleteListItem("lm_vc","all",1);
    for(let i=0;i<{NL * ctx * KVD};i++){{appendList("lm_kc",0);appendList("lm_vc",0);}}
    deleteListItem("lm_x","all",1);deleteListItem("lm_h","all",1);deleteListItem("lm_q","all",1);
    for(let i=0;i<{d};i++){{appendList("lm_x",0);appendList("lm_h",0);appendList("lm_q",0);}}
  }});
  setVar("lm_status","等你开口");setVar("lm_phase","就绪");setVar("lm_dirty",1);setVar("lm_ready",1);
  forever(()=>{{
    setVar("mouseNow",mouseTrigger("down")?1:0);
    if(v("mouseNow")===1&&v("mouseWas")===0&&v("lm_running")===0&&mouseY()<-182&&mouseY()>-218){{ask("想说什么？（只能用常用字）");setVar("lm_prompt",answer());setVar("lm_request",1);}}
    setVar("mouseWas",v("mouseNow"));
    if(v("lm_reset")===1){{setVar("lm_reset",0);callProc("lm new chat");setVar("lm_dirty",1);}}
    if(v("lm_request")===1&&v("lm_running")===0){{callProc("lm submit");setVar("lm_dirty",1);}}
    if(v("lm_running")===1){{
      setVar("tokenStarted",timerValue());
      setVar("lm_input_token",item("lm_hist",v("lm_cursor")));changeVar("lm_cursor",1);
      callProc("lm step");
      if(v("lm_cursor")>(listLength("lm_hist") as number)){{
        setVar("lm_status","回复中");callProc("lm sample");setVar("gotToken",1);
        appendList("lm_hist",v("lm_next_token"));
        if(v("lm_next_token")===1){{setVar("lm_status","该你了");callProc("lm finish");}}
        else {{
          setVar("lm_reply",join(getVar("lm_reply"),listItem("lm_vocabulary","any",v("lm_next_token")+1)));
          changeVar("lm_generated",1);
          if(v("lm_position")>={ctx}-1){{appendList("lm_hist",1);setVar("lm_cursor",1);setVar("lm_position",0);setVar("lm_status","写满了，已截断");callProc("lm finish");}}
        }}
      }} else {{setVar("lm_status","读取上文");}}
      if(v("lm_stop")===1&&v("lm_running")===1){{setVar("lm_stop",0);appendList("lm_hist",1);setVar("lm_status","已停止");callProc("lm finish");}}
      callProc("lm HUD");
      // 墙钟时间：含采样和界面重绘，<E> 不计入 token 数
      if(v("gotToken")===1){{
        setVar("gotToken",0);setVar("lm_last_seconds",(timerValue() as number)-v("tokenStarted"));
        changeVar("genSeconds",v("lm_last_seconds"));if(v("lm_generated")>0)setVar("lm_rate",v("lm_generated")/v("genSeconds"));
      }}
    }} else {{
      if(v("lm_dirty")===1){{setVar("lm_dirty",0);callProc("lm HUD");}}
      wait(0.03);
    }}
  }});
}});
keyButton("13","输入");
keyButton("78","新对话");
keyButton("84","解码");
keyButton("32","停止");
keyButton("38","↑");
keyButton("40","↓");
keyButton("49","示例一",false);
keyButton("50","示例二",false);
keyButton("51","示例三",false);
onKey("13","up",()=>{{if(v("lm_running")===0){{ask("想说什么？（只能用常用字）");setVar("lm_prompt",answer());setVar("lm_request",1);}}}});
onKey("49","up",()=>{{if(v("lm_running")===0){{setVar("lm_prompt","{PRESETS[0]}");setVar("lm_request",1);}}}});
onKey("50","up",()=>{{if(v("lm_running")===0){{setVar("lm_prompt","{PRESETS[1]}");setVar("lm_request",1);}}}});
onKey("51","up",()=>{{if(v("lm_running")===0){{setVar("lm_prompt","{PRESETS[2]}");setVar("lm_request",1);}}}});
onKey("78","up",()=>{{setVar("lm_reset",1);}});
onKey("84","up",()=>{{if(v("lm_temperature")>0){{setVar("lm_temperature",0);}}else{{setVar("lm_temperature",{TEMPERATURE});}}setVar("lm_dirty",1);}});
onKey("32","up",()=>{{setVar("lm_stop",1);}});
onKey("38","up",()=>{{changeVar("lm_scroll",3);setVar("lm_dirty",1);}});
onKey("40","up",()=>{{changeVar("lm_scroll",-3);if(v("lm_scroll")<0)setVar("lm_scroll",0);setVar("lm_dirty",1);}});
'''
