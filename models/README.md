# models/ — โมเดล AI ที่เว็บใช้วิเคราะห์พืช

## vitrovision-unet-small.onnx (ไฟล์ที่เว็บใช้จริง)

- **แหล่งที่มา:** https://huggingface.co/Peeradon4778/vitrovision-unet-small (Hugging Face, สัญญาอนุญาต MIT)
- **โปรเจกต์ต้นทาง:** https://github.com/peeradon4778/VitroVision
- **สถาปัตยกรรม:** U-Net + MobileNetV3-Small encoder (segmentation_models_pytorch, ~3.6M พารามิเตอร์)
- **งาน:** แยกส่วน "ต้นพืช" ออกจากภาพ (plant segmentation)
- **อินพุต/เอาต์พุต:** RGB 256×256 (ค่าพิกเซล ÷255) → sigmoid mask 256×256 (ค่าความมั่นใจ 0–1)
- **คุณภาพ (จากโมเดลการ์ด):** Val Dice 0.9817 บนชุดข้อมูล greenhouse_leafy_segmentation

## วิธีสร้างไฟล์ .onnx นี้ใหม่ (ถ้าต้องการ)

```powershell
# 1) ดาวน์โหลดน้ำหนักจาก Hugging Face
python -c "from urllib.request import urlretrieve; urlretrieve('https://huggingface.co/Peeradon4778/vitrovision-unet-small/resolve/main/pytorch_model.bin', 'models/vitrovision-unet-small.bin')"

# 2) แปลงเป็น ONNX (ต้องมี: torch, segmentation-models-pytorch, timm, onnx, onnxruntime, onnxscript)
python tools\export_onnx.py

# 3) รวม external data (.onnx.data) ให้เป็นไฟล์เดียว
python tools\finalize_onnx.py
```

หมายเหตุ: เลือกใช้ FP32 ไฟล์เดียว (ขนาด ~14.8 MB) เพราะจากการทดสอบ int8 dynamic quantization
ให้ผลต่างจากโมเดลเดิมสูงมากในงาน segmentation (agreement 64–96%) และช้ากว่า — ไม่เหมาะกับงานนี้

## การทดสอบ/สอบเทียบ

- `tools/sim_scores.py` — จำลองสูตรให้คะแนนเดียวกับเว็บ บนชุดภาพตัวอย่าง
- `tools/test_onnx.py` — รันโมเดลบน samples/chili แล้วสรุปค่าที่วัดได้
- `tools/e2e_check.js` — ขับเว็บจริงใน Chrome headless ผ่าน CDP แล้วอ่านผลลัพธ์ทั้งหมด
