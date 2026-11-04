"""Independent FP64 NumPy inference with and without a KV cache."""
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[2]

class Reference:
    def __init__(self, path=ROOT/'assets/tiny-lm/model.json'):
        self.model=json.loads(Path(path).read_text(encoding='utf8'))
        self.a=self.model['architecture']
        self.w={n:np.array(v['values'],dtype=np.float64).reshape(v['shape']) for n,v in self.model['weights'].items()}
        self.vocab=self.model['vocabulary'];self.ids={c:i for i,c in enumerate(self.vocab)}
        self.reset()
    def reset(self):
        self.keys=[[] for _ in range(self.a['layers'])];self.values=[[] for _ in range(self.a['layers'])];self.pos=0
    def norm(self,x,w):return x/np.sqrt(np.mean(x*x,axis=-1,keepdims=True)+self.a['epsilon'])*w
    @staticmethod
    def softmax(x):
        e=np.exp(x-np.max(x,axis=-1,keepdims=True));return e/e.sum(axis=-1,keepdims=True)
    def step(self,token):
        assert self.pos<self.a['context']
        w=self.w;d=self.a['dim'];heads=self.a['heads'];hd=d//heads
        x=w['token.weight'][token]+w['position.weight'][self.pos]
        for l in range(self.a['layers']):
            p=f'blocks.{l}.';z=self.norm(x,w[p+'n1.weight'])
            q,k,v=[(w[p+n+'.weight']@z).reshape(heads,hd) for n in ['q','k','v']]
            self.keys[l].append(k);self.values[l].append(v)
            keys=np.stack(self.keys[l],axis=1);values=np.stack(self.values[l],axis=1)
            att=self.softmax(np.einsum('hd,htd->ht',q,keys)/np.sqrt(hd))
            ctx=np.einsum('ht,htd->hd',att,values).reshape(d)
            x=x+w[p+'o.weight']@ctx
            z=self.norm(x,w[p+'n2.weight']);x=x+w[p+'down.weight']@np.maximum(w[p+'up.weight']@z,0)
        self.pos+=1
        return w['token.weight']@self.norm(x,w['final.weight'])
    def full(self,tokens):
        w=self.w;d=self.a['dim'];heads=self.a['heads'];hd=d//heads;t=len(tokens)
        x=w['token.weight'][tokens]+w['position.weight'][:t]
        for l in range(self.a['layers']):
            p=f'blocks.{l}.';z=self.norm(x,w[p+'n1.weight'])
            q,k,v=[(z@w[p+n+'.weight'].T).reshape(t,heads,hd).transpose(1,0,2) for n in ['q','k','v']]
            scores=q@k.transpose(0,2,1)/np.sqrt(hd)
            scores[:,np.triu_indices(t,1)[0],np.triu_indices(t,1)[1]]=-np.inf
            a=self.softmax(scores);ctx=(a@v).transpose(1,0,2).reshape(t,d)
            x=x+ctx@w[p+'o.weight'].T
            z=self.norm(x,w[p+'n2.weight']);x=x+np.maximum(z@w[p+'up.weight'].T,0)@w[p+'down.weight'].T
        return self.norm(x,w['final.weight'])@w['token.weight'].T
    def generate(self,prompt='',limit=32,temperature=0,seed=7):
        self.reset();tokens=[0]+[self.ids[c] for c in prompt];result=[]
        for token in tokens:logits=self.step(token)
        for _ in range(min(limit,self.a['context']-len(tokens))):
            logits[0]=-1e9
            if temperature:token=int(np.random.default_rng(seed+len(result)).choice(len(logits),p=self.softmax(logits/temperature)))
            else:token=int(np.argmax(logits))
            if token==1:break
            result.append(token);logits=self.step(token)
        return prompt+''.join(self.vocab[t] for t in result)

if __name__=='__main__':
    r=Reference()
    for p in ['小猫','今天是','夜晚，','小熊在','小兔和小鹿']:
        print(p,'=>',r.generate(p))
