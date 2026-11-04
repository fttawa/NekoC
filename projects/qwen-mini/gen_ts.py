"""Emit the block program (TypeScript for compile-ts-bcmkn) and its template.
Kernels are loops over the flat weight lists, unrolled by U on the inner
dimension; everything runs in warp so a token spans as many frames as the
player's budget needs."""
import json, numpy as np

L = json.load(open('layout.json')); C, lay = L['cfg'], L['layout']
vocab = json.load(open('data/vocab.json', encoding='utf-8'))
import os; os.makedirs('out', exist_ok=True)
d, H, KV, hd, FF, ctx, NL, V = C['d'], C['heads'], C['kv_heads'], C['d'] // C['heads'], C['ffn'], C['ctx'], C['layers'], len(vocab)
KVD = KV * hd
U = 8
PARAMS = int(json.load(open('params.json'))['params'])

BG, CARD, KEY = '#0e1621', '#172331', '#24344a'
ACCENT, TEXT, MUTED, SOFT = '#6ee7c8', '#e8f1fb', '#8aa0b6', '#5d7189'
COLS, ROWS = 32, 10  # output wrap width (chars) and visible lines


def dot(a, ai, b, bi, n, base=0):
    return '+'.join(f'item("{a}",{ai}+{j + base})*item("{b}",{bi}+{j + base})' for j in range(n))


def matvec(name, inp, cols, residual):
    """rows=v(rows); weights from wi, row scales from si (1-based list cursors)."""
    inner = dot('lm_w', 'v("wi")', inp, 'v("c")', U)
    out = ('replaceListItem("lm_x","any",v("ri"),item("lm_x",v("ri"))+v("acc")*item("lm_f",v("si")));changeVar("ri",1);'
           if residual else 'appendList("lm_y",v("acc")*item("lm_f",v("si")));')
    pre = 'setVar("ri",1);' if residual else 'deleteListItem("lm_y","all",1);'
    return f'''defineProc("{name}",[],()=>{{warp(()=>{{
  {pre}
  for(let row=0;row<v("rows");row++){{
    setVar("acc",0);setVar("c",1);
    for(let k=0;k<{cols // U};k++){{changeVar("acc",{inner});changeVar("wi",{U});changeVar("c",{U});}}
    {out}changeVar("si",1);
  }}
}});}});
'''


def norm(nw_var):
    sq = '+'.join(f'item("lm_x",v("c")+{j})*item("lm_x",v("c")+{j})' for j in range(U))
    return f'''defineProc("lm rmsnorm",[],()=>{{warp(()=>{{
  setVar("acc",0);setVar("c",1);
  for(let k=0;k<{d // U};k++){{changeVar("acc",{sq});changeVar("c",{U});}}
  setVar("inv",1/mathFunc("sqrt",v("acc")/{d}+{C['eps']}));
  for(let i=1;i<={d};i++){{replaceListItem("lm_h","any",i,item("lm_x",i)*v("inv")*item("lm_f",v("{nw_var}")+i));}}
}});}});
'''


half = hd // 2
# RoPE on one head of lm_y (+bias) at src (0-based); writes 32 values to list dst at dsto (0-based).
rope = f'''defineProc("lm rope",[],()=>{{warp(()=>{{
  setVar("cosBase",{lay['cos']}+v("lm_position")*{half});setVar("sinBase",{lay['sin']}+v("lm_position")*{half});
  for(let i=1;i<={half};i++){{
    setVar("ra",item("lm_y",v("src")+i)+item("lm_f",v("bias")+v("src")+i));
    setVar("rb",item("lm_y",v("src")+i+{half})+item("lm_f",v("bias")+v("src")+i+{half}));
    setVar("rc",item("lm_f",v("cosBase")+i));setVar("rs",item("lm_f",v("sinBase")+i));
    setVar("r1",v("ra")*v("rc")-v("rb")*v("rs"));setVar("r2",v("rb")*v("rc")+v("ra")*v("rs"));
    if(v("toCache")===1){{replaceListItem("lm_kc","any",v("dst")+i,v("r1"));replaceListItem("lm_kc","any",v("dst")+i+{half},v("r2"));}}
    else {{replaceListItem("lm_q","any",v("dst")+i,v("r1"));replaceListItem("lm_q","any",v("dst")+i+{half},v("r2"));}}
  }}
}});}});
'''

