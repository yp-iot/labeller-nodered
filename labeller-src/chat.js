// ===== Chat router + on-device answer engine =====
// in : websocket msg {type:'chat', id, text} | {type:'hello'}
// out1: reply to this browser only (msg._session kept)   out2: request for Claude (http request)
let m;
try { m = JSON.parse(msg.payload); } catch (e) { return null; }
const cfg = flow.get('labcfg') || {};
const S = flow.get('labSnap');
const H = flow.get('labHist');
const reply = (o) => ({ _session: msg._session, payload: JSON.stringify(o) });

if (m.type === 'hello') return [reply({ type: 'hist', hist: H || null }), null];
if (m.type !== 'chat' || !m.text) return null;
const text = String(m.text).slice(0, 500);

function local(q) {
    if (!S) return 'I am still starting up — give me a few seconds of data.';
    const s = q.toLowerCase();
    const w = S.win.shift, h = S.win.hour, L = S.line;
    const tips = { 'Label skew': 'check the applicator peel plate and web tension', 'Missing label': 'check the label gap sensor and roll splice', 'Wrong label': 'verify the loaded roll matches the batch', 'OCR misread': 'check the printhead and date-code contrast', 'Barcode unreadable': 'clean the printhead and check the ribbon', 'Wrinkle / bubble': 'check wipe-down brush pressure', 'Cap / seal': 'check capper torque upstream' };
    const reasons = (x, n) => x.reasons.slice(0, n).map(([k, v]) => '• ' + k + ' — ' + v + ' (' + Math.round(100 * v / Math.max(1, x.ng)) + '%)').join('\n');
    const has = (...k) => k.some(x => x.length <= 3 ? new RegExp('\\b' + x + '\\b').test(s) : s.includes(x));   // short words must match whole words ('ng' not in 'going')
    const statusTxt = { running: 'running', stopped: 'stopped', fault: 'in **fault**' }[L.status];
    const est = S.feed.some(f => f.est) ? '\n\n_Inspection details are partly simulated until the IV3/PLC data is mapped._' : '';

    if (has('yesterday', 'week', '7 day', 'history', 'last days', 'compare')) {
        if (!H || !H.days || !H.days.length) return 'History builds up in the on-device database every minute. Ask me again after the line has run for a while.';
        const d = H.days.slice(-7).map(x => '• ' + x.day + ': ' + x.total.toLocaleString() + ' pcs, NG ' + x.ngPct + '%, OEE ' + x.oee + '%').join('\n');
        return '**Last ' + Math.min(7, H.days.length) + ' days**\n' + d;
    }
    if (has('oee', 'efficien', 'availability', 'performance')) {
        const loss = [['Availability', w.A], ['Performance', w.P], ['Quality', w.Q]].sort((a, b) => a[1] - b[1])[0];
        return '**OEE this shift is ' + w.oee + '%**\nAvailability ' + w.A + '% · Performance ' + w.P + '% · Quality ' + w.Q + '%\n\nBiggest loss is **' + loss[0] + '** (' + loss[1] + '%). Last hour OEE: ' + h.oee + '%.';
    }
    if (has('label') && has('left', 'remain', 'roll', 'run out', 'empty', 'change')) {
        const c = S.consum.label;
        return 'Label roll is at **' + c.pct + '%** (~' + c.left.toLocaleString() + ' labels)' + (c.mins !== null ? ', about **' + c.mins + ' min** at the current speed.' : '.') + (c.est ? '\n_Estimated from the product count._' : '');
    }
    if (has('ribbon')) {
        const c = S.consum.ribbon;
        return 'Ribbon is at **' + c.pct + '%**' + (c.mins !== null ? ', about **' + c.mins + ' min** left.' : '.') + (c.est ? '\n_Estimated from the product count._' : '');
    }
    if (has('what should', 'check', 'fix', 'recommend', 'action', 'advice', 'improve')) {
        const acts = S.insights.filter(i => i.sev !== 'good').map(i => '• **' + i.title + '** — ' + i.body);
        const top = w.reasons[0];
        if (!acts.length && top) acts.push('• Top reject this shift is **' + top[0] + '** — ' + (tips[top[0]] || 'inspect the station') + '.');
        return acts.length ? 'Here is what I would look at:\n' + acts.join('\n') : 'Nothing needs attention right now — the line is stable.';
    }
    if (has('batch', 'lot')) {
        if (!L.batch.id) return 'No batch is running. Start one from **Batches → New batch**.';
        const b = S.win.batch, tgt = L.batch.target;
        let t = 'Batch **' + L.batch.id + '** (' + L.batch.product + '), started ' + new Date(L.batch.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ': ' + b.total.toLocaleString() + ' pcs, ' + b.ng + ' rejects (' + b.ngPct + '%), OEE ' + b.oee + '%.';
        if (tgt) { const left = Math.max(0, tgt - b.ok); t += '\nTarget ' + tgt.toLocaleString() + ' good — ' + Math.min(100, Math.round(100 * b.ok / tgt)) + '% done' + (left && L.speed > 5 ? ', about **' + Math.round(left / L.speed) + ' min** to go.' : '.'); }
        return t;
    }
    if (has('last', 'latest', 'recent')) {
        const f = S.feed.find(x => !x.ok);
        if (!f) return 'No recent rejects in the feed.';
        const ago = Math.round((Date.now() - f.t) / 1000);
        return 'Last reject was **#' + f.seq + '**, ' + ago + ' s ago: **' + f.reason + '** (AI confidence ' + f.conf + '%).\nOCR "' + f.ocr + '", code ' + (f.code || 'unreadable') + ', label offset ' + f.offset + ' mm.' + (f.est ? '\n_Classification simulated._' : '');
    }
    if (has('reject', 'ng', 'defect', 'quality', 'fail', 'why')) {
        if (!w.ng) return 'No rejects so far this shift. ' + w.total.toLocaleString() + ' good of ' + w.total.toLocaleString() + '.';
        const top = w.reasons[0];
        return '**' + w.ng + ' rejects this shift (' + w.ngPct + '%)**, last hour ' + h.ngPct + '%.\n' + reasons(w, 4) + '\n\nMain cause is **' + top[0].toLowerCase() + '** — ' + (tips[top[0]] || 'inspect the station') + '.' + est;
    }
    if (has('alert', 'alarm', 'warning', 'predict', 'problem')) {
        if (!S.alerts.length) return 'No active alerts. Label roll ' + S.consum.label.pct + '%, ribbon ' + S.consum.ribbon.pct + '%.';
        return S.alerts.map(a => '• **' + a.title + '** — ' + a.body).join('\n');
    }
    if (has('speed', 'rate', 'ppm', 'bpm', 'fast', 'slow')) return 'Running at **' + L.speed + ' PPM** (rated ' + L.ideal + ' PPM). Performance this hour: ' + h.P + '%.';
    if (has('shift', 'operator', 'who')) return 'Shift **' + L.shift.name + '** (' + L.shift.start + '–' + L.shift.end + '), operator **' + L.operator + '**. ' + w.total.toLocaleString() + ' pcs so far.';
    if (has('how many', 'output', 'count', 'produc', 'total')) return '**' + w.total.toLocaleString() + ' pcs** this shift — ' + w.ok.toLocaleString() + ' good, ' + w.ng + ' rejected. Last hour: ' + h.total.toLocaleString() + ' pcs.';
    if (has('hello', 'hi ', 'hey', 'help', 'what can')) return 'Hi — I am watching ' + L.name + '. Ask me about OEE, rejects and their causes, what to check, label roll or ribbon, speed, batch or shift, alerts, or the last 7 days.';
    // summary
    return '**' + L.name + ' is ' + statusTxt + '** at ' + L.speed + ' PPM.\nShift ' + L.shift.name + ': ' + w.total.toLocaleString() + ' pcs, NG ' + w.ngPct + '%, OEE ' + w.oee + '%.' + (S.alerts.length ? '\nActive alert: ' + S.alerts[0].title + '.' : '\nNo active alerts.');
}

const answer = local(text);

// session history (bounded: 10 sessions x 6 turns)
const hist = flow.get('chatHist') || {};
const sid = msg._session && msg._session.id || 'x';
const sess = hist[sid] || { t: 0, turns: [] };
sess.t = Date.now();
const prior = sess.turns.slice(-6);

const key = env.get('ANTHROPIC_API_KEY');
if (cfg.chatProvider === 'claude' && key) {
    const system = 'You are the assistant built into an industrial labelling and inspection line (Solo labeller with KEYENCE IV3 AI vision: OCR, 1D/2D code, label position, missing/wrong label, cap/seal, AI defect detection). ' +
        'You only observe; you cannot control the machine. Answer operators and managers briefly (max ~120 words), plain language, use the live data below, give concrete checks. Use **bold** sparingly, bullets with "• ". If data is marked est:true it is simulated. ' +
        '\n\nLIVE SNAPSHOT (JSON):\n' + JSON.stringify({ line: S && S.line, shift: S && S.win.shift, hour: S && S.win.hour, batch: S && S.win.batch, alerts: S && S.alerts, insights: S && S.insights, consumables: S && S.consum, recent: S && S.feed.slice(0, 6), days: H && H.days && H.days.slice(-7) });
    const req = {
        _session: msg._session, chatId: m.id, localAnswer: answer, userText: text,
        url: 'https://api.anthropic.com/v1/messages', method: 'POST', requestTimeout: 20000,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        payload: { model: cfg.claudeModel, max_tokens: 400, system, messages: [...prior, { role: 'user', content: text }] }
    };
    return [reply({ type: 'typing', id: m.id }), req];
}

sess.turns = [...prior, { role: 'user', content: text }, { role: 'assistant', content: answer }].slice(-6);
hist[sid] = sess;
const ids = Object.keys(hist).sort((a, b) => hist[b].t - hist[a].t);
ids.slice(10).forEach(k => delete hist[k]);
flow.set('chatHist', hist);
return [reply({ type: 'chat', id: m.id, text: answer, provider: 'local' }), null];
