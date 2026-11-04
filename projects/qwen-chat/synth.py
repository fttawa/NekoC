"""合成“记住用户信息”的多轮对话，和 BELLE 样本混合，写 data/mx.npy、data/my.npy。
chat_eval.py 用到的名字、颜色、城市不进训练集，记忆测试才算数。"""
import json, random
import numpy as np

r = random.Random(1)
vocab = json.load(open('data/vocab.json', encoding='utf-8')); index = {c: i for i, c in enumerate(vocab)}
X, Y = np.load('data/x.npy'), np.load('data/y.npy')
CTX = X.shape[1]; U, E, A = 0, 1, 2
HELD = {'小明', '李华', '王芳', '张伟', '小红', '刘洋', '陈静', '赵雷', '红色', '蓝色', '绿色', '黄色', '紫色', '黑色', '白色', '粉色',
        '北京', '上海', '广州', '成都', '杭州', '南京', '武汉', '西安'}
SUR = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹苏潘葛范彭鲁马方任袁柳唐罗薛雷贺汤龚程林高夏蔡田胡凌霍万'
GIVEN = '伟芳娜敏静丽强磊军洋勇艳杰娟涛超秀霞平刚桂明红华英玲海宁婷云飞鹏浩宇晨阳欣怡佳琪雪梅兰松涛亮'
COLORS = ['橙色', '灰色', '棕色', '青色', '金色', '银色', '天蓝色', '深红色', '浅绿色', '米色', '玫红色', '湖蓝色', '草绿色', '咖啡色']
CITIES = ['天津', '重庆', '苏州', '青岛', '厦门', '长沙', '郑州', '沈阳', '大连', '昆明', '济南', '合肥', '福州', '南昌', '贵阳', '兰州', '太原', '哈尔滨', '宁波', '无锡', '三亚', '拉萨']
PETS = ['猫', '狗', '兔子', '仓鼠', '金鱼', '乌龟', '鹦鹉', '小猫', '小狗']
FOODS = ['面条', '饺子', '火锅', '米饭', '苹果', '西瓜', '蛋糕', '包子', '烤鸭', '草莓', '香蕉', '牛肉', '鸡蛋', '豆腐']
JOBS = ['老师', '医生', '程序员', '厨师', '司机', '学生', '护士', '画家', '记者', '律师', '工程师', '歌手']
HOBBY = ['游泳', '跑步', '画画', '唱歌', '下棋', '钓鱼', '爬山', '读书', '打球', '跳舞', '弹琴', '摄影']


def name():
    while True:
        n = r.choice(SUR) + r.choice(GIVEN) + (r.choice(GIVEN) if r.random() < .5 else '') if r.random() < .7 else r.choice('小阿') + r.choice(GIVEN)
        if n not in HELD: return n


SLOTS = {
    'name': (name, ['我叫{}。', '我的名字是{}。', '你好，我叫{}。', '叫我{}就行。'], ['我叫什么名字？', '我叫什么？', '你还记得我的名字吗？', '我的名字是什么？'], ['你叫{}。', '你的名字是{}。', '你叫{}，我记得。']),
    'age': (lambda: r.choice(['八', '九', '十', '十二', '十五', '十八', '二十', '二十五', '三十', '四十', '五十', '六十']) + '岁', ['我今年{}。', '我{}了。'], ['我今年多大？', '我多大了？', '我几岁了？'], ['你今年{}。', '你{}了。']),
    'color': (lambda: r.choice(COLORS), ['我最喜欢的颜色是{}。', '我喜欢{}。'], ['我最喜欢什么颜色？', '我喜欢什么颜色？'], ['你最喜欢{}。', '你喜欢的颜色是{}。']),
    'city': (lambda: r.choice(CITIES), ['我住在{}。', '我家在{}。', '我在{}生活。'], ['我住在哪里？', '我家在哪？', '我住哪儿？'], ['你住在{}。', '你家在{}。']),
    'pet': (lambda: r.choice(PETS), ['我养了一只{}。', '我家有一只{}。'], ['我养了什么？', '我家有什么宠物？'], ['你养了一只{}。', '你家有一只{}。']),
    'food': (lambda: r.choice(FOODS), ['我最爱吃{}。', '我喜欢吃{}。'], ['我最爱吃什么？', '我喜欢吃什么？'], ['你最爱吃{}。', '你喜欢吃{}。']),
    'job': (lambda: r.choice(JOBS), ['我是一名{}。', '我的工作是{}。'], ['我是做什么的？', '我的工作是什么？'], ['你是一名{}。', '你的工作是{}。']),
    'hobby': (lambda: r.choice(HOBBY), ['我平时喜欢{}。', '我的爱好是{}。'], ['我有什么爱好？', '我平时喜欢做什么？'], ['你喜欢{}。', '你的爱好是{}。']),
}
ACK = ['好的，我记住了。', '好的，记住了。', '明白了，我记下了。', '知道了，很高兴认识你。', '好的，还有什么想告诉我的吗？']
SMALL = [('你好', '你好！有什么可以帮你的吗？'), ('今天天气不错。', '是啊，很适合出门走走。'), ('谢谢你', '不客气！'), ('你会做什么？', '我可以陪你聊天，回答一些简单的问题。'),
         ('给我讲个笑话吧', '为什么书很累？因为它有太多的章节要读。'), ('我有点累了。', '那就好好休息一下吧。'), ('一加一等于几？', '一加一等于二。'), ('你觉得读书好吗？', '读书很好，可以学到很多知识。')]


def dialog():
    keys = r.sample(list(SLOTS), r.choice([1, 1, 2, 2, 3]))
    facts = {k: SLOTS[k][0]() for k in keys}
    turns = []
    if len(keys) > 1 and r.random() < .3:  # 一句话说几件事
        turns.append((''.join(r.choice(SLOTS[k][1]).format(facts[k]) for k in keys), r.choice(ACK)))
    else:
        turns += [(r.choice(SLOTS[k][1]).format(facts[k]), r.choice(ACK)) for k in keys]
    asks = [(r.choice(SLOTS[k][2]), r.choice(SLOTS[k][3]).format(facts[k])) for k in r.sample(keys, r.randint(1, len(keys)))]
    for _ in range(r.choice([0, 0, 1, 1, 2])):
        turns.append(r.choice(SMALL))
    # 不知道的事要说不知道，免得模型什么都编
    other = [k for k in SLOTS if k not in keys]
    if r.random() < .25:
        asks.append((r.choice(SLOTS[r.choice(other)][2]), r.choice(['你还没有告诉我。', '这个你没有说过。'])))
    r.shuffle(asks)
    return turns + asks


def encode(turns):
    ids, tgt = [], []
    for q, a in turns:
        u = [U] + [index[c] for c in q] + [A]; ids += u; tgt += [-1] * len(u)
        v = [index[c] for c in a] + [E]; ids += v; tgt += v
    x, y = ids[:-1], tgt[1:]
    return x + [E] * (CTX - len(x)), y + [-1] * (CTX - len(y))


SX, SY = [], []
while len(SX) < 60000:
    try:
        a, b = encode(dialog())
    except KeyError:
        continue
    SX.append(a); SY.append(b)
mx = np.concatenate([X, np.array(SX, dtype=np.int16)]); my = np.concatenate([Y, np.array(SY, dtype=np.int16)])
o = np.random.default_rng(0).permutation(len(mx))
np.save('data/mx.npy', mx[o]); np.save('data/my.npy', my[o])
print('mixed', len(mx), 'synthetic', len(SX))
for t in dialog(): print(t)
