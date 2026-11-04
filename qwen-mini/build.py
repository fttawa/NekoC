"""ckpt.pt -> out/qwen_mini.bcmkn: quantize, generate blocks, compile with NekoC.
  python build.py --nekoc ../NekoC [--ckpt ckpt.pt] [--greedy] [--prompt 从前，有一只小猫]"""
import argparse, os, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument('--nekoc', required=True, help='path to the NekoC repository (needs cargo, node, npm install)')
ap.add_argument('--ckpt', default='ckpt.pt')
ap.add_argument('--greedy', action='store_true', help='start in greedy decoding instead of sampling')
ap.add_argument('--prompt', action='append', default=[], help='also print the reference greedy continuation')
a = ap.parse_args()
here = os.path.dirname(os.path.abspath(__file__))
py = sys.executable


def run(*cmd): print('>', ' '.join(cmd), flush=True); subprocess.run(cmd, check=True)


run(py, os.path.join(here, 'export.py'), a.ckpt, *a.prompt)
run(py, os.path.join(here, 'gen_ts.py'))
ts = os.path.abspath('out/qwen_mini.ts')
if a.greedy:
    src = open(ts, encoding='utf-8').read().replace('setVar("lm_temperature",0.8);setVar("lm_seed",7)',
                                                    'setVar("lm_temperature",0);setVar("lm_seed",7)')
    open(ts, 'w', encoding='utf-8').write(src)
run('cargo', 'run', '--release', '--quiet', '--manifest-path', os.path.join(os.path.abspath(a.nekoc), 'Cargo.toml'),
    '--bin', 'nekoc', '--', 'compile-ts-bcmkn', ts,
    '--template', os.path.abspath('out/template.bcmkn'), '--out', os.path.abspath('out/qwen_mini.bcmkn'))
print('wrote', os.path.abspath('out/qwen_mini.bcmkn'))
