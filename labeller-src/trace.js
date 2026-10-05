// ===== Audit trace query (dashboard search + CSV export) =====
// in : msg.trace = {q, batch, result:'all'|'ok'|'ng', from, to, before, limit}   (ws)
//      or msg.req.query with the same fields                                    (GET /labeller/api/items.csv)
// out: msg.topic = SQL, msg.payload = params  -> SQLite -> "Trace results"
// q matches: trace ID (LOT-2611D-000123) | barcode (exact) | batch number (exact) | OCR text (contains, last 24 h unless a range is given)
const t = msg.trace || (msg.req && msg.req.query) || {};
const csv = !!msg.req;
const where = [], params = [];
const P = v => { params.push(v); return '$' + params.length; };
const num = v => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);
const from = num(t.from), to = num(t.to), before = num(t.before);
if (from !== null) where.push('ts >= ' + P(from));
if (to !== null) where.push('ts < ' + P(to));
if (before !== null) where.push('ts < ' + P(before));
if (t.batch) where.push('batch = ' + P(String(t.batch).slice(0, 32)));
if (t.result === 'ok') where.push('ok = 1');
if (t.result === 'ng') where.push('ok = 0');
const q = String(t.q || '').trim().slice(0, 64);
if (q) {
    const ors = [];
    const m = /^(.+)-(\d{1,9})$/.exec(q);
    if (m) ors.push('(batch = ' + P(m[1]) + ' AND bseq = ' + P(Number(m[2])) + ')');
    ors.push('code = ' + P(q));
    ors.push('batch = ' + P(q));
    ors.push('(ts >= ' + P(from !== null ? from : Date.now() - 86400000) + " AND ocr LIKE " + P('%' + q.replace(/[%_]/g, '') + '%') + ')');
    where.push('(' + ors.join(' OR ') + ')');
}
const limit = csv ? 200000 : Math.min(200, Math.max(1, num(t.limit) || 100));
msg.topic = 'SELECT ts,tid,seq,batch,bseq,ok,reason,conf,offset,ocr,code,est,sim,shift,operator FROM items' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY ts DESC LIMIT ' + limit;
msg.payload = params;
msg.traceReq = { q, limit, csv };
return msg;
