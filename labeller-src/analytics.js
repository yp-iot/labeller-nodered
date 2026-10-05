// ===== Analytics: counters, OEE, inspection feed, AI insights, predictive alerts =====
// in : topic 'tags' (from Mapper) | 'tick' (every 1 s)
// out1: snapshot -> websocket   out2: SQL batch -> SQLite (every 60 s)
const cfg = flow.get('labcfg');
if (!cfg) return null;
const now = Date.now();
const tags = flow.get('tags') || {};

// ---------- state: P = persisted (file store), M = memory only, all bounded ----------
let P = context.get('P', 'file');
if (!P || !P.shift) P = { shift: null, batch: null, seq: 0, labelUsed: 0, ribbonUsed: 0 };
let M = context.get('M');
if (!M) M = { buckets: [], feed: [], itemTs: [], stops: [], alerts: {}, insights: [], pendingNG: 0, lastTick: now, lastItemTs: 0, wasRunning: null, statusSince: now, q: { min: [], ng: [], alert: [], shift: [] }, lastInsight: 0, lastFlush: now };

const REASON_TIPS = {
    'Label skew': 'check applicator peel plate and web tension',
    'Missing label': 'check label gap sensor calibration and roll splice',
    'Wrong label': 'verify the loaded roll matches this batch',
    'OCR misread': 'check printhead and date-code contrast',
    'Barcode unreadable': 'clean the printhead and check ribbon wrinkles',
    'Wrinkle / bubble': 'check wipe-down brush pressure and bottle surface',
    'Cap / seal': 'check capper torque upstream'
};
const SIM_W = { 'Label skew': 22, 'Missing label': 10, 'Wrong label': 3, 'OCR misread': 20, 'Barcode unreadable': 14, 'Wrinkle / bubble': 21, 'Cap / seal': 10 };
const rnd = (a, b) => a + Math.random() * (b - a);
const r1 = x => Math.round(x * 10) / 10;
function pick(w) { let t = 0; for (const k in w) t += w[k]; let r = Math.random() * t; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return 'Label skew'; }
function valid(t) { const x = tags[t]; return !!x && (x.src === 'di' || now - x.ts < 10000); }
function fresh(t) { const x = tags[t]; return !!x && now - x.ts <= cfg.detailFreshMs; }
const tv = t => tags[t] && tags[t].v;

