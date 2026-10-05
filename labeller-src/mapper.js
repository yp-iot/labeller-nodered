// ===== Mapper: raw source values -> named tags (uses TAG MAP) =====
// in : msg.payload = {src,key,value} or an array of them, msg.origin = 'sim' | 'real'
// out: msg.payload = [{tag,value,delta?,ts,src,key}]  (values first, counters last)
const cfg = flow.get('labcfg');
const map = flow.get('tagmap');
if (!cfg || !map) return null;
if (((msg.origin || 'real') === 'sim') !== !!cfg.simulate) return null;   // only one data world at a time

const ver = flow.get('tagmapVer');
let idx = context.get('idx');
if (!idx || idx.ver !== ver) {
    idx = { ver, deps: {} };
    const add = (k, i) => { (idx.deps[k] = idx.deps[k] || []).push(i); };
    map.forEach((r, i) => {
        const m = /^([A-Z]+)(\d+)$/i.exec(r.key);
        const n = r.type === 'ascii' ? (r.words || 1) : /32/.test(r.type) ? 2 : 1;
        for (let w = 0; w < n; w++) add(r.src + ':' + (m && n > 1 ? m[1] + (Number(m[2]) + w) : r.key), i);
    });
    context.set('idx', idx);
    context.set('last', {});
}

const cache = context.get('raw') || {};
const last = context.get('last') || {};
const tags = flow.get('tags') || {};
const now = Date.now();

function word(src, key, i) {
    if (!i) return cache[src + ':' + key];
    const m = /^([A-Z]+)(\d+)$/i.exec(key);
    return m ? cache[src + ':' + m[1] + (Number(m[2]) + i)] : undefined;
}
function decode(r) {
    const w0 = word(r.src, r.key, 0);
    if (w0 === undefined) return undefined;
    let v;
    switch (r.type) {
    case 'bool': return !!Number(w0);
    case 'ascii': {
        if (typeof w0 === 'string') return w0.trim();          // already text (simulator)
        let s = '';
        for (let i = 0; i < (r.words || 1); i++) {
            const w = word(r.src, r.key, i);
            if (w === undefined) return undefined;
            s += String.fromCharCode(w & 0xFF, (w >> 8) & 0xFF);
        }
        return s.replace(/\0/g, '').trim();
    }
    case 'int16': v = (w0 & 0xFFFF) > 0x7FFF ? (w0 & 0xFFFF) - 0x10000 : (w0 & 0xFFFF); break;
    case 'uint16': case 'enum': v = w0 & 0xFFFF; break;
    case 'uint32': case 'int32': case 'float32': {
        const w1 = word(r.src, r.key, 1);
        if (w1 === undefined) return undefined;
        const b = Buffer.alloc(4); b.writeUInt16LE(w0 & 0xFFFF, 0); b.writeUInt16LE(w1 & 0xFFFF, 2);
        v = r.type === 'uint32' ? b.readUInt32LE(0) : r.type === 'int32' ? b.readInt32LE(0) : b.readFloatLE(0);
        break;
    }
    default: v = Number(w0);
    }
    if (r.type === 'enum') return (r.map && r.map[v] !== undefined) ? r.map[v] : 'Code ' + v;
    return r.scale ? Math.round(v * r.scale * 1000) / 1000 : v;
}

const entries = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
const changed = new Set();
const counts = [];
for (const e of entries) {
    if (!e || e.key === undefined) continue;
    const k = e.src + ':' + e.key;
    const prev = cache[k];
    cache[k] = e.value;
    for (const i of (idx.deps[k] || [])) {
        const r = map[i];
        if (r.kind !== 'pulse') { changed.add(i); continue; }
        if (r.key !== e.key) continue;
        const on = !!Number(e.value), was = !!Number(prev);
        const edge = (r.edge || 'rise') === 'rise' ? (on && !was) : (!on && was);
        if (!edge) continue;
        if (r.when && !Number(cache[r.src + ':' + r.when])) continue;
        counts.push({ i, u: { tag: r.tag, value: 1, delta: 1, ts: now, src: r.src, key: r.key } });
    }
}
context.set('raw', cache);

const out = [];
for (const i of [...changed].sort((a, b) => a - b)) {
    const r = map[i];
    const v = decode(r);
    if (v === undefined) continue;
    const u = { tag: r.tag, value: v, ts: now, src: r.src, key: r.key };
    if (r.kind === 'counter') {
        const l = last[r.tag];
        u.delta = (l !== undefined && v >= l && v - l < 100000) ? v - l : 0;   // first read / reset -> 0
        last[r.tag] = v;
        counts.push({ i, u });
    } else out.push(u);
}
counts.sort((a, b) => a.i - b.i).forEach(c => out.push(c.u));
context.set('last', last);
if (!out.length) return null;

for (const u of out) {
    const r = map.find(x => x.tag === u.tag) || {};
    const t = tags[u.tag] || {};
    tags[u.tag] = { v: r.kind === 'pulse' ? (t.v || 0) + 1 : u.value, ts: now, src: u.src, key: u.key, unit: r.unit || '' };
}
flow.set('tags', tags);
msg.topic = 'tags';
msg.payload = out;
return msg;
