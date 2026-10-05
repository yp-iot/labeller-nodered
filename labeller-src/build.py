#!/usr/bin/env python3
"""Build the 'Labeller AI Demo' tab and deploy it into the running Node-RED (keeps all other tabs)."""
import json, os, sys, urllib.request

D = os.path.dirname(os.path.abspath(__file__))
src = lambda f: open(os.path.join(D, f)).read()
Z = 'tab_lab'
GPIO_DI_LINKOUTS = ['ed5cac9635191991', '9031ea95efdb0241', '953d87ee5e6849cb', '1f7d4606b8ef7d0d']
nodes = []

def add(n):
    n.setdefault('z', Z)
    nodes.append(n)
    return n

def fn(id, name, code, x, y, wires, outputs=1):
    return add({'id': id, 'type': 'function', 'name': name, 'func': code, 'outputs': outputs, 'timeout': 0, 'noerr': 0,
                'initialize': '', 'finalize': '', 'libs': [], 'x': x, 'y': y, 'wires': wires})

def inject(id, name, x, y, wires, topic='', payload='', ptype='date', repeat='', once=False, delay=0.1, crontab='', d=False):
    n = {'id': id, 'type': 'inject', 'name': name, 'props': [{'p': 'payload'}, {'p': 'topic', 'vt': 'str'}],
         'repeat': repeat, 'crontab': crontab, 'once': once, 'onceDelay': delay, 'topic': topic, 'payload': payload,
         'payloadType': ptype, 'x': x, 'y': y, 'wires': wires}
    if d: n['d'] = True
    return add(n)

def comment(id, name, info, x, y):
    return add({'id': id, 'type': 'comment', 'name': name, 'info': info, 'x': x, 'y': y, 'wires': []})

def debug(id, name, x, y, active=True, complete='payload'):
    return add({'id': id, 'type': 'debug', 'name': name, 'active': active, 'tosidebar': True, 'console': False, 'tostatus': False,
                'complete': complete, 'targetType': 'msg' if complete != 'true' else 'full', 'statusVal': '', 'statusType': 'auto', 'x': x, 'y': y, 'wires': []})

def http_in(id, name, url, x, y, wires):
    return add({'id': id, 'type': 'http in', 'name': name, 'url': url, 'method': 'get', 'upload': False, 'swaggerDoc': '', 'x': x, 'y': y, 'wires': wires})

def http_out(id, x, y, ctype='application/json'):
    return add({'id': id, 'type': 'http response', 'name': '', 'statusCode': '', 'headers': {'content-type': ctype}, 'x': x, 'y': y, 'wires': []})

add({'id': Z, 'type': 'tab', 'label': 'Labeller AI Demo', 'disabled': False,
     'info': 'Solo Smart Factory labeller - read-only monitoring dashboard with AI insights.\n\n'
             'Dashboard: http://<device-ip>:1880/labeller\n\n'
             '1. CONFIG / TAG MAP - edit here\n2. Sources: DI (GPIO tab links), Mitsubishi serial (disabled), Simulator\n'
             '3. Mapper -> 4. Analytics -> websocket + SQLite\n\nNothing on this tab writes to the machine.'})

# ---------- shared config nodes ----------
add({'id': 'lab_wsl', 'type': 'websocket-listener', 'z': '', 'path': '/ws/labeller', 'wholemsg': 'false'})
add({'id': 'lab_db', 'type': 'sqlitedb', 'z': '', 'db': '/home/pi/.node-red/data/labeller.db', 'mode': 'RWC'})
add({'id': 'lab_serialcfg', 'type': 'serial-port', 'z': '', 'name': 'PLC RS-485', 'serialport': '/dev/ttyS0', 'serialbaud': '9600',
     'databits': '7', 'parity': 'even', 'stopbits': '1', 'waitfor': '', 'dtr': 'none', 'rts': 'none', 'cts': 'none', 'dsr': 'none',
     'newline': '150', 'bin': 'bin', 'out': 'time', 'addchar': '', 'responsetimeout': '2000'})

