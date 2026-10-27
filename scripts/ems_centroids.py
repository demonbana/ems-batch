#!/usr/bin/env python3
r"""ems_centroids.py <cap_image> <cx1,cy1> <cx2,cy2> <cx3,cy3> <cx4,cy4> <cx5,cy5>
在验证码图中，围绕每个目测大致位置(±55px 窗口)计算高饱和度像素的精确质心。
输入的大致位置来自视觉识别(误差 ±25px 内即可)。
输出 JSON: {"w":..,"h":..,"chars":[{"cx":..,"cy":..,"rx":..,"ry":..,"n":..}, ...]} (按输入顺序)
"""
import sys, json
from PIL import Image

def main():
    if len(sys.argv) < 7:
        print("usage: ems_centroids.py <cap_image> <cx,cy> x5", file=sys.stderr)
        sys.exit(1)
    im = Image.open(sys.argv[1]).convert("RGB")
    W, H = im.size
    px = im.load()
    out = []
    for arg in sys.argv[2:7]:
        ax, ay = (int(float(v)) for v in arg.split(","))
        pts = []
        for y in range(max(0, ay - 55), min(H, ay + 55)):
            for x in range(max(0, ax - 55), min(W, ax + 55)):
                r, g, b = px[x, y]
                if max(r, g, b) - min(r, g, b) > 70:
                    pts.append((x, y))
        if len(pts) > 50:
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            out.append({"cx": round(cx, 1), "cy": round(cy, 1),
                        "rx": round(cx / W, 4), "ry": round(cy / H, 4), "n": len(pts)})
        else:
            out.append({"error": "too few pixels", "approx": [ax, ay], "n": len(pts)})
    print(json.dumps({"w": W, "h": H, "chars": out}, ensure_ascii=False))

if __name__ == "__main__":
    main()
