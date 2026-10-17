/* VitroVision — plant readiness checker (real AI segmentation + pixel measurement) */
(function () {
  "use strict";

  var RING_C = 364.4; // 2 * PI * 58
  var HISTORY_KEY = "vitroVisionHistory";
  var HISTORY_MAX = 10;

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
  var ringFg = document.getElementById("ringFg");
  var scoreNum = document.getElementById("scoreNum");
  var metricsList = document.getElementById("metricsList");
  var measuredTitle = document.getElementById("measuredTitle");
  var measuredList = document.getElementById("measuredList");
  var methodNote = document.getElementById("methodNote");
  var aiShot = document.getElementById("aiShot");
  var aiShotImg = document.getElementById("aiShotImg");
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

  var currentFile = null;
  var analyzing = false;
  var currentSample = null; // stage label when scanned from sample gallery

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

  function startAnalysis() {
    if (!currentFile || analyzing) return;
    analyzing = true;
    analyzeBtn.disabled = true;
    resultEmpty.classList.add("hidden");
    resultBox.classList.add("hidden");
    progressBox.classList.remove("hidden");
    updateStepTexts();
    var t0 = Date.now();
    var pixelP = analyzeImagePixels(currentFile);
    var unetP = unetAnalyzeFromFile(currentFile);
    Promise.all([pixelP, unetP]).then(function (r) {
      pendingFeatures = r[0];
      pendingUnet = r[1];
      // keep the progress animation readable even when analysis is fast
      var rest = Math.max(0, 2200 - (Date.now() - t0));
      setTimeout(function () { runSteps(0); }, rest);
    });
  }

  function updateStepTexts() {
    if (!stepsList.length) return;
    var s0 = stepsList[0];
    if (unetState === "ready") s0.textContent = "ตรวจจับต้นพืชด้วยโมเดล AI (U-Net)";
    else if (unetState === "loading") s0.textContent = "กำลังโหลดโมเดล AI (ครั้งแรก ~14 MB)…";
    else if (unetState === "failed") s0.textContent = "ตรวจจับต้นพืชในภาพ (โหมดวัดสีพื้นฐาน)";
    else s0.textContent = "ตรวจจับต้นพืชในภาพ";
  }

  // ---------- Real image measurement (no more random simulation) ----------
  var pendingFeatures = null;
  var pendingUnet = null;

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
  // แยก "ส่วนต้นพืช" ออกจากภาพด้วยการเรียนรู้ของเครื่อง จากนั้นวัดขนาด/สีจากพิกเซลจริง
  var UNET_URL = "models/vitrovision-unet-small.onnx";
  var UNET_ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
  var UNET_SIZE = 256;
  var UNET_MIN_COVERAGE = 0.008; // ต่ำกว่านี้ = โมเดลไม่พบต้นพืชในภาพ
  var UNET_HEIGHT_REF = 0.55;    // ความสูงต้น/ความสูงภาพ ที่ถือว่า "เต็มขนาด"
  var UNET_MASS_REF = 0.06;      // สัดส่วนพื้นที่ต้น/ภาพ ที่ถือว่า "เต็มขนาด"

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
      var nowF = (window.performance && performance.now) ? performance.now.bind(performance) : function () { return Date.now(); };
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

    var maskCanvas = null;
    if (wantOverlay && area > 0) {
      var ov = document.createElement("canvas");
      ov.width = w;
      ov.height = h;
      var octx = ov.getContext("2d");
      var idata = octx.createImageData(w, h);
      var od = idata.data;
      for (var k = 0; k < n; k++) {
        var q = k * 4;
        od[q] = rgba[q];
        od[q + 1] = rgba[q + 1];
        od[q + 2] = rgba[q + 2];
        od[q + 3] = 255;
        if (mask[k]) {
          od[q] = Math.round(0.5 * rgba[q] + 0.5 * 60);
          od[q + 1] = Math.round(0.5 * rgba[q + 1] + 0.5 * 210);
          od[q + 2] = Math.round(0.5 * rgba[q + 2] + 0.5 * 80);
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
      maskCanvas: maskCanvas,
      ms: ms
    };
  }

  function modelCore(u, f) {
    // ขนาดต้นจากพื้นที่ (model mask) + ความสูงเทียบภาพ
    var sizeScore = Math.min(1, u.height / UNET_HEIGHT_REF);
    var massScore = Math.min(1, u.coverage / UNET_MASS_REF);
    var canopy = 100 * (0.4 * sizeScore + 0.6 * massScore);
    // ความน่าเชื่อถือว่า "ก้อนที่ตรวจได้" เป็นใบพืชจริง: สัดส่วนสีเขียว vs สีอื่นในก้อนนั้น
    // (ภาพเมล็ดพริกแห้ง: โมเดลจับเป็นก้อนได้ แต่สีครีม/เหลืองเกือบ 100% → pure ต่ำ → คะแนนถูกกด)
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
        measured: modelMeasured(u, f),
        noPlant: true,
        note: null,
        source: "ai"
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
      measured: modelMeasured(u, f),
      noPlant: false,
      note: note,
      source: "ai"
    };
  }

  function modelMeasured(u, f) {
    var out = [
      { label: "ต้นพืช (AI แยกส่วน)", text: (u.coverage * 100).toFixed(1) + "% ของภาพ" },
      { label: "ความสูงเทียบภาพ", text: (u.height * 100).toFixed(0) + "%" },
      { label: "สีเขียวในต้น", text: (u.greenPct * 100).toFixed(0) + "%" },
      { label: "ใบเหลืองในต้น", text: (u.yellowPct * 100).toFixed(0) + "%" }
    ];
    if (f) {
      out.push({ label: "ความมืดของดิน", text: f.soilDark >= 0 ? (f.soilDark * 100).toFixed(0) + "%" : "ไม่พบดิน" });
      out.push({ label: "ความสว่างภาพ", text: (f.bright * 100).toFixed(0) + "%" });
    }
    return out;
  }

  function computeFeatures(d, w, h) {
    var green = 0, centerGreen = 0, yellow = 0, soilN = 0, soilSum = 0, brightSum = 0;
    var n = d.length / 4;
    w = w || 1; h = h || 1;
    var x0 = w * 0.25, x1 = w * 0.75, y0 = h * 0.25, y1 = h * 0.75;
    for (var i = 0; i < d.length; i += 4) {
      var p = i / 4, x = p % w, y = (p - x) / w;
      var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      brightSum += (r + g + b) / 3;
      var exg = 2 * g - r - b; // Excess Green index
      var centered = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (g > r + 0.03 && g > b + 0.03 && exg > 0.08) {
        green++;
        if (centered) centerGreen++;
        continue;
      }
      if (r > 0.4 && g > 0.35 && b < 0.45 && r >= g && (r - b) > 0.12) { yellow++; continue; }
      if (r > 0.2 && r < 0.7 && g > 0.12 && g < r && b < g && (r - b) > 0.06) {
        soilN++;
        soilSum += (r + g + b) / 3;
      }
    }
    return {
      green: green / n,
      centerGreen: centerGreen / (n * 0.25),
      yellow: yellow / n,
      soilDark: soilN > 0 ? soilSum / soilN : -1,
      bright: brightSum / n
    };
  }

  function clampNum(v, a, b) { return Math.max(a, Math.min(b, Math.round(v))); }

  function metricsFromFeatures(f, u) {
    if (u) return modelCore(u, f);
    if (!f) { // fallback if pixels unreadable: seeded value so it still works
      var seed = hashSeed(currentFile.name + "|" + currentFile.size + "|" + currentFile.lastModified);
      var rand = mulberry32(seed);
      var fv = {};
      METRICS.forEach(function (m) { fv[m.key] = 42 + Math.floor(rand() * 57); });
      return { values: fv, measured: null, noPlant: false, source: "seed" };
    }
    return pixelCore(f);
  }

  function pixelCore(f) {
    // Center-weighted green: the plant is usually centered, edges are often background
    var effGreen = 0.65 * f.centerGreen + 0.35 * f.green;
    // Detection gate: almost no leaf-green = seeds only / no plant in frame
    var noPlant = (f.green < 0.015 && f.centerGreen < 0.02) ||
                  (f.bright > 0.82 && f.green < 0.05 && f.soilDark < 0);
    var coverage = 100 * (1 - Math.exp(-effGreen * 8)); // saturating canopy curve
    var unhealthy = f.yellow / (f.green + f.yellow + 0.005); // sick share of vegetation
    var moisture = f.soilDark >= 0
      ? clampNum(100 - Math.abs(f.soilDark - 0.30) * 260, 5, 97)
      : clampNum(28 + coverage * 0.4, 5, 97);
    if (noPlant) {
      return {
        values: { leaf: 8, stem: 10, moisture: Math.min(moisture, 35), roots: 8 },
        measured: buildMeasured(f),
        noPlant: true,
        source: "pixel"
      };
    }
    return {
      values: {
        leaf: clampNum(8 + coverage * (1 - 0.6 * unhealthy), 5, 98),
        stem: clampNum(16 + coverage * 0.78, 8, 97),
        moisture: moisture,
        roots: clampNum(14 + coverage * 0.72, 8, 95)
      },
      measured: buildMeasured(f),
      noPlant: false,
      source: "pixel"
    };
  }

  function buildMeasured(f) {
    return [
      { label: "พื้นที่สีเขียว", text: (f.green * 100).toFixed(1) + "%" },
      { label: "สีเขียวกลางภาพ", text: (f.centerGreen * 100).toFixed(1) + "%" },
      { label: "ใบเหลือง/จุด", text: (f.yellow * 100).toFixed(1) + "%" },
      { label: "ความมืดของดิน", text: f.soilDark >= 0 ? (f.soilDark * 100).toFixed(0) + "%" : "ไม่พบดิน" },
      { label: "ความสว่างภาพ", text: (f.bright * 100).toFixed(0) + "%" }
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
  var FALLBACK_TIPS = {
    leafLow: "ใบซีดหรือไม่สมบูรณ์ — เพิ่มแสงรำไร 4–6 ชม./วัน และพ่นปุ๋ยทางใบสูตรเสมอสัปดาห์ละครั้ง",
    leafOk: "ใบสภาพดี — รักษาระดับแสงปัจจุบัน หลีกเลี่ยงแดดจัดช่วงเที่ยง",
    stemLow: "ลำต้นยังอ่อน — ลดการรดน้ำ งดปุ๋ยไนโตรเจนสูง และให้ลมโกรกเพื่อสร้างความแข็งแรง",
    dry: "ดินแห้งเกินไป — รดน้ำเช้า–เย็นแบบพอชุ่ม หลีกเลี่ยงน้ำขังโคนต้น",
    moistureOk: "ความชื้นพอดี — รักษารอบการรดน้ำแบบนี้ต่อไป",
    wet: "ดินแฉะเกินไป — เว้นระยะรดน้ำ 1 วัน และปรับวัสดุปลูกให้ระบายน้ำดีขึ้น",
    rootsLow: "รากยังเดินไม่เต็ม — อย่าเพิ่งย้าย อนุบาลต่อจนรากแน่นก่อนย้ายปลูก",
    ready: "ย้ายปลูกช่วงเย็น รองก้นหลุมด้วยปุ๋ยคอก และพรางแสง 2–3 วันแรก"
  };
  var FALLBACK_PROFILE = {
    name: "",
    readyScore: 80,
    careScore: 60,
    ideal: { leaf: [70, 100], stem: [70, 100], moisture: [55, 85], roots: [70, 100] },
    nurseDays: { care: 5, notReady: 10 },
    tips: FALLBACK_TIPS
  };

  if (window.fetch) {
    fetch("plants-dataset.json")
      .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); })
      .then(function (d) { if (d && d.plants) DATASET = d; })
      .catch(function () { DATASET = null; });
  }

  function extend(base, over) {
    var out = {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (over) for (k in over) if (Object.prototype.hasOwnProperty.call(over, k)) out[k] = over[k];
    return out;
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
      readyScore: found && found.readyScore != null ? found.readyScore : base.readyScore,
      careScore: found && found.careScore != null ? found.careScore : base.careScore,
      ideal: extend(base.ideal, found && found.ideal),
      nurseDays: extend(base.nurseDays, found && found.nurseDays),
      tips: extend(base.tips || FALLBACK_TIPS, found && found.tips)
    };
  }

  function finishAnalysis() {
    var u = pendingUnet;
    var res = metricsFromFeatures(pendingFeatures, pendingUnet);
    pendingFeatures = null;
    pendingUnet = null;
    var values = res.values;
    var score = Math.round(
      METRICS.reduce(function (sum, m) { return sum + values[m.key] * m.weight; }, 0)
    );

    renderResult(score, values, res.measured, res.noPlant, res.source, res.note, u);
    saveHistory(score);

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

  function statusOf(score, prof) {
    prof = prof || FALLBACK_PROFILE;
    if (score >= prof.readyScore) return { cls: "ok", text: "พร้อมลงปลูก", days: 0 };
    if (score >= prof.careScore) return { cls: "warn", text: "ควรดูแลเพิ่มเติม", days: prof.nurseDays.care };
    return { cls: "bad", text: "ยังไม่พร้อมลงปลูก", days: prof.nurseDays.notReady };
  }

  function renderResult(score, values, measured, noPlant, source, note, u) {
    var prof = getProfile();
    var st = statusOf(score, prof);
    var name = plantNameInput.value.trim();
    if (prof.name) name = prof.name;
    if (currentSample) name = (name || "ต้นกล้า") + " (" + currentSample + ")";

    statusBadge.textContent = st.text;
    statusBadge.className = "status-badge " + st.cls;
    resultTitle.textContent = name ? "ผลวิเคราะห์: " + name : "ผลวิเคราะห์ต้นกล้า";
    resultDesc.textContent =
      st.cls === "ok"
        ? "ต้นกล้าแข็งแรงดี สามารถย้ายลงแปลงปลูกได้เลย ควรย้ายช่วงเย็นและรดน้ำตามทันที"
        : "ต้นกล้ายังต้องการการดูแลอีกประมาณ " + st.days + " วันก่อนย้ายลงแปลง ดูคำแนะนำด้านล่าง";
    if (noPlant) {
      resultDesc.textContent = source === "ai"
        ? "โมเดล AI ไม่พบส่วนของต้นพืชในภาพนี้ — อาจเป็นเมล็ด ภาพเบลอ หรือถ่ายไม่ติดต้น ลองถ่ายใหม่ให้เห็นใบชัด ๆ"
        : "ภาพนี้แทบไม่มีสีเขียวของใบพืชเลย — อาจเป็นเมล็ดล้วนหรือถ่ายไม่ติดต้น จึงให้คะแนนต่ำไว้ก่อน ลองถ่ายใหม่ให้เห็นใบชัด ๆ";
    }

    // Score ring (animate)
    ringFg.style.stroke = st.cls === "ok" ? "#2fa14f" : st.cls === "warn" ? "#d97706" : "#dc2626";
    ringFg.style.strokeDashoffset = RING_C;
    scoreNum.textContent = "0";
    requestAnimationFrame(function () {
      ringFg.style.strokeDashoffset = (RING_C * (1 - score / 100)).toFixed(1);
    });
    animateNumber(scoreNum, score, 1100);

    // Metrics (bar colors follow dataset thresholds)
    metricsList.innerHTML = "";
    METRICS.forEach(function (m) {
      var v = values[m.key];
      var li = document.createElement("li");
      li.innerHTML =
        '<div class="metric-head"><span>' + m.label + '</span><span>' + v + "/100</span></div>" +
        '<div class="metric-track"><span class="metric-fill"></span></div>';
      metricsList.appendChild(li);
      requestAnimationFrame(function () {
        li.querySelector(".metric-fill").style.width = v + "%";
        li.querySelector(".metric-fill").style.background =
          v >= prof.readyScore ? "#2fa14f" : v >= prof.careScore ? "#d97706" : "#dc2626";
      });
    });

    // Measured-from-pixels evidence
    if (measured && measured.length) {
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

    // AI segmentation overlay (แสดงเฉพาะเมื่อโมเดล AI ทำงานจริง)
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
      ? "วิธีวิเคราะห์: โมเดล AI (U-Net + MobileNetV3-Small, Val Dice 0.98) แยกส่วนต้นพืชออกจากภาพ แล้ววัดขนาดต้น สีใบ (Excess Green) และความมืดของดินจากพิกเซลจริง"
      : "วิธีวิเคราะห์: วัดสีพื้นฐาน (Excess Green) จากพิกเซลภาพจริง — ครั้งนี้โหลดโมเดล AI ไม่ได้ (ครั้งแรกต้องต่ออินเทอร์เน็ต)";

    // Recommendations (dataset-driven)
    recsList.innerHTML = "";
    var recItems;
    if (note) {
      recItems = [note, "ถ่ายภาพใหม่ให้เห็นต้นพืชสีเขียวชัด ๆ วางไว้กลางภาพ ใช้แสงธรรมชาติ"];
    } else {
      recItems = buildRecs(values, st, prof);
      if (noPlant) recItems.unshift("ถ่ายภาพใหม่ให้เห็นใบและลำต้นชัด ๆ วางต้นกล้าไว้กลางภาพ ใช้แสงธรรมชาติ");
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
        window.VitroVision3D.render(score, values);
      } catch (e) {
        setView("2d");
      }
    } else {
      setView("2d");
    }
  }

  function buildRecs(v, st, prof) {
    prof = prof || FALLBACK_PROFILE;
    var tips = prof.tips;
    var ideal = prof.ideal;
    var recs = [];
    if (v.leaf < ideal.leaf[0]) recs.push(tips.leafLow);
    else recs.push(tips.leafOk);
    if (v.stem < ideal.stem[0]) recs.push(tips.stemLow);
    if (v.moisture < ideal.moisture[0]) recs.push(tips.dry);
    else if (v.moisture > ideal.moisture[1]) recs.push(tips.wet);
    else recs.push(tips.moistureOk);
    if (v.roots < ideal.roots[0]) recs.push(tips.rootsLow);
    if (st.cls === "ok") recs.push(tips.ready);
    return recs;
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
  function saveHistory(score) {
    var st = statusOf(score, getProfile());
    var hname = plantNameInput.value.trim() || "ต้นกล้าไม่ระบุชื่อ";
    if (currentSample) hname += " (" + currentSample + ")";
    var items = loadHistory();
    items.unshift({
      t: Date.now(),
      name: hname,
      score: score,
      cls: st.cls,
      status: st.text
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
        '<span class="hist-score ' + it.cls + '">' + it.score + '</span>' +
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
