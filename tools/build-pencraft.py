"""Build a deterministic, editable native-pen voxel survival island."""
import base64
import colorsys
import json
from pathlib import Path
import random
import re
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parent.parent
N,H=16,12
NORMALS=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]

def defer_pen(source):
    def color(match):
        value=match[1]
        hsv=colorsys.rgb_to_hsv(*(int(value[i:i+2],16)/255 for i in (0,2,4)))
        return 'queueColor('+','.join(str(round(n*scale,8)) for n,scale in zip(hsv,[360,100,100]))+')'
    source=re.sub(r'setPenColor\("#([0-9a-fA-F]{6})"\)',color,source)
    for old,new in {'clearDrawing':'queueClear','moveTo':'queueMove','penDown':'queueDown','penUp':'queueUp','setPenSize':'queueSize','setPenEffect':'queueEffect','stampText':'queueText'}.items():
        source=re.sub(r'\b'+old+r'\(',new+'(',source)
    source=source.replace('changeVar("frames",1);','callProc("mc present");')
    return source

def deferred_source(source):
    present=(ROOT/'modules/voxel/present.ts').read_text(encoding='utf8')
    source=defer_pen(source)+'\n'+re.sub(r'^import .*?;\s*','',present,flags=re.M).replace('export function','function')
    for level in range(1,14):
        child='mc paint command' if level==1 else f'mc paint tree {level-1}'
        source+=f'\ndefineProc("mc paint tree {level}",[],()=>{{\nif(v("paintindex")<=v("paintcount")) {{callProc("{child}");callProc("{child}");}}\n}});\n'
    return source

def localize(project):
    """Use public script-variable blocks for single-interpreter scratch data.

    Key handlers communicate through ordinary globals. Native procedure calls
    share the caller's script-variable storage (verified in the official editor).
    """
    keep=set('phase presenting paintcount frames fps ready px py pz yaw pitch hp food clock edits tool durability selected apples enemyalive enemyhp daylight notice hit hitmat mining grounded'.split())
    def blocks(o):
        if isinstance(o,dict):
            if 'type' in o and 'id' in o:yield o
            for v in o.values():yield from blocks(v)
        elif isinstance(o,list):
            for v in o:yield from blocks(v)
    roots=list(blocks(project))
    event_ids=set()
    for b in roots:
        if b['type']=='on_keydown':
            event_ids.update(c.get('fields',{}).get('variable') for c in blocks(b))
    variables=project['variables']['variablesDict']
    local={k:v['name'] for k,v in variables.items() if v['type']!='list' and v['name'] not in keep and k not in event_ids}
    scratch={k:v['name'] for k,v in variables.items() if v['type']=='list' and v['name'] not in ['bag']}
    for b in roots:
        field=b.get('fields',{}).get('variable')
        if field in local:
            name=local[field]
            if b['type']=='variables_get':b['type']='script_variables_value';b['fields']={'TEXT':name}
            elif b['type'] in ['variables_set','change_variables']:b['fields']['variable']=json.dumps({'name':name,'type':'NEKO_SCRIPT_VARIABLE_TYPE-957f2554-87af'},separators=(',',':'))
            else:raise ValueError(f'Unsupported local reference {b["type"]}')
        if b['type'] in ['pure_list_get','list_get'] and b.get('fields',{}).get('list') in scratch:
            name=scratch[b['fields']['list']]
            b['type']='script_variables_value';b['fields']={'TEXT':'list_'+name};b.pop('is_shadow',None)
    start=next(b for b in roots if b['type']=='on_running_group_activated')
    tail=start.get('next');last=start
    names=list(local.values())+['list_'+n for n in scratch.values()]
    for batch in range(0,len(names),20):
        group=names[batch:batch+20];bid=f'pc-locals-{batch}'
        declaration={'id':bid,'type':'script_variables','parent_id':last['id'],'shield':False,
            'mutation':'<mutation xmlns="http://www.w3.org/1999/xhtml" items="'+str(len(group))+'">'+''.join(f'<arg name="PARAMS{i}"></arg>' for i in range(len(group)))+'</mutation>',
            'inputs':{f'PARAMS{i}':{'id':f'{bid}-{i}','type':'script_variables_param','parent_id':bid,'fields':{'TEXT':n},'is_output':True,'shield':False} for i,n in enumerate(group)}}
        last['next']=declaration;last=declaration
    for name in scratch.values():
        bid='pc-array-'+name
        init={'id':bid,'type':'variables_set','parent_id':last['id'],'shield':False,
            'fields':{'variable':json.dumps({'name':'list_'+name,'type':'NEKO_SCRIPT_VARIABLE_TYPE-957f2554-87af'},separators=(',',':'))},
            'inputs':{'value':{'id':bid+'-value','type':'temporary_list','parent_id':bid,'is_output':True,'shield':False,
                'mutation':'<mutation xmlns="http://www.w3.org/1999/xhtml" items="0"></mutation>'}}}
        last['next']=init;last=init
        original=next(k for k,n in scratch.items() if n==name)
        if variables[original]['value']:
            # Copy the persisted initial bank once. The mutable working array
            # has no observable list ID and survives across procedure calls.
            cid=bid+'-copy'
            copy={'id':cid,'type':'list_copy','parent_id':last['id'],'shield':False,'inputs':{
                'list':{'id':cid+'-src','type':'pure_list_get','parent_id':cid,'fields':{'list':original},'is_output':True,'shield':False},
                'target_list':{'id':cid+'-dst','type':'script_variables_value','parent_id':cid,'fields':{'TEXT':'list_'+name},'is_output':True,'shield':False}}}
            last['next']=copy;last=copy
    if tail:last['next']=tail;tail['parent_id']=last['id']
    for k in list(local)+[k for k in scratch if not variables[k]['value']]:del variables[k]
    return len(local)

