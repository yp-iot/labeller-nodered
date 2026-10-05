// ===== Claude reply -> browser (falls back to the on-device answer on any error) =====
let text = null, provider = 'claude';
const p = msg.payload;
if (!msg.error && msg.statusCode === 200 && p && Array.isArray(p.content)) {
    text = p.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
}
if (!text) {
    provider = 'local';
    text = msg.localAnswer || 'Sorry, I could not answer that.';
    node.warn('Claude unavailable (' + (msg.error ? (msg.error.message || msg.error) : 'HTTP ' + msg.statusCode + ' ' + JSON.stringify(p && p.error || '')) + ') - used on-device answer');
}
const hist = flow.get('chatHist') || {};
const sid = msg._session && msg._session.id || 'x';
const sess = hist[sid] || { t: 0, turns: [] };
sess.t = Date.now();
sess.turns = [...sess.turns, { role: 'user', content: msg.userText }, { role: 'assistant', content: text }].slice(-6);
hist[sid] = sess;
Object.keys(hist).sort((a, b) => hist[b].t - hist[a].t).slice(10).forEach(k => delete hist[k]);
flow.set('chatHist', hist);
return { _session: msg._session, payload: JSON.stringify({ type: 'chat', id: msg.chatId, text, provider }) };