# ---------- 1. config ----------
comment('lab_c1', '① CONFIG + TAG MAP — edit these two nodes', 'CONFIG: line, shifts, simulate on/off, storage limits, chat provider, PLC protocol.\n'
        'TAG MAP: where each machine value comes from (DI0..3 or PLC D/M registers).\nRedeploy after editing.', 200, 40)
inject('lab_boot', 'on deploy', 140, 90, [['lab_cfg', 'lab_map']], once=True, delay=0.1)
fn('lab_cfg', 'CONFIG', src('config.js'), 330, 70, [], outputs=0)
fn('lab_map', 'TAG MAP', src('tagmap.js'), 330, 110, [], outputs=0)

# ---------- 2. sources ----------
comment('lab_c2', '② SOURCES — all produce raw {src,key,value}', 'DI: from the GPIO tab (one node per pin rule).\n'
        'Simulator: active while CONFIG.simulate = true; writes the same raw keys the real machine would.\n'
        'Mitsubishi serial: enable "PLC poll" + "PLC serial" when the PLC is wired, set CONFIG.simulate = false.', 210, 170)
add({'id': 'lab_dilink', 'type': 'link in', 'name': 'DI0-DI3 from GPIO', 'links': GPIO_DI_LINKOUTS, 'x': 150, 'y': 220, 'wires': [['lab_diad']]})
fn('lab_diad', 'DI adapter', "// GPIO pin -> DI key (read-only)\nconst pins = { 'gpio/13': 'DI0', 'gpio/17': 'DI1', 'gpio/22': 'DI2', 'gpio/27': 'DI3' };\n"
   "const key = pins[msg.topic];\nif (!key) return null;\nreturn { topic: 'raw', origin: 'real', payload: { src: 'di', key, value: Number(msg.payload) ? 1 : 0 } };",
   350, 220, [['lab_mapper']])
inject('lab_simtick', 'every 250 ms', 150, 270, [['lab_sim']], topic='tick', repeat='0.25', once=True, delay=1)
inject('lab_burst', 'demo: defect burst', 160, 310, [['lab_sim']], topic='burst')
fn('lab_sim', 'Simulator', src('simulator.js'), 350, 290, [['lab_mapper']])
inject('lab_plctick', 'PLC poll', 140, 370, [['lab_plc']], topic='tick', repeat='0.5', once=True, delay=2, d=True)
fn('lab_plc', 'Mitsubishi poller (read-only)', src('plc.js'), 380, 370, [['lab_serial'], ['lab_mapper']], outputs=2)
add({'id': 'lab_serial', 'type': 'serial request', 'name': 'PLC serial', 'serial': 'lab_serialcfg', 'd': True, 'x': 380, 'y': 420, 'wires': [['lab_plc']]})

# ---------- 3. mapper ----------
comment('lab_c3', '③ MAPPER — raw → named tags', 'Applies TAG MAP (type, scale, enum, counters, pulses). Inspect with "show tags" or GET /labeller/api/tags', 650, 170)
fn('lab_mapper', 'Mapper', src('mapper.js'), 620, 260, [['lab_an']])
inject('lab_showtags', 'show tags', 620, 330, [['lab_tagview']])
http_in('lab_tagsapi', 'GET tags', '/labeller/api/tags', 630, 370, [['lab_tagview']])
fn('lab_tagview', 'Tag view', "const tags = flow.get('tags') || {}, map = flow.get('tagmap') || [], now = Date.now();\n"
   "msg.payload = map.map(r => { const t = tags[r.tag]; return { tag: r.tag, source: r.src + ':' + r.key, type: r.type + (r.kind ? '/' + r.kind : ''), value: t ? t.v : null, unit: r.unit || '', ageS: t ? Math.round((now - t.ts) / 1000) : null }; });\n"
   "return msg.req ? [null, msg] : [msg, null];", 820, 350, [['lab_tagdbg'], ['lab_tagsres']], outputs=2)
