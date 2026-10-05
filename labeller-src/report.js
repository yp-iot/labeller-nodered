// ===== Batch traceability report  GET /labeller/report?id=<batch row id> =====
// Runs a short chain of read-only queries (this node <-> "SQLite report"), then renders printable HTML.
const cfg = flow.get('labcfg') || {};
const R = msg.rep || (msg.rep = { step: 'start' });
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CSS = `
:root{--bg:#F5F5F7;--card:#fff;--text:#1D1D1F;--t2:#6E6E73;--line:rgba(0,0,0,.08);--fill:#F2F2F7;--accent:#0071E3;--ok:#28A745;--warn:#C77C02;--bad:#E5484D;
--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
main{max-width:1100px;margin:0 auto;padding:32px 24px 48px}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.eyebrow{font-size:13px;color:var(--t2);font-weight:500}h1{font-size:34px;font-weight:700;letter-spacing:-.025em;margin-top:2px}.sub{color:var(--t2);font-size:15px;margin-top:2px}
.tools{display:flex;gap:8px}.btn{all:unset;cursor:pointer;font-size:14px;font-weight:500;padding:8px 16px;border-radius:999px;background:var(--fill);color:var(--accent)}.btn.primary{background:var(--accent);color:#fff}
.status{display:inline-block;margin:14px 0 18px;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px}.status.done{background:rgba(40,167,69,.12);color:var(--ok)}.status.live{background:rgba(0,113,227,.1);color:var(--accent)}
.banner{background:#FFF4E5;color:#8A5300;border-radius:12px;padding:10px 14px;font-weight:600;font-size:13px;margin-bottom:18px}
.grid{display:grid;gap:12px;margin-bottom:12px}.meta{grid-template-columns:repeat(6,1fr)}.kpis{grid-template-columns:repeat(5,1fr)}
.meta div,.kpi{background:var(--card);border-radius:16px;padding:14px 16px}.meta span,.kpi span{display:block;font-size:12px;color:var(--t2)}.meta b{font-size:14px;font-weight:600}
.kpi b{font-size:28px;font-weight:600;letter-spacing:-.02em}.kpi small{font-size:14px;color:var(--t2);font-weight:500}
.card{background:var(--card);border-radius:18px;padding:20px 22px;margin-bottom:12px;break-inside:avoid}.card h2{font-size:17px;font-weight:600;margin-bottom:12px}.card h2 small{font-size:13px;color:var(--t2);font-weight:400;margin-left:6px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.two .card{margin-bottom:12px}
.muted{color:var(--t2)}.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12.5px}
.badge{font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;margin-right:6px}.badge.ok{background:rgba(40,167,69,.12);color:var(--ok)}.badge.warn{background:#FFF4E5;color:var(--warn)}.badge.info{background:rgba(0,113,227,.1);color:var(--accent)}
.t{width:100%;border-collapse:collapse;margin-top:10px}.t th{text-align:left;font-weight:500;color:var(--t2);font-size:12px;padding:6px 10px 6px 0;border-bottom:.5px solid var(--line)}.t td{padding:7px 10px 7px 0;border-bottom:.5px solid var(--line)}.t .r{text-align:right}.t.small td{font-size:12.5px}
.bar{display:grid;grid-template-columns:150px 1fr 90px;gap:10px;align-items:center;margin:8px 0;font-size:13px}.bar i{height:8px;background:var(--fill);border-radius:4px;overflow:hidden}.bar em{display:block;height:100%;background:var(--accent);border-radius:4px}.bar b{text-align:right;font-weight:500;color:var(--t2)}
.est{font-size:10px;color:var(--t2);font-weight:600}
footer{margin-top:20px;font-size:12px;color:var(--t2)}
@media (max-width:800px){.meta{grid-template-columns:repeat(2,1fr)}.kpis{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.t{display:block;overflow-x:auto}}
@media print{@page{size:A4;margin:12mm}body{background:#fff;font-size:11px}main{padding:0;max-width:none}.noprint{display:none}.card,.meta div,.kpi{border:.5px solid #d2d2d7;border-radius:10px}.kpi b{font-size:20px}h1{font-size:26px}.t td,.t th{padding:4px 8px 4px 0}}
`;
const W = 'FROM items WHERE batch = $1 AND ts >= $2 AND ts < $3';
const ask = (step, sql, params) => { R.step = step; msg.topic = sql; msg.payload = params; return [msg, null]; };
const win = () => [R.b.batch, R.b.start * 1000, (R.b.end ? R.b.end + 1 : Math.floor(Date.now() / 1000) + 1) * 1000];

