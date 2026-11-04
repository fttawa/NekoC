"""GPU 训练，只对助手回复计算 loss。每 --eval 步保存 ckpt.pt，--resume 接着训练。"""
import argparse, json, math, os, time
import numpy as np, torch, torch.nn.functional as F
from model import QwenMini, CFG

ap = argparse.ArgumentParser()
ap.add_argument('--steps', type=int, default=40000)
ap.add_argument('--batch', type=int, default=64)
ap.add_argument('--lr', type=float, default=2e-3)
ap.add_argument('--eval', type=int, default=2000)
ap.add_argument('--resume', action='store_true')
ap.add_argument('--x', default='data/x.npy')
ap.add_argument('--y', default='data/y.npy')
a = ap.parse_args()
assert torch.cuda.is_available(), '需要 CUDA GPU'
dev = 'cuda'
torch.manual_seed(0)
x = torch.from_numpy(np.load(a.x).astype(np.int64))
y = torch.from_numpy(np.load(a.y).astype(np.int64))
CFG['vocab'] = len(json.load(open('data/vocab.json', encoding='utf-8')))
held = min(2000, len(x) // 100)
vx, vy, x, y = x[:held], y[:held], x[held:].to(dev), y[held:].to(dev)
m = QwenMini(CFG).to(dev)
print('samples', len(x), 'params', sum(p.numel() for p in m.parameters()), flush=True)
decay = [p for p in m.parameters() if p.dim() >= 2]
other = [p for p in m.parameters() if p.dim() < 2]
opt = torch.optim.AdamW([{'params': decay, 'weight_decay': 0.05}, {'params': other, 'weight_decay': 0.0}],
                        lr=a.lr, betas=(0.9, 0.95), fused=True)
start = 1
if a.resume and os.path.exists('ckpt.pt'):
    ck = torch.load('ckpt.pt', map_location=dev)
    m.load_state_dict(ck['model']); opt.load_state_dict(ck['opt']); start = ck['step'] + 1
    print('resumed at', start, flush=True)


def loss_of(bx, by):
    with torch.autocast('cuda', dtype=torch.bfloat16):
        return F.cross_entropy(m(bx).float().flatten(0, 1), by.flatten(), ignore_index=-1)


@torch.no_grad()
def evaluate():
    m.eval()
    L = [loss_of(vx[i:i + a.batch].to(dev), vy[i:i + a.batch].to(dev)).item() for i in range(0, held, a.batch)]
    m.train(); return sum(L) / len(L)


t0 = time.time(); best = 1e9
for step in range(start, a.steps + 1):
    lr = a.lr * min(1, step / 500) * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * step / a.steps)))
    for g in opt.param_groups: g['lr'] = lr
    i = torch.randint(0, len(x), (a.batch,), device=dev)
    loss = loss_of(x[i], y[i])
    opt.zero_grad(set_to_none=True); loss.backward()
    torch.nn.utils.clip_grad_norm_(m.parameters(), 1.0); opt.step()
    if step % 200 == 0:
        print(f'step {step} loss {loss.item():.3f} lr {lr:.2e} {time.time() - t0:.0f}s', flush=True)
    if step % a.eval == 0 or step == a.steps:
        score = evaluate(); print(f'val {score:.3f}', flush=True)
        state = {'cfg': CFG, 'model': {k: v.cpu() for k, v in m.state_dict().items()}, 'opt': opt.state_dict(), 'step': step}
        torch.save(state, 'ckpt.pt')
        if score < best: best = score; torch.save(state, 'best.pt')
