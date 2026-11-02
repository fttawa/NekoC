"""Generate reproducible native input scenarios; fixture setters are explicit."""
import json
from pathlib import Path
ROOT=Path(__file__).parent
def key(k,**kw):return dict(key='b' if k=='Escape' else k,domKey=True,waitMs=300,**kw)
def click(x,y,**kw):return dict(click=dict(x=x,y=y),waitMs=350,**kw)
steps=[key('h',name='help',assert_={'mode':5}),key('Escape'),key('o',name='settings'),key('q',name='quality-low',assert_={'quality':0}),key('s',name='shake-off',assert_={'shakeEnabled':0}),key('Escape'),key('Enter',name='six-sectors',assert_={'mode':1})]
for level,(x,y) in enumerate([(-240,55),(0,55),(240,55),(-240,-110),(0,-110),(240,-110)],1):
    steps += [click(x,y,name=f'card-{level}',assert_={'mode':2,'level':level,'waves':[4,5,6,7,8,10][level-1]}),key('Escape'),key('Enter')]
steps += [key('1',name='normal-campaign'),click(-160,-35,name='build-pulse'),key('u'),key('u',name='pulse-max',assertLists={'tLevel':{'3':3}},assert_={'gold':10}),key('Space',name='wave-1'),key('p',name='paused',assert_={'paused':1}),dict(name='pause-stable',waitMs=1000,assert_={'paused':1,'wave':1,'lives':20}),key('p',name='resume',assert_={'paused':0})]
after=[dict(name='wave-1-cleared',until={'name':'waveActive','value':0},timeout=90000),key('3'),click(-320,25,name='nova-earned-gold'),key('Space',name='wave-2'),dict(until={'name':'waveActive','value':0},timeout=90000),click(-320,25),key('u'),key('u'),key('Space',name='wave-3'),dict(until={'name':'waveActive','value':0},timeout=90000),key('Space',name='wave-4'),dict(name='normal-victory',until={'name':'mode','value':3},timeout=90000,assert_={'stars':3,'lives':20}),key('Enter',name='stored-stars',assertLists={'bestStars':{'0':3}}),key('1',name='undefended-reset')]
for wave in range(1,4):
    after += [key('Space',name=f'undefended-wave-{wave}')]
    if wave<3:after += [dict(until={'name':'waveActive','value':0},timeout=90000)]
after += [dict(name='normal-defeat',until={'name':'mode','value':4},timeout=90000,assert_={'stars':0,'lives':0})]
scenario=dict(before=steps,benchmark=dict(label='M3 ordinary-gold level 1 battle after six card/menu checks',windows=3,windowMs=2000,assert_={'mode':2,'paused':0},activeEnemies=True,validateActorLayers=True),after=after)
def clean(value):
    if isinstance(value,dict):return {('assert' if k=='assert_' else k):clean(v) for k,v in value.items()}
    if isinstance(value,list):return [clean(v) for v in value]
    return value
(ROOT/'m3-actions.json').write_text(json.dumps(clean(scenario),ensure_ascii=False,indent=2)+'\n',encoding='utf8')
