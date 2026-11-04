"""Numerical reference fixtures and honest narrow-domain held-out evaluation."""
import hashlib
import json
from pathlib import Path
import numpy as np
from corpus import documents,corpus_digest
from reference import Reference,ROOT

def main():
    r=Reference();train,val=documents();assert r.model['training']['corpusSha256']==corpus_digest(train,val)
    assert set(train).isdisjoint(val)
    errors=[];losses=[];correct=total=0
    for text in val:
        ids=[0]+[r.ids[c] for c in text]+[1]
        logits=r.full(ids[:-1]);probs=r.softmax(logits)
        losses.extend(-np.log(probs[np.arange(len(ids)-1),ids[1:]]))
        correct+=int((logits.argmax(-1)==ids[1:]).sum());total+=len(ids)-1
    probes=[]
    for prompt in ['', '小猫','今天是','夜晚，','小熊在','小兔和小鹿']:
        ids=[0]+[r.ids[c] for c in prompt];r.reset();all_logits=[]
        for i,token in enumerate(ids):
            cached=r.step(token);full=r.full(ids[:i+1])[-1]
            errors.append(float(np.max(np.abs(cached-full))));all_logits.append(cached.tolist())
        probes.append({'prompt':prompt,'tokens':ids,'logits':all_logits,'greedy':r.generate(prompt),'sample':r.generate(prompt,temperature=.7)})
    report={'modelSha256':hashlib.sha256((ROOT/'assets/tiny-lm/model.json').read_bytes()).hexdigest(),
        'parameters':r.model['parameterCount'],'architecture':r.a,'corpusSha256':corpus_digest(train,val),
        'validation':{'documents':len(val),'tokens':total,'crossEntropyNats':float(np.mean(losses)),
            'perplexity':float(np.exp(np.mean(losses))),'top1Accuracy':correct/total,'uniformBaselineCrossEntropy':float(np.log(len(r.vocab))),
            'scope':'held-out combinations from the same narrow synthetic grammar, NOT general-language benchmark'},
        'kvCacheVsFullMaxAbsError':max(errors),'probes':probes}
    ids=np.random.default_rng(42).integers(0,len(r.vocab),64).tolist();r.reset()
    for token in ids:cached=r.step(token)
    full=r.full(ids)[-1]
    assert np.max(np.abs(cached-full))<1e-10
    report['capacityProbe']={'tokens':ids,'lastLogits':full.tolist(),'scope':'64-token numeric capacity, not a language-quality claim'}
    out=ROOT/'assets/tiny-lm/reference.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    assert report['kvCacheVsFullMaxAbsError']<1e-10
    print(json.dumps({k:v for k,v in report.items() if k!='probes'},indent=2))

if __name__=='__main__':main()