// ---------- shift + batch ----------
function hm(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function shiftAt(ts) {
    const d = new Date(ts), mins = d.getHours() * 60 + d.getMinutes();
    for (const s of cfg.shifts) {
        const a = hm(s.start), b = hm(s.end);
        const inside = a < b ? (mins >= a && mins < b) : (mins >= a || mins < b);
        if (!inside) continue;
        const st = new Date(d); st.setHours(Math.floor(a / 60), a % 60, 0, 0);
        if (st.getTime() > ts) st.setDate(st.getDate() - 1);
        const id = st.getFullYear() + '-' + String(st.getMonth() + 1).padStart(2, '0') + '-' + String(st.getDate()).padStart(2, '0') + ' ' + s.name;
        return { id, name: s.name, operator: s.operator, start: st.getTime(), startTxt: s.start, endTxt: s.end };
    }
    return { id: 'none', name: '-', operator: '-', start: ts, startTxt: '', endTxt: '' };
}
const blank = (extra) => Object.assign({ total: 0, ok: 0, ng: 0, reasons: {}, runMs: 0, planMs: 0 }, extra);
const sh = shiftAt(now);
if (!P.shift || P.shift.id !== sh.id) {
    if (P.shift && P.shift.planMs > 60000) M.q.shift.push(Object.assign({ end: now }, P.shift, { oee: oee(P.shift).oee }));
    P.shift = blank({ id: sh.id, name: sh.name, operator: sh.operator, start: sh.start, startTxt: sh.startTxt, endTxt: sh.endTxt });
}
// ---------- batch (started/ended from the dashboard, or followed from the PLC batch_no tag) ----------
const q = s => s === null || s === undefined ? 'NULL' : typeof s === 'number' ? (isFinite(s) ? String(s) : 'NULL') : "'" + String(s).replace(/'/g, "''").slice(0, 200) + "'";
const sqlNow = [];
function batchIns(b) {
    if (!b.id) return;
    sqlNow.push('INSERT OR IGNORE INTO batches(batch,product,target,note,operator,start) VALUES(' + [b.id, b.product, b.target || null, b.note || null, b.operator, Math.floor(b.start / 1000)].map(q).join(',') + ');');
    b.inDb = true;
}
function batchUpd(b, end, rows) {
    if (!b.id) return;
    if (!b.inDb) batchIns(b);
    const o = oee(b), top = Object.entries(b.reasons).sort((a, c) => c[1] - a[1])[0];
    rows.push('UPDATE batches SET end=' + q(end ? Math.floor(end / 1000) : null) + ',total=' + b.total + ',ok=' + b.ok + ',ng=' + b.ng + ',run_s=' + Math.round(b.runMs / 1000) +
        ',oee=' + q(Math.round(o.oee * 1000) / 10) + ',top_reason=' + q(top ? top[0] : null) + ' WHERE batch=' + q(b.id) + ' AND start=' + Math.floor(b.start / 1000) + ';');
}
function startBatch(info) {
    if (P.batch) batchUpd(P.batch, now, sqlNow);
    P.batch = blank({ id: info.id || '', product: info.product || cfg.product, target: info.target || 0, note: info.note || '', operator: P.shift.operator, start: now });
    batchIns(P.batch);
}
if (msg.topic === 'batch') {
    const c = msg.payload || {};
    if (c.action === 'new') startBatch({ id: c.id, product: c.product, target: c.target, note: c.note });
    else if (c.action === 'end') startBatch({ id: '' });
    node.log('batch ' + c.action + ' ' + (c.id || '') + ' by ' + (c.by || 'dashboard'));
}
if (!P.batch) startBatch({ id: cfg.batch });
if (cfg.batchSource === 'plc' && valid('batch_no') && tv('batch_no') && tv('batch_no') !== P.batch.id) startBatch({ id: tv('batch_no') });
if (P.batch.id && !P.batch.inDb) batchIns(P.batch);
flow.set('labBatchId', P.batch.id);

// ---------- minute buckets ----------
const minute = Math.floor(now / 60000) * 60000;
let B = M.buckets[M.buckets.length - 1];
if (!B || B.t !== minute) {
    if (B) M.q.min.push(B);
    B = blank({ t: minute, offSum: 0, offN: 0 });
    M.buckets.push(B);
    while (M.buckets.length > 61) M.buckets.shift();
}

function oee(w) {
    const A = w.planMs > 0 ? Math.min(1, w.runMs / w.planMs) : 0;
    const Pf = w.runMs > 0 ? Math.min(1, w.total / (w.runMs / 60000 * (cfg.idealPpm || 120))) : 0;
    const Q = w.total > 0 ? w.ok / w.total : 1;
    return { A, P: Pf, Q, oee: A * Pf * Q };
}

// ---------- items from counters ----------
function addItem(ng) {
    P.seq++;
    let est = false;
    const take = (t, synth) => { if (fresh(t) && tv(t) !== undefined && tv(t) !== '') return tv(t); est = true; return synth(); };
    let reason = null;
    if (ng) {
        reason = fresh('reject_code') && tv('reject_code') !== 'None' ? tv('reject_code') : (est = true, pick(SIM_W));
    }
    const conf = take('ai_conf', () => ng ? rnd(84, 99) : rnd(96.5, 99.9));
    const offset = take('label_offset', () => reason === 'Label skew' ? rnd(1.6, 2.3) : (Math.random() - 0.5) * 0.6);
    const ocr = take('ocr_text', () => 'LOT ' + String(P.batch.id).replace(/^LOT-?/i, '') + ' EXP 10/2028');
    const code = fresh('barcode') ? tv('barcode') : (est = true, '95560' + String(1234500 + P.seq % 100000).padStart(8, '0'));
    P.batch.seq = (P.batch.seq === undefined ? P.batch.total : P.batch.seq) + 1;   // serial = position in batch (continues the counter)
    const tid = (P.batch.id || 'NOBATCH') + '-' + String(P.batch.seq).padStart(6, '0');   // trace ID = batch + serial in batch
    const it = { tid, seq: P.seq, t: now, ok: !ng, reason, conf: r1(conf), offset: Math.round(offset * 100) / 100, ocr, code, est };
    for (const w of [P.shift, P.batch, B]) {
        w.total++;
        if (ng) { w.ng++; w.reasons[reason] = (w.reasons[reason] || 0) + 1; } else w.ok++;
    }
    B.offSum += it.offset; B.offN++;
    P.labelUsed += reason === 'Missing label' ? 0 : 1;
    P.ribbonUsed += 1;
    M.feed.unshift(it); if (M.feed.length > 20) M.feed.pop();
    M.itemTs.push(now); while (M.itemTs.length && now - M.itemTs[0] > 60000) M.itemTs.shift();
    M.lastItemTs = now;
    // every product -> audit trace (written in the 60 s batch; queue capped so a DB outage can't eat RAM)
    M.q.items = M.q.items || [];
    M.q.items.push([now, tid, P.seq, P.batch.id || 'NOBATCH', P.batch.seq, ng ? 0 : 1, reason, it.conf, it.offset, ocr, code, est ? 1 : 0, cfg.simulate ? 1 : 0, P.shift.id, P.shift.operator]);
    if (M.q.items.length > 20000) M.q.items.splice(0, M.q.items.length - 20000);
    if (ng) { M.q.ng.push({ ts: now, seq: it.seq, reason, conf: it.conf, offset: it.offset, ocr, code, est: est ? 1 : 0, shift: P.shift.id, batch: P.batch.id }); if (M.q.ng.length > 2000) M.q.ng.shift(); }
}

if (msg.topic === 'tags') {
    for (const u of msg.payload) {
        if (u.tag === 'count_ng') M.pendingNG = Math.min(M.pendingNG + (u.delta || 0), 500);
        else if (u.tag === 'count_total') {
            for (let i = 0; i < Math.min(u.delta || 0, 500); i++) {
                const ng = M.pendingNG > 0; if (ng) M.pendingNG--;
                addItem(ng);
            }
            M.pendingNG = 0;   // NG pulses belong to the items just counted
        }
    }
    context.set('M', M); context.set('P', P, 'file');
    return sqlNow.length ? [null, { topic: 'BEGIN;\n' + sqlNow.join('\n') + '\nCOMMIT;' }] : null;
}

// ================= tick (1 s) =================
const dt = Math.min(5000, Math.max(0, now - M.lastTick));
M.lastTick = now;
const fault = valid('fault') ? !!tv('fault') : false;
const running = !fault && ((valid('running') && !!tv('running')) || now - M.lastItemTs < 6000);   // products flowing = running, even if no run signal is wired
const status = fault ? 'fault' : running ? 'running' : 'stopped';
if (M.wasRunning !== null && M.wasStatus !== status) M.statusSince = now;
if (M.wasRunning && !running) { M.stops.push(now); }
M.stops = M.stops.filter(t => now - t < 15 * 60000);
M.wasRunning = running; M.wasStatus = status;
for (const w of [P.shift, P.batch, B]) { w.planMs += dt; if (running) w.runMs += dt; }

const speed = valid('speed_ppm') ? Number(tv('speed_ppm')) : (running ? M.itemTs.length : 0);

// consumables (tag if mapped, else estimated from count)
function consumable(tag, used, qty) {
    let pct, est = false;
    if (valid(tag)) pct = Number(tv(tag));
    else { est = true; pct = Math.max(0, 100 * (1 - used / qty)); }
    const left = pct / 100 * qty;
    const mins = speed > 5 ? left / speed : null;
    return { pct: Math.round(pct), left: Math.round(left), mins: mins === null ? null : Math.round(mins), est };
}
if (!valid('label_remain') && P.labelUsed >= cfg.labelRollQty && !running && now - M.statusSince > 30000) P.labelUsed = 0;   // assume roll change
if (!valid('ribbon_remain') && P.ribbonUsed >= cfg.ribbonQty && !running && now - M.statusSince > 30000) P.ribbonUsed = 0;
const consum = { label: consumable('label_remain', P.labelUsed, cfg.labelRollQty), ribbon: consumable('ribbon_remain', P.ribbonUsed, cfg.ribbonQty) };

// ---------- windows ----------
function sumBuckets(list) {
    const w = blank({});
    for (const b of list) { w.total += b.total; w.ok += b.ok; w.ng += b.ng; w.runMs += b.runMs; w.planMs += b.planMs; for (const k in b.reasons) w.reasons[k] = (w.reasons[k] || 0) + b.reasons[k]; }
    return w;
}
function view(w) {
    const o = oee(w);
    return { total: w.total, ok: w.ok, ng: w.ng, ngPct: w.total ? r1(100 * w.ng / w.total) : 0,
        A: r1(o.A * 100), P: r1(o.P * 100), Q: r1(o.Q * 100), oee: r1(o.oee * 100),
        reasons: Object.entries(w.reasons).sort((a, b) => b[1] - a[1]), runS: Math.round(w.runMs / 1000), planS: Math.round(w.planMs / 1000) };
}
const last5 = sumBuckets(M.buckets.filter(b => b.t > minute - 5 * 60000));
const win = { hour: view(sumBuckets(M.buckets.slice(-60))), shift: view(P.shift), batch: view(P.batch) };

// ---------- regression helpers ----------
function slope(pts) {   // pts [[x,y]] -> {m,b}
    const n = pts.length; if (n < 4) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const d = n * sxx - sx * sx; if (!d) return null;
    const m = (n * sxy - sx * sy) / d; return { m, b: (sy - m * sx) / n };
}
const done = M.buckets.slice(-11, -1).filter(b => b.total >= 20);

// ---------- AI insights + predictive alerts (every 10 s) ----------
if (now - M.lastInsight >= 10000) {
    M.lastInsight = now;
    const ins = [];
    const shiftNg = win.shift.ngPct, ng5 = last5.total ? 100 * last5.ng / last5.total : 0;
    const top5 = Object.entries(last5.reasons).sort((a, b) => b[1] - a[1])[0];
    if (last5.total >= 40 && ng5 > Math.max(shiftNg * 1.8, shiftNg + 1.2, cfg.ngAlarmPct * 0.8) && top5) {
        const share = Math.round(100 * top5[1] / last5.ng);
        ins.push({ sev: 'warn', title: 'Reject rate is climbing', body: 'NG ' + r1(ng5) + '% in the last 5 min vs ' + shiftNg + '% for the shift. ' + share + '% are ' + top5[0].toLowerCase() + ' — ' + (REASON_TIPS[top5[0]] || 'inspect the station') + '.' });
    }
    const offs = done.filter(b => b.offN > 10).map(b => b.offSum / b.offN);
    const curOff = offs.length ? offs[offs.length - 1] : 0;
    if (Math.abs(curOff) > cfg.offsetTolMm * 0.45) {
        ins.push({ sev: 'warn', title: 'Label position drifting', body: 'Average offset is ' + (curOff > 0 ? '+' : '') + curOff.toFixed(2) + ' mm (tolerance ±' + cfg.offsetTolMm + ' mm). Adjust the applicator before skew rejects start.' });
    }
    if (running && win.hour.P < 88 && win.hour.runS > 300) ins.push({ sev: 'info', title: 'Running below rated speed', body: 'Performance ' + win.hour.P + '% this hour — ' + Math.round(speed) + ' PPM vs ' + cfg.idealPpm + ' PPM rated.' });
    if (M.stops.length >= 3) ins.push({ sev: 'info', title: M.stops.length + ' short stops in 15 min', body: 'Frequent micro-stops cost Availability (' + win.hour.A + '% this hour). Check infeed spacing and bottle supply.' });
    const topShift = win.shift.reasons[0];
    if (topShift && win.shift.ng >= 10 && !ins.some(i => i.title.startsWith('Reject'))) ins.push({ sev: 'info', title: 'Top reject this shift: ' + topShift[0], body: topShift[1] + ' of ' + win.shift.ng + ' rejects (' + Math.round(100 * topShift[1] / win.shift.ng) + '%). Tip: ' + (REASON_TIPS[topShift[0]] || 'inspect the station') + '.' });
    if (!ins.some(i => i.sev === 'warn') && win.shift.total > 50 && shiftNg < cfg.ngAlarmPct * 0.7 && M.stops.length < 3 && !Object.keys(M.alerts).length) ins.unshift({ sev: 'good', title: 'Line is stable', body: 'OEE ' + win.shift.oee + '% and NG ' + shiftNg + '% this shift. Quality and speed on target.' });
    if (!ins.length) ins.push({ sev: 'info', title: 'Learning the line', body: 'Collecting data — insights appear after a few minutes of production.' });
    M.insights = ins.slice(0, 4);

    // predictive alerts
    const A = {};
    const add = (id, sev, title, body) => { A[id] = { id, sev, title, body, since: (M.alerts[id] && M.alerts[id].since) || now }; };
    if (fault) add('fault', 'crit', 'Machine fault', 'Line stopped on fault.');
    for (const [k, nm] of [['label', 'Label roll'], ['ribbon', 'Ribbon']]) {
        const c = consum[k];
        if (c.mins !== null && c.mins <= 5) add(k, 'crit', nm + ' almost empty', '~' + c.mins + ' min left at ' + Math.round(speed) + ' PPM. Prepare a new ' + nm.toLowerCase() + '.');
        else if (c.mins !== null && c.mins <= 15) add(k, 'warn', nm + ' low', '~' + c.mins + ' min left (' + c.pct + '%).');
    }
    const ngFit = slope(done.map((b, i) => [i, 100 * b.ng / b.total]));
    if (ngFit && ngFit.m > 0.05) {
        const proj = ngFit.b + ngFit.m * (done.length - 1 + 15);
        if (proj >= cfg.ngAlarmPct) {
            const nowV = ngFit.b + ngFit.m * (done.length - 1);
            const mins = Math.max(1, Math.round((cfg.ngAlarmPct - nowV) / ngFit.m));
            add('ngtrend', nowV >= cfg.ngAlarmPct ? 'crit' : 'warn', 'NG rate trending up', 'Projected to pass ' + cfg.ngAlarmPct + '% ' + (nowV >= cfg.ngAlarmPct ? '— already above limit' : 'in ~' + mins + ' min') + ' (+' + ngFit.m.toFixed(2) + '%/min).');
        }
    }
    const offFit = slope(offs.map((v, i) => [i, Math.abs(v)]));
    if (offFit && offFit.m > 0.01 && Math.abs(curOff) < cfg.offsetTolMm) {
        const mins = Math.round((cfg.offsetTolMm - Math.abs(curOff)) / offFit.m);
        if (mins <= 30) add('skew', 'warn', 'Skew limit in ~' + mins + ' min', 'Label offset drifting ' + offFit.m.toFixed(2) + ' mm/min toward ±' + cfg.offsetTolMm + ' mm.');
    }
    for (const id in A) if (!M.alerts[id]) M.q.alert.push({ ts: now, sev: A[id].sev, code: id, text: A[id].title + ' — ' + A[id].body });
    M.alerts = A;
    if (M.q.alert.length > 200) M.q.alert.splice(0, M.q.alert.length - 200);
}

// ---------- snapshot ----------
const snap = {
    type: 'snap', t: now,
    line: { name: cfg.line, machine: cfg.machine, product: P.batch.product || cfg.product, status, statusSince: M.statusSince, speed: r1(speed), ideal: cfg.idealPpm,
        operator: P.shift.operator, shift: { name: P.shift.name, start: P.shift.startTxt, end: P.shift.endTxt }, batch: { id: P.batch.id, product: P.batch.product || cfg.product, target: P.batch.target || 0, note: P.batch.note || '', operator: P.batch.operator || '', start: P.batch.start },
        batchSource: cfg.batchSource || 'dashboard', pinRequired: !!cfg.batchPin, products: cfg.products || [],
        simulate: !!cfg.simulate, provider: cfg.chatProvider, ngAlarmPct: cfg.ngAlarmPct, offsetTol: cfg.offsetTolMm },
    win,
    trend: M.buckets.slice(-60).map(b => ({ t: b.t, total: b.total, ng: b.ng, ngPct: b.total ? r1(100 * b.ng / b.total) : null, off: b.offN ? Math.round(100 * b.offSum / b.offN) / 100 : null })),
    feed: M.feed.slice(0, 12),
    insights: M.insights,
    alerts: Object.values(M.alerts).sort((a, b) => (a.sev === 'crit' ? 0 : 1) - (b.sev === 'crit' ? 0 : 1)),
    consum
};
flow.set('labSnap', snap);

// ---------- DB flush (every 60 s, one transaction) ----------
let sql = null;
const rows0 = sqlNow.splice(0);
if (now - M.lastFlush >= 60000) {
    M.lastFlush = now;
    const rows = [];
    for (const b of M.q.min) {
        const o = oee(b), top = Object.entries(b.reasons).sort((a, c) => c[1] - a[1])[0];
        rows.push('INSERT OR REPLACE INTO minute_stats VALUES(' + [Math.floor(b.t / 1000), b.total, b.ok, b.ng, Math.round(b.runMs / 1000), b.total, r1(o.A * 100), r1(o.P * 100), r1(o.Q * 100), r1(o.oee * 100), top ? top[0] : null, P.shift.id, P.batch.id].map(q).join(',') + ');');
    }
    const its = M.q.items || [];
    for (let i = 0; i < its.length; i += 200)   // multi-row inserts, 200 per statement
        rows.push('INSERT INTO items(ts,tid,seq,batch,bseq,ok,reason,conf,offset,ocr,code,est,sim,shift,operator) VALUES' + its.slice(i, i + 200).map(r => '(' + r.map(q).join(',') + ')').join(',') + ';');
    for (const e of M.q.ng) rows.push('INSERT INTO ng_events(ts,seq,reason,conf,offset,ocr,code,est,shift,batch) VALUES(' + [Math.floor(e.ts / 1000), e.seq, e.reason, e.conf, e.offset, e.ocr, e.code, e.est, e.shift, e.batch].map(q).join(',') + ');');
    for (const a of M.q.alert) rows.push('INSERT INTO alerts(ts,sev,code,text) VALUES(' + [Math.floor(a.ts / 1000), a.sev, a.code, a.text].map(q).join(',') + ');');
    for (const s of M.q.shift) {
        const top = Object.entries(s.reasons).sort((a, c) => c[1] - a[1])[0];
        rows.push('INSERT OR REPLACE INTO shift_summary VALUES(' + [s.id, Math.floor(s.start / 1000), Math.floor(s.end / 1000), s.operator, s.total, s.ok, s.ng, Math.round(s.runMs / 1000), r1(s.oee * 100), top ? top[0] : null].map(q).join(',') + ');');
    }
    batchUpd(P.batch, null, rows);   // running totals of the open batch
    M.q = { min: [], ng: [], alert: [], shift: [], items: [] };
    rows0.push(...rows);
}
if (rows0.length) sql = { topic: 'BEGIN;\n' + rows0.join('\n') + '\nCOMMIT;', rows: rows0.length };

context.set('M', M); context.set('P', P, 'file');
node.status({ fill: status === 'running' ? 'green' : status === 'fault' ? 'red' : 'yellow', shape: 'dot', text: status + ' | shift ' + win.shift.total + ' pcs, NG ' + win.shift.ngPct + '%, OEE ' + win.shift.oee + '%' });
return [{ payload: JSON.stringify(snap) }, sql];
