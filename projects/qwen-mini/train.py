"""Train the mini Qwen2 model. Uses CUDA or Apple MPS when available.
Saves ckpt.pt every --eval steps; rerun with --resume to continue."""
import argparse, json, math, os, time
import numpy as np, torch, torch.nn.functional as F
from model import QwenMini, CFG

ap = argparse.ArgumentParser()
ap.add_argument('--steps', type=int, default=10000)
ap.add_argument('--batch', type=int, default=32)
ap.add_argument('--lr', type=float, default=3e-3)
ap.add_argument('--eval', type=int, default=1000)
ap.add_argument('--device', default='auto', help='auto, cpu, cuda, mps')
ap.add_argument('--threads', type=int, default=0, help='CPU threads (0 = torch default)')
ap.add_argument('--resume', action='store_true')
a = ap.parse_args()

dev = a.device
if dev == 'auto':
    dev = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
if a.threads: torch.set_num_threads(a.threads)
torch.manual_seed(0)
B, T = a.batch, CFG['ctx']
train = torch.from_numpy(np.load('data/train.npy').astype(np.int64))
val = torch.from_numpy(np.load('data/val.npy').astype(np.int64))
CFG['vocab'] = len(json.load(open('data/vocab.json', encoding='utf-8')))
m = QwenMini(CFG).to(dev)
print('device', dev, 'params', sum(p.numel() for p in m.parameters()), flush=True)
decay = [p for p in m.parameters() if p.dim() >= 2]
other = [p for p in m.parameters() if p.dim() < 2]
opt = torch.optim.AdamW([{'params': decay, 'weight_decay': 0.1}, {'params': other, 'weight_decay': 0.0}],
                        lr=a.lr, betas=(0.9, 0.95))
start = 1
if a.resume and os.path.exists('ckpt.pt'):
    ck = torch.load('ckpt.pt', map_location=dev)
    m.load_state_dict(ck['model'])
    if 'opt' in ck: opt.load_state_dict(ck['opt'])
    start = ck.get('step', 0) + 1
    print('resumed at step', start, flush=True)
amp = dev == 'cuda'


def window(d, i):
    x = torch.stack([d[j:j + T] for j in i]); y = torch.stack([d[j + 1:j + T + 1] for j in i])
    return x.to(dev), y.to(dev)


def loss_of(x, y):
    with torch.autocast('cuda', dtype=torch.bfloat16, enabled=amp):
        return F.cross_entropy(m(x).float().flatten(0, 1), y.flatten())


@torch.no_grad()
def evaluate():
    m.eval(); g = torch.Generator().manual_seed(1)
    L = [loss_of(*window(val, torch.randint(0, len(val) - T - 1, (B,), generator=g))).item() for _ in range(20)]
    m.train(); return sum(L) / len(L)


t0 = time.time()
for step in range(start, a.steps + 1):
    lr = a.lr * min(1, step / 200) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / a.steps)))
    for g in opt.param_groups: g['lr'] = lr
    loss = loss_of(*window(train, torch.randint(0, len(train) - T - 1, (B,))))
    opt.zero_grad(set_to_none=True); loss.backward()
    torch.nn.utils.clip_grad_norm_(m.parameters(), 1.0); opt.step()
    if step % 100 == 0:
        print(f'step {step} loss {loss.item():.3f} lr {lr:.2e} {time.time() - t0:.0f}s', flush=True)
    if step % a.eval == 0 or step == a.steps:
        print(f'val {evaluate():.3f}', flush=True)
        torch.save({'cfg': CFG, 'model': {k: v.cpu() for k, v in m.state_dict().items()},
                    'opt': opt.state_dict(), 'step': step}, 'ckpt.pt')
