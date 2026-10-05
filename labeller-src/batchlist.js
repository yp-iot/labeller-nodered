// ===== Batch history -> browser (websocket) or CSV download (http) =====
const cfg = flow.get('labcfg') || { idealPpm: 120 };
const rows = (msg.payload || []).map(r => ({
    id: r.id, batch: r.batch, product: r.product, target: r.target, note: r.note, operator: r.operator,
    start: r.start * 1000, end: r.end ? r.end * 1000 : null, total: r.total, ok: r.ok, ng: r.ng,
    ngPct: r.total ? Math.round(1000 * r.ng / r.total) / 10 : 0, oee: r.oee, top: r.top_reason, runS: r.run_s
}));
if (msg.req) {
    const iso = t => t ? new Date(t).toLocaleString('sv-SE').slice(0, 19) : '';   // local time, sortable
    const cell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['batch', 'product', 'target', 'operator', 'start', 'end', 'output', 'good', 'rejects', 'reject_pct', 'oee_pct', 'top_reject', 'run_min', 'note'];
    const body = rows.map(r => [r.batch, r.product, r.target || '', r.operator, iso(r.start), iso(r.end), r.total, r.ok, r.ng, r.ngPct, r.oee, r.top, Math.round(r.runS / 60), r.note].map(cell).join(','));
    msg.payload = head.join(',') + '\n' + body.join('\n') + '\n';
    msg.headers = { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="batches-' + new Date().toISOString().slice(0, 10) + '.csv"' };
    return [null, msg];
}
return [{ _session: msg._session, payload: JSON.stringify({ type: 'batches', rows }) }, null];
