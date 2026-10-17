# -*- coding: utf-8 -*-
"""Export VitroVision U-Net (PyTorch .bin) -> ONNX with sigmoid for onnxruntime-web."""
import os
import numpy as np
import torch
import torch.nn as nn
import segmentation_models_pytorch as smp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BIN = os.path.join(ROOT, "models", "vitrovision-unet-small.bin")
OUT = os.path.join(ROOT, "models", "vitrovision-unet-small.onnx")
IMG = 256
ENCODER = "timm-mobilenetv3_small_100"


class SigWrap(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        return torch.sigmoid(self.m(x))


def main():
    sd = torch.load(BIN, map_location="cpu", weights_only=True)
    model = smp.Unet(encoder_name=ENCODER, encoder_weights=None, in_channels=3, classes=1)
    missing, unexpected = model.load_state_dict(sd, strict=False)
    print("missing keys:", list(missing)[:5])
    print("unexpected keys:", list(unexpected)[:5])
    assert not list(missing) and not list(unexpected), "state_dict mismatch!"
    model.eval()

    wrap = SigWrap(model).eval()
    dummy = torch.rand(1, 3, IMG, IMG)
    with torch.no_grad():
        out = wrap(dummy)
    print("torch output:", tuple(out.shape), float(out.min()), float(out.max()))

    torch.onnx.export(
        wrap, dummy, OUT,
        input_names=["input"], output_names=["mask"],
        opset_version=13,
        dynamic_axes={"input": {0: "batch"}, "mask": {0: "batch"}},
    )
    print("saved:", OUT, round(os.path.getsize(OUT) / 1e6, 2), "MB")

    import onnxruntime as ort
    sess = ort.InferenceSession(OUT, providers=["CPUExecutionProvider"])
    o = sess.run(None, {"input": dummy.numpy()})[0]
    d = float(np.abs(o - out.numpy()).max())
    print("max |torch-onnx|:", d)
    assert d < 1e-4
    print("EXPORT_OK")


if __name__ == "__main__":
    main()
