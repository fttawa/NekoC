"""用 ckpt 跑多轮对话和记忆测试。python chat_eval.py [ckpt.pt]"""
import json, sys, torch
from model import QwenMini
ck = torch.load(sys.argv[1] if len(sys.argv) > 1 else 'ckpt.pt', map_location='cuda')
m = QwenMini(ck['cfg']).cuda().eval(); m.load_state_dict(ck['model'])
vocab = json.load(open('data/vocab.json', encoding='utf-8')); index = {c: i for i, c in enumerate(vocab)}
U, E, A = 0, 1, 2


@torch.no_grad()
def reply(hist, q, temp=0.0, n=160):
    hist += [U] + [index[c] for c in q if c in index] + [A]
    out = ''
    while len(out) < n and len(hist) < ck['cfg']['ctx']:
        lg = m(torch.tensor([hist]).cuda())[0, -1]
        t = int(lg.argmax()) if temp == 0 else int(torch.multinomial((lg / temp).softmax(-1), 1))
        hist.append(t)
        if t == E: break
        out += vocab[t]
    return out


CHATS = [['你好，你是谁？', '你能帮我做什么？', '谢谢你'],
         ['推荐一部好看的电影', '它讲的是什么？', '还有别的吗？'],
         ['最近总是失眠怎么办？', '还有其他办法吗？'],
         ['我叫小明，今年十岁。', '我叫什么名字？', '我今年多大？'],
         ['我最喜欢的颜色是红色。', '我最喜欢什么颜色？'],
         ['请帮我写一句关于春天的诗。', '再写一句关于秋天的。']]
for chat in CHATS:
    h = []
    for q in chat:
        print('用户:', q); print('助手:', reply(h, q))
    print()
# 记忆测试：回答里要出现之前说过的信息
TESTS = [(f'我叫{n}。', '我叫什么名字？', n) for n in ['小明', '李华', '王芳', '张伟', '小红', '刘洋', '陈静', '赵雷']]
TESTS += [(f'我最喜欢的颜色是{c}。', '我最喜欢什么颜色？', c) for c in ['红色', '蓝色', '绿色', '黄色', '紫色', '黑色', '白色', '粉色']]
TESTS += [(f'我住在{c}。', '我住在哪里？', c) for c in ['北京', '上海', '广州', '成都', '杭州', '南京', '武汉', '西安']]
hit = 0
for a, b, want in TESTS:
    h = []; reply(h, a); hit += want in reply(h, b)
print(f'记忆测试 {hit}/{len(TESTS)}')