function page(title, body) {
    msg.payload = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' + CSS + '</style></head><body><main>' + body + '</main></body></html>';
    msg.headers = { 'content-type': 'text/html; charset=utf-8' };
    return [null, msg];
}

switch (R.step) {
case 'start': {
    const id = parseInt(msg.req.query.id, 10);
    if (!id) { msg.statusCode = 400; return page('Report', '<h1>Batch report</h1><p class="muted">Open a report from <b>Batches</b> on the dashboard.</p>'); }
    return ask('batch', 'SELECT * FROM batches WHERE id = $1', [id]);
}
case 'batch':
    if (!msg.payload.length) { msg.statusCode = 404; return page('Report', '<h1>Batch not found</h1><p class="muted"><a href="/labeller">Back to dashboard</a></p>'); }
    R.b = msg.payload[0];
    return ask('sum', 'SELECT COUNT(*) n, SUM(ok) ok, MIN(ts) t0, MAX(ts) t1, SUM(est) est, SUM(sim) sim, MIN(bseq) s0, MAX(bseq) s1 ' + W, win());
case 'sum':
    R.sum = msg.payload[0];
    return ask('ends', 'SELECT * FROM (SELECT tid, code, ts ' + W + ' ORDER BY ts ASC LIMIT 1) UNION ALL SELECT * FROM (SELECT tid, code, ts FROM items WHERE batch = $4 AND ts >= $5 AND ts < $6 ORDER BY ts DESC LIMIT 1)', [...win(), ...win()]);
case 'ends':
    R.ends = msg.payload;
    return ask('reasons', 'SELECT reason, COUNT(*) n ' + W + ' AND ok = 0 GROUP BY reason ORDER BY n DESC', win());
case 'reasons':
    R.reasons = msg.payload;
    return ask('hourly', 'SELECT (ts / 3600000) * 3600000 h, COUNT(*) n, SUM(ok) ok ' + W + ' GROUP BY h ORDER BY h', win());
case 'hourly':
    R.hourly = msg.payload;
    return ask('people', 'SELECT shift, operator, COUNT(*) n, SUM(ok) ok, MIN(ts) t0, MAX(ts) t1 ' + W + ' GROUP BY shift, operator ORDER BY t0', win());
case 'people':
    R.people = msg.payload;
    return ask('rejects', 'SELECT ts, tid, reason, conf, offset, ocr, code, est ' + W + ' AND ok = 0 ORDER BY ts LIMIT 5000', win());
case 'rejects': R.rejects = msg.payload; break;
default: return null;
}

