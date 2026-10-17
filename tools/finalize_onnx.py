# -*- coding: utf-8 -*-
"""Merge ONNX external data into a single file + optional int8 dynamic quant, compare accuracy."""
import os
import numpy as np
import onnx
import onnxruntime as ort
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
P = os.path.join(ROOT, "models", "vitrovision-unet-small.onnx")
DATA = P + ".data"
Q = os.path.join(ROOT, "models", "vitrovision-unet-small-int8.onnx")
SAMPLE_DIR = os.path.join(ROOT, "samples", "chili")
S = 256


def main():
    # ---- 1) merge external data into single .onnx ----
    m = onnx.load(P)  # auto-loads external data
    tmp = P + ".merged"
    onnx.save_model(m, tmp, save_as_external_data=False)
    os.replace(tmp, P)
    if os.path.exists(DATA):
        os.remove(DATA)
    print("merged single-file:", round(os.path.getsize(P) / 1e6, 2), "MB")

    sess = ort.InferenceSession(P, providers=["CPUExecutionProvider"])
    x = np.random.rand(1, 3, S, S).astype(np.float32)
    o = sess.run(None, {"input": x})[0]
    print("single-file forward OK:", o.shape, float(o.min()), float(o.max()))

    # ---- 2) int8 dynamic quantization ----
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(P, Q, weight_type=QuantType.QUInt8)
    print("int8 model:", round(os.path.getsize(Q) / 1e6, 2), "MB")

    sessq = ort.InferenceSession(Q, providers=["CPUExecutionProvider"])

    def prep(path):
        img = Image.open(path).convert("RGB").resize((S, S), Image.BILINEAR)
        a = np.asarray(img, dtype=np.float32) / 255.0
        return a.transpose(2, 0, 1)[None], a

    files = sorted(f for f in os.listdir(SAMPLE_DIR) if f.lower().endswith(".jpg"))
    print("%-24s %9s %9s %9s %9s %9s" % ("image", "maxdiff", "meandiff", "fp32_cov", "int8_cov", "agree%"))
    import time
    for f in files:
        xn, _ = prep(os.path.join(SAMPLE_DIR, f))
        p1 = sess.run(None, {"input": xn})[0][0, 0]
        p2 = sessq.run(None, {"input": xn})[0][0, 0]
        m1 = p1 > 0.5
        m2 = p2 > 0.5
        agree = 100.0 * (m1 == m2).mean()
        print("%-24s %9.4f %9.4f %9.4f %9.4f %8.1f%%" % (
            f, np.abs(p1 - p2).max(), np.abs(p1 - p2).mean(),
            m1.mean(), m2.mean(), agree))

    # rough speed check
    xn, _ = prep(os.path.join(SAMPLE_DIR, files[0]))
    for name, s in (("fp32", sess), ("int8", sessq)):
        s.run(None, {"input": xn})  # warmup
        t0 = time.time()
        for _ in range(5):
            s.run(None, {"input": xn})
        print(name, "avg ms:", round((time.time() - t0) / 5 * 1000))


if __name__ == "__main__":
    main()