# One query head against the cache of its KV head. qb: 0-based in lm_q; cb: 0-based cache base.
acc_set = ''.join(f'setVar("a{j}",0);' for j in range(hd))
acc_add = ''.join(f'changeVar("a{j}",v("w")*item("lm_vc",v("vb")+{j + 1}));' for j in range(hd))
acc_out = ''.join(f'appendList("lm_ctx",v("a{j}"));' for j in range(hd))
attend = f'''defineProc("lm attend",[],()=>{{warp(()=>{{
  deleteListItem("lm_scores","all",1);setVar("scoreMax",-1000000000);setVar("kb",v("cb"));
  for(let past=0;past<=v("lm_position");past++){{
    setVar("score",({dot('lm_q', 'v("qb")', 'lm_kc', 'v("kb")', 16, 1)}));
    changeVar("score",{dot('lm_q', 'v("qb")', 'lm_kc', 'v("kb")', 16, 17)});
    setVar("score",v("score")*{1 / hd ** 0.5!r});
    appendList("lm_scores",v("score"));if(v("score")>v("scoreMax"))setVar("scoreMax",v("score"));
    changeVar("kb",{KVD});
  }}
  setVar("scoreSum",0);
  for(let i=1;i<=v("lm_position")+1;i++){{
    setVar("e",mathFunc("exp",item("lm_scores",i)-v("scoreMax")));replaceListItem("lm_scores","any",i,v("e"));changeVar("scoreSum",v("e"));
  }}
  {acc_set}setVar("vb",v("cb"));
  for(let i=1;i<=v("lm_position")+1;i++){{
    setVar("w",item("lm_scores",i)/v("scoreSum"));
    {acc_add}
    changeVar("vb",{KVD});
  }}
  {acc_out}
}});}});
'''

layer = []
for l in range(NL):
    cacheL = l * ctx * KVD
    heads = ''.join(
        f'setVar("qb",{i * hd});setVar("cb",{cacheL}+{(i // (H // KV)) * hd});callProc("lm attend");' for i in range(H))
    ropes = ''.join(f'setVar("src",{i * hd});setVar("dst",{i * hd});callProc("lm rope");' for i in range(H))
    kropes = ''.join(
        f'setVar("src",{d + j * hd});setVar("dst",v("cacheRow")+{j * hd});callProc("lm rope");' for j in range(KV))
    layer.append(f'''defineProc("lm layer {l}",[],()=>{{warp(()=>{{
  setVar("nw",{lay[f'{l}.n1']});callProc("lm rmsnorm");
  setVar("rows",{d + 2 * KVD});setVar("wi",{lay[f'{l}.q'] + 1});setVar("si",{lay[f'{l}.q.s'] + 1});callProc("lm mv h");
  setVar("bias",{lay[f'{l}.q.b']});setVar("toCache",0);{ropes}
  setVar("cacheRow",{cacheL}+v("lm_position")*{KVD});setVar("toCache",1);{kropes}
  for(let i=1;i<={KVD};i++){{replaceListItem("lm_vc","any",v("cacheRow")+i,item("lm_y",{d + KVD}+i)+item("lm_f",{lay[f'{l}.q.b'] + d + KVD}+i));}}
  deleteListItem("lm_ctx","all",1);{heads}
  setVar("rows",{d});setVar("wi",{lay[f'{l}.o'] + 1});setVar("si",{lay[f'{l}.o.s'] + 1});callProc("lm mv ctx");
  setVar("nw",{lay[f'{l}.n2']});callProc("lm rmsnorm");
  setVar("rows",{2 * FF});setVar("wi",{lay[f'{l}.gate'] + 1});setVar("si",{lay[f'{l}.gate.s'] + 1});callProc("lm mv h");
  deleteListItem("lm_a","all",1);
  for(let i=1;i<={FF};i++){{setVar("g",item("lm_y",i));appendList("lm_a",v("g")/(1+mathFunc("exp",0-v("g")))*item("lm_y",i+{FF}));}}
  setVar("rows",{d});setVar("wi",{lay[f'{l}.down'] + 1});setVar("si",{lay[f'{l}.down.s'] + 1});callProc("lm mv a");
}});}});
''')