debug('lab_tagdbg', 'tags', 1000, 330)
http_out('lab_tagsres', 1010, 370)

# ---------- 4. analytics ----------
comment('lab_c4', '④ ANALYTICS — OEE, feed, AI insights, predictive alerts', '', 900, 170)
inject('lab_tick', 'every 1 s', 620, 220, [['lab_an']], topic='tick', repeat='1', once=True, delay=1)
fn('lab_an', 'Analytics', src('analytics.js'), 840, 240, [['lab_wsout'], ['lab_sqlw']], outputs=2)

# ---------- 5. storage ----------
comment('lab_c5', '⑤ STORAGE — SQLite data/labeller.db (batched 60 s, retention, size guard)', 'minute_stats, ng_events, shift_summary, alerts.\n'
        'Retention daily 02:00 (CONFIG.retentionDays), VACUUM Sundays. Size guard hourly: trims oldest week if db > maxDbMB or free disk < minFreeGB.', 260, 480)
inject('lab_dbinit', 'init db', 140, 530, [['lab_dbjobs']], topic='init', once=True, delay=0.5)
inject('lab_ret', 'retention 02:00', 160, 570, [['lab_dbjobs']], topic='retention', crontab='00 02 * * *')
inject('lab_guardt', 'size check hourly', 160, 610, [['lab_guardexec']], topic='guard', repeat='3600', once=True, delay=20)
add({'id': 'lab_guardexec', 'type': 'exec', 'name': 'db size + free disk', 'command': "echo $(stat -c %s /home/pi/.node-red/data/labeller.db 2>/dev/null || echo 0) $(df --output=avail -B1 / | tail -1)",
     'addpay': '', 'append': '', 'useSpawn': 'false', 'timer': '10', 'winHide': False, 'oldrc': False, 'x': 370, 'y': 610, 'wires': [['lab_dbjobs'], [], []]})
fn('lab_dbjobs', 'Storage jobs', src('db.js'), 570, 570, [['lab_sqlw']])
add({'id': 'lab_sqlw', 'type': 'sqlite', 'name': 'SQLite write (batch)', 'mydb': 'lab_db', 'sqlquery': 'batch', 'sql': '', 'x': 1080, 'y': 260, 'wires': [[]]})
inject('lab_histt', 'history every 5 min', 170, 680, [['lab_hist']], topic='refresh', repeat='300', once=True, delay=8)
fn('lab_hist', 'History cache (7 days)', src('hist.js'), 410, 680, [['lab_sqlq'], ['lab_wsout']], outputs=2)
add({'id': 'lab_sqlq', 'type': 'sqlite', 'name': 'SQLite query', 'mydb': 'lab_db', 'sqlquery': 'msg.topic', 'sql': '', 'x': 640, 'y': 680, 'wires': [['lab_hist']]})
http_in('lab_initapi', 'GET init.js', '/labeller/api/init.js', 160, 770, [['lab_initfn']])
fn('lab_initfn', 'first paint data', "msg.payload = 'window.__INIT=' + JSON.stringify({ snap: flow.get('labSnap') || null, hist: flow.get('labHist') || null }).replace(/</g, '\\u003c') + ';';\nreturn msg;", 380, 770, [['lab_initres']])
http_out('lab_initres', 560, 770, 'application/javascript; charset=utf-8')
http_in('lab_histapi', 'GET history', '/labeller/api/history', 160, 730, [['lab_histget']])
fn('lab_histget', 'flow.labHist', "msg.payload = flow.get('labHist') || {};\nreturn msg;", 380, 730, [['lab_histres']])
http_out('lab_histres', 560, 730)

