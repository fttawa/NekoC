"""Original synthetic Chinese sentence-completion corpus; no web data or API.

This is a narrow grammar-learning experiment, not a general chat dataset.
Split complete unique documents before tokenization to avoid train/val copies.
"""
import hashlib
import random

ANIMALS = ['小猫', '小狗', '小鸟', '小兔', '小熊', '小鹿']
PLACES = ['花园', '森林', '山上', '河边', '家里', '草地']
WEATHERS = ['晴天', '雨天', '雪天', '春天', '夏天', '秋天', '冬天']
OBJECTS = ['花', '树', '星星', '月亮', '太阳', '云', '小船', '石头']
FEELINGS = ['开心', '快乐', '安静', '温暖']

def documents():
    docs = set()
    for animal in ANIMALS:
        for place in PLACES:
            for obj in OBJECTS:
                for feeling in FEELINGS:
                    docs.add(f'{animal}在{place}看{obj}。它觉得很{feeling}。')
                    docs.add(f'{animal}走到{place}，看见了{obj}。它很{feeling}。')
                    docs.add(f'{animal}喜欢{obj}，也喜欢{place}。')
            for other in ANIMALS:
                if other != animal:
                    docs.add(f'{animal}和{other}一起去{place}玩。它们很开心。')
                    docs.add(f'{animal}在{place}遇见{other}。它们一起看花。')
        for weather in WEATHERS:
            for place in PLACES:
                docs.add(f'今天是{weather}。{animal}在{place}玩。')
                docs.add(f'{weather}到了。{animal}想去{place}看看。')
    for place in PLACES:
        for obj in OBJECTS:
            docs.add(f'夜晚，{place}很安静。天上有星星，还有月亮。')
            docs.add(f'早上，太阳出来了。{place}有{obj}，还有花。')
    ordered = sorted(docs)
    rng = random.Random(20261103)
    rng.shuffle(ordered)
    val = ordered[:len(ordered)//10]
    train = ordered[len(val):]
    return train, val

def corpus_digest(train, val):
    return hashlib.sha256(('TRAIN\n'+'\n'.join(train)+'\nVAL\n'+'\n'.join(val)).encode()).hexdigest()