calls = ''.join(f'setVar("lm_phase","第 {l + 1} / {NL} 层");callProc("lm layer {l}");' for l in range(NL))
step = f'''defineProc("lm step",[],()=>{{warp(()=>{{
  setVar("lm_phase","嵌入");
  setVar("wi",{lay['emb']}+v("lm_input_token")*{d});setVar("es",item("lm_f",{lay['emb.s'] + 1}+v("lm_input_token")));
  for(let i=1;i<={d};i++){{replaceListItem("lm_x","any",i,item("lm_w",v("wi")+i)*v("es"));}}
  {calls}
  setVar("lm_phase","输出层");setVar("nw",{lay['norm']});callProc("lm rmsnorm");
  setVar("rows",{V});setVar("wi",{lay['emb'] + 1});setVar("si",{lay['emb.s'] + 1});callProc("lm mv h");
  changeVar("lm_position",1);
}});}});
'''

# Temperature sampling with min-p truncation (drop tokens under 10% of the best).
sample = f'''defineProc("lm sample",[],()=>{{warp(()=>{{
  setVar("bestScore",-1000000000);setVar("lm_next_token",1);
  for(let i=1;i<={V};i++){{if(item("lm_y",i)>v("bestScore")){{setVar("bestScore",item("lm_y",i));setVar("lm_next_token",i-1);}}}}
  if(v("lm_temperature")>0){{
    setVar("probSum",0);setVar("floorLogit",v("bestScore")+v("lm_temperature")*mathFunc("ln",0.1));
    for(let i=1;i<={V};i++){{
      if(item("lm_y",i)>=v("floorLogit")){{changeVar("probSum",mathFunc("exp",(item("lm_y",i)-v("bestScore"))/v("lm_temperature")));}}
    }}
    setVar("lm_rng",(v("lm_rng")*48271)%2147483647);
    setVar("threshold",v("lm_rng")/2147483647*v("probSum"));setVar("cumulative",0);setVar("sampled",0);
    for(let i=1;i<={V};i++){{
      if(v("sampled")===0&&item("lm_y",i)>=v("floorLogit")){{
        changeVar("cumulative",mathFunc("exp",(item("lm_y",i)-v("bestScore"))/v("lm_temperature")));
        if(v("cumulative")>=v("threshold")){{setVar("lm_next_token",i-1);setVar("sampled",1);}}
      }}
    }}
  }}
}});}});
'''


# ---------------- HUD ----------------
def s(t): return '"' + t + '"'
def color(c): return f'setPenColor("{c}");'
def label(x, y, text, size, align='left', c=None):
    return (color(c) if c else '') + f'penUp();moveTo({x},{y});stampText({text},{size},"{align}");'


frame = [color(BG), 'setPenSize(562);moveTo(-450,0);penDown();moveTo(450,0);penUp();',
         label(-420, 240, s('迷你 Qwen 故事机'), 28, 'left', TEXT),
         label(-180, 240, s('Qwen2 结构 · 原生积木'), 18, 'left', ACCENT),
         label(-420, 208, s(f'{NL} 层解码器 · 隐藏 {d} 维 · {H} 查询头 / {KV} KV 头（GQA）· RoPE · SwiGLU · RMSNorm · {PARAMS:,} 个参数 · int8 权重'), 13, 'left', MUTED),
         color(CARD), 'callProc("lm card",-420,186,196,-150);', 'callProc("lm card",216,186,420,-150);',
         'callProc("lm card",-420,-166,420,-246);',
         label(0, -266, s('按 Qwen2 结构缩小、在中文儿童故事上训练的字级小模型；只在 NekoC 播放器里能跑得动，不是通用聊天助手。'), 12, 'center', SOFT)]

