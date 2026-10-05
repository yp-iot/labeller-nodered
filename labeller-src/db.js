// ===== Storage jobs (one node, by topic) -> SQLite batch node =====
// 'init'      : create tables (on deploy)
// 'retention' : daily purge + weekly VACUUM
// 'guard'     : msg.payload = "<dbBytes> <freeBytes>" from the size check exec node
const cfg = flow.get('labcfg');
if (!cfg) return null;
const nowS = Math.floor(Date.now() / 1000);
if (msg.topic === 'init') {
    msg.topic = [
        'PRAGMA journal_mode=WAL;', 'PRAGMA synchronous=NORMAL;',
        'CREATE TABLE IF NOT EXISTS minute_stats(ts INTEGER PRIMARY KEY, total INTEGER, ok INTEGER, ng INTEGER, run_s INTEGER, speed REAL, a REAL, p REAL, q REAL, oee REAL, top_reason TEXT, shift TEXT, batch TEXT);',
        'CREATE TABLE IF NOT EXISTS ng_events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, seq INTEGER, reason TEXT, conf REAL, offset REAL, ocr TEXT, code TEXT, est INTEGER, shift TEXT, batch TEXT);',
        'CREATE INDEX IF NOT EXISTS ng_events_ts ON ng_events(ts);',
        'CREATE TABLE IF NOT EXISTS shift_summary(shift_id TEXT PRIMARY KEY, start INTEGER, end INTEGER, operator TEXT, total INTEGER, ok INTEGER, ng INTEGER, run_s INTEGER, oee REAL, top_reason TEXT);',
        'CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, sev TEXT, code TEXT, text TEXT);',
        'CREATE INDEX IF NOT EXISTS alerts_ts ON alerts(ts);',
        'CREATE TABLE IF NOT EXISTS items(ts INTEGER, tid TEXT, seq INTEGER, batch TEXT, bseq INTEGER, ok INTEGER, reason TEXT, conf REAL, offset REAL, ocr TEXT, code TEXT, est INTEGER, sim INTEGER, shift TEXT, operator TEXT);',
        'CREATE INDEX IF NOT EXISTS items_ts ON items(ts);',
        'CREATE INDEX IF NOT EXISTS items_batch ON items(batch, bseq);',
        'CREATE INDEX IF NOT EXISTS items_code ON items(code);',
        'CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY AUTOINCREMENT, batch TEXT, product TEXT, target INTEGER, note TEXT, operator TEXT, start INTEGER, end INTEGER, total INTEGER DEFAULT 0, ok INTEGER DEFAULT 0, ng INTEGER DEFAULT 0, run_s INTEGER DEFAULT 0, oee REAL, top_reason TEXT, UNIQUE(batch, start));'
    ].join('\n');
    return msg;
}
if (msg.topic === 'retention') {
    const cut = nowS - cfg.retentionDays * 86400, cutS = nowS - cfg.shiftRetentionDays * 86400, cutI = (nowS - (cfg.itemRetentionDays || 90) * 86400) * 1000;
    const sql = ['DELETE FROM items WHERE ts < ' + cutI + ';', 'DELETE FROM minute_stats WHERE ts < ' + cut + ';', 'DELETE FROM ng_events WHERE ts < ' + cut + ';', 'DELETE FROM alerts WHERE ts < ' + cut + ';', 'DELETE FROM shift_summary WHERE start < ' + cutS + ';', 'DELETE FROM batches WHERE start < ' + cutS + ';'];
    if (new Date().getDay() === 0) sql.push('VACUUM;');
    sql.push('PRAGMA wal_checkpoint(TRUNCATE);');
    msg.topic = sql.join('\n');
    node.status({ fill: 'green', shape: 'dot', text: 'retention ' + new Date().toLocaleString() });
    return msg;
}
if (msg.topic === 'guard') {
    const [dbB, freeB] = String(msg.payload).trim().split(/\s+/).map(Number);
    const dbMB = Math.round((dbB || 0) / 1048576), freeGB = Math.round((freeB || 0) / 1073741824 * 10) / 10;
    flow.set('labDbInfo', { dbMB, freeGB, checked: Date.now() });
    node.status({ fill: 'blue', shape: 'dot', text: 'db ' + dbMB + ' MB, free ' + freeGB + ' GB' });
    if (dbMB > cfg.maxDbMB || (freeB && freeGB < cfg.minFreeGB)) {
        node.warn('Storage guard: db ' + dbMB + ' MB, free ' + freeGB + ' GB -> trimming oldest 7 days');
        msg.topic = [
            'DELETE FROM items WHERE ts < (SELECT MIN(ts) + 604800000 FROM items);',
            'DELETE FROM minute_stats WHERE ts < (SELECT MIN(ts) + 604800 FROM minute_stats);',
            'DELETE FROM ng_events WHERE ts < (SELECT MIN(ts) + 604800 FROM ng_events);',
            'DELETE FROM alerts WHERE ts < (SELECT MIN(ts) + 604800 FROM alerts);',
            "INSERT INTO alerts(ts,sev,code,text) VALUES(" + nowS + ",'warn','storage','Storage guard trimmed oldest 7 days (db " + dbMB + " MB, free " + freeGB + " GB)');",
            'VACUUM;'
        ].join('\n');
        return msg;
    }
    return null;
}
return null;
