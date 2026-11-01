"""Build a self-contained native Kitten N PV from the user's rendered master.

python tools/build-eisei-pv.py --source E:/test/eisei_pv --out samples/eisei_pv.bcmkn
Use --duration 6 --out <temp>/prototype.bcmkn for a small runtime probe.
"""
import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def data_url(path, mime):
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--duration", type=float, default=143.5)
    p.add_argument("--fps", type=int, default=10)
    p.add_argument("--width", type=int, default=480)
    args = p.parse_args()
    if not (0 < args.duration <= 143.5 and 1 <= args.fps <= 30 and args.width > 0 and args.width % 16 == 0):
        p.error("duration must be (0,143.5], FPS 1..30, width a positive multiple of 16")
    master = args.source / "out/eisei_ascii_pv_1080p30.mp4"
    height = args.width * 9 // 16
    count = math.ceil(args.duration * args.fps)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    temp_root = Path("D:/AppData/Local/Temp/opencode")
    with tempfile.TemporaryDirectory(prefix="eisei-", dir=temp_root if temp_root.exists() else None) as tmp:
        tmp = Path(tmp)
        run("ffmpeg", "-v", "error", "-i", master, "-t", args.duration,
            "-vf", f"fps={args.fps},scale={args.width}:{height}:flags=lanczos",
            "-q:v", "3", tmp / "frame-%05d.jpg")
        # Keep the source's muxed audio timing; prefix silence makes cache warmup
        # inaudible and gives a fixed, documented playback countdown.
        run("ffmpeg", "-v", "error", "-i", master, "-vn", "-af",
            f"atrim=duration={args.duration},asetpts=PTS-STARTPTS,adelay=3000:all=1",
            "-c:a", "libmp3lame", "-b:a", "192k", tmp / "song.mp3")
        source = (ROOT / "samples/eisei_pv.ts").read_text(encoding="utf-8")
        source = source.replace('10); // BUILD_FPS', f'{args.fps}); // BUILD_FPS')
        source = source.replace('1435); // BUILD_FRAMES', f'{count}); // BUILD_FRAMES')
        source = source.replace('143.5); // BUILD_DURATION', f'{args.duration}); // BUILD_DURATION')
        (tmp / "player.ts").write_text(source, encoding="utf-8")
        compiler = ROOT / "target/debug" / ("nekoc.exe" if os.name == "nt" else "nekoc")
        run(compiler, "compile-ts-bcmkn", tmp / "player.ts",
            "--template", ROOT / "samples/kitten-n-0.27.4.bcmkn", "--out", tmp / "player.bcmkn")
        project = json.loads((tmp / "player.bcmkn").read_text(encoding="utf-8"))
        project["projectName"] = "衛星 / ASCII PV · Kitten N"
        project["stageSize"] = {"width": 960, "height": 540}
        actor = next(iter(project["actors"]["actorsDict"].values()))
        actor.update(name="PV Player", scale=960 / args.width * 100, visible=False, styles=[])
        styles = project["styles"]["stylesDict"]
        background = next(iter(project["scenes"]["scenesDict"].values()))["currentStyleId"]
        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><path fill="#060616" d="M0 0h960v540H0z"/></svg>'
        styles.clear()
        styles[background] = {"id": background, "name": "Background", "url": "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()}
        frames = sorted(tmp.glob("frame-*.jpg"))
        assert len(frames) == count, (len(frames), count)
        for i, frame in enumerate(frames, 1):
            key = f"eisei-frame-{i:05d}"
            styles[key] = {"id": key, "name": f"{(i-1)/args.fps:.3f}s", "url": data_url(frame, "image/jpeg")}
            actor["styles"].append(key)
        actor["currentStyleId"] = actor["styles"][0]
        project["audios"] = {"audiosDict": {"eisei-song": {"id": "eisei-song", "name": "衛星 — 柿崎ユウタ (3s lead-in)", "url": data_url(tmp / "song.mp3", "audio/mpeg")}}, "sortList": ["eisei-song"], "currentAudioId": "eisei-song"}
        args.out.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        digest = hashlib.sha256()
        with master.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        report = {"source": str(master), "sourceSha256": digest.hexdigest(),
                  "output": str(args.out.resolve()), "duration": args.duration, "fps": args.fps,
                  "width": args.width, "height": height, "frames": count,
                  "decodedRgbaMiB": count * args.width * height * 4 / 1048576,
                  "bytes": args.out.stat().st_size, "audioLeadIn": 3}
        args.out.with_suffix(".build.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
