"""BELLE 多轮对话 -> 定长样本。格式：<U>用户<A>助手<E><U>用户<A>助手<E>...
只对助手回复（含 <E>）计算 loss；放不下上下文的对话整段丢弃。
写出 data/x.npy（输入）、data/y.npy（目标，-1 不计 loss）、data/vocab.json。"""
import argparse, collections, json, random, re
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--raw', default='data/raw/belle.json')
ap.add_argument('--vocab', type=int, default=2000)
ap.add_argument('--ctx', type=int, default=256)
ap.add_argument('--max-reply', type=int, default=160)
ap.add_argument('--min-chinese', type=float, default=0.6)
a = ap.parse_args()
U, E, A = 0, 1, 2


def clean(t):
    return re.sub(r'\s+', ' ', t).strip()


def turns(r):
    parts = re.split(r'(Human:|Assistant:)', r['instruction'])
    seq, who = [], None
    for p in parts:
        if p in ('Human:', 'Assistant:'):
            who = p
        elif who:
            seq.append((who == 'Human:', clean(p)))
    if not seq or seq[-1][0]:
        return None
    seq[-1] = (False, clean(r['output']))
    pairs = []
    for i in range(0, len(seq) - 1, 2):
        if not seq[i][0] or seq[i + 1][0]:
            return None
        pairs.append((seq[i][1], seq[i + 1][1]))
    return pairs


def chinese(t):
    return sum('一' <= c <= '鿿' for c in t) / max(len(t), 1)


dialogs = []
for line in open(a.raw, encoding='utf-8'):
    p = turns(json.loads(line))
    if p and all(q and r for q, r in p):
        dialogs.append(p)
print('parsed', len(dialogs), flush=True)
count = collections.Counter()
for p in dialogs:
    for q, r in p:
        count.update(q); count.update(r)
vocab = ['<U>', '<E>', '<A>'] + sorted(c for c, _ in count.most_common(a.vocab))
index = {c: i for i, c in enumerate(vocab)}
X, Y = [], []
seen = set()
multi = 0
for p in dialogs:
    # 最后一轮是这段语料的目标，太长或不在词表就整段丢弃
    q, r = p[-1]
    if len(r) > a.max_reply:
        continue
    kept = []
    size = 1
    for q, r in reversed(p):
        n = len(q) + len(r) + 3
        if size + n > a.ctx or any(c not in index for c in q + r) or chinese(q + r) < a.min_chinese:
            break
        kept.insert(0, (q, r)); size += n
    # 截断会让“上述文章”这类指代失去上文，只留完整放得下的对话
    if len(kept) != len(p):
        continue
    key = ''.join(q + r for q, r in kept)
    if key in seen:
        continue
    seen.add(key)
    ids, tgt = [], []
    for q, r in kept:
        u = [U] + [index[c] for c in q] + [A]
        ids += u; tgt += [-1] * len(u)
        rid = [index[c] for c in r] + [E]
        ids += rid; tgt += rid
    # 目标错开一位：读到 <A> 时预测回复第一个字
    x = ids[:-1]; y = tgt[1:]
    pad = a.ctx - len(x)
    X.append(x + [E] * pad); Y.append(y + [-1] * pad)
    multi += len(kept) > 1
order = list(range(len(X)))
random.Random(0).shuffle(order)
X = np.array(X, dtype=np.int16)[order]; Y = np.array(Y, dtype=np.int16)[order]
np.save('data/x.npy', X); np.save('data/y.npy', Y)
json.dump(vocab, open('data/vocab.json', 'w', encoding='utf-8'), ensure_ascii=False)
print(f'samples {len(X)} multi-turn {multi} vocab {len(vocab)} reply-chars {(Y >= 0).sum()}')
for i in range(3):
    print(''.join(vocab[t] for t in X[i] if True).split('<E><E>')[0][:200])
