/* E2E check: drive the real site in headless Chrome via CDP and read analysis results. */
const SAMPLES = [0, 1, 2, 3, 4];
const PORT = 9222;
const URLMATCH = process.env.VV_URL_MATCH || "8123";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
      const page = list.find(t => t.type === "page" && t.url.includes(URLMATCH));
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(500);
  }
  throw new Error("no CDP page found");
}

(async () => {
  const url = await connect();
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      logs.push("[console." + m.params.type + "] " + m.params.args.map(a => a.value || a.description || "").join(" ").slice(0, 200));
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      logs.push("[EXCEPTION] " + (d.exception && (d.exception.description || d.exception.value) || d.text || "").slice(0, 300));
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) return { evalError: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r && r.result ? r.result.value : null;
  };
  await send("Runtime.enable", {});
  await send("Page.enable", {});

  // wait for sample gallery
  const ready = await evalJs(`new Promise(res => { const t = setInterval(() => { if (document.querySelectorAll('#sampleGrid .sample-card').length >= 5) { clearInterval(t); res(true); } }, 200); setTimeout(() => { clearInterval(t); res(false); }, 20000); })`);
  console.log("sample gallery ready:", ready);
  if (!ready) { console.log("LOGS:", logs.slice(-10)); process.exit(1); }

  const runSample = (idx) => `new Promise(res => {
    document.querySelectorAll('#sampleGrid .sample-card')[${idx}].click();
    const box = document.getElementById('resultBox');
    const t = setInterval(() => {
      if (!box.classList.contains('hidden') && document.getElementById('metricsList').children.length > 0) {
        clearInterval(t);
        setTimeout(() => {
          res({
            title: document.getElementById('resultTitle').textContent,
            score: document.getElementById('scoreNum').textContent,
            status: document.getElementById('statusBadge').textContent,
            measured: Array.from(document.querySelectorAll('#measuredList li')).map(li => li.textContent).slice(0, 8),
            recs: Array.from(document.querySelectorAll('#recsList li')).map(li => li.textContent).slice(0, 2),
            aiShotHidden: document.getElementById('aiShot').classList.contains('hidden'),
            methodNote: document.getElementById('methodNote').textContent.slice(0, 60),
            desc: document.getElementById('resultDesc').textContent.slice(0, 80)
          });
        }, 1600);
      }
    }, 250);
    setTimeout(() => { clearInterval(t); res({ timeout: true }); }, 90000);
  })`;

  for (const i of SAMPLES) {
    const r = await evalJs(runSample(i));
    console.log("SAMPLE#" + i + ":", JSON.stringify(r, null, 1));
    await evalJs(`document.getElementById('newScanBtn').click(); true`);
    await sleep(500);
  }

  // ---- gate test: plain image with no plant ----
  const gateTest = `new Promise(res => {
    fetch('tools/test-plain.jpg').then(r => r.blob()).then(function (blob) {
      const file = new File([blob], 'test-plain.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
      document.getElementById('analyzeBtn').click();
      const box = document.getElementById('resultBox');
      const t = setInterval(() => {
        if (!box.classList.contains('hidden') && document.getElementById('metricsList').children.length > 0) {
          clearInterval(t);
          setTimeout(() => {
            res({
              score: document.getElementById('scoreNum').textContent,
              status: document.getElementById('statusBadge').textContent,
              desc: document.getElementById('resultDesc').textContent.slice(0, 90),
              aiHidden: document.getElementById('aiShot').classList.contains('hidden'),
              measured: Array.from(document.querySelectorAll('#measuredList li')).map(li => li.textContent).slice(0, 4)
            });
          }, 1600);
        }
      }, 250);
      setTimeout(() => { clearInterval(t); res({ timeout: true }); }, 60000);
    });
  })`;
  const g = await evalJs(gateTest);
  console.log("GATE(test-plain):", JSON.stringify(g, null, 1));

  console.log("--- console logs (last 12) ---");
  console.log(logs.slice(-12).join("\n"));
  ws.close();
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
