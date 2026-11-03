"""Decode ANSI character frames into native list-driven pen text commands."""
import argparse
import base64
import colorsys
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import unicodedata
import zlib

ROOT = Path(__file__).resolve().parent.parent
TOKENS = re.compile(r"\x1b\[([0-9;]*)([A-Za-z])|([^\x1b])", re.S)


def row_commands(row, metrics):
    """Overlay same-color glyphs with measured, error-corrected Unicode spacing.

    Every glyph is placed against its absolute grid coordinate: rounding errors
    never accumulate across a row. Spaces break kerning between adjacent glyphs.
    """
    size = 14
    scale = size / 16
    spaces = [(ch, metrics[ch]*scale) for ch in ("\u2002", "\u2009", "\u200a")]

    @lru_cache(maxsize=8192)
    def padding(distance):
        best = None
        for a in range(max(0, int(distance/spaces[0][1])-2), int(distance/spaces[0][1])+1):
            for b in range(5):
                rest = distance-a*spaces[0][1]-b*spaces[1][1]
                c = max(0, round(rest/spaces[2][1]))
                advance = a*spaces[0][1]+b*spaces[1][1]+c*spaces[2][1]
                candidate = (abs(advance-distance), a+b+c, a,b,c,advance)
                if best is None or candidate < best: best = candidate
        _,_,a,b,c,advance = best
        return spaces[0][0]*a+spaces[1][0]*b+spaces[2][0]*c, advance

    groups = {}
    for col,(ch,rgb) in enumerate(row):
        if not ch.strip() or rgb == 0: continue
        wide = unicodedata.east_asian_width(ch) in ("W","F")
        width = metrics.get(ch,16 if wide else 10)*scale
        x = col*10+(20 if wide else 10)/2-width/2
        groups.setdefault(rgb,[]).append((x,ch,width))
    for rgb,glyphs in sorted(groups.items()):
        start, text, advance = glyphs[0]
        cursor = start+advance
        for x,ch,width in glyphs[1:]:
            if x-cursor < spaces[-1][1]/2:
                yield start,text,rgb,size
                start,text,cursor = x,ch,x+width
            else:
                gap,advance = padding(round(x-cursor,5))
                text += gap+ch
                cursor += advance+width
        yield start,text,rgb,size


