/**
 * Returns the self-contained dashboard HTML (inline CSS + JS, no external
 * assets or CDNs). The client connects to `/api/stream` (SSE) and falls back to
 * polling `/api/snapshot`.
 */
export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NodeLLMCache · live metrics</title>
<style>
  :root {
    --bg: #05060d;
    --panel: rgba(18, 22, 38, 0.55);
    --border: rgba(120, 160, 255, 0.18);
    --cyan: #28e0ff;
    --magenta: #ff4ecd;
    --green: #46f9a0;
    --text: #e6ecff;
    --muted: #8a93b8;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font-family: var(--sans);
    color: var(--text);
    background: var(--bg);
    overflow-x: hidden;
  }
  /* animated backdrop */
  body::before {
    content: "";
    position: fixed; inset: 0; z-index: -2;
    background:
      radial-gradient(1100px 600px at 12% -10%, rgba(40,224,255,0.16), transparent 60%),
      radial-gradient(900px 600px at 100% 0%, rgba(255,78,205,0.14), transparent 55%),
      radial-gradient(800px 800px at 50% 120%, rgba(70,249,160,0.10), transparent 60%);
  }
  body::after {
    content: "";
    position: fixed; inset: 0; z-index: -1;
    background-image:
      linear-gradient(rgba(120,160,255,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(120,160,255,0.05) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(circle at 50% 30%, black, transparent 85%);
    animation: drift 40s linear infinite;
  }
  @keyframes drift { to { background-position: 440px 440px, 440px 440px; } }

  .wrap { max-width: 1180px; margin: 0 auto; padding: 34px 24px 60px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 30px; }
  .brand { font-family: var(--mono); font-weight: 700; font-size: 20px; letter-spacing: 2px; }
  .brand .mark {
    color: var(--cyan);
    text-shadow: 0 0 14px rgba(40,224,255,0.8);
    margin-right: 8px;
  }
  .brand .grad {
    background: linear-gradient(90deg, var(--cyan), var(--magenta));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
  .live { margin-left: auto; display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--green); box-shadow: 0 0 10px var(--green); animation: pulse 1.6s ease-in-out infinite; }
  .dot.off { background: #ff5566; box-shadow: 0 0 10px #ff5566; animation: none; }
  @keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.7); } }

  .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    position: relative;
    overflow: hidden;
    transition: transform .25s ease, border-color .25s ease;
  }
  .card:hover { transform: translateY(-3px); border-color: rgba(120,160,255,0.4); }
  .card::before {
    content: ""; position: absolute; inset: 0 0 auto 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(40,224,255,0.7), transparent);
  }
  .label { font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--muted); }
  .value { font-family: var(--mono); font-weight: 700; margin-top: 10px; line-height: 1; }
  .value.big { font-size: 44px; }
  .value.mid { font-size: 30px; }
  .unit { font-size: 14px; color: var(--muted); margin-left: 6px; font-weight: 400; }
  .glow-cyan { color: var(--cyan); text-shadow: 0 0 18px rgba(40,224,255,0.45); }
  .glow-mag { color: var(--magenta); text-shadow: 0 0 18px rgba(255,78,205,0.45); }
  .glow-green { color: var(--green); text-shadow: 0 0 18px rgba(70,249,160,0.4); }

  .span3 { grid-column: span 3; } .span4 { grid-column: span 4; }
  .span6 { grid-column: span 6; } .span8 { grid-column: span 8; } .span12 { grid-column: span 12; }
  @media (max-width: 820px) { .span3,.span4,.span6,.span8 { grid-column: span 12; } }

  .ring-wrap { display: flex; align-items: center; gap: 18px; }
  canvas { display: block; width: 100%; }
  .chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }

  .bar-row { display: grid; grid-template-columns: 92px 1fr 64px; align-items: center; gap: 12px; margin: 10px 0; font-size: 13px; }
  .bar-track { height: 8px; border-radius: 6px; background: rgba(120,160,255,0.12); overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--cyan), var(--magenta)); transition: width .5s ease; }
  .bar-row .t { color: var(--muted); font-family: var(--mono); }
  .bar-row .n { text-align: right; font-family: var(--mono); color: var(--text); }
  .muted { color: var(--muted); }
  footer { margin-top: 28px; text-align: center; color: var(--muted); font-size: 12px; font-family: var(--mono); }
  .empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <div class="brand"><span class="mark">&#9670;</span><span class="grad">NODELLMCACHE</span></div>
      <div class="sub">AI memory infrastructure · live metrics</div>
    </div>
    <div class="live"><span class="dot" id="dot"></span><span id="status">connecting</span></div>
  </header>

  <div class="grid">
    <div class="card span4">
      <div class="label">Hit rate</div>
      <div class="ring-wrap">
        <canvas id="ring" width="120" height="120" style="width:120px;height:120px"></canvas>
        <div>
          <div class="value big glow-cyan"><span id="hitRate">0.0</span><span class="unit">%</span></div>
          <div class="sub"><span id="hits">0</span> hits · <span id="misses">0</span> misses</div>
        </div>
      </div>
    </div>

    <div class="card span4">
      <div class="label">Tokens saved</div>
      <div class="value big glow-mag" id="tokens">0</div>
      <div class="sub">re-used instead of regenerated</div>
    </div>

    <div class="card span4">
      <div class="label">Estimated savings</div>
      <div class="value big glow-green">$<span id="usd">0.0000</span></div>
      <div class="sub">based on the pricing table</div>
    </div>

    <div class="card span3">
      <div class="label">Avg latency</div>
      <div class="value mid"><span id="avg">0.00</span><span class="unit">ms</span></div>
    </div>
    <div class="card span3">
      <div class="label">p99 latency</div>
      <div class="value mid"><span id="p99">0.00</span><span class="unit">ms</span></div>
    </div>
    <div class="card span3">
      <div class="label">Compression</div>
      <div class="value mid glow-cyan"><span id="comp">1.00</span><span class="unit">&times;</span></div>
    </div>
    <div class="card span3">
      <div class="label">Embeddings reused</div>
      <div class="value mid glow-mag" id="emb">0</div>
    </div>

    <div class="card span8">
      <div class="chart-head"><div class="label">Hit rate over time</div><div class="sub" id="rangeLabel">live</div></div>
      <canvas id="chart" height="220"></canvas>
    </div>

    <div class="card span4">
      <div class="label">By cache type</div>
      <div id="byType"><div class="empty">no activity yet</div></div>
    </div>
  </div>

  <footer>localhost dashboard · refreshes live over SSE</footer>
