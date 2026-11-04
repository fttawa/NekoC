"""Download 52AI/TinyStoriesZh (1M stories, ~260MB), build a character
vocabulary of the most common chars, keep only stories fully covered by it,
and write data/train.npy, data/val.npy, data/vocab.json."""
import argparse, collections, json, os, tarfile, urllib.request
import numpy as np

URL = 'https://huggingface.co/datasets/52AI/TinyStoriesZh/resolve/main/TinyStories_all_data_zh_1M.tar.gz'
ap = argparse.ArgumentParser()
ap.add_argument('--vocab', type=int, default=1500, help='number of characters (plus <BOS>, <EOS>)')
ap.add_argument('--archive', default='data/zh1m.tar.gz')
a = ap.parse_args()
os.makedirs('data', exist_ok=True)
if not os.path.exists(a.archive):
    print('downloading', URL)
    urllib.request.urlretrieve(URL, a.archive + '.part')
    os.replace(a.archive + '.part', a.archive)

stories = []
with tarfile.open(a.archive) as tar:
    for m in tar:
        if m.isfile() and m.name.endswith('.json'):
            stories += [r['story'].strip() for r in json.load(tar.extractfile(m))]
            print('read', m.name, len(stories), flush=True)
count = collections.Counter()
for s in stories: count.update(s)
vocab = ['<BOS>', '<EOS>'] + sorted(ch for ch, _ in count.most_common(a.vocab))
index = {ch: i for i, ch in enumerate(vocab)}
keep = [s for s in stories if all(ch in index for ch in s)]
ids = []
for s in keep:
    ids.append(0); ids += [index[ch] for ch in s]; ids.append(1)
ids = np.array(ids, dtype=np.uint16)
cut = int(len(ids) * 0.995)
np.save('data/train.npy', ids[:cut]); np.save('data/val.npy', ids[cut:])
json.dump(vocab, open('data/vocab.json', 'w', encoding='utf-8'), ensure_ascii=False)
print(f'stories {len(stories)} kept {len(keep)} tokens {len(ids)} vocab {len(vocab)}')
