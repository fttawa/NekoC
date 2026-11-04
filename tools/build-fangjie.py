"""方界：生成原创 16×16 材质，编译 modules/fangjie/game.ts，并写入材质列表。"""
import colorsys, json, random, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
S=16
def noisy(base,amp,seed):
    r=random.Random(seed);return [[tuple(max(0,min(255,c+d)) for c in base) for d in [r.randint(-amp,amp)]][0] for _ in range(S*S)]
def put(t,x,y,c): t[(y%S)*S+x%S]=c
def specks(t,color,n,seed,size=2):
    r=random.Random(seed)
    for _ in range(n):
        x,y=r.randint(1,14),r.randint(1,14)
        for i in range(size):
            for j in range(size):
                if r.random()<.8: put(t,x+i,y+j,tuple(max(0,min(255,c+r.randint(-18,18))) for c in color))
    return t
def stone(seed=3):
    t=noisy((122,122,126),12,seed);r=random.Random(seed+1)
    for _ in range(9):
        x,y=r.randrange(S),r.randrange(S)
        for i in range(r.randint(2,5)):put(t,x+i,y,(96,96,101))
    return t
def grass_top(): 
    t=noisy((88,158,62),20,10);return specks(t,(112,186,74),10,11,1)
def dirt(): return specks(noisy((124,86,56),13,12),(92,62,40),9,13,1)
def grass_side():
    t=dirt();r=random.Random(14)
    for x in range(S):
        for y in range(r.randint(3,5)):put(t,x,y,tuple(c+r.randint(-14,14) for c in (92,158,64)))
    return t
def sand(): return specks(noisy((222,206,150),8,15),(198,180,126),8,16,1)
def log_side():
    t=[];r=random.Random(17);bars=[r.randint(-14,14) for _ in range(S)]
    for y in range(S):
        for x in range(S):
            d=bars[x]+r.randint(-5,5);t.append((98+d,70+d,42+d))
    return t
def log_top():
    t=[]
    for y in range(S):
        for x in range(S):
            d=max(abs(x-7.5),abs(y-7.5))
            t.append((92,66,40) if d>6 else (178-int(d)%2*28,140-int(d)%2*26,88-int(d)%2*18))
    return t
def leaves():
    r=random.Random(18);return [None if r.random()<.22 else (44+r.randint(-14,14),122+r.randint(-26,26),46+r.randint(-14,14)) for _ in range(S*S)]