// ---------- render ----------
const b = R.b, s = R.sum || {}, now = Date.now();
const snap = flow.get('labSnap');
const live = !b.end && snap && snap.line.batch.id === b.batch && Math.floor(snap.line.batch.start / 1000) === b.start;
const counter = live ? snap.win.batch : { total: b.total, ok: b.ok, ng: b.ng, oee: b.oee };
const traced = s.n || 0, tOk = s.ok || 0, tNg = traced - tOk;
const total = traced || counter.total || 0, ok = traced ? tOk : counter.ok || 0, ng = total - ok;
const fmt = n => n === null || n === undefined ? '–' : Number(n).toLocaleString('en-US');
const dt = ms => ms ? new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
const tm = ms => new Date(ms).toLocaleTimeString('en-GB');
const dur = sec => { if (!sec && sec !== 0) return '–'; const m = Math.round(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
const endMs = b.end ? b.end * 1000 : now;
const pct = (a, c) => c ? (Math.round(1000 * a / c) / 10) + '%' : '–';

let recon;
if (!traced) recon = '<span class="badge warn">No item-level trace</span> This batch was recorded before per-product tracing was enabled; totals come from the batch counter.';
else {
    // serials run 1..N within a batch: anything not traced shows up as a hole in that sequence
    const before = Math.max(0, (s.s0 || 1) - 1);                 // counted before tracing started
    const gaps = Math.max(0, (s.s1 - s.s0 + 1) - traced);        // serials missing inside the range
    const pending = Math.max(0, counter.total - (s.s1 || 0));    // counted after the last saved record
    const lines = [];
    if (before) lines.push(fmt(before) + ' items (serial 1–' + fmt(before) + ') were counted before per-product tracing started and are not traced individually.');
    if (gaps) lines.push(fmt(gaps) + ' serial numbers between ' + fmt(s.s0) + ' and ' + fmt(s.s1) + ' have no trace record (e.g. a storage interruption).');
    if (pending && !(live && pending <= 400)) lines.push(fmt(pending) + ' items counted after the last traced serial ' + fmt(s.s1) + '.');
    if (!lines.length) recon = live && pending ? '<span class="badge info">In progress</span> Serials 1–' + fmt(s.s1) + ' fully traced; the latest ' + pending + ' items are saved within 60 s.'
        : '<span class="badge ok">Reconciled</span> Serials 1–' + fmt(s.s1) + ' are all traced and match the production counter (' + fmt(counter.total) + ').';
    else recon = '<span class="badge warn">Gaps</span> Traced ' + fmt(traced) + ' of ' + fmt(counter.total) + ' counted items.<br>' + lines.join('<br>');
}
const notes = [];
if (s.sim) notes.push('<div class="banner">SIMULATED DATA — ' + fmt(s.sim) + ' of ' + fmt(traced) + ' items came from the demo simulator, not the machine.</div>');
const estNote = s.est ? fmt(s.est) + ' items have inspection details estimated (no IV3/PLC detail available at the time).' : '';

const maxR = Math.max(1, ...R.reasons.map(r => r.n));
const csvUrl = '/labeller/api/items.csv?batch=' + encodeURIComponent(b.batch) + '&from=' + (b.start * 1000) + '&to=' + ((b.end ? b.end + 1 : Math.floor(now / 1000) + 1) * 1000);
const first = R.ends[0], last = R.ends[1] || R.ends[0];

let h = notes.join('') +
'<div class="top"><div><div class="eyebrow">Batch traceability report · ' + esc(cfg.line || '') + ' · ' + esc(cfg.machine || '') + '</div><h1>' + esc(b.batch) + '</h1><div class="sub">' + esc(b.product || '') + (b.note ? ' · ' + esc(b.note) : '') + '</div></div>' +
'<div class="tools noprint"><a class="btn" href="' + csvUrl + '">Download all items (CSV)</a><button class="btn primary" onclick="window.print()">Print / Save PDF</button></div></div>' +
'<div class="status ' + (b.end ? 'done' : 'live') + '">' + (b.end ? 'Completed' : 'In progress') + '</div>' +
'<section class="grid meta">' +
  [['Started', dt(b.start * 1000)], ['Ended', b.end ? dt(b.end * 1000) : 'Running'], ['Duration', dur((endMs - b.start * 1000) / 1000)], ['Run time', dur(live ? counter.runS : b.run_s)],
   ['Target', b.target ? fmt(b.target) + ' good' : '–'], ['Started by', esc(b.operator || '–')]].map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('') +
'</section>' +
'<section class="grid kpis">' +
  [['Output', fmt(total)], ['Good', fmt(ok)], ['Rejects', fmt(ng) + ' <small>' + pct(ng, total) + '</small>'], ['OEE', counter.oee === null || counter.oee === undefined ? '–' : counter.oee + '%'], ['Target reached', b.target ? pct(ok, b.target) : '–']]
  .map(([k, v]) => '<div class="kpi"><span>' + k + '</span><b>' + v + '</b></div>').join('') +
'</section>' +
'<section class="card"><h2>Record integrity</h2><p>' + recon + '</p>' + (estNote ? '<p class="muted">' + estNote + '</p>' : '') +
(first ? '<table class="t"><tr><th></th><th>Trace ID</th><th>Barcode</th><th>Time</th></tr><tr><td class="muted">First item</td><td class="mono">' + esc(first.tid) + '</td><td class="mono">' + esc(first.code || '—') + '</td><td>' + dt(first.ts) + '</td></tr><tr><td class="muted">Last item</td><td class="mono">' + esc(last.tid) + '</td><td class="mono">' + esc(last.code || '—') + '</td><td>' + dt(last.ts) + '</td></tr></table>' : '') +
'</section>' +
'<div class="two"><section class="card"><h2>Reject reasons</h2>' + (R.reasons.length ? R.reasons.map(r => '<div class="bar"><span>' + esc(r.reason || 'Unclassified') + '</span><i><em style="width:' + (100 * r.n / maxR) + '%"></em></i><b>' + fmt(r.n) + ' · ' + pct(r.n, tNg) + '</b></div>').join('') : '<p class="muted">No rejects.</p>') + '</section>' +
'<section class="card"><h2>Shifts & operators</h2>' + (R.people.length ? '<table class="t"><tr><th>Shift</th><th>Operator</th><th>From</th><th>To</th><th class="r">Output</th><th class="r">Reject</th></tr>' +
  R.people.map(p => '<tr><td>' + esc(p.shift) + '</td><td>' + esc(p.operator) + '</td><td>' + tm(p.t0) + '</td><td>' + tm(p.t1) + '</td><td class="r">' + fmt(p.n) + '</td><td class="r">' + pct(p.n - p.ok, p.n) + '</td></tr>').join('') + '</table>' : '<p class="muted">–</p>') + '</section></div>' +
'<section class="card"><h2>Hourly production</h2>' + (R.hourly.length ? '<table class="t"><tr><th>Hour</th><th class="r">Output</th><th class="r">Good</th><th class="r">Rejects</th><th class="r">Reject rate</th></tr>' +
  R.hourly.map(x => '<tr><td>' + new Date(x.h).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</td><td class="r">' + fmt(x.n) + '</td><td class="r">' + fmt(x.ok) + '</td><td class="r">' + fmt(x.n - x.ok) + '</td><td class="r">' + pct(x.n - x.ok, x.n) + '</td></tr>').join('') + '</table>' : '<p class="muted">–</p>') + '</section>' +
'<section class="card"><h2>Reject log <small>' + fmt(R.rejects.length) + (R.rejects.length >= 5000 ? ' (first 5,000 — full list in CSV)' : '') + '</small></h2>' + (R.rejects.length ? '<table class="t small"><tr><th>Time</th><th>Trace ID</th><th>Reason</th><th class="r">AI conf.</th><th class="r">Offset</th><th>OCR</th><th>Barcode</th></tr>' +
  R.rejects.map(x => '<tr><td>' + tm(x.ts) + '</td><td class="mono">' + esc(x.tid) + '</td><td>' + esc(x.reason) + (x.est ? ' <span class="est">est.</span>' : '') + '</td><td class="r">' + x.conf + '%</td><td class="r">' + (x.offset > 0 ? '+' : '') + x.offset + ' mm</td><td>' + esc(x.ocr) + '</td><td class="mono">' + esc(x.code || '—') + '</td></tr>').join('') + '</table>' : '<p class="muted">No rejects recorded.</p>') + '</section>' +
'<footer>Generated ' + dt(now) + ' · IRIV PiControl · read-only data collection · report covers records ' + dt(b.start * 1000) + ' – ' + (b.end ? dt(b.end * 1000) : 'now') + '</footer>';

return page('Batch ' + b.batch + ' · Traceability report', h);