wrap = f'''defineProc("lm wrap",[],()=>{{warp(()=>{{
  deleteListItem("lm_lines","all",1);setVar("line","");setVar("wrapText",getVar("lm_output"));
  if(v("lm_running")===1)setVar("wrapText",join(getVar("lm_output"),"▍"));
  for(let i=1;i<=length(getVar("wrapText"));i++){{
    setVar("ch",selectText(getVar("wrapText"),i,i));
    if(getVar("ch")==="\\n"){{appendList("lm_lines",getVar("line"));setVar("line","");}}
    else {{
      setVar("line",join(getVar("line"),getVar("ch")));
      if(length(getVar("line"))>={COLS}){{appendList("lm_lines",getVar("line"));setVar("line","");}}
    }}
  }}
  appendList("lm_lines",getVar("line"));
  setVar("firstLine",(listLength("lm_lines") as number)-{ROWS});if(v("firstLine")<0)setVar("firstLine",0);
}});}});
'''
out_lines = ''.join(
    f'if(v("firstLine")+{i + 1}<=(listLength("lm_lines") as number)){{penUp();moveTo(-396,{78 - i * 23});stampText(listItem("lm_lines","any",v("firstLine")+{i + 1}),18,"left");}}'
    for i in range(ROWS))
content = [label(-396, 160, s('故事开头'), 13, 'left', MUTED),
           label(-396, 130, 'getVar("lm_prompt")', 22, 'left', TEXT),
           label(-396, 100, s('模型续写'), 13, 'left', MUTED),
           'callProc("lm wrap");', color(ACCENT), out_lines,
           label(240, 160, s('状态'), 13, 'left', MUTED),
           label(240, 130, 'getVar("lm_status")', 18, 'left', ACCENT),
           label(240, 104, 'getVar("lm_phase")', 13, 'left', SOFT)]
stats, y = [], 66
for name, value in [('已生成', 'join(v("lm_generated")," 字")'), ('上下文', f'join(v("lm_position")," / {ctx}")'),
                    ('上一字', 'join(floor(v("lm_last_seconds")*1000)," 毫秒")'),
                    ('平均速度', 'join(floor(v("lm_rate")*10)/10," 字/秒")'), ('随机种子', 'v("lm_seed")')]:
    stats += [label(240, y, s(name), 14, 'left', MUTED), label(396, y, value, 14, 'right', TEXT)]; y -= 30
stats += [label(240, y, s('解码'), 14, 'left', MUTED), color(TEXT),
          f'if(v("lm_temperature")===0){{penUp();moveTo(396,{y});stampText("贪心",14,"right");}}else{{penUp();moveTo(396,{y});stampText(join("采样 · 温度 ",v("lm_temperature")),14,"right");}}']
keys = []
def row(y, items):
    x = -396
    for key, desc, stepx in items:
        w = 8 if len(key) == 1 else 18
        keys.append(f'callProc("lm key",{x},{y},{w},"{key}");'); keys.append(label(x + 36 + w, y, s(desc), 14, 'left', TEXT)); x += stepx
PRESETS = ['从前，有一只小猫', '有一天，莉莉', '汤姆和他的狗']
row(-188, [('1', PRESETS[0], 220), ('2', PRESETS[1], 220), ('3', PRESETS[2], 220), ('回车', '自定义开头', 0)])
row(-224, [('R', '换个种子重写', 220), ('T', '切换贪心 / 采样', 220), ('空格', '算完当前字后停止', 0)])

