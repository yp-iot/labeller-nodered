// ===== Simulator: a realistic labelling + IV3 inspection line =====
// Produces RAW values exactly where the TAG MAP says they live (DI0, D105 ...),
// so the demo exercises the same mapping as the real machine. Runs every 250 ms.
// msg.topic 'burst' = 90 s defect burst (demo button in the editor).
const cfg = flow.get('labcfg');
const map = flow.get('tagmap');
if (!cfg || !map || !cfg.simulate) { node.status({ fill: 'grey', shape: 'ring', text: 'off (simulate=false)' }); return null; }
const now = Date.now();
const S = context.get('s') || {
    state: 'run', until: 0, acc: 0, total: 0, ng: 0, seq: 0,
    labelLeft: cfg.labelRollQty * 0.62, ribbonLeft: cfg.ribbonQty * 0.48,
    drift: 0, driftRate: 0.0006, burstUntil: 0, speed: cfg.idealPpm
};
if (msg.topic === 'burst') { S.burstUntil = now + 90000; context.set('s', S); node.status({ fill: 'red', shape: 'dot', text: 'defect burst 90 s' }); return null; }

const REASONS = { 'Label skew': 1, 'Missing label': 2, 'Wrong label': 3, 'OCR misread': 4, 'Barcode unreadable': 5, 'Wrinkle / bubble': 6, 'Cap / seal': 7 };
const BASE_W = { 'Label skew': 22, 'Missing label': 10, 'Wrong label': 3, 'OCR misread': 20, 'Barcode unreadable': 14, 'Wrinkle / bubble': 21, 'Cap / seal': 10 };
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
function pick(w) { let t = 0; for (const k in w) t += w[k]; let r = Math.random() * t; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; }

// --- encode a tag value into raw source entries using the tag map ---
function enc(tag, value) {
    const r = map.find(x => x.tag === tag);
    if (!r || r.kind) return [];
    const m = /^([A-Z]+)(\d+)$/i.exec(r.key);
    const k = i => (m ? m[1] + (Number(m[2]) + i) : r.key);
    if (r.type === 'bool') return [{ src: r.src, key: r.key, value: value ? 1 : 0 }];
    if (r.type === 'ascii') return [{ src: r.src, key: r.key, value: String(value) }];
    let v = value;
    if (r.type === 'enum') { v = 0; for (const c in r.map) if (r.map[c] === value) v = Number(c); }
    else if (r.scale) v = Math.round(value / r.scale);
    if (/32/.test(r.type)) {
        const b = Buffer.alloc(4);
        if (r.type === 'float32') b.writeFloatLE(value, 0); else b.writeUInt32LE(v >>> 0, 0);
        return [{ src: r.src, key: k(0), value: b.readUInt16LE(0) }, { src: r.src, key: k(1), value: b.readUInt16LE(2) }];
    }
    return [{ src: r.src, key: r.key, value: v & 0xFFFF }];
}
function encCounters(item) {
    // pulse rows: set 'when' inputs, then one edge per distinct key; counter rows: cumulative values
    const out = [], edges = new Set();
    for (const r of map) {
        if (r.kind === 'pulse') {
            if (r.when) out.push({ src: r.src, key: r.when, value: (r.tag === 'count_ng' ? item.ng : 0) ? 1 : 0 });
            edges.add(r.src + '|' + r.key + '|' + (r.edge || 'rise'));
        }
    }
    for (const e of edges) { const [src, key, edge] = e.split('|'); const a = edge === 'rise' ? 1 : 0; out.push({ src, key, value: a }, { src, key, value: 1 - a }); }
    for (const r of map) {
        if (r.kind === 'counter') {
            const val = r.tag === 'count_ng' ? S.ng : r.tag === 'count_total' ? S.total : null;
            if (val !== null) out.push(...encRow(r, val));
        }
    }
    return out;
}
function encRow(r, value) {
    const m = /^([A-Z]+)(\d+)$/i.exec(r.key);
    if (/32/.test(r.type)) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0, 0); return [{ src: r.src, key: r.key, value: b.readUInt16LE(0) }, { src: r.src, key: m[1] + (Number(m[2]) + 1), value: b.readUInt16LE(2) }]; }
    return [{ src: r.src, key: r.key, value: value & 0xFFFF }];
}

