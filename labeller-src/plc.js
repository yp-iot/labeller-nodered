// ===== Mitsubishi serial poller (READ ONLY) =====
// topic 'tick' -> sends next read frame to the serial request node (output 1)
// reply from serial request -> parsed words/bits -> Mapper (output 2) as {src:'plc', key:'D100', value}
// Protocols:
//   fx-prog : FX programming port (FX1S/1N/2N/3U), 9600 7E1. Read cmd '0', D0 at byte addr 0x1000, M0 at 0x0100.
//   mc-1c   : Dedicated protocol format 1 (FX-485BD / computer link), command 'WR' (word read), sum check on.
const cfg = flow.get('labcfg');
if (!cfg || !cfg.plc) return null;
const pc = cfg.plc;
const st = context.get('st') || { i: 0, busy: 0, ok: 0, err: 0 };
const hex = (v, w) => v.toString(16).toUpperCase().padStart(w, '0');
const sum = s => hex([...s].reduce((a, c) => a + c.charCodeAt(0), 0) & 0xFF, 2);
const STX = '\x02', ETX = '\x03', ENQ = '\x05';

function frame(rd) {
    if (pc.protocol === 'fx-prog') {
        const base = rd.dev === 'D' ? 0x1000 + rd.start * 2 : rd.dev === 'M' ? 0x0100 + rd.start / 8 : null;
        if (base === null) throw new Error('fx-prog supports D and M only');
        const body = '0' + hex(base, 4) + hex(rd.words * 2, 2) + ETX;
        return STX + body + sum(body);
    }
    if (pc.protocol === 'mc-1c') {
        const head = rd.dev + String(rd.start).padStart(4, '0');
        const body = hex(pc.station, 2) + pc.pcNo + 'WR' + '0' + head + hex(rd.words, 2);
        return ENQ + body + sum(body);
    }
    throw new Error('unknown protocol ' + pc.protocol);
}
function parse(rd, buf) {
    const s = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '');
    const a = s.indexOf(STX), e = s.indexOf(ETX, a + 1);
    if (a < 0 || e < 0) throw new Error(s.length ? 'bad reply ' + JSON.stringify(s.slice(0, 20)) : 'no reply');
    let data = s.slice(a + 1, e);
    const chk = s.slice(e + 1, e + 3);
    if (chk.length === 2 && chk.toUpperCase() !== sum(data + ETX)) throw new Error('checksum');   // both protocols: sum of chars after STX up to ETX
    const words = [];
    if (pc.protocol === 'fx-prog') {              // bytes as hex, low byte first
        for (let i = 0; i + 4 <= data.length; i += 4) words.push(parseInt(data.substr(i + 2, 2) + data.substr(i, 2), 16));
    } else {                                      // mc-1c: station(2) pc(2) then 4 hex per word, high first
        data = data.slice(4);
        for (let i = 0; i + 4 <= data.length; i += 4) words.push(parseInt(data.substr(i, 4), 16));
    }
    if (words.length < rd.words) throw new Error('short reply');
    const out = [];
    words.slice(0, rd.words).forEach((w, i) => {
        if (rd.dev === 'M') for (let b = 0; b < 16; b++) out.push({ src: 'plc', key: 'M' + (rd.start + i * 16 + b), value: (w >> b) & 1 });
        else out.push({ src: 'plc', key: rd.dev + (rd.start + i), value: w });
    });
    return out;
}

if (msg.topic === 'tick') {
    if (st.busy && Date.now() - st.busy < 3000) return null;      // still waiting
    const rd = pc.reads[st.i % pc.reads.length];
    try {
        st.busy = Date.now();
        context.set('st', st);
        return [{ payload: Buffer.from(frame(rd), 'latin1'), plcRead: rd }, null];
    } catch (e) { node.error(e.message); st.busy = 0; context.set('st', st); return null; }
}
// reply
const rd = msg.plcRead;
st.busy = 0; st.i++;
try {
    const vals = parse(rd, msg.payload);
    st.ok++;
    node.status({ fill: 'green', shape: 'dot', text: pc.protocol + ' ok ' + st.ok + ' err ' + st.err });
    context.set('st', st);
    return [null, { topic: 'raw', origin: 'real', payload: vals }];
} catch (e) {
    st.err++;
    node.status({ fill: 'red', shape: 'ring', text: rd.dev + rd.start + ': ' + e.message + ' (err ' + st.err + ')' });
    context.set('st', st);
    return null;
}