def generate():
    rng=random.Random(1337)
    world=[0]*(N*N*H)
    def put(x,y,z,t):
        if 0<=x<N and 0<=z<N and 0<=y<H:world[x+N*z+N*N*y]=t
    for z in range(N):
        for x in range(N):
            height=3+(z//5)+(1 if x<4 or x>12 else 0)
            if 4<=x<=10 and z<=7:height=3
            for y in range(height+1):
                put(x,y,z,1 if y==height else (2 if y>=height-1 else (6 if y>0 and rng.random()<0.07 else 3)))
    # Accessible initial wood and separated canopies keep the mesh compact.
    for x,z in [(5,7),(11,8),(3,12),(12,13)]:
        ground=max(y for y in range(H) if world[x+N*z+N*N*y]>0)+1
        for y in range(ground,ground+3):put(x,y,z,4)
        for xx in range(x-1,x+2):
            for zz in range(z-1,z+2):put(xx,ground+3,zz,5)
        put(x,ground+4,z,5)
    return world

def mesh(world):
    def block(x,y,z):
        if 0<=x<N and 0<=z<N and 0<=y<H:return world[x+N*z+N*N*y]
        return 0 if y>=H else 3
    faces=[]
    for chunk in range(16):
        x0,z0=chunk%4*4,chunk//4*4
        for d,(nx,ny,nz) in enumerate(NORMALS):
            masks={}
            for y in range(H):
                for z in range(z0,z0+4):
                    for x in range(x0,x0+4):
                        t=block(x,y,z)
                        if not t or block(x+nx,y+ny,z+nz):continue
                        plane,u,v=(x,z,y) if d<2 else ((y,x,z) if d<4 else (z,x,y))
                        # Face-level contact shade, quantized to preserve merges.
                        ao=1 if d==2 else (0.86 if block(x+nx,y+ny+1,z+nz) else 1)
                        masks.setdefault(plane,{})[(u,v)]=(t,ao)
            for plane,mask in masks.items():
                while mask:
                    u,v=min(mask,key=lambda p:(p[1],p[0]));value=mask[(u,v)]
                    w=1
                    while mask.get((u+w,v))==value:w+=1
                    h=1
                    while all(mask.get((u+i,v+h))==value for i in range(w)):h+=1
                    for j in range(h):
                        for i in range(w):del mask[(u+i,v+j)]
                    x,y,z=(plane,v,u) if d<2 else ((u,plane,v) if d<4 else (u,v,plane))
                    faces.append((x,y,z,d,w,h,value[0],chunk,value[1]))
    return faces

def main():
    dest=ROOT/'samples/pencraft.bcmkn'
    # Frontend imports inline functions only. Bundle native procedure modules
    # once, keeping their source files independently type-checkable.
    sources=[ROOT/f'modules/voxel/{name}.ts' for name in ['state','world','render','game']]+[ROOT/'samples/pencraft.ts']
    source='\n'.join(re.sub(r'^import .*?;\s*','',p.read_text(encoding='utf8'),flags=re.M).replace('export function','function') for p in sources)
    # Deferred native pen backend: capture drawing, then present the completed
    # command list without a loop boundary that could expose a partial frame.
    source=deferred_source(source)
    # Native procedure calls do not inherit the caller's warp flag. Each body
    # must explicitly batch its loops, otherwise every edge yields a frame.
    source=re.sub(r'(defineProc\("[^"]+",\[\],\(\)=>\{)(.*?)(\n\}\);)',lambda m:m[1]+'warp(()=>{'+m[2]+'\n});});',source,flags=re.S)
    with tempfile.TemporaryDirectory(prefix='pencraft-',dir='D:/AppData/Local/Temp/opencode') as temp:
        entry=Path(temp)/'main.ts';entry.write_text(source,encoding='utf8')
        subprocess.run([str(ROOT/'target/debug/nekoc.exe'),'compile-ts-bcmkn',str(entry),'--template',str(ROOT/'samples/kitten-n-0.27.4.bcmkn'),'--out',str(dest)],check=True)
    p=json.loads(dest.read_text(encoding='utf8'));world=generate();faces=mesh(world)
    banks={'world':[''.join(map(str,world[i:i+16])) for i in range(0,len(world),16)],'nx':[x for x,y,z in NORMALS],'ny':[y for x,y,z in NORMALS],'nz':[z for x,y,z in NORMALS],
           'shade':[78,58,100,40,86,68],
           'bag':[0,12,0,0,0,0,0],'names':['Grass','Dirt','Stone','Wood','Leaves','Iron','Lantern']}
    for i,name in enumerate(['mx','my','mz','md','mu','mv','mt','mc','ma']):banks[name]=[f[i] for f in faces]
    palette=['#729b42','#987253','#8e969b','#a77d47','#477d45','#af9c83','#f7c66b']
    hsv=[colorsys.rgb_to_hsv(*(int(c[i:i+2],16)/255 for i in (1,3,5))) for c in palette]
    banks.update(hue=[round(h*360,3) for h,s,v in hsv],sat=[round(s*100,3) for h,s,v in hsv],value=[round(v*100,3) for h,s,v in hsv])
    found=set()
    for value in p['variables']['variablesDict'].values():
        if value['type']=='list' and value['name'] in banks:
            value['value']=banks[value['name']];found.add(value['name'])
    missing=set(banks)-found
    if missing:raise ValueError(f'Missing native banks: {missing}')
    p['projectName']='PENCRAFT · 原生画笔生存';p['stageSize']={'width':640,'height':360}
    actor=next(iter(p['actors']['actorsDict'].values()));actor.update(name='Voxel engine',visible=False)
    scene=next(iter(p['scenes']['scenesDict'].values()))
    svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><path fill="#76b9d7" d="M0 0h640v360H0z"/></svg>'
    p['styles']['stylesDict'][scene['currentStyleId']]['url']='data:image/svg+xml;base64,'+base64.b64encode(svg.encode()).decode()
    local_count=localize(p)
    dest.write_text(json.dumps(p,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    report={'world':[N,H,N],'seed':1337,'solidBlocks':sum(t>0 for t in world),'mergedFaces':len(faces),'scriptLocals':local_count,'bytes':dest.stat().st_size}
    dest.with_suffix('.build.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))

if __name__=='__main__':main()
