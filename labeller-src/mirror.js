// ===== Mirror (VPS): show and store the Pi's data =====
// Active in data mode 'mirror' only. The Pi does all the counting; this node
//  - forwards its live snapshot to the browsers (marked offline when the Pi stops sending),
//  - keeps a copy of its database: asks for rows newer than what is stored here, upserts them, repeats while there are more.
// in : MQTT <line>/snap | <line>/status | <line>/rows | topic 'tick' (every 5 s; polls every cloud.pollS) | SQLite results (msg.mirStep)
// out1: snapshot -> browsers   out2: watermark query -> SQLite   out3: upserts -> SQLite (batch)   out4: request -> MQTT <line>/req   out5: -> MQTT <line>/watch
const cfg = flow.get('labcfg');
if (!cfg) return null;
flow.set('labMirrorAvail', true);   // this server can mirror: the dashboard offers the mode
const C = Object.assign({ pollS: 15, backfillDays: 30 }, cfg.cloud);
const now = Date.now();
const topic = String(msg.topic || '');
const S = context.get('S') || { snap: null, snapTs: 0, online: null, inflight: 0, lastPoll: 0, reqId: 0, rows: 0, lastRows: 0 };
const save = () => context.set('S', S);
if (cfg.mode !== 'mirror') {
    if (S.snap) { S.snap = null; S.inflight = 0; save(); }
    node.status({ fill: 'grey', shape: 'ring', text: 'off (data mode ' + cfg.mode + ')' });
    return null;
}

const watched = now - (flow.get('labViewerTs') || 0) < 60000;
function marked() {
    const online = S.online !== false && now - S.snapTs < (watched ? 20000 : 90000);
    const s = Object.assign({}, S.snap);
    s.line = Object.assign({}, s.line, { srcMode: s.line.mode, mode: 'mirror', mirrorAvail: true, mirror: { online, lastTs: S.snapTs } });
    return s;
}
function show() {
    if (!S.snap) return null;
    const s = marked();
    flow.set('labSnap', s);
    node.status({ fill: s.line.mirror.online ? 'green' : 'red', shape: 'dot', text: (s.line.mirror.online ? 'machine online' : 'machine OFFLINE') + ', ' + S.rows + ' rows synced' });
    return { payload: JSON.stringify(s) };
}
function poll() {
    if (S.inflight && now - S.inflight < 60000) return null;   // one request at a time; retry after 60 s without an answer
    S.inflight = now;
    return { mirStep: 'wm', payload: [], topic: 'SELECT (SELECT MAX(ts) FROM items) AS items, (SELECT MAX(ts) FROM minute_stats) AS minute, (SELECT MAX(id) FROM ng_events) AS ng, (SELECT MAX(id) FROM alerts) AS alerts' };
}

if (topic.endsWith('/snap')) {
    let s;
    try { s = JSON.parse(msg.payload); } catch (e) { return null; }
    if (!s || s.type !== 'snap' || !s.line) return null;
    S.snap = s; S.snapTs = now; S.online = true; save();
    return [show(), null, null, null, null];
}
if (topic.endsWith('/status')) {
    S.online = String(msg.payload) === 'online'; save();
    return [show(), null, null, null, null];
}
if (msg.topic === 'tick') {   // keep "offline" + "last data x ago" current, tell the Pi someone is watching, poll for rows
    let q = null;
    if (now - S.lastPoll >= C.pollS * 1000) { S.lastPoll = now; q = poll(); }
    save();
    return [show(), q, null, null, watched ? { payload: String(now) } : null];
}
if (msg.mirStep === 'applied' && msg.more) {   // backlog: next page right away
    const q = poll(); save();
    return [null, q, null, null, null];
}
if (msg.mirStep === 'applied') return null;

if (msg.mirStep === 'wm') {   // what is stored here -> ask the Pi for anything newer (first sync: last backfillDays only)
    const r = (msg.payload && msg.payload[0]) || {};
    const floorS = Math.floor((now - C.backfillDays * 86400000) / 1000), minS = Math.max(r.minute || 0, floorS);
    const wm = { items: Math.max(r.items || 0, floorS * 1000), minute: minS - 180, ng: r.ng || 0, alerts: r.alerts || 0, since: floorS, recent: minS - 2 * 86400 };
    S.reqId = now; save();
    return [null, null, null, { payload: JSON.stringify({ id: S.reqId, wm }) }, null];
}

if (topic.endsWith('/rows')) {
    let d;
    try { d = JSON.parse(msg.payload); } catch (e) { return null; }
    if (!d || typeof d.data !== 'object') return null;
    // values only from the payload, column names and statements fixed here
    const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? (isFinite(v) ? String(v) : 'NULL') : "'" + String(v).replace(/'/g, "''").slice(0, 500) + "'";
    const T = {
        items: ['INSERT OR IGNORE INTO items(ts,tid,seq,batch,bseq,ok,reason,conf,offset,ocr,code,est,sim,shift,operator)', 15],
        minute: ['INSERT OR REPLACE INTO minute_stats(ts,total,ok,ng,run_s,speed,a,p,q,oee,top_reason,shift,batch)', 13],
        ng: ['INSERT OR IGNORE INTO ng_events(id,ts,seq,reason,conf,offset,ocr,code,est,shift,batch)', 11],
        alerts: ['INSERT OR IGNORE INTO alerts(id,ts,sev,code,text)', 5],
        shifts: ['INSERT OR REPLACE INTO shift_summary(shift_id,start,end,operator,total,ok,ng,run_s,oee,top_reason)', 10],
        batches: ['INSERT OR REPLACE INTO batches(id,batch,product,target,note,operator,start,end,total,ok,ng,run_s,oee,top_reason)', 14]
    };
    const sql = [];
    let n = 0;
    for (const k in T) {
        const rows = (Array.isArray(d.data[k]) ? d.data[k] : []).filter(r => Array.isArray(r) && r.length === T[k][1]);
        n += rows.length;
        for (let i = 0; i < rows.length; i += 200) sql.push(T[k][0] + ' VALUES' + rows.slice(i, i + 200).map(r => '(' + r.map(q).join(',') + ')').join(',') + ';');
    }
    S.inflight = 0; S.rows += n; S.lastRows = now; save();
    node.status({ fill: 'blue', shape: 'dot', text: 'synced ' + n + ' rows' + (d.more ? ', more coming' : '') + ' ' + new Date(now).toLocaleTimeString() });
    if (!sql.length) return null;
    return [null, null, { mirStep: 'applied', more: !!d.more, topic: 'BEGIN;\n' + sql.join('\n') + '\nCOMMIT;' }, null, null];
}
return null;
