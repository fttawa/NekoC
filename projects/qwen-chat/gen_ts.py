"""Emit the block program (TypeScript for compile-ts-bcmkn) and its template.
Kernels are loops over the flat weight lists, unrolled by U on the inner
dimension; everything runs in warp so a token spans as many frames as the
player's budget needs."""
import json, numpy as np
import ui

L = json.load(open('layout.json')); C, lay = L['cfg'], L['layout']
vocab = json.load(open('data/vocab.json', encoding='utf-8'))
import os; os.makedirs('out', exist_ok=True)
d, H, KV, hd, FF, ctx, NL, V = C['d'], C['heads'], C['kv_heads'], C['d'] // C['heads'], C['ffn'], C['ctx'], C['layers'], len(vocab)
KVD = KV * hd
U = 8
PARAMS = int(json.load(open('params.json'))['params'])

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
# RoPE on one head of lm_y (+bias) at src (0-based); writes hd values to list dst at dsto (0-based).
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
score_chunks = ''.join('    changeVar("score",' + dot('lm_q', 'v("qb")', 'lm_kc', 'v("kb")', 16, 16 * i + 1) + ');\n' for i in range(hd // 16))
attend = f'''defineProc("lm attend",[],()=>{{warp(()=>{{
  deleteListItem("lm_scores","all",1);setVar("scoreMax",-1000000000);setVar("kb",v("cb"));
  for(let past=0;past<=v("lm_position");past++){{
    setVar("score",0);
{score_chunks}
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


main = ui.build(ctx, NL, KVD, d)

head = '''// Generated by gen_ts.py: a scaled-down Qwen2 decoder in native blocks.
function v(name:string):number {return getVar(name) as number;}
function item(name:string,index:number):number {return listItem(name,"any",index) as number;}
'''
ts = head + matvec('lm mv h', 'lm_h', d, False) + matvec('lm mv ctx', 'lm_ctx', d, True) + \
    matvec('lm mv a', 'lm_a', FF, True) + norm('nw') + rope + attend + ''.join(layer) + step + sample + main
open('out/qwen_chat.ts', 'w', encoding='utf-8').write(ts)

# Template: base.bcmkn (stage and one empty actor) plus this model's lists.
t = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'base.bcmkn'), encoding='utf-8'))
vd = t['variables']['variablesDict']; proto = dict(vd['kn-list-proto'])
for k in list(vd): del vd[k]
def lst(name, vals):
    x = dict(proto); x['id'] = 'kn-list-' + name; x['name'] = name; x['value'] = vals; vd[x['id']] = x
lst('lm_w', np.load('w.npy').astype(int).tolist())
lst('lm_f', np.load('f.npy').tolist())
lst('lm_vocabulary', vocab)
for n in ('lm_x', 'lm_h', 'lm_q', 'lm_y', 'lm_a', 'lm_ctx', 'lm_scores', 'lm_kc', 'lm_vc', 'lm_prompt_tokens', 'lm_lines', 'lm_roles', 'lm_hist'):
    lst(n, [])
t['projectName'] = '迷你 Qwen 聊天'
json.dump(t, open('out/template.bcmkn', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('ts', len(ts), 'bytes')