def plank():
    t=[];r=random.Random(19)
    for y in range(S):
        for x in range(S):
            seam=y%4==3 or (x+(y//4)*5)%8==0
            d=r.randint(-7,7);t.append((122,88,50) if seam else (182+d,142+d,88+d))
    return t
def cobble():
    t=[];r=random.Random(20);cells=[(r.randrange(S),r.randrange(S),r.randint(-24,18)) for _ in range(12)]
    for y in range(S):
        for x in range(S):
            ds=sorted((min(abs(x-a),S-abs(x-a))**2+min(abs(y-b),S-abs(y-b))**2,c) for a,b,c in cells)
            v=66 if ds[1][0]-ds[0][0]<5 else 124+ds[0][1]
            t.append((v,v,v+3))
    return t
def ore(color,seed): return specks(stone(seed),color,6,seed+1)
def glass():
    t=[None]*(S*S)
    for i in range(S):
        for p in ((i,0),(i,15),(0,i),(15,i)):put(t,*p,(208,236,240))
    for i in range(5):put(t,4+i,10-i,(236,248,250));put(t,8+i,12-i,(236,248,250))
    return t
def brick():
    t=[];r=random.Random(21)
    for y in range(S):
        for x in range(S):
            seam=y%4==3 or (x+(y//4%2)*4)%8==7
            d=r.randint(-12,12);t.append((176,170,160) if seam else (164+d,78+d//2,62+d//2))
    return t
def water():
    r=random.Random(22);return [None if (x+y)%2 and r.random()<.75 else (46,104+r.randint(-14,14),196+r.randint(-14,14)) for y in range(S) for x in range(S)]
def snow(): return specks(noisy((238,244,248),5,23),(218,228,240),5,24,1)
def snow_side():
    t=dirt();r=random.Random(25)
    for x in range(S):
        for y in range(r.randint(3,5)):put(t,x,y,(238,244,248))
    return t
def bedrock():
    r=random.Random(26);return [(lambda v:(v,v,v))(r.choice((34,48,62,86))) for _ in range(S*S)]
def table_top():
    t=plank()
    for i in range(S):
        put(t,i,5,(88,60,34));put(t,i,10,(88,60,34));put(t,5,i,(88,60,34));put(t,10,i,(88,60,34))
    return t
def table_side():
    t=plank()
    for y in range(3,10):
        for x in range(3,7):put(t,x,y,(96,104,112))
    for y in range(4,12):put(t,11,y,(90,62,36))
    return t
TEX=[grass_top,grass_side,dirt,stone,sand,log_side,log_top,leaves,plank,cobble,
 lambda:ore((36,36,40),30),lambda:ore((214,170,134),32),lambda:ore((246,206,62),34),lambda:ore((96,230,226),36),
 glass,brick,water,snow,snow_side,bedrock,table_top,table_side]
# 每种方块：顶面、侧面、底面（序号见 TEX），下标为方块 id-1
FACES=[(0,1,2),(2,2,2),(3,3,3),(4,4,4),(6,5,6),(7,7,7),(8,8,8),(9,9,9),(10,10,10),(11,11,11),(12,12,12),(13,13,13),(14,14,14),(15,15,15),(16,16,16),(17,18,2),(19,19,19),(20,21,8)]
def main():
    H,Sa,V=[],[],[]
    for make in TEX:
        for c in make():
            if c is None:H.append(-1);Sa.append(0);V.append(0);continue
            h,s,v=colorsys.rgb_to_hsv(*(x/255 for x in c));H.append(round(h*360,1));Sa.append(round(s*100,1));V.append(round(v*100,1))
    src=ROOT/'modules/fangjie/game.ts';out=ROOT/'projects/fangjie/fangjie.bcmkn'
    subprocess.run([str(ROOT/'target/debug/nekoc.exe'),'compile-ts-bcmkn',str(src),'--template',str(ROOT/'samples/kitten-n-0.27.4.bcmkn'),'--out',str(out)],check=True)
    p=json.loads(out.read_text(encoding='utf-8-sig'));p['projectName']='方界'
    names=['草方块','泥土','石头','沙子','原木','树叶','木板','圆石','煤矿石','铁矿石','金矿石','钻石矿石','玻璃','红砖','水','雪块','基岩','工作台']
    hard=[.5,.4,1.4,.4,.9,.2,.8,1.6,1.8,2.4,2.8,3.4,.3,1.6,99,.4,99,1]
    # 产物、产量、原料1、数量、原料2、数量
    recipes=[7,4,5,1,0,0, 18,1,7,4,0,0, 3,4,8,4,9,1, 13,4,4,4,9,1, 14,4,2,4,9,1, 8,1,3,1,0,0]
    help=['W A S D：移动　　空格：跳跃 / 上浮　　R：奔跑','方向键：转动视角（设置里可开启鼠标视角）','F 或按住鼠标左键：挖方块','G：放置快捷栏选中的方块','数字键 1–9：切换快捷栏','E：背包　　C：合成','P：暂停菜单','世界会无限延伸，你改过的方块都会保留','小心高处：摔落会掉血，血量会慢慢恢复']
    banks={'tex_h':H,'tex_s':Sa,'tex_v':V,'block_faces':[f for t in FACES for f in t],'block_names':names,'hardness':hard,'recipes':recipes,'help':help}
    d=p['variables']['variablesDict']
    for name,val in banks.items():
        m=[x for x in d.values() if x['name']==name and x['type']=='list']
        assert len(m)==1,name;m[0]['value']=val
    for x in d.values():x['visible']=False
    out.write_text(json.dumps(p,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print('方界',out.stat().st_size,'字节',len(TEX),'张材质')
main()