// --- line state machine ---
if (now >= S.until && S.state !== 'run') { S.state = 'run'; if (S.reason === 'roll') S.labelLeft = cfg.labelRollQty; if (S.reason === 'ribbon') S.ribbonLeft = cfg.ribbonQty; S.reason = ''; }
if (S.state === 'run') {
    if (S.labelLeft <= 0) { S.state = 'stop'; S.reason = 'roll'; S.until = now + 75000; }
    else if (S.ribbonLeft <= 0) { S.state = 'stop'; S.reason = 'ribbon'; S.until = now + 90000; }
    else if (Math.random() < 1 / (4 * 60 * 12)) { S.state = 'stop'; S.reason = 'micro'; S.until = now + rnd(6000, 25000); }
    else if (Math.random() < 1 / (4 * 60 * 50)) { S.state = 'fault'; S.reason = 'fault'; S.until = now + rnd(40000, 90000); }
}
const running = S.state === 'run';

// label position drift: creeps, then the "operator" corrects it
S.drift += S.driftRate * (running ? 1 : 0);
if (Math.abs(S.drift) > 1.35 || Math.random() < 1 / (4 * 60 * 30)) { S.drift = 0; S.driftRate = rnd(0.0003, 0.0009) * (Math.random() < 0.5 ? -1 : 1); }

S.speed = running ? Math.max(0, (cfg.idealPpm || 120) * rnd(0.9, 0.995)) : 0;
if (!isFinite(S.acc)) S.acc = 0;   // self-heal if a bad config ever produced NaN
S.acc += S.speed / 60 * 0.25;
const status = [...enc('running', running), ...enc('fault', S.state === 'fault'), ...enc('speed_ppm', Math.round(S.speed * 10) / 10)];

const msgs = [];
while (S.acc >= 1) {
    S.acc -= 1;
    S.seq++;
    const burst = now < S.burstUntil;
    const skewExtra = Math.max(0, Math.abs(S.drift) - 0.7) * 0.09;
    const pNg = 0.011 + skewExtra + (burst ? 0.14 : 0);
    const ng = Math.random() < pNg;
    let reason = 'None';
    if (ng) {
        const w = Object.assign({}, BASE_W);
        w['Label skew'] += skewExtra * 2500;
        if (burst) w['Wrinkle / bubble'] += 160;
        reason = pick(w);
    }
    let offset = S.drift + gauss() * 0.22;
    if (reason === 'Label skew') offset = Math.sign(S.drift || 1) * rnd(cfg.offsetTolMm + 0.1, cfg.offsetTolMm + 0.9);
    const conf = ng ? rnd(84, 99.4) : rnd(96.5, 99.9);
    const lot = String(flow.get('labBatchId') || 'NOLOT').replace(/^LOT-?/i, '');
    const ocr = reason === 'OCR misread' ? 'LOT ' + lot.slice(0, 3) + '? EXP 1?/2028' : 'LOT ' + lot + ' EXP 10/2028';
    const code = reason === 'Barcode unreadable' ? '' : '95560' + String(1234500 + (S.seq % 100000)).padStart(8, '0');
    S.total++; if (ng) S.ng++;
    S.labelLeft = Math.max(0, S.labelLeft - (reason === 'Missing label' ? 0 : 1));
    S.ribbonLeft = Math.max(0, S.ribbonLeft - 1);
    const raw = [
        ...enc('reject_code', reason), ...enc('ai_conf', Math.round(conf * 10) / 10), ...enc('label_offset', Math.round(offset * 100) / 100),
        ...enc('ocr_text', ocr), ...enc('barcode', code),
        ...encCounters({ ng })
    ];
    msgs.push({ topic: 'raw', origin: 'sim', payload: raw });
}
status.push(...enc('label_remain', Math.round(100 * S.labelLeft / cfg.labelRollQty)), ...enc('ribbon_remain', Math.round(100 * S.ribbonLeft / cfg.ribbonQty)));
msgs.push({ topic: 'raw', origin: 'sim', payload: status });

context.set('s', S);
node.status({ fill: running ? 'green' : S.state === 'fault' ? 'red' : 'yellow', shape: 'dot', text: S.state + (S.reason ? ' (' + S.reason + ')' : '') + ' | ' + S.total + ' pcs, drift ' + S.drift.toFixed(2) + 'mm' + (now < S.burstUntil ? ' | BURST' : '') });
return [msgs];
