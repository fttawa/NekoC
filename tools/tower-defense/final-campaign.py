"""Final sector-six native campaign using only ordinary player inputs."""
import json
from pathlib import Path
def key(k,**extra):return dict(key=k,domKey=True,waitMs=250,**extra)
def pad(index):
    xy=[(-330,165),(-320,25),(-310,-175),(-160,-35),(-160,175),(15,55),(15,-175),(180,55),(180,-175),(245,165),(-405,-50),(250,-25)][index-1]
    return dict(click=dict(x=xy[0],y=xy[1]),waitMs=300)
def build(index,kind,upgrades=0):return [key(str(kind)),pad(index)]+[key('u') for _ in range(upgrades)]
def upgrade(index,times):return [pad(index)]+[key('u') for _ in range(times)]
buy=[build(4,1,2)+build(2,3),upgrade(2,2),build(6,4,1),upgrade(6,1)+build(5,2,2),build(8,4,2),build(7,3,2)+build(1,1,2),build(9,4,2)+build(3,3),upgrade(3,2)+build(10,4,1),upgrade(10,1),[]]
before=[key('Enter'),key('6',name='ordinary-sector6',assert_={'mode':2,'gold':280,'waves':10})]+buy[0]+[key('Space',name='first-wave',assert_={'gold':10,'wave':1}),dict(waitMs=1500)]
after=[dict(name='wave-1-clear',until=dict(name='waveActive',value=0),timeout=180000)]
for wave in range(2,11):
    after+=buy[wave-1]+[key('Space',name=f'wave-{wave}',assert_={'wave':wave})]
    if wave<10:after += [dict(name=f'wave-{wave}-clear',until=dict(name='waveActive',value=0),timeout=180000)]
after += [dict(name='sector6-natural-victory',until=dict(name='mode',value=3),timeout=240000,assert_={'stars':3,'lives':20}),key('l',name='sector6-local-record',assert_={'mode':7,'socialRecordCount':1})]
def clean(x):
    if isinstance(x,list):return [clean(v) for v in x]
    if isinstance(x,dict):return {('assert' if k=='assert_' else k):clean(v) for k,v in x.items()}
    return x
p=dict(before=before,benchmark=dict(label='Final sector6 normal starting gold, no injected state',windows=3,windowMs=2000,assert_={'mode':2,'paused':0},activeEnemies=True,validateActorLayers=True),after=after)
Path(__file__).with_name('final-campaign-actions.json').write_text(json.dumps(clean(p),ensure_ascii=False,indent=2)+'\n',encoding='utf8')