# ---------- 6. dashboard + chat ----------
comment('lab_c6', '⑥ DASHBOARD /labeller + "Ask the machine" chat', 'Page is plain HTML/CSS/JS (no CDN). Websocket /ws/labeller: snapshot every 1 s; chat in/out per browser session.\n'
        'Chat: CONFIG.chatProvider = "local" (on-device) or "claude" (needs ANTHROPIC_API_KEY env var for the nodered service). Falls back to local on any error.', 960, 480)
http_in('lab_pagein', 'GET /labeller', '/labeller', 830, 530, [['lab_page']])
add({'id': 'lab_page', 'type': 'template', 'name': 'Dashboard page', 'field': 'payload', 'fieldType': 'msg', 'format': 'html', 'syntax': 'plain',
     'template': src('page.html'), 'output': 'str', 'x': 1030, 'y': 530, 'wires': [['lab_pageres']]})
http_out('lab_pageres', 1210, 530, 'text/html; charset=utf-8')
add({'id': 'lab_wsin', 'type': 'websocket in', 'name': 'browser', 'server': 'lab_wsl', 'client': '', 'x': 650, 'y': 600, 'wires': [['lab_router']]})
fn('lab_router', 'Router (chat / batch / trace)', src('router.js'), 840, 600, [['lab_chat'], ['lab_an'], ['lab_sqlb'], ['lab_wsout'], ['lab_traceq']], outputs=5)
# ---------- 7. audit trace + batch report ----------
comment('lab_c7', '⑦ AUDIT TRACE — every product + batch report', 'items table: one row per product (trace ID = batch-serial), kept itemRetentionDays.\n'
        'Search from the dashboard (Trace), CSV: /labeller/api/items.csv?batch=..&from=..&to=..&q=..&result=ok|ng\nReport: /labeller/report?id=<batch row id>', 230, 900)
http_in('lab_itemscsv', 'GET items.csv', '/labeller/api/items.csv', 160, 950, [['lab_traceq']])
fn('lab_traceq', 'Trace query', src('trace.js'), 400, 950, [['lab_sqlt']])
add({'id': 'lab_sqlt', 'type': 'sqlite', 'name': 'SQLite trace', 'mydb': 'lab_db', 'sqlquery': 'msg.topic', 'sql': '', 'x': 600, 'y': 950, 'wires': [['lab_traceres']]})
fn('lab_traceres', 'Trace results / CSV', src('traceresult.js'), 810, 950, [['lab_wsout'], ['lab_itemsres']], outputs=2)
add({'id': 'lab_itemsres', 'type': 'http response', 'name': '', 'statusCode': '', 'headers': {}, 'x': 1010, 'y': 970, 'wires': []})
http_in('lab_repin', 'GET report', '/labeller/report', 160, 1020, [['lab_report']])
fn('lab_report', 'Batch report', src('report.js'), 400, 1020, [['lab_sqlr'], ['lab_repres']], outputs=2)
add({'id': 'lab_sqlr', 'type': 'sqlite', 'name': 'SQLite report', 'mydb': 'lab_db', 'sqlquery': 'msg.topic', 'sql': '', 'x': 400, 'y': 1070, 'wires': [['lab_report']]})
add({'id': 'lab_repres', 'type': 'http response', 'name': '', 'statusCode': '', 'headers': {}, 'x': 610, 'y': 1020, 'wires': []})
add({'id': 'lab_sqlb', 'type': 'sqlite', 'name': 'SQLite batches', 'mydb': 'lab_db', 'sqlquery': 'msg.topic', 'sql': '', 'x': 1050, 'y': 820, 'wires': [['lab_batchlist']]})
fn('lab_batchlist', 'Batch list / CSV', src('batchlist.js'), 1250, 820, [['lab_wsout'], ['lab_csvres']], outputs=2)
http_in('lab_csvapi', 'GET batches.csv', '/labeller/api/batches.csv', 650, 820, [['lab_csvq']])
fn('lab_csvq', 'query all batches', "msg.topic = 'SELECT batch,product,target,note,operator,start,end,total,ok,ng,run_s,oee,top_reason FROM batches ORDER BY start DESC LIMIT 5000';\nmsg.payload = [];\nreturn msg;", 850, 820, [['lab_sqlb']])
add({'id': 'lab_csvres', 'type': 'http response', 'name': '', 'statusCode': '', 'headers': {}, 'x': 1430, 'y': 840, 'wires': []})
fn('lab_chat', 'Chat (on-device AI)', src('chat.js'), 1040, 600, [['lab_wsout'], ['lab_claudereq']], outputs=2)
add({'id': 'lab_claudereq', 'type': 'http request', 'name': 'Claude API', 'method': 'use', 'ret': 'obj', 'paytoqs': 'ignore', 'url': '', 'tls': '',
     'persist': False, 'proxy': '', 'insecureHTTPParser': False, 'authType': '', 'senderr': False, 'headers': [], 'x': 1050, 'y': 650, 'wires': [['lab_claudereply']]})
