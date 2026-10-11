/* VitroVision — plant readiness demo (front-end simulation) */
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

  // ---------- Analysis (simulated) ----------
  analyzeBtn.addEventListener("click", startAnalysis);

  function startAnalysis() {
    if (!currentFile || analyzing) return;
    analyzing = true;
    analyzeBtn.disabled = true;
    resultEmpty.classList.add("hidden");
    resultBox.classList.add("hidden");
    progressBox.classList.remove("hidden");
    // Real pixel measurement first, then animated steps
    analyzeImagePixels(currentFile).then(function (f) {
      pendingFeatures = f;
      runSteps(0);
    });
  }

  // ---------- Real image measurement (no more random simulation) ----------
  var pendingFeatures = null;

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

  function metricsFromFeatures(f) {
    if (!f) { // fallback if pixels unreadable: seeded value so it still works
      var seed = hashSeed(currentFile.name + "|" + currentFile.size + "|" + currentFile.lastModified);
      var rand = mulberry32(seed);
      var fv = {};
      METRICS.forEach(function (m) { fv[m.key] = 42 + Math.floor(rand() * 57); });
      return { values: fv, measured: null, noPlant: false };
    }
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
        noPlant: true
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
      noPlant: false
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
    var res = metricsFromFeatures(pendingFeatures);
    pendingFeatures = null;
    var values = res.values;
    var score = Math.round(
      METRICS.reduce(function (sum, m) { return sum + values[m.key] * m.weight; }, 0)
    );

    renderResult(score, values, res.measured, res.noPlant);
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

  function renderResult(score, values, measured, noPlant) {
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
      resultDesc.textContent = "ภาพนี้แทบไม่มีสีเขียวของใบพืชเลย — อาจเป็นเมล็ดล้วนหรือถ่ายไม่ติดต้น จึงให้คะแนนต่ำไว้ก่อน ลองถ่ายใหม่ให้เห็นใบชัด ๆ";
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

    // Recommendations (dataset-driven)
    recsList.innerHTML = "";
    var recItems = buildRecs(values, st, prof);
    if (noPlant) recItems.unshift("ถ่ายภาพใหม่ให้เห็นใบและลำต้นชัด ๆ วางต้นกล้าไว้กลางภาพ ใช้แสงธรรมชาติ");
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
  var liveVals = { leaf: 70, stem: 70, moisture: 70 };

  function liveMetricColor(v) {
    return v >= 80 ? "#2fa14f" : v >= 60 ? "#d97706" : "#dc2626";
  }
  function paintLiveMetrics() {
    for (var i = 0; i < liveMetricEls.length; i++) {
      (function (li) {
        var key = li.getAttribute("data-m");
        var v = Math.round(liveVals[key]);
        li.querySelector(".live-val").textContent = v + "/100";
        var fill = li.querySelector(".metric-fill");
        fill.style.width = v + "%";
        fill.style.background = liveMetricColor(v);
      })(liveMetricEls[i]);
    }
  }
  function tickLive() {
    var keys = ["leaf", "stem", "moisture"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      liveVals[k] = Math.max(38, Math.min(97, liveVals[k] + (Math.random() * 10 - 5)));
    }
    paintLiveMetrics();
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
        liveVals = { leaf: 62 + Math.random() * 20, stem: 62 + Math.random() * 20, moisture: 55 + Math.random() * 25 };
        paintLiveMetrics();
        liveTimer = setInterval(tickLive, 2000);
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
