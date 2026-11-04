"""Qwen2-style decoder, scaled down: RMSNorm, RoPE (rotate-half), GQA with
q/k/v bias, SwiGLU, tied embeddings. Character vocabulary."""
import math, torch, torch.nn as nn, torch.nn.functional as F

CFG = dict(vocab=1502, d=128, layers=6, heads=4, kv_heads=2, ffn=384, ctx=256,
           theta=10000.0, eps=1e-6)


class RMSNorm(nn.Module):
    def __init__(s, d, eps):
        super().__init__(); s.w = nn.Parameter(torch.ones(d)); s.eps = eps
    def forward(s, x):
        return s.w * x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + s.eps)


def rope_tables(c):
    hd = c['d'] // c['heads']
    inv = 1.0 / (c['theta'] ** (torch.arange(0, hd, 2).double() / hd))
    ang = torch.arange(c['ctx']).double()[:, None] * inv[None, :]  # ctx x hd/2
    return ang.cos(), ang.sin()


def rope(x, cos, sin):  # x: B,H,T,hd
    h = x.shape[-1] // 2
    x1, x2 = x[..., :h], x[..., h:]
    c, s = cos[None, None], sin[None, None]
    return torch.cat([x1 * c - x2 * s, x2 * c + x1 * s], -1)


class Block(nn.Module):
    def __init__(s, c):
        super().__init__()
        d, hd = c['d'], c['d'] // c['heads']
        s.c, s.hd = c, hd
        s.n1 = RMSNorm(d, c['eps']); s.n2 = RMSNorm(d, c['eps'])
        s.q = nn.Linear(d, c['heads'] * hd)
        s.k = nn.Linear(d, c['kv_heads'] * hd)
        s.v = nn.Linear(d, c['kv_heads'] * hd)
        s.o = nn.Linear(c['heads'] * hd, d, bias=False)
        s.gate = nn.Linear(d, c['ffn'], bias=False)
        s.up = nn.Linear(d, c['ffn'], bias=False)
        s.down = nn.Linear(c['ffn'], d, bias=False)

    def forward(s, x, cos, sin):
        B, T, _ = x.shape
        c, hd = s.c, s.hd
        h = s.n1(x)
        q = s.q(h).view(B, T, c['heads'], hd).transpose(1, 2)
        k = s.k(h).view(B, T, c['kv_heads'], hd).transpose(1, 2)
        v = s.v(h).view(B, T, c['kv_heads'], hd).transpose(1, 2)
        q, k = rope(q, cos, sin), rope(k, cos, sin)
        rep = c['heads'] // c['kv_heads']
        k, v = k.repeat_interleave(rep, 1), v.repeat_interleave(rep, 1)
        a = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        x = x + s.o(a.transpose(1, 2).reshape(B, T, -1))
        h = s.n2(x)
        return x + s.down(F.silu(s.gate(h)) * s.up(h))


class QwenMini(nn.Module):
    def __init__(s, c=CFG):
        super().__init__()
        s.c = c
        s.emb = nn.Embedding(c['vocab'], c['d'])
        s.blocks = nn.ModuleList(Block(c) for _ in range(c['layers']))
        s.norm = RMSNorm(c['d'], c['eps'])
        cos, sin = rope_tables(c)
        s.register_buffer('cos', cos.float(), persistent=False)
        s.register_buffer('sin', sin.float(), persistent=False)
        for m in s.modules():
            if isinstance(m, nn.Linear):
                nn.init.normal_(m.weight, std=0.02)
                if m.bias is not None: nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Embedding):
                nn.init.normal_(m.weight, std=0.02)
        for b in s.blocks:  # scaled residual projections
            nn.init.normal_(b.o.weight, std=0.02 / math.sqrt(2 * c['layers']))
            nn.init.normal_(b.down.weight, std=0.02 / math.sqrt(2 * c['layers']))

    def forward(s, idx):
        T = idx.shape[1]
        x = s.emb(idx)
        cos, sin = s.cos[:T], s.sin[:T]
        for b in s.blocks: x = b(x, cos, sin)
        return s.norm(x) @ s.emb.weight.T
