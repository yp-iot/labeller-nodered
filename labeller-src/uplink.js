// ===== Cloud uplink (Pi): live snapshot + database rows for the VPS mirror =====
// in : snapshot from Analytics (every 1 s) | MQTT <line>/watch (someone has the VPS dashboard open)
//      | MQTT <line>/req {id, wm} (VPS asks for rows newer than what it already stored) | SQLite results (msg.upStep)
// out1: snapshot -> MQTT <line>/snap (retained)   out2: SELECT -> SQLite   out3: rows -> MQTT <line>/rows
// Only SELECTs on the local database; nothing received from the VPS is executed.
const cfg = flow.get('labcfg');
if (!cfg) return null;
const C = Object.assign({ snapEveryS: 2, idleSnapEveryS: 60, maxRows: 2000 }, cfg.cloud);
const now = Date.now();
const topic = String(msg.topic || '');

if (topic.endsWith('/watch')) { flow.set('labWatchTs', now); return null; }

// ---------- live snapshot: fast while someone watches on the VPS, otherwise just keep the retained copy fresh ----------
if (msg.upStep === undefined && !topic.endsWith('/req')) {
    const watched = now - (flow.get('labWatchTs') || 0) < 30000;
    if (now - (context.get('lastSnap') || 0) < (watched ? C.snapEveryS : C.idleSnapEveryS) * 1000 - 200) return null;
    context.set('lastSnap', now);
    node.status({ fill: 'green', shape: 'dot', text: (watched ? 'watched' : 'idle') + ', snap ' + new Date(now).toLocaleTimeString() });
    return [{ payload: msg.payload }, null, null];
}

// ---------- rows newer than the VPS watermarks, one table after another ----------
const LIM = Math.min(5000, Math.max(100, C.maxRows));
const N = x => Math.max(0, Math.floor(Number(x) || 0));
const COLS = {
    items: 'ts,tid,seq,batch,bseq,ok,reason,conf,offset,ocr,code,est,sim,shift,operator',
    minute: 'ts,total,ok,ng,run_s,speed,a,p,q,oee,top_reason,shift,batch',
    ng: 'id,ts,seq,reason,conf,offset,ocr,code,est,shift,batch',
    alerts: 'id,ts,sev,code,text',
    shifts: 'shift_id,start,end,operator,total,ok,ng,run_s,oee,top_reason',
    batches: 'id,batch,product,target,note,operator,start,end,total,ok,ng,run_s,oee,top_reason'
};
const STEPS = [
    ['items', w => 'SELECT ' + COLS.items + ' FROM items WHERE ts >= ' + N(w.items) + ' ORDER BY ts LIMIT ' + LIM],
    ['minute', w => 'SELECT ' + COLS.minute + ' FROM minute_stats WHERE ts >= ' + N(w.minute) + ' ORDER BY ts LIMIT ' + LIM],
    ['ng', w => 'SELECT ' + COLS.ng + ' FROM ng_events WHERE id > ' + N(w.ng) + ' AND ts >= ' + N(w.since) + ' ORDER BY id LIMIT ' + LIM],
    ['alerts', w => 'SELECT ' + COLS.alerts + ' FROM alerts WHERE id > ' + N(w.alerts) + ' AND ts >= ' + N(w.since) + ' ORDER BY id LIMIT ' + LIM],
    ['shifts', w => 'SELECT ' + COLS.shifts + ' FROM shift_summary WHERE end >= ' + N(w.recent) + ' ORDER BY start LIMIT ' + LIM],
    ['batches', w => 'SELECT ' + COLS.batches + ' FROM batches WHERE end IS NULL OR end >= ' + N(w.recent) + ' OR start >= ' + N(w.recent) + ' ORDER BY id LIMIT ' + LIM]
];
const query = (R, i) => [null, { topic: STEPS[i][1](R.wm), payload: [], upStep: i, upReq: R }, null];

if (topic.endsWith('/req')) {
    let r;
    try { r = JSON.parse(msg.payload); } catch (e) { return null; }
    if (!r || typeof r.wm !== 'object') return null;
    return query({ id: r.id, wm: r.wm, data: {}, more: false }, 0);
}

const R = msg.upReq, i = msg.upStep, name = STEPS[i][0];
const rows = Array.isArray(msg.payload) ? msg.payload : [];
const cols = COLS[name].split(',');
R.data[name] = rows.map(r => cols.map(c => r[c] === undefined ? null : r[c]));
if (rows.length >= LIM) R.more = true;
if (i + 1 < STEPS.length) return query(R, i + 1);
const n = Object.values(R.data).reduce((a, t) => a + t.length, 0);
node.status({ fill: 'blue', shape: 'ring', text: 'sent ' + n + ' rows' + (R.more ? ' (more)' : '') + ' ' + new Date(now).toLocaleTimeString() });
return [null, null, { payload: JSON.stringify({ id: R.id, at: now, more: R.more, data: R.data }) }];
