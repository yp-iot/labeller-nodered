// ===== History cache: last 7 days from SQLite (refreshed every 5 min) =====
// step 1 (topic 'refresh'): query per-day stats -> sqlite
// step 2 (histStep 'days'): store, query reasons -> sqlite
// step 3 (histStep 'reasons'): store -> flow.labHist (+ broadcast to browsers)
const cfg = flow.get('labcfg') || { idealPpm: 120 };
const since = Math.floor(Date.now() / 1000) - 7 * 86400;
if (msg.topic === 'refresh') {
    msg.histStep = 'days';
    msg.topic = "SELECT date(ts,'unixepoch','localtime') AS day, SUM(total) AS total, SUM(ok) AS ok, SUM(ng) AS ng, SUM(run_s) AS run_s, COUNT(*) AS mins FROM minute_stats WHERE ts >= " + since + " GROUP BY day ORDER BY day";
    msg.payload = [];
    return [msg, null];
}
if (msg.histStep === 'days') {
    msg.days = msg.payload.map(d => {
        const A = d.mins ? d.run_s / (d.mins * 60) : 0, P = d.run_s ? Math.min(1, d.total / (d.run_s / 60 * cfg.idealPpm)) : 0, Q = d.total ? d.ok / d.total : 1;
        return { day: d.day, total: d.total, ok: d.ok, ng: d.ng, ngPct: d.total ? Math.round(1000 * d.ng / d.total) / 10 : 0, oee: Math.round(1000 * A * P * Q) / 10, hours: Math.round(d.mins / 6) / 10 };
    });
    msg.histStep = 'reasons';
    msg.topic = 'SELECT reason, COUNT(*) AS n FROM ng_events WHERE ts >= ' + since + ' GROUP BY reason ORDER BY n DESC';
    msg.payload = [];
    return [msg, null];
}
if (msg.histStep === 'reasons') {
    const days = msg.days;
    const tot = days.reduce((a, d) => ({ total: a.total + d.total, ok: a.ok + d.ok, ng: a.ng + d.ng }), { total: 0, ok: 0, ng: 0 });
    const H = { t: Date.now(), days, total: tot.total, ok: tot.ok, ng: tot.ng, ngPct: tot.total ? Math.round(1000 * tot.ng / tot.total) / 10 : 0,
        oee: days.length ? Math.round(10 * days.reduce((a, d) => a + d.oee * d.total, 0) / Math.max(1, tot.total)) / 10 : 0,
        reasons: msg.payload.map(r => [r.reason, r.n]), db: flow.get('labDbInfo') || null };
    flow.set('labHist', H);
    node.status({ fill: 'green', shape: 'dot', text: days.length + ' days, ' + tot.total + ' pcs' });
    return [null, { payload: JSON.stringify({ type: 'hist', hist: H }) }];
}
return null;
