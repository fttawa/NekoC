"""Original, offline vector artwork for STARHOLD / 星垒.

Public API: generate(outputdir) -> dict[str, dict]. The returned dictionary is
also written to outputdir/manifest.json. Each value contains exactly
{file, width, height, name}; file is relative to outputdir. All SVG viewBoxes
start at (0, 0). Native KN centerPoint is an OFFSET from geometric center:
use {x: 0, y: 0} for these centered costumes, not half the SVG dimensions.
Towers, enemies and projectiles face RIGHT (native direction 90).

Gameplay coordinates are world coordinates, with +y pointing up. MAP_PATH and
PADS are exported for the builder. UI backgrounds leave their main interaction
areas empty for native actors/text. Level cards are centered at world
(-240, 55), (0, 55), (240, 55), (-240, -110), (0, -110), (240, -110).
Title action space is x=0, y=-60 through -215. Panel headings occupy their top
70px. This module uses only Python's standard library and no bitmap renderer.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import random
from xml.sax.saxutils import escape


MAP_PATH = [(-400, 100), (-240, 100), (-240, -110), (-70, -110),
            (-70, 130), (100, 130), (100, -110), (250, -110)]
PADS = [(-330, 165), (-320, 25), (-310, -175), (-160, -35),
        (-160, 175), (15, 55), (15, -175), (180, 55),
        (180, -175), (245, 165), (-405, -50), (250, -25)]
LEVELS = [
    ("晨光哨站", "DAWN OUTPOST", "#4de2d8", "#122b39", "01 / FIRST CONTACT"),
    ("冰蓝廊道", "FROST CORRIDOR", "#7abfff", "#13243e", "02 / COLD FRONT"),
    ("赤砂断层", "EMBER FAULT", "#ffba73", "#33242d", "03 / RED HORIZON"),
    ("紫电峡谷", "VOLT CANYON", "#bf9bff", "#25213f", "04 / ION STORM"),
    ("深空枢纽", "DEEP SPACE HUB", "#73e5f1", "#132b3b", "05 / EVENT HORIZON"),
    ("终焉裂隙", "FINAL RIFT", "#ff7eae", "#302039", "06 / LAST LIGHT"),
]
TOWER_COLORS = ["#6ff8e6", "#9bcfff", "#ffc66f", "#d0a4ff"]
FONT = "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif"
MONO = "'Cascadia Code','Consolas',monospace"


def text(x, y, value, size=12, color="#cbddeb", anchor="start", weight=400,
         tracking=0, mono=False, opacity=1):
    font = MONO if mono else FONT
    return (f'<text x="{x}" y="{y}" fill="{color}" font-family="{font}" '
            f'font-size="{size}" text-anchor="{anchor}" font-weight="{weight}" '
            f'letter-spacing="{tracking}" opacity="{opacity}">{escape(str(value))}</text>')


def polygon(points, fill, stroke="none", width=1, extra=""):
    pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
    return f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="{width}" {extra}/>'


def regular(cx, cy, radius, sides=6, angle=0):
    return [(cx + radius * math.cos(angle + i * math.tau / sides),
             cy + radius * math.sin(angle + i * math.tau / sides)) for i in range(sides)]


def star(cx, cy, outer=11, inner=5):
    return [(cx + (outer if i % 2 == 0 else inner) * math.cos(-math.pi / 2 + i * math.pi / 5),
             cy + (outer if i % 2 == 0 else inner) * math.sin(-math.pi / 2 + i * math.pi / 5))
            for i in range(10)]


def svg(width, height, body, accent="#6ff8e6", title="STARHOLD"):
    # Broad, low-opacity strokes replace blur filters: crisp in the native SVG
    # renderer, inexpensive at game scale, and no external font/image requests.
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" fill="none">
<title>{escape(title)}</title>
<defs>
  <linearGradient id="space" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101e31"/><stop offset=".55" stop-color="#091321"/><stop offset="1" stop-color="#050b15"/></linearGradient>
  <linearGradient id="metal" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#536a80"/><stop offset=".44" stop-color="#243a50"/><stop offset="1" stop-color="#142334"/></linearGradient>
  <linearGradient id="darkmetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#263c51"/><stop offset="1" stop-color="#0b1522"/></linearGradient>
  <linearGradient id="energy" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f0fffd"/><stop offset=".45" stop-color="{accent}"/><stop offset="1" stop-color="{accent}" stop-opacity=".25"/></linearGradient>
  <linearGradient id="trail"><stop stop-color="{accent}" stop-opacity="0"/><stop offset=".66" stop-color="{accent}" stop-opacity=".45"/><stop offset="1" stop-color="#f0fffd"/></linearGradient>
  <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#172c42"/><stop offset="1" stop-color="#0b1627"/></linearGradient>
  <radialGradient id="halo"><stop stop-color="{accent}" stop-opacity=".28"/><stop offset=".5" stop-color="{accent}" stop-opacity=".09"/><stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" stroke="#7aa9c0" stroke-opacity=".055" stroke-width="1"/></pattern>
</defs>
{body}
</svg>
'''


def stars(width=900, height=562, seed=61, count=92):
    rng = random.Random(seed)
    parts = []
    for _ in range(count):
        x, y = rng.uniform(15, width - 15), rng.uniform(15, height - 15)
        radius = rng.choice([.6, .7, 1, 1.2])
        opacity = rng.uniform(.13, .5)
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{radius}" fill="#b9dbea" opacity="{opacity:.2f}"/>')
    return "".join(parts)


def corner_marks(x, y, w, h, color="#79b2c8", length=12, opacity=.6):
    return (f'<path d="M{x} {y+length}V{y}H{x+length}M{x+w-length} {y}H{x+w}V{y+length}'
            f'M{x} {y+h-length}V{y+h}H{x+length}M{x+w-length} {y+h}H{x+w}V{y+h-length}" '
            f'stroke="{color}" stroke-width="1.5" opacity="{opacity}"/>')


def orbital_core(cx, cy, r=54, color="#6ff8e6", compact=False):
    parts = [f'<circle cx="{cx}" cy="{cy}" r="{r*1.6}" fill="url(#halo)"/>',
             f'<circle cx="{cx}" cy="{cy}" r="{r}" stroke="{color}" stroke-width="1" opacity=".23"/>',
             f'<circle cx="{cx}" cy="{cy}" r="{r*.87}" stroke="{color}" stroke-width="{max(2,r*.06)}" stroke-dasharray="{r*.65} {r*.18}" transform="rotate(-22 {cx} {cy})" opacity=".65"/>',
             polygon(regular(cx, cy, r*.7, 6, math.pi/6), "url(#darkmetal)", color, 1.5),
             polygon(regular(cx, cy, r*.53, 6, math.pi/6), "#0c2232", color, .8),
             polygon([(cx, cy-r*.42), (cx+r*.29, cy), (cx, cy+r*.42), (cx-r*.29, cy)], "url(#energy)", "#c8fff7", 1),
             f'<path d="M{cx} {cy-r*.42}V{cy+r*.42}M{cx-r*.29} {cy}H{cx+r*.29}" stroke="#e5fffe" stroke-opacity=".65"/>']
    if not compact:
        for angle in [0, math.pi/2, math.pi, math.pi*1.5]:
            x, y = cx+math.cos(angle)*r*1.2, cy+math.sin(angle)*r*1.2
            parts.append(polygon(regular(x, y, r*.09, 4), color, "none"))
    return "".join(parts)


def battlefield(level):
    _, _, accent, tint, _ = LEVELS[level-1]
    parts = ['<rect width="900" height="562" fill="url(#space)"/>', stars(seed=61+level, count=60),
             '<rect x="10" y="66" width="720" height="435" rx="12" fill="#081421" stroke="#294356"/>',
             f'<rect x="11" y="67" width="718" height="433" rx="11" fill="{tint}" opacity=".32"/>',
             '<rect x="12" y="68" width="716" height="431" rx="10" fill="url(#grid)"/>',
             '<path d="M28 89H104M28 89V130M712 478H636M712 478V437" stroke="#36586a" stroke-width="1"/>']
    # Small raised mechanical islands establish scale without competing with
    # moving units or the twelve interactive pad actors.
    for x, y, w, h in [(70, 422, 42, 49), (245, 205, 58, 39), (410, 292, 68, 51),
                       (585, 331, 45, 32), (466, 83, 42, 24), (603, 78, 46, 15)]:
        parts += [f'<rect x="{x+3}" y="{y+4}" width="{w}" height="{h}" rx="5" fill="#040b14" opacity=".6"/>',
                  f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="#172a3a" stroke="#2d4657" stroke-width=".8"/>',
                  f'<path d="M{x+9} {y+8}H{x+w-9}M{x+9} {y+13}H{x+w-9}" stroke="#3a5161" stroke-width="1" opacity=".6"/>',
                  f'<rect x="{x+7}" y="{y+h-9}" width="{min(w-14,18)}" height="2" fill="{accent}" opacity=".3"/>']
    screen_path = [(x+450, 281-y) for x, y in MAP_PATH]
    d = "M" + "L".join(f"{x},{y}" for x, y in screen_path)
    for width, color, opacity in [(44, "#020810", .8), (38, "#365569", .8),
                                   (35, "#122b3b", 1), (30, accent, .1),
                                   (27, "#102333", 1), (2, accent, .42)]:
        parts.append(f'<path d="{d}" stroke="{color}" stroke-width="{width}" opacity="{opacity}" stroke-linejoin="round" stroke-linecap="round"/>')
    parts.append(f'<path d="{d}" stroke="{accent}" stroke-width="1.2" stroke-dasharray="3 25" opacity=".65"/>')
    # Discrete chevrons make travel direction immediately legible.
    for (ax, ay), (bx, by) in zip(screen_path, screen_path[1:]):
        distance = math.hypot(bx-ax, by-ay)
        angle = math.degrees(math.atan2(by-ay, bx-ax))
        for fraction in ([.5] if distance < 180 else [.34, .7]):
            x, y = ax+(bx-ax)*fraction, ay+(by-ay)*fraction
            parts.append(f'<path d="M-4 -5L1 0L-4 5" stroke="{accent}" stroke-width="1.7" opacity=".65" transform="translate({x} {y}) rotate({angle})"/>')
    parts += ['<path d="M29 160L19 166V196L29 202M35 165L28 170V192L35 197" stroke="#ff8c9f" stroke-width="2"/>',
              '<circle cx="49" cy="181" r="10" fill="#ff7d97" opacity=".14"/>',
              '<path d="M42 175L49 181L42 187" stroke="#ffd1d7" stroke-width="2"/>',
              orbital_core(700, 391, 25, accent, compact=True)]
    for i, (x, y) in enumerate(PADS, 1):
        parts.append(text(x+450, 281-y+33, f"{i:02}", 8, "#78909e", "middle", mono=True, opacity=.6))
    parts += [corner_marks(17, 73, 706, 421, accent, 10, .35),
              '<path d="M741 76V493" stroke="#2b4458" stroke-dasharray="2 6" opacity=".6"/>']
    return svg(900, 562, "".join(parts), accent, f"STARHOLD battlefield {level}")


def tower(kind, level):
    color = TOWER_COLORS[kind-1]
    p = ['<ellipse cx="31" cy="44" rx="26" ry="14" fill="#020812" opacity=".65"/>',
         '<circle cx="30" cy="32" r="27" fill="url(#halo)"/>',
         polygon(regular(30, 33, 24, 6, math.pi/6), "#091421", "#456075", 1.2),
         polygon(regular(30, 30, 21, 6, math.pi/6), "url(#metal)", "#6d879a", .8),
         '<circle cx="30" cy="30" r="15" fill="#0c1c2a" stroke="#385369"/>',
         f'<circle cx="30" cy="30" r="18" stroke="{color}" stroke-width="1.5" stroke-dasharray="9 7" opacity=".65"/>']
    if kind == 1:  # Paired pulse rails; extra tier adds lateral fins and a third rail.
        p += [polygon([(16,21),(32,18),(42,24),(42,36),(32,42),(16,39),(12,30)], "url(#metal)", "#7c9ba6", 1),
              '<path d="M30 23H53L58 26V29H30ZM30 33H58V36L53 39H30Z" fill="#2b5360" stroke="#8eb9c0" stroke-width=".9"/>',
              f'<path d="M35 25H55M35 35H55" stroke="{color}" stroke-width="2.5"/>',
              f'<circle cx="25" cy="30" r="8" fill="#143e43" stroke="{color}"/>',
              '<circle cx="25" cy="30" r="4.2" fill="url(#energy)"/>',
              '<path d="M17 24V36M53 29V33" stroke="#e0fff6" stroke-width="1" opacity=".65"/>']
        if level >= 2:
            p += [polygon([(16,19),(26,14),(37,16),(33,20),(20,24)], "#395968", color, .8),
                  polygon([(16,41),(26,46),(37,44),(33,40),(20,36)], "#395968", color, .8)]
        if level == 3:
            p.append(f'<path d="M33 30H61" stroke="#19353d" stroke-width="6"/><path d="M35 30H61" stroke="{color}" stroke-width="2"/>')
    elif kind == 2:  # Faceted ice crystal, visually unlike a conventional gun.
        p += [polygon([(13,30),(23,17),(37,20),(49,30),(37,40),(23,43)], "#1d3e61", "#8ab4d5", 1),
              polygon([(18,30),(31,18),(55,30),(31,42)], "url(#energy)", "#d6efff", 1.2),
              polygon([(18,30),(31,18),(31,30)], "#e4f6ff"),
              polygon([(31,30),(55,30),(31,42)], "#429bdd", "none", 1, 'opacity=".75"'),
              '<path d="M18 30H55M31 18V42" stroke="#cbeaff" stroke-width=".8"/>',
              polygon([(13,18),(18,11),(24,24)], "#69bbec", "#c4e9ff", .8),
              polygon([(13,42),(18,49),(24,36)], "#69bbec", "#c4e9ff", .8)]
        if level >= 2:
            p += [polygon([(31,15),(38,8),(43,22)], "url(#energy)", "#d7f0ff", .8),
                  polygon([(31,45),(38,52),(43,38)], "url(#energy)", "#d7f0ff", .8)]
        if level == 3:
            p += [polygon([(43,19),(55,17),(50,25)], "#b9e7ff", "#e4f5ff", .8),
                  polygon([(43,41),(55,43),(50,35)], "#b9e7ff", "#e4f5ff", .8)]
    elif kind == 3:  # Heavy octagonal cannon with a hot, recessed muzzle.
        p += [polygon(regular(27,30,19,8,math.pi/8), "url(#metal)", "#b19979", 1.2),
              '<path d="M17 15H31V21H17ZM17 39H31V45H17Z" fill="#9a6532" stroke="#e1b574" stroke-width=".8"/>',
              '<path d="M29 19H49L58 24V36L49 41H29Z" fill="#4b433a" stroke="#c8a175" stroke-width="1.2"/>',
              '<path d="M34 22H49V38H34Z" fill="#263641"/>',
              f'<path d="M35 23V37M41 23V37M47 23V37" stroke="{color}" stroke-width="2" opacity=".8"/>',
              '<path d="M51 23L58 26V34L51 37Z" fill="#101924" stroke="#dfb57b"/>',
              f'<path d="M55 27V33" stroke="{color}" stroke-width="2.5"/>',
              '<circle cx="23" cy="30" r="8" fill="#2b281f" stroke="#a57d49"/>',
              '<circle cx="23" cy="30" r="4" fill="url(#energy)"/>']
        if level >= 2:
            p += ['<path d="M11 20L16 16V44L11 40Z" fill="#bd9153" stroke="#ffe0a2" stroke-width=".7"/>',
                  '<path d="M35 16H49L53 20H35ZM35 44H49L53 40H35Z" fill="#776046" stroke="#e9b676" stroke-width=".8"/>']
        if level == 3:
            p += ['<path d="M19 9H30L36 15H18ZM19 51H30L36 45H18Z" fill="#a06e35" stroke="#f8cf8b"/>',
                  '<path d="M20 12H29M20 48H29" stroke="#fff0cc" stroke-width="1.5"/>']
    else:  # Long forked rail + diamond core, deliberately slim and asymmetric.
        p += [polygon([(10,30),(22,17),(37,21),(45,30),(37,39),(22,43)], "#393751", "#9e92bc", 1.2),
              '<path d="M27 22L57 17L61 21L39 28ZM27 38L57 43L61 39L39 32Z" fill="#554776" stroke="#c8a6ed" stroke-width="1"/>',
              f'<path d="M37 25L58 20M37 35L58 40" stroke="{color}" stroke-width="2"/>',
              '<path d="M36 30H59" stroke="#d3b5ff" stroke-width="1" opacity=".8"/>',
              polygon([(17,30),(28,20),(39,30),(28,40)], "url(#energy)", "#eadcff", 1.2),
              polygon([(17,30),(28,20),(28,30)], "#f2e8ff"),
              '<path d="M28 20V40M17 30H39" stroke="#e4d4ff" stroke-width=".7"/>']
        if level >= 2:
            p += [polygon([(17,18),(24,10),(35,15),(30,19)], "#735696", "#ceb0ef", .9),
                  polygon([(17,42),(24,50),(35,45),(30,41)], "#735696", "#ceb0ef", .9)]
        if level == 3:
            p += [f'<circle cx="28" cy="30" r="23" stroke="{color}" stroke-dasharray="12 24" stroke-width="1.7"/>',
                  '<path d="M45 28L62 30L45 32" fill="#efdfff"/>']
    # Rank lamps are readable at native size and do not depend on font rendering.
    p.append('<rect x="18" y="52" width="24" height="7" rx="3" fill="#07121c" stroke="#3b5061" stroke-width=".6"/>')
    for i in range(3):
        p.append(f'<rect x="{21+i*7}" y="54" width="4" height="3" rx=".7" fill="{color if i < level else "#273c4b"}"/>')
    return svg(64, 64, "".join(p), color, f"Tower {kind}, rank {level}")


def enemy(kind):
    colors = ["#ff8e9b", "#ffb67d", "#efc17c", "#a9ed9c", "#b7b4ff", "#ff77bf"]
    color = colors[kind-1]
    if kind == 6:
        p = ['<ellipse cx="34" cy="48" rx="31" ry="18" fill="#020611" opacity=".7"/>',
             '<circle cx="35" cy="35" r="35" fill="url(#halo)"/>',
             '<circle cx="35" cy="35" r="30" stroke="#fb6eb8" stroke-width="1" opacity=".5" stroke-dasharray="4 7"/>',
             polygon([(6,25),(18,22),(18,8),(30,18),(38,4),(45,19),(59,10),(56,25),(69,29),(60,38),(68,48),(52,47),(54,62),(41,54),(31,68),(26,53),(11,59),(16,43),(3,38)], "#46233f", "#a9588a", 1),
             polygon(regular(35,35,24,6,math.pi/6), "url(#metal)", "#f0a1d1", 1.2),
             polygon([(17,35),(28,15),(48,20),(59,35),(48,50),(28,55)], "#3f2349", "#bb6fbc", 1),
             polygon([(24,35),(35,20),(50,35),(35,50)], "url(#energy)", "#ffd6ef", 1.4),
             '<path d="M35 20V50M24 35H50" stroke="#fff0fa" stroke-width="1"/>',
             '<path d="M48 25L59 29M48 45L59 41M15 28L22 31M15 42L22 39" stroke="#ffe2f5" stroke-width="2.3"/>',
             '<path d="M9 22L18 26M9 49L18 45M29 8L32 16M29 62L32 54" stroke="#ff82c3" stroke-width="2"/>']
        return svg(72, 72, "".join(p), color, "Rift sovereign")
    p = ['<ellipse cx="19" cy="27" rx="17" ry="10" fill="#020611" opacity=".65"/>',
         '<circle cx="20" cy="20" r="19" fill="url(#halo)"/>']
    if kind == 1:
        p += ['<path d="M11 12L5 7M9 18L3 17M9 24L3 27M11 29L6 34M25 11L30 6M26 29L31 34" stroke="#ab566b" stroke-width="2.5" stroke-linecap="round"/>',
              polygon([(8,15),(17,7),(28,11),(36,20),(28,29),(17,33),(8,25)], "#573040", "#e98a9b", 1),
              polygon([(13,16),(21,10),(29,15),(30,25),(21,30),(13,24)], "#b85269", "none"),
              '<path d="M16 14L23 12M16 26L23 28" stroke="#ffd3db" stroke-width="1.2"/>',
              '<path d="M27 16L31 18M27 24L31 22" stroke="#fff1ef" stroke-width="2"/>',
              polygon([(17,20),(22,16),(26,20),(22,24)], "url(#energy)")]
    elif kind == 2:
        p += ['<path d="M3 14H10M1 20H7M3 26H10" stroke="#ffad78" stroke-width="1.5" opacity=".65"/>',
              polygon([(8,8),(22,13),(36,20),(22,27),(8,32),(13,21)], "#b7624a", "#ffc198", 1.2),
              polygon([(12,13),(22,16),(31,20),(20,23)], "url(#energy)"),
              polygon([(13,25),(22,23),(29,22),(19,27)], "#ff8b5d"),
              '<path d="M19 19L29 20L19 21" stroke="#fff5da" stroke-width="1.2"/>']
    elif kind == 3:
        p += ['<path d="M8 8H26V32H8Z" fill="#101a23" stroke="#967d66"/>',
              '<path d="M8 11H26M8 16H26M8 24H26M8 29H26" stroke="#6c6a61" stroke-width="2"/>',
              polygon([(7,13),(14,6),(27,6),(35,14),(35,26),(27,34),(14,34),(7,27)], "#625447", "#d2b488", 1.3),
              polygon([(12,15),(18,11),(29,12),(32,20),(28,28),(18,29),(12,25)], "#987c56", "#e6c494", .8),
              '<path d="M18 11V29M12 20H28" stroke="#4a443d" stroke-width="2"/>',
              '<path d="M28 16V24" stroke="#ffe7b3" stroke-width="2.5"/>',
              '<path d="M10 10L14 6M10 30L14 34" stroke="#f8ddaf" stroke-width="1"/>']
    elif kind == 4:
        p += ['<path d="M11 9L8 4M28 10L32 6M9 28L5 33M28 30L31 36" stroke="#89b58b" stroke-width="2"/>',
              '<path d="M7 18Q7 8 19 8Q28 6 32 15Q39 20 31 27Q27 35 18 32Q6 33 8 24Q3 20 7 18Z" fill="#28534b" stroke="#9ce0ae" stroke-width="1.2"/>',
              '<path d="M11 17Q16 9 23 13Q31 14 30 22Q26 30 17 28Q9 26 11 17Z" fill="#4e8967"/>',
              '<circle cx="21" cy="20" r="7" fill="#15382c" stroke="#c7f6b8"/>',
              '<path d="M21 16V24M17 20H25" stroke="#ddffd0" stroke-width="2.5"/>',
              '<circle cx="9" cy="17" r="2" fill="#c6ec9d"/><circle cx="29" cy="28" r="2" fill="#c6ec9d"/>']
    else:
        p += [polygon([(5,11),(15,4),(29,9),(37,20),(29,31),(15,36),(5,29)], "#332d55", "#9e96d5", 1.2),
              polygon([(10,13),(19,8),(29,13),(33,20),(29,27),(19,32),(10,27)], "#615b87", "#c5c0ed", .8),
              '<path d="M11 13L19 18V22L11 27M19 8V13M19 27V32" stroke="#dad6ff" stroke-width="1.4"/>',
              polygon([(19,13),(29,17),(29,23),(19,27),(15,20)], "url(#energy)", "#e9e5ff", .8),
              '<path d="M33 12Q40 20 33 28" stroke="#c3c2ff" stroke-width="2"/>',
              '<path d="M21 16V24" stroke="#f3efff" stroke-width="1"/>']
    return svg(40, 40, "".join(p), color, f"Enemy {kind}")


def projectile(kind):
    color = TOWER_COLORS[kind-1]
    p = ['<path d="M1 6L49 1L57 6L49 11Z" fill="url(#trail)" opacity=".26"/>',
         '<path d="M1 6H49" stroke="url(#trail)" stroke-width="2"/>']
    if kind == 1:
        p += ['<path d="M29 6H53" stroke="#7effe9" stroke-width="3" stroke-linecap="round"/>',
              '<path d="M40 6H54" stroke="#edfffa" stroke-width="1.4" stroke-linecap="round"/>']
    elif kind == 2:
        p += [polygon([(37,6),(46,2),(57,6),(46,10)], "url(#energy)", "#d7efff", .7),
              '<path d="M41 6H55" stroke="#effaff" stroke-width=".8"/>',
              '<path d="M23 3L28 6L23 9" stroke="#8dcaff" stroke-width="1" opacity=".6"/>']
    elif kind == 3:
        p += ['<path d="M25 4L42 3V9L25 8Z" fill="url(#trail)"/>',
              '<circle cx="48" cy="6" r="4.6" fill="#d78b47" stroke="#ffdaa1" stroke-width=".8"/>',
              '<circle cx="49" cy="5.5" r="2.5" fill="#fff2bf"/>']
    else:
        p += ['<path d="M2 6H58" stroke="#c797ff" stroke-width="3" opacity=".5"/>',
              '<path d="M8 6H59" stroke="#f4eaff" stroke-width="1.2"/>',
              polygon([(44,6),(50,2),(59,6),(50,10)], "#e0c4ff", "#f2e7ff", .7)]
    return svg(60, 12, "".join(p), color, f"Projectile {kind}")


def pad():
    p = ['<ellipse cx="24" cy="29" rx="23" ry="17" fill="#020b13" opacity=".65"/>',
         polygon(regular(24,24,22,6,math.pi/6), "#192d3b", "#58655e", 1.1),
         polygon(regular(24,22,18,6,math.pi/6), "#203442", "#8b7958", .8),
         '<circle cx="24" cy="22" r="13" fill="#10222e" stroke="#c6a363" stroke-opacity=".65" stroke-dasharray="5 4"/>',
         '<path d="M24 16V28M18 22H30" stroke="#ddbd7b" stroke-width="1.5" opacity=".75"/>',
         '<path d="M12 10L16 8M32 8L36 10M12 35L16 37M32 37L36 35" stroke="#e8c985" stroke-width="2"/>']
    return svg(48, 48, "".join(p), "#e8bd70", "Empty build socket")


def selection():
    return svg(68, 68,
               '<circle cx="34" cy="34" r="31" stroke="#ffc979" stroke-width="1" opacity=".4"/>'
               '<circle cx="34" cy="34" r="27" stroke="#ffe0a4" stroke-width="1.5" stroke-dasharray="10 7"/>'
               '<path d="M5 20V10Q5 5 10 5H20M48 5H58Q63 5 63 10V20M63 48V58Q63 63 58 63H48M20 63H10Q5 63 5 58V48" stroke="#ffce80" stroke-width="2"/>'
               '<path d="M31 2L34 6L37 2M31 66L34 62L37 66" fill="#fff0c8"/>',
               "#ffce80", "Selected tower brackets")


def ring():
    return svg(70, 70,
               '<circle cx="35" cy="35" r="30" stroke="#ffca7c" stroke-width="5" opacity=".1"/>'
               '<circle cx="35" cy="35" r="29" stroke="#ffdd9f" stroke-width="1.8" opacity=".85"/>'
               '<circle cx="35" cy="35" r="24" stroke="#fff0d3" stroke-width=".9" opacity=".6"/>'
               '<circle cx="35" cy="35" r="33" stroke="#ffc472" stroke-width="1.5" stroke-dasharray="9 13" opacity=".55"/>'
               '<path d="M35 1V7M35 63V69M1 35H7M63 35H69" stroke="#ffe2a8" stroke-width="1.3"/>',
               "#ffcd83", "Impact shock ring")


def hud():
    p = ['<path d="M10 9H890V55H10Z" fill="#0b1726" fill-opacity=".96" stroke="#345365"/>',
         '<path d="M10 9H116L126 19H10Z" fill="#3c8b91" opacity=".36"/>',
         '<path d="M11 54H889" stroke="#64d6cf" opacity=".3"/>',
         '<path d="M750 67H890V501H750Z" fill="#0b1726" fill-opacity=".96" stroke="#304b60"/>',
         '<path d="M750 67H813L824 76H750Z" fill="#b48b48" opacity=".32"/>',
         '<path d="M750 103H890M760 362H880" stroke="#345064"/>',
         '<path d="M10 511H890V552H10Z" fill="#0b1726" fill-opacity=".96" stroke="#345365"/>',
         '<path d="M10 511H145L155 517H10Z" fill="#3c8b91" opacity=".3"/>',
         corner_marks(10,9,880,46,"#79cfce",8,.75),
         corner_marks(750,67,140,434,"#d4b580",8,.6),
         corner_marks(10,511,880,41,"#79cfce",8,.5)]
    # No labels or values: all HUD text is native, and its background remains
    # completely transparent above the actual map and actors.
    return svg(900,562,"".join(p),title="Transparent gameplay HUD frame")


def menu_space(accent="#6ff8e6"):
    return ('<rect width="900" height="562" fill="url(#space)"/>' + stars(count=125) +
            '<rect width="900" height="562" fill="url(#grid)" opacity=".45"/>' +
            f'<ellipse cx="450" cy="190" rx="360" ry="240" fill="url(#halo)" opacity=".75"/>' +
            '<path d="M20 70V20H170M730 20H880V70M20 492V542H170M730 542H880V492" stroke="#456377" stroke-width="1"/>' +
            f'<path d="M20 20H72M828 20H880M20 542H72M828 542H880" stroke="{accent}" stroke-width="2" opacity=".7"/>' +
            '<path d="M38 38H120M780 38H862" stroke="#426475" opacity=".55"/>')


def title_screen():
    p = [menu_space(),
         '<circle cx="450" cy="222" r="138" stroke="#72b7bf" stroke-opacity=".08"/>',
         '<circle cx="450" cy="222" r="152" stroke="#72b7bf" stroke-opacity=".06" stroke-dasharray="3 12"/>',
         '<path d="M32 280H156L195 241H277M623 241H705L744 280H868M66 365H202L248 319H291M609 319H652L698 365H834" stroke="#3f7a88" stroke-opacity=".35"/>',
         orbital_core(145,279,56), orbital_core(755,279,56),
         '<path d="M138 116L174 152M762 116L726 152M138 440L174 404M762 440L726 404" stroke="#6fd9cf" stroke-opacity=".25"/>',
         text(450,76,"星 垒",28,"#dbf6f4","middle",700,6),
         text(450,143,"STARHOLD",58,"#edfaff","middle",800,7),
         '<path d="M335 162H565" stroke="#83dcd7" stroke-opacity=".65"/>',
         text(450,185,"守住最后一道光",14,"#91b8c8","middle",400,3),
         text(450,210,"ORBITAL DEFENSE INITIATIVE",9,"#6c93a6","middle",600,3,True),
         orbital_core(450,257,26),
         text(50,519,"SECTOR / 07",9,"#628394",mono=True,tracking=1),
         text(850,519,"TACTICAL DEFENSE · 6 SECTORS",9,"#628394","end",tracking=1,mono=True)]
    return svg(900,562,"".join(p),title="STARHOLD title screen")


def level_select():
    p = [menu_space(), text(53,74,"选择战区",26,"#e2f4f7",weight=700),
         text(55,98,"SECTOR SELECT",10,"#74a4b5",tracking=3,mono=True),
         text(846,81,"01 — 06",13,"#9bc2cc","end",mono=True,tracking=2),
         '<path d="M54 117H846" stroke="#355568"/>']
    for i, (name, en, color, tint, subtitle) in enumerate(LEVELS):
        cx, cy = [210,450,690][i%3], [226,391][i//3]
        x,y = cx-106,cy-66
        p += [f'<rect x="{x+3}" y="{y+5}" width="212" height="132" rx="8" fill="#020914" opacity=".7"/>',
              f'<rect x="{x}" y="{y}" width="212" height="132" rx="8" fill="url(#panel)" stroke="{color}" stroke-opacity=".35"/>',
              f'<path d="M{x+1} {y+20}V{y+8}Q{x+1} {y+1} {x+8} {y+1}H{x+66}" stroke="{color}" stroke-width="2"/>',
              f'<path d="M{x+139} {y+1}H{x+204}Q{x+211} {y+1} {x+211} {y+8}V{y+131}H{x+156}Z" fill="{tint}" opacity=".7"/>',
              text(x+17,y+29,f"0{i+1}",13,color,weight=600,mono=True,tracking=2),
              text(x+17,y+61,name,19,"#deecf3",weight=600),
              text(x+17,y+82,en,8,"#91adbd",mono=True,tracking=.7),
              f'<path d="M{x+17} {y+97}H{x+195}" stroke="#365063"/>']
        for j in range(3):
            p.append(polygon(star(x+24+j*20,y+115,6,2.8), "#162838", "#688394", .7))
        for j in range(i+1):
            p.append(f'<rect x="{x+137+j*10}" y="{y+110}" width="5" height="9" rx="1" fill="{color}" opacity="{.35+j*.1}"/>')
    p.append(text(450,493,"六个战区 · 自由选择 · 每一次防守都值得",11,"#7898ab","middle",tracking=1))
    return svg(900,562,"".join(p),title="Six-sector selection")


def panel_frame(width, height, accent="#6ff8e6"):
    return (f'<rect x="5" y="8" width="{width-10}" height="{height-13}" rx="15" fill="#020710" fill-opacity=".75"/>'
            f'<path d="M20 3H{width-20}L{width-3} 20V{height-20}L{width-20} {height-3}H20L3 {height-20}V20Z" fill="url(#panel)" stroke="#536c80" stroke-width="1.1"/>'
            f'<path d="M20 3H{width-20}" stroke="{accent}" stroke-width="2"/>'
            f'<path d="M24 76H{width-24}" stroke="#304c60"/>'
            f'<path d="M23 {height-18}H67M{width-67} {height-18}H{width-23}" stroke="{accent}" stroke-opacity=".4"/>'
            + corner_marks(10,10,width-20,height-20,accent,12,.4))


def pause_panel():
    p = [panel_frame(480,240),
         '<path d="M35 30H41V51H35ZM47 30H53V51H47Z" fill="#a6e9e3"/>',
         text(69,44,"战术暂停",22,"#e1f6f4",weight=700),
         text(69,63,"TACTICAL PAUSE",9,"#7fa7bb",mono=True,tracking=2),
         text(240,103,"重新部署思路，然后继续守护核心。",12,"#92aebf","middle")]
    return svg(480,240,"".join(p),title="Pause panel")


def result_panel(victory):
    color="#f4cf87" if victory else "#ff8eaa"
    p=[panel_frame(480,280,color),
       text(240,44,"战区守住了" if victory else "核心已失守",24,"#f2f3f3","middle",700),
       text(240,64,"SECTOR SECURED" if victory else "SIGNAL LOST",9,color,"middle",tracking=3,mono=True)]
    if victory:
        for cx in [197,240,283]:
            p.append(polygon(star(cx,108,16,7.5),"#203141",color,1))
        p += ['<path d="M145 129Q119 109 130 85M335 129Q361 109 350 85" stroke="#a2885c" stroke-width="1.3"/>']
        for i in range(4):
            yy=94+i*9
            p.append(f'<path d="M{127+i} {yy}l-8 -8l1 10l9 5M{353-i} {yy}l8 -8l-1 10l-9 5" fill="#b8a06b" opacity=".65"/>')
    else:
        p += [polygon([(240,84),(260,117),(220,117)],"#4e293b",color,1),
              '<path d="M240 94V105M240 110V112" stroke="#ffd8e1" stroke-width="2.5"/>',
              text(240,140,"调整阵型，下一次让裂隙止步。",11,"#ac91a4","middle")]
    return svg(480,280,"".join(p),color,"Victory panel" if victory else "Defeat panel")


def settings_panel():
    p=[panel_frame(640,420),text(32,43,"指挥设置",23,"#e0f5f5",weight=700),
       text(33,63,"COMMAND SETTINGS",9,"#86aabb",tracking=2,mono=True),
       '<path d="M32 165H608M32 258H608" stroke="#294458"/>',
       text(34,118,"画面品质",16,"#d4e7ed",weight=600),
       text(34,142,"低画质减少弹体与粒子，保持清晰反馈。",11,"#789cac"),
       text(34,211,"战场震动",16,"#d4e7ed",weight=600),
       text(34,235,"控制重击和核心受损时的镜头震动。",11,"#789cac"),
       text(34,303,"快捷指挥",16,"#d4e7ed",weight=600),
       text(34,327,"空格：下一波　 P：暂停　 Esc：主菜单",12,"#95b8c7")]
    return svg(640,420,"".join(p),title="Settings panel")


def help_panel():
    p=[panel_frame(640,420),text(32,43,"战地手册",23,"#e0f5f5",weight=700),
       text(33,63,"FIELD MANUAL",9,"#86aabb",tracking=2,mono=True),
       text(32,107,"01",13,"#70e4d7",mono=True),text(67,107,"选塔 → 点击基座 → 守住核心",16,"#e1eff3",weight=600),
       text(67,132,"选择右侧防御塔，在琥珀色基座上部署。",12,"#93b4c3"),
       text(32,168,"02",13,"#70e4d7",mono=True),text(67,168,"不同防御，应对不同威胁",16,"#e1eff3",weight=600),
       text(67,193,"脉冲：速射　冰棱：减速　震爆：范围　棱镜：穿甲",12,"#93b4c3"),
       text(32,229,"03",13,"#70e4d7",mono=True),text(67,229,"升级阵线，让每一枚金币生效",16,"#e1eff3",weight=600),
       text(67,254,"选中已有防御塔可升级或出售；出售返还投入的 60%。",12,"#93b4c3"),
       '<path d="M32 279H608" stroke="#304d61"/>',
       text(33,305,"1–4 选塔     U 升级     X 出售",12,"#c4d8e2",mono=True),
       text(33,331,"Space 下一波     P 暂停     Esc 主菜单",12,"#c4d8e2",mono=True)]
    return svg(640,420,"".join(p),title="Field manual panel")


def button(width=180,height=44,kind="primary"):
    color={"primary":"#78ebdd","secondary":"#7f9eb8","danger":"#ff94ab","gold":"#f3cb85"}[kind]
    return svg(width,height,
               f'<path d="M10 2H{width-10}L{width-2} 10V{height-10}L{width-10} {height-2}H10L2 {height-10}V10Z" fill="url(#panel)" stroke="{color}" stroke-opacity=".7"/>'
               f'<path d="M10 3H{width-10}L{width-3} 10V{height//2}H3V10Z" fill="{color}" opacity=".07"/>'
               f'<path d="M4 13V{height-13}M{width-4} 13V{height-13}" stroke="{color}" stroke-width="2"/>'
               f'<path d="M15 {height-6}H{width-15}" stroke="{color}" opacity=".12"/>',
               color,f"Unlabelled {kind} button")


def store_card():
    return svg(128,60,
               '<rect x="1" y="1" width="126" height="58" rx="5" fill="url(#panel)" stroke="#416070"/>'
               '<path d="M3 13V5Q3 3 5 3H21" stroke="#93bdc6" opacity=".6"/>'
               '<path d="M48 10V50" stroke="#325164"/>'
               '<path d="M54 44H118" stroke="#2c495d"/>',title="Tower store row")


def boss_banner():
    p=['<path d="M18 2H502L518 16V48L502 62H18L2 48V16Z" fill="#241528" fill-opacity=".96" stroke="#b95986"/>',
       '<path d="M20 3H500M20 61H500" stroke="#ff90bd" stroke-opacity=".7"/>',
       polygon([(31,18),(47,18),(56,32),(47,46),(31,46),(22,32)],"#5e284a","#f08ab8",1),
       '<path d="M39 22V35M39 39V43" stroke="#ffe0ef" stroke-width="2.5"/>',
       text(77,29,"裂隙领主接近",19,"#ffe4ef",weight=700),
       text(78,47,"RIFT SOVEREIGN INBOUND",9,"#d08ba9",mono=True,tracking=2)]
    return svg(520,64,"".join(p),"#ff90bd","Boss warning")


def generate(outputdir: str | Path) -> dict[str, dict]:
    """Write deterministic standalone SVGs and a portable name-keyed manifest."""
    out=Path(outputdir)
    out.mkdir(parents=True,exist_ok=True)
    manifest: dict[str,dict]={}

    def write(name, width, height, content):
        filename=f"{name}.svg"
        (out/filename).write_text(content,encoding="utf-8")
        manifest[name]={"file":filename,"width":width,"height":height,"name":name}

    for level in range(1,7):
        write(f"map-{level}",900,562,battlefield(level))
    for kind in range(1,5):
        for level in range(1,4):
            write(f"tower-{kind}-{level}",64,64,tower(kind,level))
        write(f"bullet-{kind}",60,12,projectile(kind))
    for kind in range(1,7):
        size=72 if kind==6 else 40
        write(f"enemy-{kind}",size,size,enemy(kind))
    write("pad",48,48,pad())
    write("selection",68,68,selection())
    write("effect-ring",70,70,ring())
    write("hud",900,562,hud())
    write("title",900,562,title_screen())
    write("level-select",900,562,level_select())
    write("pause",480,240,pause_panel())
    write("victory",480,280,result_panel(True))
    write("defeat",480,280,result_panel(False))
    write("settings",640,420,settings_panel())
    write("help",640,420,help_panel())
    for kind in ["primary","secondary","danger","gold"]:
        write(f"button-{kind}",180,44,button(kind=kind))
    write("button-small",120,34,button(120,34,"secondary"))
    write("store-card",128,60,store_card())
    write("boss-banner",520,64,boss_banner())
    write("star-empty",28,28,svg(28,28,polygon(star(14,14,12,5.6),"#203141","#7891a4",1),title="Empty rating star"))
    write("star-full",28,28,svg(28,28,polygon(star(14,14,12,5.6),"url(#energy)","#ffe7b1",1),"#f5c475","Earned rating star"))
    write("core",64,64,svg(64,64,orbital_core(32,32,20,compact=True),title="Core portal"))
    # Matching social overlays support later milestones while retaining native
    # actor/text ownership for dynamic online/offline content.
    for name, heading, subtitle in [("leaderboard","战区纪录","SECTOR RECORDS"),("messages","指挥通讯","COMMAND CHANNEL")]:
        body=panel_frame(640,420)+text(32,43,heading,23,"#e0f5f5",weight=700)+text(33,63,subtitle,9,"#86aabb",tracking=2,mono=True)
        write(name,640,420,svg(640,420,body,title=subtitle))
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("outputdir",nargs="?",type=Path)
    parser.add_argument("--out","--output",dest="output",type=Path)
    args=parser.parse_args()
    destination=args.output or args.outputdir or Path(__file__).resolve().parents[2]/"assets"/"tower-defense"
    result=generate(destination)
    print(f"Generated {len(result)} vector assets: {destination / 'manifest.json'}")
