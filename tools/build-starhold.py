"""Build STARHOLD through NekoC with native actor pools and embedded SVGs."""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PAD_X = [-330,-320,-310,-160,-160,15,15,180,180,245,-405,250]
PAD_Y = [165,25,-175,-35,175,55,-175,55,-175,165,-50,-25]

def expression(name, index):
    return f'(listItem("{name}","any",{index}) as number)'

def source_for(milestone):
    core = (ROOT/'modules/tower-defense/core.ts').read_text(encoding='utf8')
    ui = (ROOT/'modules/tower-defense/ui.ts').read_text(encoding='utf8')
    source = core+'\n'+ui+'\n'
    source = re.sub(r'^import .*?;\s*','',source,flags=re.M).replace('export function','function')
    source += f'''
sprite("Controller",{{visible:false}},()=>{{
 onStart(()=>{{
  hide();setPenLayer("peak","");setVar("milestone",{milestone});setVar("ready",0);setVar("frames",0);
  setVar("mode",0);setVar("level",1);setVar("paused",0);setVar("quality",1);
  setVar("shakeEnabled",1);setVar("shake",0);setVar("selectedTower",1);setVar("selectedPad",0);
  setVar("chooseRequest",0);setVar("clickRequest",0);setVar("fps",0);
  timerReset();timerStart();setVar("lastTime",0);setVar("fpsTime",0);setVar("fpsFrame",0);
  setVar("hudTime",-1);setVar("ready",1);
  forever(()=>{{warp(()=>{{
    setVar("now",timerValue());setVar("dt",getVar("now") as number-getVar("lastTime") as number);
    setVar("lastTime",getVar("now"));
    if((getVar("dt") as number)>0.1){{setVar("dt",0.1);}}
    if((getVar("dt") as number)<0){{setVar("dt",0);}}
    if((getVar("chooseRequest") as number)===1){{setVar("chooseRequest",0);callProc("td choose level");}}
    if((getVar("clickRequest") as number)===1){{setVar("clickRequest",0);callProc("td click");}}
    if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){{callProc("td tick");}}
    if((getVar("now") as number)-(getVar("hudTime") as number)>=0.2){{callProc("td hud");setVar("hudTime",getVar("now"));}}
    changeVar("frames",1);
    if((getVar("now") as number)-(getVar("fpsTime") as number)>=1){{
      setVar("fps",floor(((getVar("frames") as number)-(getVar("fpsFrame") as number))/((getVar("now") as number)-(getVar("fpsTime") as number))));
      setVar("fpsTime",getVar("now"));setVar("fpsFrame",getVar("frames"));
    }}
  }});}});
 }});
 onKey("Enter","up",()=>{{
   if((getVar("mode") as number)===0 || (getVar("mode") as number)===3 || (getVar("mode") as number)===4){{
     if((getVar("milestone") as number)<3){{setVar("level",1);setVar("chooseRequest",1);}}else{{setVar("mode",1);}}
   }}
 }});
 onKey("Space","up",()=>{{setVar("startWave",1);}});
 onKey("p","up",()=>{{if((getVar("mode") as number)===2){{setVar("paused",1-(getVar("paused") as number));}}}});
 onKey("Escape","up",()=>{{setVar("mode",0);setVar("paused",0);}});
 onKey("u","up",()=>{{setVar("upgradeRequest",1);}});
 onKey("x","up",()=>{{setVar("sellRequest",1);}});
 onKey("r","up",()=>{{if((getVar("mode") as number)===3 || (getVar("mode") as number)===4){{setVar("chooseRequest",1);}}}});
 onKey("h","up",()=>{{setVar("mode",5);}});onKey("o","up",()=>{{setVar("mode",6);}});
 onKey("l","up",()=>{{setVar("mode",7);}});onKey("c","up",()=>{{setVar("mode",8);}});
 onKey("q","up",()=>{{setVar("quality",1-(getVar("quality") as number));}});
 onKey("s","up",()=>{{if((getVar("mode") as number)===6){{setVar("shakeEnabled",1-(getVar("shakeEnabled") as number));}}}});
'''
    for i in range(1,7):
        source += f'''onKey("{48+i}","up",()=>{{if((getVar("mode") as number)===1){{setVar("level",{i});setVar("chooseRequest",1);}}
          else if((getVar("mode") as number)===2 && {i}<=4 && ((getVar("milestone") as number)>=2 || {i}===1)){{setVar("selectedTower",{i});}} }});\n'''
    source += '});\n'
    source += '''sprite("Backdrop",{visible:true},()=>{
      onClick(()=>{setVar("clickX",mouseX());setVar("clickY",mouseY());setVar("clickRequest",1);});
      onStart(()=>{scriptVars("lastStyle");setVar("lastStyle",0);show();moveTo(0,0);forever(()=>{
        if((scriptVar("lastStyle") as number)!==(getVar("level") as number)) {setStyle(listItem("mapStyles","any",getVar("level")));setVar("lastStyle",getVar("level"));}
      });});
    });
    sprite("Menu",{visible:true},()=>{
      onClick(()=>{setVar("clickX",mouseX());setVar("clickY",mouseY());setVar("clickRequest",1);});
      onStart(()=>{scriptVars("renderStyle");setVar("renderStyle","");forever(()=>{warp(()=>{
        if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){hide();}
        else {show();moveTo(0,0);setStyle(listItem("menuStyles","any",(getVar("mode") as number)+1));}
      });});});
    });
    '''
    for i in range(1,13):
        typ=expression('tType',i); lev=expression('tLevel',i)
        source += f'''
sprite("Tower {i:02d}",{{visible:false}},()=>{{
 onClick(()=>{{if((getVar("mode") as number)===2 && (getVar("paused") as number)===0){{setVar("selectedPad",{i});if({typ}===0){{setVar("buildRequest",{i});}}}}}});
 onStart(()=>{{scriptVars("lastStyle","styleIndex");setVar("lastStyle",-1);forever(()=>{{warp(()=>{{
  if((getVar("mode") as number)===2){{
   show();moveTo({PAD_X[i-1]},{PAD_Y[i-1]});setVar("styleIndex",0);
   if({typ}>0){{setVar("styleIndex",({typ}-1)*3+{lev});}}
   if((scriptVar("lastStyle") as number)!==(scriptVar("styleIndex") as number)){{
     setStyle(listItem("towerStyles","any",(scriptVar("styleIndex") as number)+1));setVar("lastStyle",scriptVar("styleIndex"));
   }}
  }}else{{hide();}}
 }});}});}});
}});
'''
    for i in range(1,25):
        alive=expression('eAlive',i);typ=expression('eType',i)
        source += f'''
sprite("Enemy {i:02d}",{{visible:false}},()=>{{
 onStart(()=>{{scriptVars("lastStyle");setVar("lastStyle",-1);forever(()=>{{warp(()=>{{
  if((getVar("mode") as number)===2 && {alive}===1){{
   show();moveTo({expression('eX',i)},{expression('eY',i)});
   if((scriptVar("lastStyle") as number)!=={typ}){{setStyle(listItem("enemyStyles","any",{typ}));setVar("lastStyle",{typ});}}
  }}else{{hide();}}
 }});}});}});
}});
'''
    source += '''sprite("Selection",{visible:false},()=>{
 onStart(()=>{forever(()=>{warp(()=>{
  if((getVar("mode") as number)===2 && (getVar("selectedPad") as number)>0){show();moveTo(listItem("padX","any",getVar("selectedPad")),listItem("padY","any",getVar("selectedPad")));}
  else{hide();}
 });});});
});
'''
    return '\n'.join(line.rstrip() for line in source.splitlines())+'\n'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--milestone',type=int,default=1,choices=range(1,6));args=ap.parse_args()
    spec=importlib.util.spec_from_file_location('starhold_assets',ROOT/'tools/tower-defense/assets.py')
    assets=importlib.util.module_from_spec(spec);spec.loader.exec_module(assets)
    assets.generate(ROOT/'assets/tower-defense')
    manifest=json.loads((ROOT/'assets/tower-defense/manifest.json').read_text(encoding='utf8'))
    source=source_for(args.milestone)
    out=ROOT/'samples/starhold.bcmkn'
    with tempfile.TemporaryDirectory(prefix='starhold-',dir='D:/AppData/Local/Temp/opencode') as tmp:
        entry=Path(tmp)/'main.ts';entry.write_text(source,encoding='utf8')
        subprocess.run([str(ROOT/'target/debug/nekoc.exe'),'compile-ts-bcmkn',str(entry),'--template',str(ROOT/'samples/kitten-n-0.27.4.bcmkn'),'--out',str(out)],check=True)
    p=json.loads(out.read_text(encoding='utf8'));p['projectName']='STARHOLD · 星垒';p['stageSize']={'width':900,'height':562}
    # The build contains no external resources; each shared style is embedded.
    styles={}
    entries=manifest.get('assets',manifest)
    if isinstance(entries,list):entries={x['name']:x for x in entries}
    for name,a in entries.items():
        file=ROOT/'assets/tower-defense'/a['file'];sid='td-style-'+name
        styles[sid]={'id':sid,'name':name,'url':'data:image/svg+xml;base64,'+base64.b64encode(file.read_bytes()).decode(),
                     'width':a['width'],'height':a['height'],'centerPoint':{'x':0,'y':0}}
    def sid(name):
        key='td-style-'+name
        if key not in styles:raise KeyError('Missing asset '+name)
        return key
    p['styles']['stylesDict']=styles
    towers=[sid('pad')]+[sid(f'tower-{i}-{j}') for i in range(1,5) for j in range(1,4)]
    enemies=[sid(f'enemy-{i}') for i in range(1,7)]
    menus=[sid('title'),sid('level-select'),sid('pause'),sid('victory'),sid('defeat'),sid('help'),sid('settings'),sid('leaderboard'),sid('messages')]
    maps=[sid(f'map-{i}') for i in range(1,7)]
    for a in p['actors']['actorsDict'].values():
        name=a['name'];a['rotation']=0;a['scale']=100
        if name=='Backdrop':bank=maps
        elif name=='Menu':bank=menus
        elif name.startswith('Tower '):bank=towers
        elif name.startswith('Enemy '):bank=enemies
        elif name=='Selection':bank=[sid('selection')]
        else:bank=[sid('pad')];a['visible']=False
        a['styles']=list(dict.fromkeys(bank));a['currentStyleId']=bank[0]
    scene=next(iter(p['scenes']['scenesDict'].values()));scene['styles']=[sid('map-1')];scene['currentStyleId']=sid('map-1')
    # Official loader instantiates this list in reverse: foreground comes first.
    actors=p['actors']['actorsDict'];priority=lambda k:0 if actors[k]['name']=='Backdrop' else 3 if actors[k]['name']=='Controller' else 2 if actors[k]['name']=='Menu' else 1
    scene['actorIds'].sort(key=priority,reverse=True)
    banks={'padX':PAD_X,'padY':PAD_Y,'towerStyles':towers,'enemyStyles':enemies,'menuStyles':menus,'mapStyles':maps,'bestScore':[0]*6,'bestStars':[0]*6}
    for name in ['eAlive','eType','eHP','eMax','eX','eY','eProgress','eSlow','eFlash']:banks[name]=[0]*24
    for name in ['tType','tLevel','tCooldown','tShot','tTargetX','tTargetY','tSpent']:banks[name]=[0]*12
    for v in p['variables']['variablesDict'].values():
        v['visible']=False
        if v.get('type')=='list' and v['name'] in banks:v['value']=banks[v['name']]
    # Script-variable writes use the official descriptor; setVar otherwise
    # targets a shared global even when a declaration with that name exists.
    locals_by_id={k:v['name'] for k,v in p['variables']['variablesDict'].items() if v['name'] in ['lastStyle','styleIndex','renderStyle']}
    def localize(x):
        if isinstance(x,dict):
            fields=x.get('fields',{});key=fields.get('variable')
            if key in locals_by_id:
                name=locals_by_id[key]
                if x.get('type')=='variables_get':x['type']='script_variables_value';x['fields']={'TEXT':name}
                elif x.get('type') in ['variables_set','change_variables']:
                    fields['variable']=json.dumps({'name':name,'type':'NEKO_SCRIPT_VARIABLE_TYPE-957f2554-87af'},separators=(',',':'))
            for v in x.values():localize(v)
        elif isinstance(x,list):
            for v in x:localize(v)
    localize(p)
    for key in locals_by_id:del p['variables']['variablesDict'][key]
    data=json.dumps(p,ensure_ascii=False,separators=(',',':')).encode();out.write_bytes(data)
    (ROOT/'samples/starhold.ts').write_text(source,encoding='utf8')
    def count(x):
        if isinstance(x,dict):return int('type' in x and 'id' in x)+sum(count(v) for v in x.values())
        if isinstance(x,list):return sum(count(v) for v in x)
        return 0
    report={'milestone':args.milestone,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'actors':len(actors),'styles':len(styles),'blocks':count(p),'renderer':'native SVG actor pool + text-only stamps','networkResources':0}
    (ROOT/'samples/starhold.build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps(report))

if __name__=='__main__':main()
