"""Train an actual ~30k-parameter decoder Transformer on local synthetic text.

Usage: <torch-python> tools/tiny-lm/train.py --steps 1800
Only training requires PyTorch. Export, build, inference and parity use NumPy
or native Kitten N blocks; there is no model service or downloaded checkpoint.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import time

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from corpus import documents, corpus_digest

ROOT = Path(__file__).resolve().parents[2]
D, FF, LAYERS, HEADS, CONTEXT = 32, 128, 2, 2, 64

class RMSNorm(nn.Module):
    def __init__(self):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(D))
    def forward(self, x):
        return x * torch.rsqrt(x.square().mean(-1, keepdim=True)+1e-5) * self.weight

class Block(nn.Module):
    def __init__(self):
        super().__init__()
        self.n1, self.n2 = RMSNorm(), RMSNorm()
        self.q = nn.Linear(D,D,bias=False)
        self.k = nn.Linear(D,D,bias=False)
        self.v = nn.Linear(D,D,bias=False)
        self.o = nn.Linear(D,D,bias=False)
        self.up = nn.Linear(D,FF,bias=False)
        self.down = nn.Linear(FF,D,bias=False)
    def forward(self, x):
        z = self.n1(x)
        b,t,_ = z.shape
        q,k,v = [m(z).reshape(b,t,HEADS,D//HEADS).transpose(1,2) for m in [self.q,self.k,self.v]]
        a = F.scaled_dot_product_attention(q,k,v,is_causal=True)
        x = x+self.o(a.transpose(1,2).contiguous().reshape(b,t,D))
        return x+self.down(F.relu(self.up(self.n2(x))))

class TinyLM(nn.Module):
    def __init__(self, vocab):
        super().__init__()
        self.token = nn.Embedding(vocab,D)
        self.position = nn.Embedding(CONTEXT,D)
        self.blocks = nn.ModuleList([Block() for _ in range(LAYERS)])
        self.final = RMSNorm()
        nn.init.normal_(self.token.weight,std=.12)
        nn.init.normal_(self.position.weight,std=.04)
    def forward(self, ids):
        x = self.token(ids)+self.position(torch.arange(ids.shape[1],device=ids.device))
        for block in self.blocks:
            x = block(x)
        return F.linear(self.final(x),self.token.weight)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--steps',type=int,default=1800)
    ap.add_argument('--threads',type=int,default=4)
    ap.add_argument('--out',type=Path,default=ROOT/'assets/tiny-lm/model.json')
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    torch.manual_seed(1337);np.random.seed(1337);random.seed(1337)
    train,val = documents()
    chars = ['<BOS>','<EOS>']+sorted(set(''.join(train+val)))
    encode = {c:i for i,c in enumerate(chars)}
    length = max(map(len,train+val))+1
    assert length < CONTEXT
    def tensor(docs):
        x = torch.zeros((len(docs),length),dtype=torch.long)
        y = torch.full_like(x,-100)
        for i,doc in enumerate(docs):
            ids = [0]+[encode[c] for c in doc]+[1]
            x[i,:len(ids)-1] = torch.tensor(ids[:-1])
            y[i,:len(ids)-1] = torch.tensor(ids[1:])
        return x,y
    tx,ty = tensor(train);vx,vy = tensor(val)
    model = TinyLM(len(chars))
    opt = torch.optim.AdamW(model.parameters(),lr=.003,weight_decay=.01)
    history=[];start=time.perf_counter()
    print(json.dumps({'parameters':sum(p.numel() for p in model.parameters()),'vocab':len(chars),'train':len(train),'val':len(val),'length':length}),flush=True)
    for step in range(args.steps):
        model.train()
        ids = torch.randint(len(tx),(64,))
        logits = model(tx[ids]);loss = F.cross_entropy(logits.reshape(-1,len(chars)),ty[ids].reshape(-1))
        opt.zero_grad(set_to_none=True);loss.backward();nn.utils.clip_grad_norm_(model.parameters(),1.0)
        lr=.0003+.5*(.003-.0003)*(1+math.cos(math.pi*step/args.steps))
        for group in opt.param_groups:group['lr']=lr
        opt.step()
        if step%100==0 or step==args.steps-1:
            model.eval()
            with torch.no_grad():
                vl = F.cross_entropy(model(vx[:256]).reshape(-1,len(chars)),vy[:256].reshape(-1)).item()
            item={'step':step+1,'trainLoss':loss.item(),'valLoss':vl,'seconds':time.perf_counter()-start}
            history.append(item);print(json.dumps(item),flush=True)
    weights={}
    for name,p in model.state_dict().items():
        # Nine decimal places preserve FP32 training weights to sub-micro logit
        # error; export rows in the same output-major order as native matvecs.
        weights[name]={'shape':list(p.shape),'values':np.round(p.detach().cpu().numpy().astype(np.float64),9).reshape(-1).tolist()}
    result={'format':'nekoc-tiny-lm-v1','architecture':{'dim':D,'ff':FF,'layers':LAYERS,'heads':HEADS,'context':CONTEXT,'vocab':len(chars),'epsilon':1e-5,'activation':'relu','norm':'rmsnorm','tiedOutput':True,'bias':False},
        'vocabulary':chars,'parameterCount':sum(p.numel() for p in model.parameters()),'weights':weights,
        'training':{'seed':1337,'steps':args.steps,'batch':64,'dataset':'original local synthetic Chinese grammar; no downloaded text or checkpoint',
            'corpusSha256':corpus_digest(train,val),'trainDocuments':len(train),'validationDocuments':len(val),'split':'unique full documents, shuffled seed 20261103, 10% held out',
            'torchVersion':torch.__version__,'seconds':time.perf_counter()-start,'history':history}}
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(json.dumps({'out':str(args.out),'sha256':hashlib.sha256(args.out.read_bytes()).hexdigest(),'bytes':args.out.stat().st_size}),flush=True)

if __name__=='__main__':main()