R = 16
hud = f'''defineProc("lm card",["x1","y1","x2","y2"],()=>{{
  setPenSize({2 * R});
  penUp();moveTo(param("x1")+{R},param("y1")-{R});penDown();moveTo(param("x1")+{R},param("y2")+{R});penUp();
  moveTo(param("x2")-{R},param("y1")-{R});penDown();moveTo(param("x2")-{R},param("y2")+{R});penUp();
  setVar("lm_ui_y",param("y1")-{R});
  repeatUntil(getVar("lm_ui_y")<param("y2")+{R},()=>{{
    moveTo(param("x1")+{R},getVar("lm_ui_y"));penDown();moveTo(param("x2")-{R},getVar("lm_ui_y"));penUp();
    changeVar("lm_ui_y",-{2 * R});
  }});
  moveTo(param("x1")+{R},param("y2")+{R});penDown();moveTo(param("x2")-{R},param("y2")+{R});penUp();
}});
defineProc("lm key",["x","y","w","key"],()=>{{
  setPenColor("{KEY}");setPenSize(26);
  penUp();moveTo(param("x")+13,param("y"));penDown();moveTo(param("x")+13+param("w"),param("y"));penUp();
  setPenColor("{ACCENT}");moveTo(param("x")+13+param("w")/2,param("y"));stampText(param("key"),14,"center");
}});
defineProc("lm HUD frame",[],()=>{{warp(()=>{{
  {chr(10).join('  ' + x for x in frame)}
}});}});
defineProc("lm HUD content",[],()=>{{warp(()=>{{
  {chr(10).join('  ' + x for x in content)}
}});}});
defineProc("lm HUD stats",[],()=>{{warp(()=>{{
  {chr(10).join('  ' + x for x in stats)}
  {chr(10).join('  ' + x for x in keys)}
}});}});
defineProc("lm HUD",[],()=>{{warp(()=>{{
  penUp();clearDrawing();callProc("lm HUD frame");callProc("lm HUD content");callProc("lm HUD stats");
}});}});
'''

main = f'''defineProc("lm begin",[],()=>{{warp(()=>{{
  setVar("lm_request",0);setVar("lm_running",0);setVar("lm_output","");setVar("lm_generated",0);
  setVar("lm_position",0);setVar("lm_last_seconds",0);setVar("lm_rate",0);setVar("genSeconds",0);
  setVar("lm_status","读入开头");setVar("lm_phase","分词");setVar("lm_prefill",1);
  deleteListItem("lm_prompt_tokens","all",1);appendList("lm_prompt_tokens",0);
  setVar("validPrompt",1);
  if(length(getVar("lm_prompt"))>64){{setVar("validPrompt",0);setVar("lm_status","开头太长（最多 64 字）");}}
  for(let i=1;i<=length(getVar("lm_prompt"));i++){{
    setVar("ch",selectText(getVar("lm_prompt"),i,i));
    setVar("id",(listIndexOf("lm_vocabulary",getVar("ch")) as number)-1);
    if(v("id")<2){{setVar("validPrompt",0);setVar("lm_status",join("词表外的字：",getVar("ch")));}}
    appendList("lm_prompt_tokens",v("id"));
  }}
  setVar("promptCursor",1);setVar("lm_rng",v("lm_seed")*7919%2147483647+1);
  if(v("validPrompt")===1)setVar("lm_running",1);
  callProc("lm HUD");
}});}});

onStart(()=>{{
  penUp();hide();timerStart();
  setVar("lm_prompt","{PRESETS[0]}");setVar("lm_temperature",0.8);setVar("lm_seed",7);setVar("lm_max_new_tokens",{ctx});
  setVar("lm_running",0);setVar("lm_stop",0);setVar("lm_output","");setVar("lm_generated",0);setVar("lm_position",0);
  setVar("lm_last_seconds",0);setVar("lm_rate",0);setVar("lm_ready",0);
  setVar("lm_status","初始化中");setVar("lm_phase","准备 KV 缓存");callProc("lm HUD");
  warp(()=>{{
    deleteListItem("lm_kc","all",1);deleteListItem("lm_vc","all",1);
    for(let i=0;i<{NL * ctx * KVD};i++){{appendList("lm_kc",0);appendList("lm_vc",0);}}
    deleteListItem("lm_x","all",1);deleteListItem("lm_h","all",1);deleteListItem("lm_q","all",1);
    for(let i=0;i<{d};i++){{appendList("lm_x",0);appendList("lm_h",0);appendList("lm_q",0);}}
  }});
  setVar("lm_ready",1);setVar("lm_request",1);
  forever(()=>{{
    if(v("lm_request")===1){{setVar("lm_stop",0);callProc("lm begin");}}
    if(v("lm_running")===1){{
      setVar("tokenStarted",timerValue());
      if(v("lm_prefill")===1){{setVar("lm_input_token",item("lm_prompt_tokens",v("promptCursor")));changeVar("promptCursor",1);}}
      callProc("lm step");
      if(v("lm_prefill")===1&&v("promptCursor")>(listLength("lm_prompt_tokens") as number))setVar("lm_prefill",0);
      if(v("lm_prefill")===0){{
        setVar("lm_status","生成中");callProc("lm sample");
        setVar("lm_last_seconds",(timerValue() as number)-v("tokenStarted"));
        if(v("lm_next_token")===1){{setVar("lm_running",0);setVar("lm_status","完成 · 故事结束");}}
        else {{
          setVar("lm_output",join(getVar("lm_output"),listItem("lm_vocabulary","any",v("lm_next_token")+1)));
          changeVar("lm_generated",1);setVar("lm_input_token",v("lm_next_token"));
          changeVar("genSeconds",v("lm_last_seconds"));setVar("lm_rate",v("lm_generated")/v("genSeconds"));
          if(v("lm_position")>={ctx}){{setVar("lm_running",0);setVar("lm_status","完成 · 上下文已满");}}
        }}
      }}
      if(v("lm_stop")===1){{setVar("lm_running",0);setVar("lm_status","已停止");setVar("lm_stop",0);}}
      if(v("lm_running")===0)setVar("lm_phase","就绪");
      callProc("lm HUD");
    }} else {{wait(0.05);}}
  }});
}});

onKey("49","up",()=>{{setVar("lm_prompt","{PRESETS[0]}");setVar("lm_request",1);}});
onKey("50","up",()=>{{setVar("lm_prompt","{PRESETS[1]}");setVar("lm_request",1);}});
onKey("51","up",()=>{{setVar("lm_prompt","{PRESETS[2]}");setVar("lm_request",1);}});
onKey("82","up",()=>{{changeVar("lm_seed",1);setVar("lm_request",1);}});
onKey("84","up",()=>{{if(v("lm_temperature")>0){{setVar("lm_temperature",0);}}else{{setVar("lm_temperature",0.8);}}setVar("lm_request",1);}});
onKey("32","up",()=>{{setVar("lm_stop",1);}});
onKey("13","up",()=>{{ask("输入故事开头（只能用词表里的常用字），例如：从前，有一只小兔子");setVar("lm_prompt",answer());setVar("lm_request",1);}});
'''

