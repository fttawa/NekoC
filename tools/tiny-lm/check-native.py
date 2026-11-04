"""Cross-check official native report logits and generated IDs against NumPy.

Verifier observes output only; this checker runs after playback. It never
injects computed logits, text, model weights or runtime arithmetic.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from reference import Reference,ROOT

def main():
    ap=argparse.ArgumentParser();ap.add_argument('report',type=Path,nargs='?',default=ROOT/'projects/tiny-lm/tiny-lm-verification/report.json');args=ap.parse_args()
    report=json.loads(args.report.read_text(encoding='utf8'));assert report.get('ok'),report.get('failure')
    artifact=Path(report['project']);assert hashlib.sha256(artifact.read_bytes()).hexdigest()==report['projectSha256']
    assert report['nativeEvents']['errors']==[] and report['nativeEvents']['warnings']==[]
    r=Reference();checked=[]
    for case in report['cases']:
        v=case['after']['variables'];lists=case['after']['lists'];r.reset()
        prompt=[0]+[r.ids[c] for c in v['lm_prompt']]
        generated=lists['lm_generated_ids'];temperature=v['lm_temperature'];seed=7
        if temperature:seed=case['before']['variables']['lm_seed']
        for token in prompt:logits=r.step(token)
        expected=[]
        for i in range(len(generated)):
            logits[0]=-1e9
            if temperature:
                probs=r.softmax(logits/temperature);seed=seed*48271%2147483647
                target=seed/2147483647;token=int(np.searchsorted(np.cumsum(probs),target,side='right'))
            else:token=int(np.argmax(logits))
            expected.append(token)
            if i+1<len(generated):logits=r.step(token)
        assert expected==generated,(case['name'],expected,generated)
        # Recompute the last actually consumed input, independent of sampling.
        sequence=(prompt+generated)[:v['lm_last_position']+1]
        r.reset()
        for token in sequence:logits=r.step(token)
        actual=np.array(lists['lm_logits']);max_error=float(np.max(np.abs(logits-actual)))
        assert np.all(np.isfinite(actual)) and max_error<1e-6,(case['name'],max_error)
        assert v['lm_weight_count']==r.model['parameterCount'] and v['lm_vocab_size']==len(r.vocab)
        assert v['lm_output']==''.join(r.vocab[i] for i in generated)
        checked.append({'case':case['name'],'prompt':v['lm_prompt'],'output':v['lm_output'],
            'characters':len(generated),'maxAbsLogitError':max_error,'wallSecondsIncludingPrefill':case['wallSeconds'],
            'tokenSeconds': [x/1000 for x in lists['lm_token_ms']],
            'medianGenerationTokenSeconds':float(np.median(lists['lm_token_ms'][1:]))/1000 if len(generated)>1 else None})
    result={'ok':True,'artifactSha256':report['projectSha256'],'cases':checked,'maxAbsLogitError':max(c['maxAbsLogitError'] for c in checked),
        'nativeErrors':0,'nativeWarnings':0,'externalCompleted':len(report['network']['externalCompleted']),
        'note':'CPU reference evaluated after native playback; no runtime result injection. Browser shell has documented missing editor assets.'}
    args.report.with_name('numerical-parity.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(result,ensure_ascii=True,indent=2))

if __name__=='__main__':main()
