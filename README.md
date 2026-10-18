# VitroVision — ตรวจความพร้อมต้นกล้าในขวดเพาะเลี้ยงเนื้อเยื่อ

เว็บแอป (static, mobile-first) สำหรับประเมินว่าต้นกล้าในขวดเพาะเลี้ยงเนื้อเยื่อ **พร้อมย้ายออกจากขวด** หรือยัง
ด้วยโมเดล AI แบบ segmentation จริง (ไม่สุ่ม) — โครงงาน **YSC 29YCSE00054T**
โดย Peeradon Duangthong และ Krittikon Jiruangda (โรงเรียนจุฬาภรณราชวิทยาลัย บุรีรัมย์)

**ใช้จริง:** https://tutorzaa.github.io/VitroVision/

## หลักการทำงาน

1. **ตรวจคุณภาพภาพก่อนตัดสิน** (quality gate) — ถ้าภาพไม่ผ่าน ระบบจะไม่การันตีผลและขึ้น "ตรวจเอง"
   - พื้นที่ต้นพืช < 0.8% ของภาพ (ไม่พบ ROI)
   - แสงสะท้อนจ้า (glare) > 40% ของโซนต้น
   - ฝ้า/ละอองน้ำ (condensation) > 40% ของโซนต้น
   - สิ่งที่พบเป็นสีเหลือง/ครีมเป็นหลัก (สีเขียว < 15% — อาจเป็นเมล็ด/ต้นเหลือง)
2. **วัดความสูงต้นเทียบภาพ (height_proxy)** จาก mask ของโมเดล U-Net → เกณฑ์พร้อมย้ายออก: **≥ 20% ของความสูงภาพ**
3. **สรุปผล 3 ระดับ** — พร้อมย้ายออกจากขวด / ยังไม่พร้อม (ประเมินจำนวนวันที่รอ) / ตรวจเอง (ภาพไม่ผ่านคุณภาพ)
4. **ความเชื่อมั่น** = base (จากพื้นที่ต้นพืช) × (1 − glare) และมี **รายงานรายขวด** คัดลอกได้ (ค่าทุกตัวจากพิกเซลจริง)

## ฟีเจอร์

- สแกนจากอัปโหลด/ถ่ายภาพ · มุมมอง 2D ring + 3D (three.js) · ภาพ overlay พื้นที่ที่ AI แยกได้
- **Realtime**: ส่องกล้องดูค่าวัดสด (U-Net จริง) แล้วจับภาพไปวิเคราะห์เต็ม
- **โหมดวิจัย (YSC)**: โหมดจับเวลา (เทียบเวลาตรวจด้วยตา) + โหมดเก็บข้อมูลรายขวด พร้อม **ดาวน์โหลด CSV**
  (timestamp, bottle_id, expert_label, verdict, confidence, height_pct, glare_pct, condensation_pct, ai_time_ms …)
  สำหรับการทดสอบ 100 ขวด + คำนวณ inter-rater agreement ในขั้นถัดไป
- ภาพตัวอย่างพริก 5 ระยะ (Wikimedia Commons) สำหรับทดลองระบบ
- ประวัติการสแกน (localStorage) — ข้อมูลทั้งหมดอยู่ในเครื่องผู้ใช้ ไม่มีการอัปโหลดภาพขึ้นเซิร์ฟเวอร์

## โครงสร้างไฟล์

```
index.html          โครงหน้าเว็บ (Thai, mobile-first)
style.css           สไตล์ทั้งหมด (ไม่ใช้ framework)
script.js           ตรรกะ: ONNX runtime, quality gate, height_proxy, verdict, รายงาน, โหมดวิจัย
plant3d.js          มุมมอง 3D (three.js, ES module)
plants-dataset.json ชุดโปรไฟล์พืชสำหรับสีของกราฟประกอบ (แก้ไฟล์เดียว = เพิ่มพืช)
samples/            ภาพตัวอย่าง + manifest (chili-samples.json)
models/             โมเดล U-Net + MobileNetV3-Small (ONNX, opset 18)
tools/              e2e_check.js (ทดสอบผ่าน headless Chrome/CDP), สคริปต์ export/ทดสอบ ONNX
```

## ค่าคงที่สำคัญ (script.js)

| ค่า | ความหมาย |
|---|---|
| `READY_HEIGHT = 0.20` | เกณฑ์ height_proxy พร้อมย้ายออกจากขวด (ตรงกับ README ของโมเดล) |
| `GLARE_MAX = 40` | % แสงสะท้อนสูงสุดก่อนขึ้น "ตรวจเอง" |
| `COND_MAX = 40` | % ฝ้า/ละอองน้ำสูงสุดก่อนขึ้น "ตรวจเอง" |
| `UNET_MIN_COVERAGE = 0.008` | พื้นที่ต้นพืชขั้นต่ำ (สัดส่วนภาพ) |

## รันในเครื่อง / ทดสอบ

```powershell
# 1) เสิร์ฟผ่าน HTTP (จำเป็น — fetch โมเดล/ภาพตัวอย่างใช้ file:// ไม่ได้)
python -m http.server 8123 -d C:\Users\KRITTIKON\VitroVision

# 2) ทดสอบ end-to-end (เปิด Chrome headless พร้อม CDP ก่อน)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
  --remote-debugging-port=9222 --user-data-dir="$env:TEMP\opencode\vvchrome" --window-size=430,932 `
  "http://localhost:8123/"
node tools/e2e_check.js    # ตรวจ 5 ตัวอย่าง + gate test + โหมดวิจัย แล้วพิมพ์ผลเป็น JSON
```

## เครดิต / ไลเซนส์

- โมเดล: [Peeradon4778/vitrovision-unet-small](https://huggingface.co/Peeradon4778/vitrovision-unet-small) — U-Net + MobileNetV3-Small, Val Dice 0.98 (**MIT**)
- Runtime: [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) 1.20.1 (CDN) · [three.js](https://threejs.org/) 0.160 (CDN)
- ภาพตัวอย่าง: Wikimedia Commons ตามสัญญาอนุญาตที่ระบุใน `samples/chili-samples.json`
- โค้ดโครงงานนี้ใช้ **MIT** — กรุณาให้เครดิตทีม VitroVision และระบุว่าอ้างอิงเกณฑ์ height_proxy ≥ 20%