</div>

<script>
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var history = [];
  var display = {};

  function lerp(key, target) {
    var cur = display[key] === undefined ? target : display[key];
    display[key] = cur + (target - cur) * 0.25;
    return display[key];
  }
  function fmtInt(n) { return Math.round(n).toLocaleString(); }

  function setStatus(ok) {
    $("dot").className = ok ? "dot" : "dot off";
    $("status").textContent = ok ? "live" : "offline";
  }

  function ring(rate) {
    var c = $("ring"), ctx = c.getContext("2d");
    var w = 120, cx = w / 2, cy = w / 2, r = 48;
    ctx.clearRect(0, 0, w, w);
    ctx.lineWidth = 11; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(120,160,255,0.14)";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    var g = ctx.createLinearGradient(0, 0, w, w);
    g.addColorStop(0, "#28e0ff"); g.addColorStop(1, "#ff4ecd");
    ctx.strokeStyle = g; ctx.shadowColor = "rgba(40,224,255,0.6)"; ctx.shadowBlur = 14;
    var start = -Math.PI / 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + Math.PI * 2 * Math.max(0, Math.min(1, rate))); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function chart() {
    var c = $("chart"), ctx = c.getContext("2d");
    var rect = c.getBoundingClientRect();
    var w = Math.max(280, Math.floor(rect.width)), h = 220;
    if (c.width !== w) c.width = w;
    c.height = h;
    ctx.clearRect(0, 0, w, h);
    var pad = 8;
    // grid
    ctx.strokeStyle = "rgba(120,160,255,0.10)"; ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var y = pad + (h - pad * 2) * (i / 4);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }
    if (history.length < 2) return;
    var n = history.length;
    var xAt = function (i) { return pad + (w - pad * 2) * (i / (n - 1)); };
    var yAt = function (v) { return pad + (h - pad * 2) * (1 - v); };
    // area
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(40,224,255,0.28)"); grad.addColorStop(1, "rgba(40,224,255,0)");
    ctx.beginPath(); ctx.moveTo(xAt(0), yAt(history[0]));
    for (var j = 1; j < n; j++) ctx.lineTo(xAt(j), yAt(history[j]));
    ctx.lineTo(xAt(n - 1), h - pad); ctx.lineTo(xAt(0), h - pad); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // line
    var lg = ctx.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, "#28e0ff"); lg.addColorStop(1, "#ff4ecd");
    ctx.strokeStyle = lg; ctx.lineWidth = 2.5; ctx.shadowColor = "rgba(40,224,255,0.5)"; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(xAt(0), yAt(history[0]));
    for (var k = 1; k < n; k++) ctx.lineTo(xAt(k), yAt(history[k]));
    ctx.stroke(); ctx.shadowBlur = 0;
  }

  function byType(bt) {
    var el = $("byType");
    var types = Object.keys(bt || {});
    if (!types.length) { el.innerHTML = '<div class="empty">no activity yet</div>'; return; }
    var max = 1;
    types.forEach(function (t) { max = Math.max(max, bt[t].hits + bt[t].misses); });
    el.innerHTML = types.map(function (t) {
      var total = bt[t].hits + bt[t].misses;
      var pct = Math.round((total / max) * 100);
      return '<div class="bar-row"><span class="t">' + t + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="n">' + bt[t].hits + "/" + total + "</span></div>";
    }).join("");
  }

  function render(s) {
    var rate = s.hitRate || 0;
    $("hitRate").textContent = (lerp("rate", rate * 100)).toFixed(1);
    $("hits").textContent = fmtInt(s.hits || 0);
    $("misses").textContent = fmtInt(s.misses || 0);
    $("tokens").textContent = fmtInt(lerp("tok", s.tokensSaved || 0));
    $("usd").textContent = (s.estimatedSavingsUSD || 0).toFixed(4);
    $("avg").textContent = (s.avgLatencyMs || 0).toFixed(2);
    $("p99").textContent = (s.p99LatencyMs || 0).toFixed(2);
    $("comp").textContent = ((s.compression && s.compression.ratio) || s.compressionRatio || 1).toFixed(2);
    $("emb").textContent = fmtInt(s.embeddingsReused || 0);
    ring(rate);
    history.push(rate); if (history.length > 120) history.shift();
    chart();
    byType(s.byType);
  }

  function poll() {
    fetch("/api/snapshot").then(function (r) { return r.json(); })
      .then(function (s) { setStatus(true); render(s); })
      .catch(function () { setStatus(false); });
  }

  if (window.EventSource) {
    var es = new EventSource("/api/stream");
    es.onmessage = function (e) { setStatus(true); try { render(JSON.parse(e.data)); } catch (err) {} };
    es.onerror = function () { setStatus(false); };
  } else {
    poll(); setInterval(poll, 2000);
  }
  window.addEventListener("resize", chart);
})();
</script>
</body>
</html>`
}
