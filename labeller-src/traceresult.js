// ===== Audit trace results -> browser (websocket) or CSV download =====
const rows = msg.payload || [];
if (msg.req) {
    const iso = ms => new Date(ms).toLocaleString('sv-SE') + '.' + String(ms % 1000).padStart(3, '0');
    const cell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['time', 'trace_id', 'batch', 'serial', 'result', 'reject_reason', 'ai_confidence_pct', 'label_offset_mm', 'ocr_text', 'barcode', 'shift', 'operator', 'details_estimated', 'simulated'];
    const body = rows.slice().reverse().map(r => [iso(r.ts), r.tid, r.batch, r.bseq, r.ok ? 'OK' : 'NG', r.reason, r.conf, r.offset, r.ocr, r.code, r.shift, r.operator, r.est ? 'yes' : 'no', r.sim ? 'yes' : 'no'].map(cell).join(','));
    const name = (msg.req.query.batch ? 'trace-' + String(msg.req.query.batch).replace(/[^A-Za-z0-9._-]/g, '_') : 'trace') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    msg.payload = head.join(',') + '\n' + body.join('\n') + '\n';
    msg.headers = { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="' + name + '"' };
    return [null, msg];
}
return [{ _session: msg._session, payload: JSON.stringify({ type: 'trace', rows, more: rows.length >= msg.traceReq.limit, append: !!(msg.trace && msg.trace.before) }) }, null];