fn('lab_claudereply', 'Claude reply / fallback', src('claude_reply.js'), 1250, 650, [['lab_wsout']])
add({'id': 'lab_wsout', 'type': 'websocket out', 'name': 'browsers', 'server': 'lab_wsl', 'client': '', 'x': 1290, 'y': 240, 'wires': []})
add({'id': 'lab_sqlcatch', 'type': 'catch', 'name': 'SQLite write failed', 'scope': ['lab_sqlw'], 'uncaught': False, 'x': 860, 'y': 300, 'wires': [['lab_rollback']]})
fn('lab_rollback', 'ROLLBACK open transaction', "// A failed statement inside BEGIN..COMMIT leaves the transaction open and blocks every later write.\n"
   "// Roll it back once (never loop on a failed ROLLBACK itself).\nif (/^\\s*ROLLBACK/i.test(msg.topic || '')) return null;\n"
   "node.warn('SQLite write failed, rolled back: ' + (msg.error && msg.error.message));\nreturn { topic: 'ROLLBACK;' };", 1070, 300, [['lab_sqlw']])
add({'id': 'lab_catch', 'type': 'catch', 'name': 'tab errors', 'scope': None, 'uncaught': False, 'x': 830, 'y': 730, 'wires': [['lab_errdbg']]})
debug('lab_errdbg', 'Labeller errors', 1020, 730, complete='true')

# ---------- deploy ----------
def call(method, path, body=None, headers=None):
    req = urllib.request.Request('http://127.0.0.1:1880' + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers=dict({'Content-Type': 'application/json', 'Node-RED-API-Version': 'v2'}, **(headers or {})))
    with urllib.request.urlopen(req) as r:
        body = r.read()
        try:
            return json.loads(body or b'{}')
        except ValueError:
            return {'text': body.decode()}

cur = call('GET', '/flows')
flows = [n for n in cur['flows'] if n.get('z') != Z and n['id'] != Z and not n['id'].startswith('lab_')]
for n in flows:
    if n['id'] in GPIO_DI_LINKOUTS:
        n['links'] = [l for l in n.get('links', []) if l != 'lab_dilink'] + ['lab_dilink']
flows += nodes
if '--dry' in sys.argv:
    json.dump(flows, open(os.path.join(D, 'flows.out.json'), 'w'), indent=1)
    print('dry run:', len(nodes), 'nodes'); sys.exit()
res = call('POST', '/flows', {'rev': cur['rev'], 'flows': flows}, {'Node-RED-Deployment-Type': 'nodes'})
print('deployed', len(nodes), 'nodes, rev', res.get('rev'))
import time
time.sleep(3)   # let redeployed nodes start before re-running setup
for n in ('lab_boot', 'lab_dbinit'):   # re-run CONFIG / TAG MAP / table setup so edits take effect
    call('POST', '/inject/' + n, {})
print('config + db init re-run')