def decode_frames(path):
    data = path.read_bytes()
    if data[:8] != b"ASCIIPV1":
        raise ValueError("Not an ASCIIPV1 animation")
    size = struct.unpack_from("<I", data, 8)[0]
    head = json.loads(data[12:12+size])
    base = 12+size
    cols, rows = head["cols"], head["rows"]
    grid = [[(" ", 0)] * cols for _ in range(rows)]
    for f, (off, length) in enumerate(zip(head["offsets"], head["sizes"])):
        text = zlib.decompress(data[base+off:base+off+length]).decode()
        r = c = 0
        color = 0xffffff
        for m in TOKENS.finditer(text):
            ch = m[3]
            if ch is not None:
                wide = unicodedata.east_asian_width(ch) in ("W", "F")
                if 0 <= r < rows and 0 <= c < cols:
                    grid[r][c] = (ch, color if ch != " " else 0)
                    if wide and c+1 < cols:
                        grid[r][c+1] = ("", 0)
                c += 2 if wide else 1
            elif m[2] == "H":
                r, c = (int(v)-1 for v in m[1].split(";"))
            elif m[2] == "J":
                grid = [[(" ", 0)] * cols for _ in range(rows)]
            elif m[2] == "m":
                vals = m[1].split(";")
                if len(vals) == 5 and vals[0] == "38":
                    color = (int(vals[2]) << 16) | (int(vals[3]) << 8) | int(vals[4])
        yield head, f, tuple(tuple(row) for row in grid)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", type=Path, default=Path("E:/test/eisei_pv"))
    ap.add_argument("--out", type=Path, default=ROOT/"samples/eisei_pen.bcmkn")
    ap.add_argument("--cols", type=int, choices=[96,128,160,192], default=96)
    ap.add_argument("--fps", type=int, default=10)
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--duration", type=float, default=143.5)
    args = ap.parse_args()
    if args.fps not in [5,10,15,30] or args.start < 0 or args.duration <= 0 or args.start+args.duration>143.501:
        ap.error("FPS must divide 30; time range must be within 0..143.5")
    rows = args.cols*9//32
    tables = {n:[] for n in ["ep_rows","ep_first","ep_count","ep_x","ep_text","ep_color","ep_size","ep_h","ep_s","ep_v"]}
    row_ids, palette = {}, {}
    metrics = json.loads((ROOT/"tools/eisei-font-metrics.json").read_text(encoding="utf-8")) if (ROOT/"tools/eisei-font-metrics.json").exists() else {}
    begin, end = round(args.start*30), math.ceil((args.start+args.duration)*30)
    for head, f, grid in decode_frames(args.source/f"out/terminal/eisei_{args.cols}x{rows}.anim"):
        if f >= end: break
        if f < begin or (f-begin) % (30//args.fps): continue
        for row in grid:
            # Quantize color to 32 steps; geometry and Unicode are retained.
            row = tuple((ch, sum(min(255,round(((rgb>>shift)&255)/32)*32)<<shift for shift in (16,8,0))) if ch.strip() else (ch,0) for ch,rgb in row)
            if row not in row_ids:
                row_ids[row] = len(row_ids)+1
                tables["ep_first"].append(len(tables["ep_x"])+1)
                count = 0
                for x,text,rgb,size in row_commands(row,metrics):
                    if rgb not in palette:
                        palette[rgb] = len(palette)+1
                        h,s,v = colorsys.rgb_to_hsv((rgb>>16)/255,((rgb>>8)&255)/255,(rgb&255)/255)
                        tables["ep_h"].append(round(h*360,3));tables["ep_s"].append(round(s*100,3));tables["ep_v"].append(round(v*100,3))
                    tables["ep_x"].append(round(x-args.cols*5,4))
                    tables["ep_text"].append(text)
                    tables["ep_color"].append(palette[rgb])
                    tables["ep_size"].append(size)
                    count += 1
                tables["ep_count"].append(count)
            tables["ep_rows"].append(row_ids[row])
    frame_count = len(tables["ep_rows"])//rows
    # Native observer copies array entries on every variable update. Archive
    # frame columns as strings; only the current frame is expanded into lists.
    banks = {"ep_bank_"+n:[] for n in ("rows","first","count","x","text","color")}
    for frame in range(frame_count):
        ids = tables["ep_rows"][frame*rows:(frame+1)*rows]
        columns = {n:[] for n in ("first","count","x","text","color")}
        for rid in ids:
            first,count = tables["ep_first"][rid-1]-1,tables["ep_count"][rid-1]
            columns["first"].append(len(columns["x"])+1)
            columns["count"].append(count)
            assert all(size == 14 for size in tables["ep_size"][first:first+count])
            for n in ("x","text","color"):
                columns[n].extend(tables["ep_"+n][first:first+count])
        columns["rows"] = ids
        for n,values in columns.items():
            separator = "§" if n == "text" else "|"
            encoded = list(map(str,values))
            if any(separator in value for value in encoded):
                raise ValueError(f"Archive delimiter collision in {n}, frame {frame}")
            banks["ep_bank_"+n].append(separator.join(encoded))
    command_count = len(tables["ep_x"])
    tables = {**{n:v for n,v in tables.items() if n in ("ep_h","ep_s","ep_v")},**banks}
    with tempfile.TemporaryDirectory(prefix="eisei-pen-",dir="D:/AppData/Local/Temp/opencode") as temp:
        temp=Path(temp)
        source=(ROOT/"samples/eisei_pen.ts").read_text(encoding="utf-8")
        for name,value in {"ROWS":rows,"FPS":args.fps,"FRAMES":frame_count,"DURATION":args.duration,"WIDTH":args.cols*10,"HEIGHT":rows*20}.items():
            source=source.replace(f"0); // BUILD_{name}",f"{value}); // BUILD_{name}")
        (temp/"player.ts").write_text(source,encoding="utf-8")
        subprocess.run([str(ROOT/"target/debug"/("nekoc.exe" if os.name=="nt" else "nekoc")),"compile-ts-bcmkn",str(temp/"player.ts"),"--template",str(ROOT/"samples/kitten-n-0.27.4.bcmkn"),"--out",str(temp/"player.bcmkn")],check=True)
        project=json.loads((temp/"player.bcmkn").read_text(encoding="utf-8"))
        for variable in project["variables"]["variablesDict"].values():
            if variable["type"] == "list" and variable["name"] in tables:
                variable["value"]=tables[variable["name"]]
        project["projectName"]="衛星 · 原生画笔字符版"
        project["stageSize"]={"width":args.cols*10,"height":rows*20}
        actor=next(iter(project["actors"]["actorsDict"].values()))
        actor.update(name="字符打印机",visible=False)
        scene=next(iter(project["scenes"]["scenesDict"].values()))
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{args.cols*10}" height="{rows*20}"><path fill="#060616" d="M0 0h{args.cols*10}v{rows*20}H0z"/></svg>'
        project["styles"]["stylesDict"][scene["currentStyleId"]]["url"]="data:image/svg+xml;base64,"+base64.b64encode(svg.encode()).decode()
        subprocess.run(["ffmpeg","-v","error","-ss",str(args.start),"-i",str(args.source/"out/terminal/song.wav"),"-af",f"atrim=duration={args.duration},asetpts=PTS-STARTPTS,apad=whole_dur={args.duration},adelay=3000:all=1","-c:a","libmp3lame","-b:a","192k",str(temp/"song.mp3")],check=True)
        project["audios"]={"audiosDict":{"eisei-song":{"id":"eisei-song","name":"衛星 / 柿崎ユウタ","url":"data:audio/mpeg;base64,"+base64.b64encode((temp/"song.mp3").read_bytes()).decode()}},"sortList":["eisei-song"],"currentAudioId":"eisei-song"}
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps(project,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
        report={"frames":frame_count,"cols":args.cols,"rows":rows,"fps":args.fps,"start":args.start,"duration":args.duration,"uniqueRows":len(row_ids),"stampCommandsInRowDictionary":command_count,"palette":len(palette),"bytes":args.out.stat().st_size}
        args.out.with_suffix(".build.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
        print(json.dumps(report))

if __name__=="__main__":main()
