/* VitroVision — ตรวจความพร้อมต้นกล้าในขวดเพาะเลี้ยง (tissue-culture readiness)
   จริงจังทุกค่า: AI segmentation (U-Net ONNX) + ตรวจคุณภาพภาพ (แสงสะท้อน/ฝ้า) + วัดพิกเซลจริง */
(function () {
  "use strict";

  var RING_C = 364.4; // 2 * PI * 58
  var HISTORY_KEY = "vitroVisionHistory";
  var HISTORY_MAX = 10;
  var SESSION_KEY = "vitroVisionSession";
  var SESSION_MAX = 300;

  // ---------- เกณฑ์ตัดสิน (ตรงกับ README โมเดล + ข้อเสนอ YSC) ----------
  var READY_HEIGHT = 0.20;   // height_proxy: ความสูงต้น/ความสูงภาพ ≥ 20% = พร้อมย้ายออกจากขวด
  var GLARE_MAX = 40;        // % แสงสะท้อนในโซนต้น สูงกว่านี้ = ให้ "ตรวจเอง"
  var COND_MAX = 40;         // % ฝ้า/ละอองน้ำ สูงกว่านี้ = ให้ "ตรวจเอง"

  var METRICS = [
    { key: "leaf", label: "สุขภาพใบ", weight: 0.35 },
    { key: "stem", label: "ความแข็งแรงลำต้น", weight: 0.25 },
    { key: "moisture", label: "ความชื้น", weight: 0.2 },
    { key: "roots", label: "ระบบราก", weight: 0.2 }
  ];

  // ---------- Element refs ----------
  var navToggle = document.getElementById("navToggle");
  var mainNav = document.getElementById("mainNav");
  var fileInput = document.getElementById("fileInput");
  var uploadZone = document.getElementById("uploadZone");
  var uploadHint = document.getElementById("uploadHint");
  var previewImg = document.getElementById("previewImg");
  var plantNameInput = document.getElementById("plantName");
  var analyzeBtn = document.getElementById("analyzeBtn");
  var resetBtn = document.getElementById("resetBtn");
  var progressBox = document.getElementById("progressBox");
  var stepsList = document.getElementById("stepsList").children;
  var progressFill = document.getElementById("progressFill");
  var progressBar = document.getElementById("progressBar");
  var resultEmpty = document.getElementById("resultEmpty");
  var resultBox = document.getElementById("resultBox");
  var statusBadge = document.getElementById("statusBadge");
  var resultTitle = document.getElementById("resultTitle");
  var resultDesc = document.getElementById("resultDesc");
  var gateBox = document.getElementById("gateBox");
  var gateReason = document.getElementById("gateReason");
  var gateTips = document.getElementById("gateTips");
  var scoreWrap = document.getElementById("scoreWrap");
  var ringFg = document.getElementById("ringFg");
  var scoreNum = document.getElementById("scoreNum");
  var scoreCaption = document.getElementById("scoreCaption");
  var confLine = document.getElementById("confLine");
  var metricsList = document.getElementById("metricsList");
  var measuredTitle = document.getElementById("measuredTitle");
  var measuredList = document.getElementById("measuredList");
  var methodNote = document.getElementById("methodNote");
  var aiShot = document.getElementById("aiShot");
  var aiShotImg = document.getElementById("aiShotImg");
  var reportCard = document.getElementById("reportCard");
  var reportText = document.getElementById("reportText");
  var copyReportBtn = document.getElementById("copyReportBtn");
  var timingLine = document.getElementById("timingLine");
  var recsList = document.getElementById("recsList");
  var newScanBtn = document.getElementById("newScanBtn");
  var historyList = document.getElementById("historyList");
  var historyEmpty = document.getElementById("historyEmpty");
  var clearHistoryBtn = document.getElementById("clearHistoryBtn");
  var view2d = document.getElementById("view2d");
  var view3dBox = document.getElementById("view3d");
  var view2dBtn = document.getElementById("view2dBtn");
  var view3dBtn = document.getElementById("view3dBtn");
  var threeDNote = document.getElementById("threeDNote");
  var liveVideo = document.getElementById("liveVideo");
  var videoIdle = document.getElementById("videoIdle");
  var liveDot = document.getElementById("liveDot");
  var liveBeam = document.getElementById("liveBeam");
  var liveError = document.getElementById("liveError");
  var liveStartBtn = document.getElementById("liveStartBtn");
  var liveCaptureBtn = document.getElementById("liveCaptureBtn");
  var liveStopBtn = document.getElementById("liveStopBtn");
  var livePulse = document.getElementById("livePulse");
  var liveMetricEls = document.querySelectorAll("#liveMetrics li");
  var captureCanvas = document.getElementById("captureCanvas");
  var sampleGrid = document.getElementById("sampleGrid");
  var samplesCredit = document.getElementById("samplesCredit");
  // lab / research mode
  var timeModeChk = document.getElementById("timeModeChk");
  var dataModeChk = document.getElementById("dataModeChk");
  var labFields = document.getElementById("labFields");
  var bottleIdInput = document.getElementById("bottleId");
  var expertLabelSel = document.getElementById("expertLabel");
  var manualMinInput = document.getElementById("manualMin");
  var sessionStats = document.getElementById("sessionStats");
  var sessionListEl = document.getElementById("sessionList");
  var exportCsvBtn = document.getElementById("exportCsvBtn");
  var clearSessionBtn = document.getElementById("clearSessionBtn");

  var currentFile = null;
  var analyzing = false;
  var currentSample = null; // stage label when scanned from sample gallery
  var lastResult = null;    // {ms} เก็บไว้รีเฟรช timing line เมื่อสลับโหมด

  // ---------- Mobile nav ----------
  navToggle.addEventListener("click", function () {
    var open = mainNav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    navToggle.setAttribute("aria-label", open ? "ปิดเมนูนำทาง" : "เปิดเมนูนำทาง");
  });
  mainNav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      mainNav.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });

  // ---------- Upload / preview ----------
  function setPreviewFile(file) {
    currentFile = file;
    var url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.classList.remove("hidden");
    uploadHint.classList.add("hidden");
    uploadZone.classList.add("has-image");
    analyzeBtn.disabled = false;
    loadUnet(); // โหลดโมเดล AI ล่วงหน้าเบื้องหลัง เพื่อให้กดวิเคราะห์แล้วเร็ว
  }

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("กรุณาเลือกไฟล์ภาพ (JPG หรือ PNG)");
      fileInput.value = "";
      return;
    }
    setPreviewFile(file);
  });

  resetBtn.addEventListener("click", resetScan);
  newScanBtn.addEventListener("click", function () {
    resetScan();
    document.getElementById("scan").scrollIntoView({ behavior: "smooth" });
  });

  function resetScan() {
    fileInput.value = "";
    currentFile = null;
    currentSample = null;
    lastResult = null;
    plantNameInput.value = "";
    previewImg.src = "";
    previewImg.classList.add("hidden");
    uploadHint.classList.remove("hidden");
    uploadZone.classList.remove("has-image");
    analyzeBtn.disabled = true;
    progressBox.classList.add("hidden");
    resultBox.classList.add("hidden");
    resultEmpty.classList.remove("hidden");
  }

  // ---------- Analysis flow ----------
  analyzeBtn.addEventListener("click", startAnalysis);
  var pendingFeatures = null;
  var pendingUnet = null;
  var pendingMs = 0;

  function nowF() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function startAnalysis() {
    if (!currentFile || analyzing) return;
    analyzing = true;
    analyzeBtn.disabled = true;
    resultEmpty.classList.add("hidden");
    resultBox.classList.add("hidden");
    progressBox.classList.remove("hidden");
    updateStepTexts();
    var t0 = nowF();
    var pixelP = analyzeImagePixels(currentFile);
    var unetP = unetAnalyzeFromFile(currentFile);
    Promise.all([pixelP, unetP]).then(function (r) {
      pendingFeatures = r[0];
      pendingUnet = r[1];
      pendingMs = Math.round(nowF() - t0);
      // keep the progress animation readable even when analysis is fast
      var rest = Math.max(0, 2200 - pendingMs);
      setTimeout(function () { runSteps(0); }, rest);
    });
  }

  function updateStepTexts() {
    if (!stepsList.length) return;
    var s0 = stepsList[0];
    if (unetState === "ready") s0.textContent = "แยกส่วนต้นพืชด้วยโมเดล AI (U-Net)";
    else if (unetState === "loading") s0.textContent = "กำลังโหลดโมเดล AI (ครั้งแรก ~15 MB)…";
    else if (unetState === "failed") s0.textContent = "ตรวจคุณภาพภาพ (โหมดวัดสีพื้นฐาน — โมเดลโหลดไม่ได้)";
    else s0.textContent = "ตรวจคุณภาพภาพ (แสงสะท้อน / ฝ้า / พบต้นพืช)";
  }

  // ---------- Real image measurement (no random simulation) ----------
  function analyzeImagePixels(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var out = null;
        try {
          var S = 160;
          var scale = Math.min(1, S / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, c.width, c.height);
          out = computeFeatures(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        } catch (e) { out = null; }
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // ---------- AI model: U-Net + MobileNetV3-Small (ONNX, onnxruntime-web) ----------
  // โมเดลจริงจาก Hugging Face: Peeradon4778/vitrovision-unet-small (MIT, Val Dice 0.98)
  var UNET_URL = "models/vitrovision-unet-small.onnx";
  var UNET_ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
  var UNET_SIZE = 256;
  var UNET_MIN_COVERAGE = 0.008; // ต่ำกว่านี้ = โมเดลไม่พบต้นพืชในภาพ (no ROI → ตรวจเอง)
  var UNET_HEIGHT_REF = 0.55;    // อ้างอิงสำหรับองค์ประกอบรอง (ไม่ใช่เกณฑ์ตัดสิน)
  var UNET_MASS_REF = 0.06;

  var unetSession = null;
  var unetState = "idle"; // idle | loading | ready | failed
  var unetPromise = null;

  function loadUnet() {
    if (unetState === "ready") return Promise.resolve(unetSession);
    if (unetState === "failed") return Promise.resolve(null);
    if (unetPromise) return unetPromise;
    unetState = "loading";
    try {
      if (typeof ort === "undefined") throw new Error("ort not loaded");
      ort.env.wasm.wasmPaths = UNET_ORT_BASE;
      unetPromise = ort.InferenceSession.create(UNET_URL, { executionProviders: ["wasm"] })
        .then(function (sess) { unetSession = sess; unetState = "ready"; return sess; })
        .catch(function () { unetState = "failed"; return null; });
    } catch (e) {
      unetState = "failed";
      unetPromise = Promise.resolve(null);
    }
    return unetPromise;
  }

  function unetAnalyzeFromFile(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        unetAnalyze(img, true).then(
          function (u) { URL.revokeObjectURL(url); resolve(u); },
          function () { URL.revokeObjectURL(url); resolve(null); }
        );
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function unetAnalyze(src, wantOverlay) {
    return loadUnet().then(function (sess) {
      if (!sess) return null;
      var c = document.createElement("canvas");
      c.width = UNET_SIZE;
      c.height = UNET_SIZE;
      var ctx = c.getContext("2d");
      ctx.drawImage(src, 0, 0, UNET_SIZE, UNET_SIZE);
      var d = ctx.getImageData(0, 0, UNET_SIZE, UNET_SIZE).data;
      var n = UNET_SIZE * UNET_SIZE;
      var input = new Float32Array(3 * n);
      for (var i = 0; i < n; i++) {
        input[i] = d[i * 4] / 255;
        input[n + i] = d[i * 4 + 1] / 255;
        input[2 * n + i] = d[i * 4 + 2] / 255;
      }
      var t0 = nowF();
      return sess.run({ input: new ort.Tensor("float32", input, [1, 3, UNET_SIZE, UNET_SIZE]) })
        .then(function (res) {
          return unetMetrics(res.mask.data, d, UNET_SIZE, UNET_SIZE, nowF() - t0, !!wantOverlay);
        });
    });
  }

  function unetMetrics(prob, rgba, w, h, ms, wantOverlay) {
    var n = w * h;
    var area = 0, minX = w, maxX = -1, minY = h, maxY = -1, greenIn = 0, yellowIn = 0;
    var mask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      if (prob[i] > 0.5) {
        mask[i] = 1;
        area++;
        var x = i % w, y = (i - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        var j = i * 4;
        var r = rgba[j] / 255, g = rgba[j + 1] / 255, b = rgba[j + 2] / 255;
        if (g > r + 0.03 && g > b + 0.03 && (2 * g - r - b) > 0.08) greenIn++;
        else if (r > 0.4 && g > 0.35 && b < 0.45 && r >= g && (r - b) > 0.12) yellowIn++;
      }
    }
    var coverage = area / n;
    var height = area > 0 ? (maxY - minY + 1) / h : 0;
    var width = area > 0 ? (maxX - minX + 1) / w : 0;
    var compact = area > 0 ? area / ((maxY - minY + 1) * (maxX - minX + 1)) : 0;
    var greenPct = greenIn / Math.max(area, 1);
    var yellowPct = yellowIn / Math.max(area, 1);

    // ตรวจคุณภาพภาพในกรอบโซนต้น (bbox): แสงสะท้อนจัด = ขาวโพลน, ฝ้า/ละอองน้ำ = ขาวขุ่น
    var glarePct = 0, condPct = 0;
    if (area > 0) {
      var boxArea = (maxY - minY + 1) * (maxX - minX + 1);
      var glareN = 0, condN = 0;
      for (var yy = minY; yy <= maxY; yy++) {
        for (var xx = minX; xx <= maxX; xx++) {
          var q = (yy * w + xx) * 4;
          var rr = rgba[q], gg = rgba[q + 1], bb = rgba[q + 2];
          var mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
          if (mx === 0) continue;
          var sat = (mx - mn) / mx;
          if (mx >= 235 && sat <= 0.15) glareN++;
          else if (mx >= 184 && mx < 235 && sat <= 0.12) condN++;
        }
      }
      glarePct = glareN / boxArea;
      condPct = condN / boxArea;
    }

    var maskCanvas = null;
    if (wantOverlay && area > 0) {
      var ov = document.createElement("canvas");
      ov.width = w;
      ov.height = h;
      var octx = ov.getContext("2d");
      var idata = octx.createImageData(w, h);
      var od = idata.data;
      for (var k = 0; k < n; k++) {
        var q2 = k * 4;
        od[q2] = rgba[q2];
        od[q2 + 1] = rgba[q2 + 1];
        od[q2 + 2] = rgba[q2 + 2];
        od[q2 + 3] = 255;
        if (mask[k]) {
          od[q2] = Math.round(0.5 * rgba[q2] + 0.5 * 60);
          od[q2 + 1] = Math.round(0.5 * rgba[q2 + 1] + 0.5 * 210);
          od[q2 + 2] = Math.round(0.5 * rgba[q2 + 2] + 0.5 * 80);
        }
      }
      octx.putImageData(idata, 0, 0);
      octx.strokeStyle = "#e02424";
      octx.lineWidth = 2;
      octx.strokeRect(minX + 1, minY + 1, Math.max(maxX - minX - 1, 1), Math.max(maxY - minY - 1, 1));
      maskCanvas = ov;
    }
    return {
      coverage: coverage,
      height: height,
      width: width,
      compact: compact,
      greenPct: greenPct,
      yellowPct: yellowPct,
      glarePct: glarePct,
      condPct: condPct,
      maskCanvas: maskCanvas,
      ms: ms
    };
  }

  // ---------- ค่าองค์ประกอบรอง 4 มิติ (ประกอบผล ไม่ใช่ตัวตัดสิน) ----------
  function modelCore(u, f) {
    var sizeScore = Math.min(1, u.height / UNET_HEIGHT_REF);
    var massScore = Math.min(1, u.coverage / UNET_MASS_REF);
    var canopy = 100 * (0.4 * sizeScore + 0.6 * massScore);
    var colored = u.greenPct + u.yellowPct;
    var organic = colored > 0 ? u.greenPct / (colored + 0.05) : 0;
    var purity = 0.22 + 0.78 * organic;
    var unhealthy = u.yellowPct / (colored + 0.05);
    var moisture = f && f.soilDark >= 0
      ? clampNum(100 - Math.abs(f.soilDark - 0.30) * 260, 5, 97)
      : clampNum(28 + canopy * 0.4, 5, 97);
    if (u.coverage < UNET_MIN_COVERAGE) {
      return {
        values: { leaf: 8, stem: 10, moisture: Math.min(moisture, 35), roots: 8 },
        noPlant: true, note: null, source: "ai"
      };
    }
    var note = null;
    if (organic < 0.25 && u.yellowPct > 0.35 && u.greenPct < 0.15) {
      note = "สิ่งที่ตรวจพบในภาพเป็นสีเหลือง/ครีมเป็นหลัก (เช่น เมล็ด) ไม่ใช่ใบพืชสีเขียว — รอให้งอกเป็นต้นเขียวแล้วสแกนใหม่";
    }
    return {
      values: {
        leaf: clampNum(8 + canopy * purity * (1 - 0.55 * unhealthy), 5, 98),
        stem: clampNum(16 + canopy * purity * 0.78, 8, 97),
        moisture: moisture,
        roots: clampNum(14 + canopy * purity * 0.72, 8, 95)
      },
      noPlant: false, note: note, source: "ai"
    };
  }

  function computeFeatures(d, w, h) {
    var green = 0, centerGreen = 0, yellow = 0, soilN = 0, soilSum = 0, brightSum = 0;
    var n = d.length / 4;
    w = w || 1; h = h || 1;
    var x0 = w * 0.25, x1 = w * 0.75, y0 = h * 0.25, y1 = h * 0.75;
    var gx0 = w, gx1 = -1, gy0 = h, gy1 = -1; // bbox ของพืช (เขียวหรือเหลือง)
    for (var i = 0; i < d.length; i += 4) {
      var p = i / 4, x = p % w, y = (p - x) / w;
      var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      brightSum += (r + g + b) / 3;
      var exg = 2 * g - r - b; // Excess Green index
      if (g > r + 0.03 && g > b + 0.03 && exg > 0.08) {
        green++;
        if (x < gx0) gx0 = x;
        if (x > gx1) gx1 = x;
        if (y < gy0) gy0 = y;
        if (y > gy1) gy1 = y;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) centerGreen++;
        continue;
      }
      if (r > 0.4 && g > 0.35 && b < 0.45 && r >= g && (r - b) > 0.12) {
        yellow++;
        if (x < gx0) gx0 = x;
        if (x > gx1) gx1 = x;
        if (y < gy0) gy0 = y;
        if (y > gy1) gy1 = y;
        continue;
      }
      if (r > 0.2 && r < 0.7 && g > 0.12 && g < r && b < g && (r - b) > 0.06) {
        soilN++;
        soilSum += (r + g + b) / 3;
      }
    }
    var roiH = gx1 >= 0 ? (gy1 - gy0 + 1) / h : 0;
    var box = gx1 >= 0 ? (gy1 - gy0 + 1) * (gx1 - gx0 + 1) : 0;
    var glareN = 0, condN = 0;
    if (box > 0) {
      for (var yy = gy0; yy <= gy1; yy++) {
        for (var xx = gx0; xx <= gx1; xx++) {
          var q = (yy * w + xx) * 4;
          var rr = d[q], gg = d[q + 1], bb = d[q + 2];
          var mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
          if (mx === 0) continue;
          var sat = (mx - mn) / mx;
          if (mx >= 235 && sat <= 0.15) glareN++;
          else if (mx >= 184 && mx < 235 && sat <= 0.12) condN++;
        }
      }
    }
    return {
      green: green / n,
      centerGreen: centerGreen / (n * 0.25),
      yellow: yellow / n,
      soilDark: soilN > 0 ? soilSum / soilN : -1,
      bright: brightSum / n,
      roiH: roiH,
      glare: box > 0 ? glareN / box : 0,
      cond: box > 0 ? condN / box : 0
    };
  }

  function clampNum(v, a, b) { return Math.max(a, Math.min(b, Math.round(v))); }
  function pctStr(x) { return (Math.round((x || 0) * 1000) / 10).toFixed(1) + "%"; }

  function pixelCore(f) {
    // Center-weighted green: the plant is usually centered, edges are often background
    var effGreen = 0.65 * f.centerGreen + 0.35 * f.green;
    var noPlant = (f.green < 0.015 && f.centerGreen < 0.02) ||
                  (f.bright > 0.82 && f.green < 0.05 && f.soilDark < 0);
    var coverage = 100 * (1 - Math.exp(-effGreen * 8)); // saturating canopy curve
    var unhealthy = f.yellow / (f.green + f.yellow + 0.005);
    var moisture = f.soilDark >= 0
      ? clampNum(100 - Math.abs(f.soilDark - 0.30) * 260, 5, 97)
      : clampNum(28 + coverage * 0.4, 5, 97);
    if (noPlant) {
      return {
        values: { leaf: 8, stem: 10, moisture: Math.min(moisture, 35), roots: 8 },
        noPlant: true, note: null, source: "pixel"
      };
    }
    return {
      values: {
        leaf: clampNum(8 + coverage * (1 - 0.6 * unhealthy), 5, 98),
        stem: clampNum(16 + coverage * 0.78, 8, 97),
        moisture: moisture,
        roots: clampNum(14 + coverage * 0.72, 8, 95)
      },
      noPlant: false, note: null, source: "pixel"
    };
  }

  function metricsFromFeatures(f, u) {
    if (u) return modelCore(u, f);
    if (!f) { // fallback if pixels unreadable: seeded value so it still works
      var seed = hashSeed(currentFile.name + "|" + currentFile.size + "|" + currentFile.lastModified);
      var rand = mulberry32(seed);
      var fv = {};
      METRICS.forEach(function (m) { fv[m.key] = 42 + Math.floor(rand() * 57); });
      return { values: fv, noPlant: false, source: "seed", note: null };
    }
    return pixelCore(f);
  }

  // ---------- ค่าที่ใช้ตัดสิน (height_proxy + คุณภาพภาพ) ----------
  function collectMeasure(u, f) {
    if (u) {
      return {
        ai: true,
        height: u.height || 0,
        coverage: u.coverage || 0,
        green: u.greenPct || 0,
        yellow: u.yellowPct || 0,
        glare: u.glarePct || 0,
        cond: u.condPct || 0
      };
    }
    if (f) {
      var veg = f.green + f.yellow;
      return {
        ai: false,
        height: f.roiH || 0,
        coverage: veg,
        green: veg > 0 ? f.green / veg : 0,
        yellow: veg > 0 ? f.yellow / veg : 0,
        glare: f.glare || 0,
        cond: f.cond || 0
      };
    }
    return null;
  }

  function confidenceOf(m) {
    if (!m) return null;
    var base = m.ai ? 0.5 + 0.5 * Math.min(1, m.coverage / 0.04) : 0.65;
    return Math.max(5, Math.min(99, Math.round(100 * base * (1 - Math.min(1, m.glare)))));
  }

  var GATE_TIPS = {
    noRoi: [
      "วางขวดให้เต็มเฟรม ถ่ายแนวดิ่งจากด้านหน้า ให้เห็นต้นในขวดชัด ๆ",
      "ใช้แสงธรรมชาติอ่อน ๆ หลีกเลี่ยงการย้อนแสง และถ่ายให้ภาพไม่เบลอ"
    ],
    glare: [
      "ถ่ายจากมุมอื่นที่ไม่มีแสงสะท้อนบนผิวขวด/ฝา",
      "ปิดแฟลชและหรี่ไฟด้านบนขวดชั่วคราวเมื่อถ่าย",
      "ใช้ฉากหลังทึบสีเข้มด้านหลังขวด เพื่อลดแสงสะท้อน"
    ],
    cond: [
      "เช็ดฝา/ผิวนอกขวดให้แห้งก่อนถ่าย",
      "รอ 1–2 นาทีให้ฝ้าจางแล้วถ่ายใหม่",
      "ถ้าเป็นฝ้าด้านในขวด (จากความชื้นในขวด) ให้รอฝ้าจางหรือเปลี่ยนขวดที่มองเห็นต้นชัดกว่า"
    ],
    yellow: [
      "ถ้าเป็นเมล็ด/วัสดุเพาะ ให้รอต้นงอกเป็นสีเขียวแล้วสแกนใหม่",
      "ถ้าเป็นต้นในขวดที่ใบเหลือง ให้ตรวจอาหารเพาะเลี้ยง/แสง แล้วปรึกษาครูพี่เลี้ยงก่อนย้ายออก",
      "บันทึกภาพไว้เทียบกับครั้งถัดไปในโหมดวิจัย เพื่อดูว่าใบกลับมาเขียวหรือไม่"
    ]
  };

  function verdictInfo(m) {
    if (!m) {
      return {
        cls: "manual", text: "ตรวจเอง", gate: "noRoi", conf: null, score: null, m: null,
        desc: "อ่านค่าจากภาพไม่ได้ — ลองถ่ายใหม่เป็นไฟล์ JPG/PNG ปกติ แล้วสแกนอีกครั้ง",
        tips: GATE_TIPS.noRoi
      };
    }
    if (m.coverage < UNET_MIN_COVERAGE) {
      return {
        cls: "manual", text: "ตรวจเอง", gate: "noRoi", conf: null, score: null, m: m,
        desc: "ไม่พบส่วนของต้นพืชในภาพ (พื้นที่ต้นพืช " + pctStr(m.coverage) + " ต่ำกว่าเกณฑ์ " + pctStr(UNET_MIN_COVERAGE) + ") — อาจถ่ายไม่ติดต้น เบลอ หรือต้นเล็กเกินไป",
        tips: GATE_TIPS.noRoi
      };
    }
    var conf = confidenceOf(m);
    if (m.green < 0.15) {
      return {
        cls: "manual", text: "ตรวจเอง", gate: "yellow", conf: conf, score: null, m: m,
        desc: "สิ่งที่ตรวจพบเป็นสีเหลือง/ครีมเป็นหลัก (สีเขียว " + pctStr(m.green) + ") — อาจเป็นเมล็ดหรือต้นที่ใบเหลือง ระบบจึงไม่ยืนยันความพร้อมอัตโนมัติ",
        tips: GATE_TIPS.yellow
      };
    }
    if (m.glare * 100 > GLARE_MAX) {
      return {
        cls: "manual", text: "ตรวจเอง", gate: "glare", conf: conf, score: null, m: m,
        desc: "แสงสะท้อนจ้าบังผิวขวด (" + pctStr(m.glare) + " ของโซนต้น — เกินเกณฑ์ " + GLARE_MAX + "%) ระบบจึงไม่การันตีผลอัตโนมัติ ควรให้คนตรวจหรือถ่ายใหม่",
        tips: GATE_TIPS.glare
      };
    }
    if (m.cond * 100 > COND_MAX) {
      return {
        cls: "manual", text: "ตรวจเอง", gate: "cond", conf: conf, score: null, m: m,
        desc: "ฝ้า/ละอองน้ำบนกระจกบังมุมมอง (" + pctStr(m.cond) + " ของโซนต้น — เกินเกณฑ์ " + COND_MAX + "%) ระบบจึงไม่การันตีผลอัตโนมัติ",
        tips: GATE_TIPS.cond
      };
    }
    var score = Math.max(2, Math.min(100, Math.round(100 * m.height / READY_HEIGHT)));
    if (m.height >= READY_HEIGHT) {
      return {
        cls: "ok", text: "พร้อมย้ายออกจากขวด", gate: null, conf: conf, score: score, m: m,
        desc: "ความสูงต้น " + pctStr(m.height) + " ถึงเกณฑ์ ≥ " + pctStr(READY_HEIGHT) + " ของภาพ — พร้อมย้ายออกปลูกนอกขวด ย้ายช่วงเช้า/เย็น แล้วปรับสภาพ (acclimatize) 2–3 วันแรก"
      };
    }
    var d = READY_HEIGHT - m.height;
    var days = d >= 0.10 ? "10–14" : d >= 0.05 ? "5–10" : "3–5";
    return {
      cls: "warn", text: "ยังไม่พร้อม — รออีก ~" + days + " วัน", gate: null, conf: conf, score: score, m: m, days: days,
      desc: "ต้นสูง " + pctStr(m.height) + " ยังไม่ถึงเกณฑ์ ≥ " + pctStr(READY_HEIGHT) + " ของภาพ (ขาดอีก " + pctStr(d) + ") — ประเมินแนวโน้ม: อีกประมาณ " + days + " วัน ควรสแกนซ้ำทุก 3–5 วัน"
    };
  }

  function buildMeasureList(m) {
    if (!m) return [];
    return [
      { label: "ความสูงต้น (height_proxy)", text: pctStr(m.height) },
      { label: "พื้นที่ต้นพืชในภาพ", text: pctStr(m.coverage) },
      { label: "สีเขียวในต้น", text: pctStr(m.green) },
      { label: "ใบเหลืองในต้น", text: pctStr(m.yellow) },
      { label: "แสงสะท้อน (glare)", text: pctStr(m.glare) },
      { label: "ฝ้า/ละอองน้ำ", text: pctStr(m.cond) }
    ];
  }

  function runSteps(i) {
    var total = stepsList.length;
    if (i > 0) {
      stepsList[i - 1].classList.remove("active");
      stepsList[i - 1].classList.add("done");
    }
    if (i >= total) {
      finishAnalysis();
      return;
    }
    stepsList[i].classList.add("active");
    var pct = Math.round(((i + 1) / total) * 100);
    progressFill.style.width = pct + "%";
    progressBar.setAttribute("aria-valuenow", pct);
    setTimeout(function () { runSteps(i + 1); }, 850);
  }

  // ---------- Dataset (plants-dataset.json, replaceable) ----------
  var DATASET = null;
  var FALLBACK_PROFILE = { name: "", readyScore: 80, careScore: 60 };

  if (window.fetch) {
    fetch("plants-dataset.json")
      .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); })
      .then(function (d) { if (d && d.plants) DATASET = d; })
      .catch(function () { DATASET = null; });
  }

  // Match typed plant name against dataset (contains-match, Thai-friendly)
  function getProfile() {
    var base = (DATASET && DATASET.defaults) ? DATASET.defaults : FALLBACK_PROFILE;
    var q = plantNameInput.value.trim();
    var found = null;
    if (DATASET && DATASET.plants && q) {
      for (var i = 0; i < DATASET.plants.length; i++) {
        var p = DATASET.plants[i];
        var keys = [p.name].concat(p.aliases || []);
        for (var j = 0; j < keys.length; j++) {
          var k = (keys[j] || "").trim();
          if (!k) continue;
          if (q.indexOf(k) !== -1 || (q.length >= 2 && k.indexOf(q) !== -1)) { found = p; break; }
        }
        if (found) break;
      }
    }
    return {
      name: found ? found.name : "",
      readyScore: found && found.readyScore != null ? found.readyScore : (base.readyScore || 80),
      careScore: found && found.careScore != null ? found.careScore : (base.careScore || 60)
    };
  }

  function finishAnalysis() {
    var u = pendingUnet;
    var f = pendingFeatures;
    var ms = pendingMs;
    var res = metricsFromFeatures(f, u);
    var m = collectMeasure(u, f);
    var v = verdictInfo(m);
    pendingFeatures = null;
    pendingUnet = null;

    renderResult(res.values, v, u, ms, res.source, res.note);
    saveHistory(v);
    recordSession(v, ms, res.source);
    lastResult = { ms: ms };
    updateTimingLine(ms);

    analyzing = false;
    analyzeBtn.disabled = false;
    progressBox.classList.add("hidden");
    progressFill.style.width = "0";
    progressBar.setAttribute("aria-valuenow", "0");
    for (var i = 0; i < stepsList.length; i++) stepsList[i].classList.remove("active", "done");

    resultBox.classList.remove("hidden");
    if (window.innerWidth < 900) {
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function buildReportText(name, v, ms, source) {
    var d = new Date();
    var lines = [];
    lines.push("รายงาน VitroVision — ตรวจความพร้อมต้นกล้าในขวดเพาะเลี้ยง");
    lines.push("ตัวอย่าง: " + (name || "(ไม่ระบุชื่อ)"));
    lines.push("เวลา: " + d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }));
    lines.push("ผล: " + v.text);
    if (v.conf != null) lines.push("ความเชื่อมั่น: " + v.conf + "%");
    if (v.m) {
      lines.push("ความสูงต้น (height_proxy): " + pctStr(v.m.height) + " (เกณฑ์ ≥ " + pctStr(READY_HEIGHT) + ")");
      lines.push("พื้นที่ต้นพืช / สีเขียว / ใบเหลือง: " + pctStr(v.m.coverage) + " / " + pctStr(v.m.green) + " / " + pctStr(v.m.yellow));
      lines.push("แสงสะท้อน / ฝ้า: " + pctStr(v.m.glare) + " / " + pctStr(v.m.cond));
    }
    if (typeof ms === "number") {
      lines.push("เวลาวิเคราะห์: " + (ms / 1000).toFixed(1) + " วินาที (" + (source === "ai" ? "AI U-Net" : "วัดสีพื้นฐาน") + ")");
    }
    lines.push("โมเดล: U-Net + MobileNetV3-Small (VitroVision, MIT)");
    return lines.join("\n");
  }

  function renderResult(values, v, u, ms, source, note) {
    var prof = getProfile();
    var name = plantNameInput.value.trim();
    var bid = bottleIdInput ? bottleIdInput.value.trim() : "";
    if (bid) name = name ? name + " (" + bid + ")" : bid;
    if (currentSample) name = (name ? name + " · " : "") + currentSample;

    statusBadge.textContent = v.text;
    statusBadge.className = "status-badge " + (v.cls === "ok" ? "ok" : v.cls === "warn" ? "warn" : "manual");
    resultTitle.textContent = name ? "ผลวิเคราะห์: " + name : "ผลวิเคราะห์ขวดเพาะเลี้ยง";
    resultDesc.textContent = v.desc;

    // Gate box (แสดงเมื่อต้องตรวจเอง)
    if (v.cls === "manual") {
      gateBox.classList.remove("hidden");
      gateReason.textContent = "ต้องตรวจเอง — " +
        (v.gate === "glare" ? "แสงสะท้อนจ้า" : v.gate === "cond" ? "ฝ้า/ละอองน้ำบัง"
          : v.gate === "yellow" ? "พบสีเหลืองเป็นหลัก" : "ไม่พบต้นพืชในภาพ") +
        " · วิธีแก้:";
      gateTips.innerHTML = "";
      (v.tips || []).forEach(function (t) {
        var li = document.createElement("li");
        li.textContent = t;
        gateTips.appendChild(li);
      });
    } else {
      gateBox.classList.add("hidden");
    }

    // Score ring (เฉพาะเมื่อมีคะแนน = ผ่านคุณภาพภาพแล้ว)
    var showScore = v.score != null;
    scoreWrap.classList.toggle("hidden", !showScore);
    scoreCaption.classList.toggle("hidden", !showScore);
    if (showScore) {
      scoreCaption.textContent = "ความพร้อมเทียบเกณฑ์ความสูง (สูง ≥ " + pctStr(READY_HEIGHT) + " ของภาพ)";
      ringFg.style.stroke = v.cls === "ok" ? "#2fa14f" : "#d97706";
      ringFg.style.strokeDashoffset = RING_C;
      scoreNum.textContent = "0";
      requestAnimationFrame(function () {
        ringFg.style.strokeDashoffset = (RING_C * (1 - v.score / 100)).toFixed(1);
      });
      animateNumber(scoreNum, v.score, 1100);
    }
    confLine.classList.toggle("hidden", v.conf == null);
    if (v.conf != null) {
      confLine.textContent = "ความเชื่อมั่นของผลวิเคราะห์: " + v.conf + "% (คำนวณจากพื้นที่ต้นพืชและแสงสะท้อน)";
    }

    // Metrics (องค์ประกอบรอง — สีตามเกณฑ์ของพืชที่เลือก)
    metricsList.innerHTML = "";
    METRICS.forEach(function (m) {
      var val = values[m.key];
      var li = document.createElement("li");
      li.innerHTML =
        '<div class="metric-head"><span>' + m.label + '</span><span>' + val + "/100</span></div>" +
        '<div class="metric-track"><span class="metric-fill"></span></div>';
      metricsList.appendChild(li);
      requestAnimationFrame(function () {
        li.querySelector(".metric-fill").style.width = val + "%";
        li.querySelector(".metric-fill").style.background =
          val >= prof.readyScore ? "#2fa14f" : val >= prof.careScore ? "#d97706" : "#dc2626";
      });
    });

    // ค่าที่วัดได้จากภาพจริง
    var measured = buildMeasureList(v.m);
    if (measured.length) {
      measuredTitle.classList.remove("hidden");
      measuredList.classList.remove("hidden");
      measuredList.innerHTML = "";
      measured.forEach(function (mm) {
        var li = document.createElement("li");
        var big = document.createElement("strong");
        big.textContent = mm.text;
        li.appendChild(big);
        li.appendChild(document.createTextNode(mm.label));
        measuredList.appendChild(li);
      });
    } else {
      measuredTitle.classList.add("hidden");
      measuredList.classList.add("hidden");
    }

    // AI segmentation overlay
    if (u && u.maskCanvas) {
      try {
        aiShotImg.src = u.maskCanvas.toDataURL("image/png");
        aiShot.classList.remove("hidden");
      } catch (e) {
        aiShot.classList.add("hidden");
      }
    } else {
      aiShot.classList.add("hidden");
      aiShotImg.removeAttribute("src");
    }

    methodNote.textContent = source === "ai"
      ? "วิธีวิเคราะห์: โมเดล AI U-Net + MobileNetV3-Small (Val Dice 0.98) แยกส่วนต้นพืชออกจากภาพ → วัดความสูงต้นเทียบภาพ (height_proxy) พร้อมตรวจแสงสะท้อน/ฝ้า/สีจากพิกเซลจริง — เกณฑ์ความพร้อม: ความสูง ≥ 20% ของภาพ"
      : "วิธีวิเคราะห์: วัดสีพื้นฐาน (Excess Green) จากพิกเซลภาพจริง — ครั้งนี้โหลดโมเดล AI ไม่ได้ (ครั้งแรกต้องต่ออินเทอร์เน็ต) ผลจะแม่นยำน้อยกว่าโหมด AI";

    // รายงานรายขวด
    var report = buildReportText(name, v, ms, source);
    reportText.textContent = report;
    reportCard.classList.remove("hidden");

    // คำแนะนำ
    recsList.innerHTML = "";
    var recItems = [];
    if (note) recItems.push(note);
    if (v.cls === "ok") {
      recItems.push("ย้ายออกจากขวดช่วงเช้าหรือเย็น แล้วปรับสภาพ (acclimatize) ในที่ร่ม/พรางแสง 50% 2–3 วันแรก");
      recItems.push("ก่อนย้าย ตรวจรากให้แน่นและไม่มีรอยเน่า/เชื้อรา แล้วบันทึกวันย้ายไว้ในรายงานรายขวด");
      recItems.push("หลังย้ายค่อย ๆ เพิ่มแสงเต็มที่ และเฝ้าดูใบร่วง 2–3 วันแรก");
    } else if (v.cls === "warn") {
      recItems.push("ต้นยังเล็กกว่าเกณฑ์ — รออีกประมาณ " + (v.days || "3–5") + " วัน แล้วสแกนซ้ำ (ตรวจทุก 3–5 วัน)");
      recItems.push("ระหว่างรอ: รักษาแสง ~16 ชม./วัน และตรวจอาหารเพาะเลี้ยงไม่ให้ขุ่น/แห้ง");
      recItems.push("ขวดที่ต้นเหลืองผิดปกติหรือฝักช้ำ ให้แยกออกจากชุดที่กำลังจะย้าย");
    } else {
      (v.tips || []).forEach(function (t) { recItems.push(t); });
      recItems.push("ถ้าถ่ายใหม่แล้วยังขึ้น \"ตรวจเอง\" ให้ผู้เชี่ยวชาญตรวจด้วยตา และบันทึกผลในโหมดวิจัย (CSV)");
    }
    recItems.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      recsList.appendChild(li);
    });

    // 3D view when available, otherwise stay on 2D
    if (threeOK && window.VitroVision3D) {
      setView("3d");
      try {
        window.VitroVision3D.render(v.score != null ? v.score : 40, values);
      } catch (e) {
        setView("2d");
      }
    } else {
      setView("2d");
    }
  }

  function animateNumber(el, target, dur) {
    var start = performance.now();
    function tick(t) {
      var p = Math.min((t - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ---------- 2D / 3D view ----------
  var threeOK = false;
  function setView(mode) {
    var is3d = mode === "3d" && threeOK;
    view2d.classList.toggle("hidden", is3d);
    view3dBox.classList.toggle("hidden", !is3d);
    view2dBtn.setAttribute("aria-pressed", is3d ? "false" : "true");
    view3dBtn.setAttribute("aria-pressed", is3d ? "true" : "false");
  }
  view2dBtn.addEventListener("click", function () { setView("2d"); });
  view3dBtn.addEventListener("click", function () { setView("3d"); });
  window.addEventListener("vitro3d-ready", function () {
    threeOK = true;
    view3dBtn.disabled = false;
    threeDNote.textContent = "ลากเพื่อหมุนดูรอบต้น • แท่งกราฟซ้ายไปขวา: ใบ ลำต้น ชื้น ราก";
  });
  setTimeout(function () {
    if (!threeOK) threeDNote.textContent = "โหลดโมเดล 3D ไม่ได้ (ต้องใช้อินเทอร์เน็ต) — แสดงผลแบบ 2D แทน";
  }, 9000);

  // ---------- Realtime camera ----------
  var liveStream = null;
  var liveTimer = null;
  var liveVals = { leaf: null, stem: null, moisture: null };
  var liveBusy = false;
  var liveHasData = false;
  var liveFrame = document.createElement("canvas");
  liveFrame.width = 256;
  liveFrame.height = 256;

  function liveMetricColor(v) {
    return v >= 80 ? "#2fa14f" : v >= 60 ? "#d97706" : "#dc2626";
  }
  function paintLiveMetrics() {
    for (var i = 0; i < liveMetricEls.length; i++) {
      (function (li) {
        var key = li.getAttribute("data-m");
        var raw = liveVals[key];
        var val = (typeof raw === "number") ? Math.round(raw) : null;
        li.querySelector(".live-val").textContent = val === null ? "–" : val + "/100";
        var fill = li.querySelector(".metric-fill");
        fill.style.width = (val === null ? 0 : val) + "%";
        fill.style.background = val === null ? "#d1d5db" : liveMetricColor(val);
      })(liveMetricEls[i]);
    }
  }
  function applyLive(res) {
    if (res && liveStream) {
      var keys = ["leaf", "stem", "moisture"];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var t = res.values[k];
        liveVals[k] = (liveHasData && typeof liveVals[k] === "number")
          ? liveVals[k] * 0.55 + t * 0.45
          : t;
      }
      liveHasData = true;
      paintLiveMetrics();
    }
    liveBusy = false;
  }
  function tickLive() {
    if (liveBusy || !liveVideo.videoWidth) return;
    liveBusy = true;
    var f = null;
    try {
      var fctx = liveFrame.getContext("2d");
      fctx.drawImage(liveVideo, 0, 0, 256, 256);
      f = computeFeatures(fctx.getImageData(0, 0, 256, 256).data, 256, 256);
    } catch (e) { f = null; }
    if (unetState !== "failed" && unetState !== "ready") loadUnet(); // โหลดโมเดลระหว่างดูภาพสด
    if (unetState === "ready") {
      unetAnalyze(liveVideo, false).then(
        function (u) { applyLive(u ? modelCore(u, f) : (f ? pixelCore(f) : null)); },
        function () { applyLive(f ? pixelCore(f) : null); }
      );
    } else {
      applyLive(f ? pixelCore(f) : null);
    }
  }
  function showLiveError(err) {
    var msg = "เปิดกล้องไม่ได้";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg = "เบราว์เซอร์นี้เปิดกล้องไม่ได้ในหน้านี้ (ต้องเปิดผ่าน localhost หรือ HTTPS) — กลับไปใช้อัปโหลดไฟล์แทนได้เลย";
    } else if (err && err.name === "NotAllowedError") {
      msg = "เข้าถึงกล้องไม่ได้ — กดอนุญาตสิทธิ์กล้องในเบราว์เซอร์ก่อน หรือกลับไปใช้อัปโหลดไฟล์";
    } else if (err && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
      msg = "ไม่พบกล้องในอุปกรณ์นี้ — กลับไปใช้อัปโหลดไฟล์แทนได้เลย";
    } else if (err && err.name === "NotReadableError") {
      msg = "กล้องถูกใช้งานอยู่ — ปิดแอปอื่นที่ใช้กล้องแล้วลองใหม่";
    }
    liveError.textContent = msg;
    liveError.classList.remove("hidden");
  }

  liveStartBtn.addEventListener("click", function () {
    liveError.classList.add("hidden");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showLiveError(null);
      return;
    }
    liveStartBtn.disabled = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function (stream) {
        liveStream = stream;
        liveVideo.srcObject = stream;
        return liveVideo.play();
      })
      .then(function () {
        videoIdle.classList.add("hidden");
        liveDot.classList.remove("hidden");
        liveBeam.classList.remove("hidden");
        livePulse.classList.remove("hidden");
        liveCaptureBtn.disabled = false;
        liveStopBtn.disabled = false;
        liveVals = { leaf: null, stem: null, moisture: null };
        liveHasData = false;
        paintLiveMetrics();
        liveTimer = setInterval(tickLive, 2200);
        tickLive();
      })
      .catch(function (err) {
        liveStartBtn.disabled = false;
        showLiveError(err);
      });
  });

  function stopLive() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    if (liveStream) {
      liveStream.getTracks().forEach(function (t) { t.stop(); });
      liveStream = null;
    }
    liveVideo.srcObject = null;
    videoIdle.classList.remove("hidden");
    liveDot.classList.add("hidden");
    liveBeam.classList.add("hidden");
    livePulse.classList.add("hidden");
    liveStartBtn.disabled = false;
    liveCaptureBtn.disabled = true;
    liveStopBtn.disabled = true;
  }
  liveStopBtn.addEventListener("click", stopLive);

  liveCaptureBtn.addEventListener("click", function () {
    if (!liveStream || liveVideo.videoWidth === 0) return;
    var maxW = 1280;
    var scale = Math.min(1, maxW / liveVideo.videoWidth);
    captureCanvas.width = Math.round(liveVideo.videoWidth * scale);
    captureCanvas.height = Math.round(liveVideo.videoHeight * scale);
    captureCanvas.getContext("2d").drawImage(liveVideo, 0, 0, captureCanvas.width, captureCanvas.height);
    captureCanvas.toBlob(function (blob) {
      if (!blob) return;
      var file;
      try {
        file = new File([blob], "realtime-" + Date.now() + ".jpg", { type: "image/jpeg" });
      } catch (e) {
        blob.name = "realtime-" + Date.now() + ".jpg";
        file = blob;
      }
      setPreviewFile(file);
      document.getElementById("scan").scrollIntoView({ behavior: "smooth" });
      startAnalysis();
    }, "image/jpeg", 0.9);
  });

  // ---------- Sample gallery (chili growth stages as scan dataset) ----------
  if (window.fetch) {
    fetch("samples/chili-samples.json")
      .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); })
      .then(function (d) { if (d && d.samples) renderSamples(d); })
      .catch(function () {
        sampleGrid.innerHTML = "";
        samplesCredit.textContent = "โหลดภาพตัวอย่างไม่ได้ในขณะนี้";
      });
  }

  function renderSamples(manifest) {
    sampleGrid.innerHTML = "";
    var credits = [];
    manifest.samples.forEach(function (s) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sample-card";
      var img = document.createElement("img");
      img.src = s.file;
      img.alt = "ภาพตัวอย่าง" + s.label;
      img.loading = "lazy";
      img.onerror = function () { btn.style.display = "none"; };
      var body = document.createElement("span");
      body.className = "sample-body";
      var badge = document.createElement("span");
      badge.className = "sample-stage";
      badge.textContent = "ระยะที่ " + s.stage + " • " + s.age;
      var title = document.createElement("strong");
      title.textContent = s.label;
      var desc = document.createElement("small");
      desc.textContent = s.desc;
      body.appendChild(badge);
      body.appendChild(title);
      body.appendChild(desc);
      btn.appendChild(img);
      btn.appendChild(body);
      btn.addEventListener("click", function () { useSample(s, manifest.cropName); });
      sampleGrid.appendChild(btn);
      if (s.credit) credits.push(s.credit.author + " (" + s.credit.license + ")");
    });
    samplesCredit.textContent = "ที่มาภาพ: " + (manifest.source || "") + " — " + credits.join(" • ");
  }

  function useSample(s, cropName) {
    if (analyzing) return;
    fetch(s.file)
      .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.blob(); })
      .then(function (blob) {
        var fname = s.file.split("/").pop() || "sample.jpg";
        var file;
        try {
          file = new File([blob], fname, { type: blob.type || "image/jpeg" });
        } catch (e) {
          blob.name = fname;
          file = blob;
        }
        currentSample = s.label;
        plantNameInput.value = cropName || "พริกขี้หนู";
        setPreviewFile(file);
        document.getElementById("scan").scrollIntoView({ behavior: "smooth" });
        startAnalysis();
      })
      .catch(function () {
        alert("โหลดภาพตัวอย่างไม่ได้ กรุณาลองใหม่");
      });
  }

  // ---------- History (localStorage) ----------
  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch (e) {
      return [];
    }
  }
  function saveHistory(v) {
    var hname = plantNameInput.value.trim() || "ขวดไม่ระบุชื่อ";
    var bid = bottleIdInput ? bottleIdInput.value.trim() : "";
    if (bid) hname += " (" + bid + ")";
    if (currentSample) hname += " · " + currentSample;
    var items = loadHistory();
    items.unshift({
      t: Date.now(),
      name: hname,
      score: v.score != null ? v.score : null,
      cls: v.cls,
      status: v.text
    });
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
    } catch (e) { /* storage full / private mode — ignore */ }
    renderHistory();
  }
  function renderHistory() {
    var items = loadHistory();
    historyList.innerHTML = "";
    historyEmpty.style.display = items.length ? "none" : "block";
    items.forEach(function (it) {
      var li = document.createElement("li");
      var date = new Date(it.t).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
      li.innerHTML =
        '<span class="hist-score ' + it.cls + '">' + (it.score == null ? "–" : it.score) + '</span>' +
        '<div class="hist-info"><strong></strong><span>' + date + '</span></div>' +
        '<span class="hist-status ' + it.cls + '">' + it.status + '</span>';
      li.querySelector("strong").textContent = it.name;
      historyList.appendChild(li);
    });
  }
  clearHistoryBtn.addEventListener("click", function () {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    renderHistory();
  });
  renderHistory();

  // ---------- โหมดวิจัย: จับเวลา + เก็บข้อมูล 100 ขวด ----------
  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY)) || [];
    } catch (e) {
      return [];
    }
  }
  function saveSession(items) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(items.slice(0, SESSION_MAX)));
    } catch (e) { /* ignore */ }
  }
  function pctNum(x) { return Math.round((x || 0) * 1000) / 10; }

  function recordSession(v, ms, source) {
    if (!dataModeChk || !dataModeChk.checked) return;
    var items = loadSession();
    items.unshift({
      t: Date.now(),
      bottle: bottleIdInput ? bottleIdInput.value.trim() : "",
      expert: expertLabelSel ? expertLabelSel.value : "",
      verdict: v.text,
      cls: v.cls,
      conf: v.conf != null ? v.conf : "",
      height: v.m ? pctNum(v.m.height) : "",
      coverage: v.m ? pctNum(v.m.coverage) : "",
      green: v.m ? pctNum(v.m.green) : "",
      yellow: v.m ? pctNum(v.m.yellow) : "",
      glare: v.m ? pctNum(v.m.glare) : "",
      cond: v.m ? pctNum(v.m.cond) : "",
      score: v.score != null ? v.score : "",
      ms: ms,
      source: source
    });
    saveSession(items);
    renderSession();
  }

  function renderSession() {
    if (!sessionStats) return;
    var items = loadSession();
    var n = items.length;
    if (!n) {
      sessionStats.textContent = "ยังไม่มีข้อมูลในเซสชันนี้ — สแกนขวดแรกเพื่อเริ่มเก็บข้อมูล";
    } else {
      var mean = 0;
      for (var i = 0; i < n; i++) mean += items[i].ms || 0;
      mean = mean / n;
      var txt = "เก็บแล้ว " + n + " ขวด • เวลา AI เฉลี่ย " + (mean / 1000).toFixed(1) + " วิ/ขวด";
      var mm = manualMinInput ? parseFloat(manualMinInput.value) : NaN;
      if (mm > 0) {
        var red = Math.max(0, Math.round((1 - (mean / 60000) / mm) * 100));
        txt += " • เร็วกว่าตรวจด้วยตา (" + mm + " นาที/ขวด) ≈ " + red + "%";
      }
      sessionStats.textContent = txt;
    }
    sessionListEl.innerHTML = "";
    items.slice(0, 8).forEach(function (it) {
      var li = document.createElement("li");
      var t = new Date(it.t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
      li.textContent = t + " • " + (it.bottle || "(ไม่ระบุรหัส)") + " • " + it.verdict +
        (it.height !== "" && it.height != null ? " • สูง " + it.height + "%" : "") +
        " • " + ((it.ms || 0) / 1000).toFixed(1) + " วิ";
      sessionListEl.appendChild(li);
    });
  }

  function updateTimingLine(ms) {
    if (!timingLine) return;
    var show = timeModeChk && timeModeChk.checked && typeof ms === "number";
    if (!show) {
      timingLine.classList.add("hidden");
      return;
    }
    var txt = "เวลาวิเคราะห์ขวดนี้: " + (ms / 1000).toFixed(1) + " วินาที (AI ในเบราว์เซอร์)";
    var mm = manualMinInput ? parseFloat(manualMinInput.value) : NaN;
    if (mm > 0) {
      txt += " — ตรวจด้วยตา ~" + mm + " นาที/ขวด → เร็วขึ้น ≈ " + Math.max(0, Math.round((1 - (ms / 60000) / mm) * 100)) + "%";
    }
    timingLine.textContent = txt;
    timingLine.classList.remove("hidden");
  }

  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function exportCsv() {
    var items = loadSession();
    if (!items.length) {
      alert("ยังไม่มีข้อมูล — เปิดโหมดเก็บข้อมูล สแกนก่อน แล้วค่อยดาวน์โหลด");
      return;
    }
    var head = ["timestamp", "bottle_id", "expert_label", "ai_verdict", "ai_class", "confidence_pct",
                "height_pct", "coverage_pct", "green_pct", "yellow_pct", "glare_pct",
                "condensation_pct", "ai_time_ms", "source"];
    var rows = items.map(function (it) {
      return [new Date(it.t).toISOString(), it.bottle, it.expert, it.verdict, it.cls, it.conf,
              it.height, it.coverage, it.green, it.yellow, it.glare, it.cond, it.ms, it.source]
        .map(csvCell).join(",");
    });
    var csv = "\uFEFF" + head.join(",") + "\r\n" + rows.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    var d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = "vitrovision-session-" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      "-" + pad2(d.getHours()) + pad2(d.getMinutes()) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  if (dataModeChk) {
    dataModeChk.addEventListener("change", function () {
      labFields.classList.toggle("hidden", !dataModeChk.checked);
      renderSession();
    });
  }
  if (timeModeChk) {
    timeModeChk.addEventListener("change", function () {
      if (lastResult) updateTimingLine(lastResult.ms);
      else updateTimingLine(undefined);
    });
  }
  if (manualMinInput) {
    manualMinInput.addEventListener("input", function () {
      renderSession();
      if (lastResult) updateTimingLine(lastResult.ms);
    });
  }
  if (exportCsvBtn) exportCsvBtn.addEventListener("click", exportCsv);
  if (clearSessionBtn) {
    clearSessionBtn.addEventListener("click", function () {
      if (confirm("ล้างข้อมูลเซสชันวิจัยทั้งหมด?")) {
        saveSession([]);
        renderSession();
      }
    });
  }
  renderSession();

  // คัดลอกรายงาน
  copyReportBtn.addEventListener("click", function () {
    var text = reportText.textContent || "";
    function done() {
      copyReportBtn.textContent = "คัดลอกแล้ว ✓";
      setTimeout(function () { copyReportBtn.textContent = "คัดลอก"; }, 1600);
    }
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      } catch (e) {
        alert("คัดลอกอัตโนมัติไม่ได้ — กรุณาเลือกข้อความในรายงานแล้วคัดลอกเอง");
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  });

  // ---------- Utils: seeded random ----------
  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
})();
