// ===== DI trigger tester: digital stand-in for the machine's DI0 / DI1 outputs =====
// Sends the same messages the GPIO tab sends (topic gpio/13 = DI0 trigger, gpio/17 = DI1 reject) into the DI adapter,
// so the dashboard counts them exactly like the real machine. Works in "Real machine" and "Demo" mode.
// payload: {cmd:'start', ppm, rejectPct, rejectDelayMs, pulseMs} | {cmd:'stop'} | {cmd:'one', ng:true|false}
const cfg = flow.get('labcfg') || {};
const c = msg.payload || {};
const st = context.get('st') || { on: false, ppm: 120, rejectPct: 3, rejectDelayMs: 150, pulseMs: 40, n: 0, ng: 0 };

const pin = (gpio, v) => node.send({ topic: 'gpio/' + gpio, payload: v });
function product(ng) {
    pin(13, 1); setTimeout(() => pin(13, 0), st.pulseMs);                      // DI0 trigger pulse
    if (ng) setTimeout(() => { pin(17, 1); setTimeout(() => pin(17, 0), st.pulseMs); }, st.rejectDelayMs);   // DI1 reject pulse
    st.n++; if (ng) st.ng++;
    context.set('st', st);
    show();
}
function show() {
    if (cfg.mode === 'sim') return node.status({ fill: 'yellow', shape: 'ring', text: 'dashboard is in Simulate mode - switch to Real machine or Demo' });
    node.status(st.on ? { fill: 'green', shape: 'dot', text: 'running ' + st.ppm + ' PPM, ' + st.rejectPct + '% reject | sent ' + st.n + ' (' + st.ng + ' NG)' }
                      : { fill: 'grey', shape: 'ring', text: 'stopped | sent ' + st.n + ' (' + st.ng + ' NG)' });
}
function loop() {   // next product after one cycle at the set speed, +/-6% jitter like a real line
    const ms = 60000 / st.ppm * (0.94 + Math.random() * 0.12);
    context.set('timer', setTimeout(() => { if (!st.on) return; product(Math.random() * 100 < st.rejectPct); loop(); }, ms));
}

clearTimeout(context.get('timer'));
if (c.cmd === 'start') {
    for (const k of ['ppm', 'rejectPct', 'rejectDelayMs', 'pulseMs']) if (Number.isFinite(Number(c[k])) && c[k] !== '') st[k] = Number(c[k]);
    st.ppm = Math.min(600, Math.max(1, st.ppm));
    st.on = true; context.set('st', st); loop();
} else if (c.cmd === 'stop') {
    st.on = false; context.set('st', st);
} else if (c.cmd === 'one') {
    product(!!c.ng);
    if (st.on) loop();
} else if (st.on) loop();
show();
return null;
