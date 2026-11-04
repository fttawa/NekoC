"""Quantize a checkpoint to per-row int8 and lay it out as two flat lists:
lm_w (int8 matrices, row-major) and lm_f (row scales, biases, norm weights,
RoPE tables). Also runs a float64 reference that follows the block arithmetic,
so the VM output can be checked token for token."""
import sys, json, math, numpy as np, torch

ck = torch.load(sys.argv[1] if len(sys.argv) > 1 else 'ckpt.pt', map_location='cpu')
C, sd = ck['cfg'], {k: v.double().numpy() for k, v in ck['model'].items()}
vocab = json.load(open('data/vocab.json', encoding='utf-8'))
d, H, KV, hd, F, ctx = C['d'], C['heads'], C['kv_heads'], C['d'] // C['heads'], C['ffn'], C['ctx']
W, Fl, lay = [], [], {}


def mat(name, m):
    s = np.abs(m).max(1) / 127.0
    s[s == 0] = 1.0
    q = np.clip(np.round(m / s[:, None]), -127, 127).astype(np.int64)
    lay[name] = len(W); W.extend(q.ravel().tolist())
    lay[name + '.s'] = len(Fl); Fl.extend(s.tolist())
    return q * s[:, None]


def vec(name, x):
    lay[name] = len(Fl); Fl.extend(x.tolist()); return x


P = {'emb': mat('emb', sd['emb.weight'])}
for l in range(C['layers']):
    b = f'blocks.{l}.'
    for n in ('q', 'k', 'v', 'o', 'gate', 'up', 'down'):
        P[f'{l}.{n}'] = mat(f'{l}.{n}', sd[b + n + '.weight'])
    for n in ('q', 'k', 'v'):
        P[f'{l}.{n}.b'] = vec(f'{l}.{n}.b', sd[b + n + '.bias'])
    P[f'{l}.n1'] = vec(f'{l}.n1', sd[b + 'n1.w']); P[f'{l}.n2'] = vec(f'{l}.n2', sd[b + 'n2.w'])
P['norm'] = vec('norm', sd['norm.w'])
inv = 1.0 / (C['theta'] ** (np.arange(0, hd, 2) / hd))
ang = np.arange(ctx)[:, None] * inv[None, :]
P['cos'] = vec('cos', np.cos(ang).ravel()); P['sin'] = vec('sin', np.sin(ang).ravel())


def rms(x, w): return x / math.sqrt((x * x).sum() / d + C['eps']) * w


def rope(x, p):
    c, s = np.cos(ang[p]), np.sin(ang[p]); h = hd // 2
    return np.concatenate([x[:h] * c - x[h:] * s, x[h:] * c + x[:h] * s])


class Ref:
    def __init__(s): s.K = np.zeros((C['layers'], ctx, KV * hd)); s.V = s.K.copy(); s.p = 0

    def step(s, t):
        x, p = P['emb'][t].copy(), s.p
        for l in range(C['layers']):
            h = rms(x, P[f'{l}.n1'])
            q = P[f'{l}.q'] @ h + P[f'{l}.q.b']; k = P[f'{l}.k'] @ h + P[f'{l}.k.b']; v = P[f'{l}.v'] @ h + P[f'{l}.v.b']
            q = np.concatenate([rope(q[i * hd:(i + 1) * hd], p) for i in range(H)])
            k = np.concatenate([rope(k[i * hd:(i + 1) * hd], p) for i in range(KV)])
            s.K[l, p], s.V[l, p] = k, v
            out = []
            for i in range(H):
                j = i // (H // KV)
                sc = s.K[l, :p + 1, j * hd:(j + 1) * hd] @ q[i * hd:(i + 1) * hd] / math.sqrt(hd)
                e = np.exp(sc - sc.max()); out.append((e / e.sum()) @ s.V[l, :p + 1, j * hd:(j + 1) * hd])
            x = x + P[f'{l}.o'] @ np.concatenate(out)
            h = rms(x, P[f'{l}.n2']); g = P[f'{l}.gate'] @ h
            x = x + P[f'{l}.down'] @ (g / (1 + np.exp(-g)) * (P[f'{l}.up'] @ h))
        s.p += 1
        return P['emb'] @ rms(x, P['norm'])


def greedy(prompt, n=10**9):
    r = Ref(); ids = [0] + [vocab.index(ch) for ch in prompt]; out = ''
    for t in ids: lg = r.step(t)
    while len(out) < n and r.p < ctx:
        t = int(lg.argmax())
        if t == 1: break
        out += vocab[t]; lg = r.step(t)
    return out


if __name__ == '__main__':
    json.dump({'cfg': C, 'layout': lay, 'w': len(W), 'f': len(Fl)}, open('layout.json', 'w'), indent=1)
    np.save('w.npy', np.array(W, dtype=np.int8)); np.save('f.npy', np.array(Fl))
    json.dump({'params': sum(v.size for v in sd.values())}, open('params.json', 'w'))
    print('int8', len(W), 'floats', len(Fl))
    for pr in sys.argv[2:]: print(pr, '→', greedy(pr))