head = '''// Generated by gen_ts.py: a scaled-down Qwen2 decoder in native blocks.
function v(name:string):number {return getVar(name) as number;}
function item(name:string,index:number):number {return listItem(name,"any",index) as number;}
'''
ts = head + matvec('lm mv h', 'lm_h', d, False) + matvec('lm mv ctx', 'lm_ctx', d, True) + \
    matvec('lm mv a', 'lm_a', FF, True) + norm('nw') + rope + attend + ''.join(layer) + step + sample + wrap + hud + main
open('out/qwen_mini.ts', 'w', encoding='utf-8').write(ts)

# Template: base.bcmkn (stage and one empty actor) plus this model's lists.
t = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'base.bcmkn'), encoding='utf-8'))
vd = t['variables']['variablesDict']; proto = dict(vd['kn-list-proto'])
for k in list(vd): del vd[k]
def lst(name, vals):
    x = dict(proto); x['id'] = 'kn-list-' + name; x['name'] = name; x['value'] = vals; vd[x['id']] = x
lst('lm_w', np.load('w.npy').astype(int).tolist())
lst('lm_f', np.load('f.npy').tolist())
lst('lm_vocabulary', vocab)
for n in ('lm_x', 'lm_h', 'lm_q', 'lm_y', 'lm_a', 'lm_ctx', 'lm_scores', 'lm_kc', 'lm_vc', 'lm_prompt_tokens', 'lm_lines'):
    lst(n, [])
t['projectName'] = '迷你 Qwen 故事机'
json.dump(t, open('out/template.bcmkn', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('ts', len(ts), 'bytes')
