# -*- coding: utf-8 -*-
"""Simulate the exact JS scoring path (computeFeatures + modelCore) on the chili samples."""
import os
import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ONNX = os.path.join(ROOT, "models", "vitrovision-unet-small.onnx")
SAMPLE_DIR = os.path.join(ROOT, "samples", "chili")
UNET_MIN_COVERAGE = 0.008
UNET_HEIGHT_REF = 0.55
UNET_MASS_REF = 0.06


def clamp(v, a, b):
    return max(a, min(b, int(round(v))))


def compute_features(arr, w, h):
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    exg = 2 * g - r - b
    x0, x1, y0, y1 = int(w * 0.25), int(w * 0.75), int(h * 0.25), int(h * 0.75)
    center = np.zeros((h, w), bool)
    center[y0:y1, x0:x1] = True
    green_m = (g > r + 0.03) & (g > b + 0.03) & (exg > 0.08)
    yellow_m = (r > 0.4) & (g > 0.35) & (b < 0.45) & (r >= g) & ((r - b) > 0.12)
    soil_m = (r > 0.2) & (r < 0.7) & (g > 0.12) & (g < r) & (b < g) & ((r - b) > 0.06)
    n = w * h
    bright = float(((r + g + b) / 3).mean())
    soil_dark = float(((r + g + b) / 3)[soil_m].mean()) if soil_m.any() else -1.0
    return {
        "green": green_m.sum() / n,
        "centerGreen": green_m[center].sum() / (n * 0.25),
        "yellow": yellow_m.sum() / n,
        "soilDark": soil_dark,
        "bright": bright,
        "jsGreenMask": green_m,
        "jsYellowMask": yellow_m,
    }


def model_metrics(prob, arr):
    mask = prob > 0.5
    area = int(mask.sum())
    cov = area / prob.size
    ys, xs = np.where(mask)
    height = (ys.max() - ys.min() + 1) / prob.shape[0] if area else 0.0
    f = compute_features(arr, prob.shape[1], prob.shape[0])
    gp = float((f["jsGreenMask"] & mask).sum()) / max(area, 1)
    yp = float((f["jsYellowMask"] & mask).sum()) / max(area, 1)
    return {"coverage": cov, "height": height, "greenPct": gp, "yellowPct": yp, "f": f}


def model_core(u):
    size_s = min(1.0, u["height"] / UNET_HEIGHT_REF)
    mass_s = min(1.0, u["coverage"] / UNET_MASS_REF)
    canopy = 100 * (0.4 * size_s + 0.6 * mass_s)
    colored = u["greenPct"] + u["yellowPct"]
    organic = u["greenPct"] / (colored + 0.05) if colored > 0 else 0.0
    purity = 0.22 + 0.78 * organic
    unhealthy = u["yellowPct"] / (colored + 0.05)
    f = u["f"]
    moisture = clamp(100 - abs(f["soilDark"] - 0.30) * 260, 5, 97) if f["soilDark"] >= 0 else clamp(28 + canopy * 0.4, 5, 97)
    if u["coverage"] < UNET_MIN_COVERAGE:
        vals = {"leaf": 8, "stem": 10, "moisture": min(moisture, 35), "roots": 8}
        return vals, True, None
    note = None
    if organic < 0.25 and u["yellowPct"] > 0.35 and u["greenPct"] < 0.15:
        note = "yellow-note"
    vals = {
        "leaf": clamp(8 + canopy * purity * (1 - 0.55 * unhealthy), 5, 98),
        "stem": clamp(16 + canopy * purity * 0.78, 8, 97),
        "moisture": moisture,
        "roots": clamp(14 + canopy * purity * 0.72, 8, 95),
    }
    return vals, False, note


def main():
    sess = ort.InferenceSession(ONNX, providers=["CPUExecutionProvider"])
    files = sorted(f for f in os.listdir(SAMPLE_DIR) if f.lower().endswith(".jpg"))
    print("%-22s %5s %5s %5s %5s %5s | %5s %5s %5s %5s %5s %5s" % (
        "image", "cover", "heigh", "jsGr", "jsYl", "soil", "leaf", "stem", "mois", "root", "TOT", "flag"))
    for f in files:
        img = Image.open(os.path.join(SAMPLE_DIR, f)).convert("RGB")
        big = np.asarray(img.resize((256, 256), Image.BILINEAR), dtype=np.float32) / 255.0
        small = np.asarray(img.resize((160, 160), Image.BILINEAR), dtype=np.float32) / 255.0
        prob = sess.run(None, {"input": big.transpose(2, 0, 1)[None]})[0][0, 0]
        u = model_metrics(prob, big)
        u["f"] = compute_features(small, 160, 160)  # site uses 160px for pixel features
        vals, gate, note = model_core(u)
        tot = round(0.35 * vals["leaf"] + 0.25 * vals["stem"] + 0.2 * vals["moisture"] + 0.2 * vals["roots"])
        flag = "GATE" if gate else (note or "")
        print("%-22s %5.3f %5.3f %5.2f %5.2f %5.2f | %5d %5d %5d %5d %5d %5s" % (
            f, u["coverage"], u["height"], u["greenPct"], u["yellowPct"], u["f"]["soilDark"],
            vals["leaf"], vals["stem"], vals["moisture"], vals["roots"], tot, flag))


if __name__ == "__main__":
    main()
