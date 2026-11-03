"""ANSI stream and grid-alignment regressions for the pen PV builder."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("eisei_pen", ROOT/"tools/build-eisei-pen.py")
pen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pen)


class PenStreamTests(unittest.TestCase):
    def test_incremental_wide_text_erase_and_keyframe(self):
        frames = [
            "\x1b[2J\x1b[1;1H\x1b[38;2;16;32;48mA衛B",
            "\x1b[1;2H  \x1b[2;5H\x1b[38;2;255;0;0m星",
            "\x1b[2J\x1b[1;1H\x1b[38;2;0;255;0mZ",
        ]
        blocks = [zlib.compress(f.encode()) for f in frames]
        offsets = [sum(map(len,blocks[:i])) for i in range(len(blocks))]
        header = json.dumps(dict(cols=6,rows=2,offsets=offsets,sizes=list(map(len,blocks)))).encode()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"probe.anim"
            path.write_bytes(b"ASCIIPV1"+struct.pack("<I",len(header))+header+b"".join(blocks))
            decoded = [grid for _,_,grid in pen.decode_frames(path)]
        self.assertEqual(decoded[0][0][:4], (("A",0x102030),("衛",0x102030),("",0),("B",0x102030)))
        self.assertEqual(decoded[1][0][:4], (("A",0x102030),(" ",0),(" ",0),("B",0x102030)))
        self.assertEqual(decoded[1][1][4:], (("星",0xff0000),("",0)))
        self.assertEqual(decoded[2][0][0], ("Z",0x00ff00))
        self.assertTrue(all(ch == " " for ch,_ in decoded[2][1]))

    def test_color_layers_preserve_absolute_grid_positions(self):
        metrics = json.loads((ROOT/"tools/eisei-font-metrics.json").read_text(encoding="utf-8"))
        row = [(" ",0)]*96
        for col,ch,color in [(0,"i",1),(4,"@",2),(13,"衛",1),(14,"",0),(31,"W",1),(55,".",2),(94,"星",1),(95,"",0)]:
            row[col] = (ch,color)
        expected = [(col*10+(10 if pen.unicodedata.east_asian_width(ch) in ("W","F") else 5),ch,rgb)
                    for col,(ch,rgb) in enumerate(row) if ch.strip() and rgb]
        actual = []
        commands = list(pen.row_commands(row,metrics))
        self.assertEqual(len(commands),2)
        for x,text,rgb,size in commands:
            for ch in text:
                width = metrics[ch]*size/16
                if ch.strip(): actual.append((x+width/2,ch,rgb))
                x += width
        self.assertEqual(len(actual),len(expected))
        for (x,ch,rgb),(want,want_ch,want_rgb) in zip(sorted(actual),sorted(expected)):
            self.assertEqual((ch,rgb),(want_ch,want_rgb))
            self.assertLess(abs(x-want),0.6,"Spacing error must not accumulate along the row")


if __name__ == "__main__":
    unittest.main()
