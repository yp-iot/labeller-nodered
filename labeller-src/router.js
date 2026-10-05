// ===== Browser message router =====
// out1: chat/hello -> Chat   out2: validated batch command -> Analytics
// out3: batch list query -> SQLite   out4: reply to this browser   out5: audit trace search
let m;
try { m = JSON.parse(msg.payload); } catch (e) { return null; }
const cfg = flow.get('labcfg') || {};
const reply = o => [null, null, null, { _session: msg._session, payload: JSON.stringify(o) }, null];
const err = e => reply({ type: 'batch:err', error: e });

if (m.type === 'chat' || m.type === 'hello') return [msg, null, null, null, null];

if (m.type === 'trace') return [null, null, null, null, { _session: msg._session, trace: m }];

if (m.type === 'batches') return [null, null, { _session: msg._session, topic: 'SELECT id,batch,product,target,note,operator,start,end,total,ok,ng,run_s,oee,top_reason FROM batches ORDER BY start DESC LIMIT 30', payload: [] }, null, null];

if (m.type === 'batch') {
    if (cfg.batchSource === 'plc') return err('Batches follow the PLC batch number (CONFIG batchSource = plc).');
    if (cfg.batchPin && String(m.pin || '') !== String(cfg.batchPin)) return err('Incorrect PIN.');
    if (m.action === 'new') {
        const id = String(m.id || '').trim();
        if (!/^[A-Za-z0-9._\-\/# ]{1,32}$/.test(id)) return err('Batch number: 1–32 letters, digits or - _ . / #');
        const product = String(m.product || '').trim().slice(0, 60) || cfg.product;
        const target = m.target === '' || m.target === undefined ? 0 : Number(m.target);
        if (!Number.isInteger(target) || target < 0 || target > 10000000) return err('Target must be a whole number.');
        const note = String(m.note || '').trim().slice(0, 120);
        return [null, { topic: 'batch', payload: { action: 'new', id, product, target, note } }, null,
            { _session: msg._session, payload: JSON.stringify({ type: 'batch:ok', action: 'new', id }) }, null];
    }
    if (m.action === 'end') return [null, { topic: 'batch', payload: { action: 'end' } }, null,
        { _session: msg._session, payload: JSON.stringify({ type: 'batch:ok', action: 'end' }) }, null];
}
return null;
