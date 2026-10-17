# -*- coding: utf-8 -*-
"""Calibration test: run ONNX on chili samples; compute model metrics + JS-style ExG colors + regions."""
import os
import numpy as np
import onnxruntime as ort
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ONNX = os.path.join(ROOT, "models", "vitrovision-unet-small.onnx")
SAMPLE_DIR = os.path.join(ROOT, "samples", "chili")
S = 256


def main():
    sess = ort.InferenceSession(ONNX, providers=["CPUExecutionProvider"])
    files = sorted(f for f in os.listdir(SAMPLE_DIR) if f.lower().endswith(".jpg"))
    print("%-22s %6s %6s %6s %6s %6s %6s %6s %5s %5s %5s" % (
        "image", "cover", "heigh", "width", "comp", "jsGr%", "jsYl%", "bare%", "reg", "bigR", "nbig"))
    for f in files:
        path = os.path.join(SAMPLE_DIR, f)
        img = Image.open(path).convert("RGB").resize((S, S), Image.BILINEAR)
        arr = np.asarray(img, dtype=np.float32) / 255.0
        x = arr.transpose(2, 0, 1)[None]
        prob = sess.run(None, {"input": x})[0][0, 0]
        mask = prob > 0.5
        area = int(mask.sum())
        cov = area / (S * S)
        ys, xs = np.where(mask)
        if len(xs):
            hh = (ys.max() - ys.min() + 1) / S
            ww = (xs.max() - xs.min() + 1) / S
            comp = area / ((ys.max() - ys.min() + 1) * (xs.max() - xs.min() + 1))
        else:
            hh = ww = comp = 0.0
        # JS-style ExG colors inside mask (mirror of script.js computeFeatures)
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        jsGreen = (g > r + 0.03) & (g > b + 0.03) & ((2 * g - r - b) > 0.08)
        jsYellow = (r > 0.4) & (g > 0.35) & (b < 0.45) & (r >= g) & ((r - b) > 0.12)
        maskBool = mask
        gp = 100.0 * int((jsGreen & maskBool).sum()) / max(area, 1)
        yp = 100.0 * int((jsYellow & maskBool).sum()) / max(area, 1)
        bare = 100.0 - gp - yp
        # region count (like space app: components > 0.5% of mask area)
        lab, num = ndimage.label(mask, structure=np.ones((3, 3)))
        sizes = ndimage.sum(mask, lab, range(1, num + 1)) if num else np.array([])
        big = int((sizes > 0.005 * max(area, 1)).sum()) if num else 0
        print("%-22s %6.3f %6.3f %6.3f %6.3f %6.1f %6.1f %6.1f %5d %5d %5d" % (
            f, cov, hh, ww, comp, gp, yp, bare, num, big, big))


if __name__ == "__main__":
    main()
