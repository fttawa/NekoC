"""Optional PyTorch-to-NumPy export parity check; not needed for playback."""
import json
import numpy as np
import torch
from train import TinyLM
from reference import Reference,ROOT

torch.set_num_threads(2)
r=Reference();model=TinyLM(len(r.vocab)).double().eval()
model.load_state_dict({name:torch.tensor(values,dtype=torch.float64) for name,values in r.w.items()})
errors=[]
with torch.no_grad():
    for text in ['小猫','今天是','夜晚，','小兔和小鹿']:
        ids=[0]+[r.ids[c] for c in text]
        actual=model(torch.tensor([ids]))[0].numpy();expected=r.full(ids)
        errors.append(float(np.max(np.abs(actual-expected))))
    # Exercise the capacity boundary numerically, not as a language-quality test.
    ids=np.random.default_rng(42).integers(0,len(r.vocab),64).tolist()
    expected=model(torch.tensor([ids]))[0].numpy();r.reset()
    cached=np.stack([r.step(token) for token in ids])
    errors.append(float(np.max(np.abs(cached-expected))))
result={'ok':max(errors)<1e-10,'maxAbsLogitError':max(errors),'cases':len(errors),
    'torchVersion':torch.__version__,'scope':'exported weights loaded into FP64 training architecture vs independent full and KV-cache NumPy implementations; includes 64-token capacity boundary'}
assert result['ok']
(ROOT/'assets/tiny-lm/training-parity.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
print(json.dumps(result,indent=2))
