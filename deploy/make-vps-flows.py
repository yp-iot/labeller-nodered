#!/usr/bin/env python3
"""Derive flows-vps.json from flows.json: keep only the Labeller tab and the config
nodes it uses, drop Pi-only hardware (serial PLC) and the Pi's cloud uplink (lab_up*), enable the
cloud mirror (lab_mir*, data mode 'Cloud copy'), and point /home/pi paths at this userDir.
The Labeller runs on its built-in simulator (labeller-src/config.js simulate: true)."""
import json, os

D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP_TABS = {'tab_lab'}
DROP_TYPES = {'serial request', 'serial-port', 'serial in', 'serial out'}

flows = json.load(open(os.path.join(D, 'flows.json')))
by_id = {n['id']: n for n in flows}
pi_only = lambda n: n['id'].startswith('lab_up')
keep = [n for n in flows if (n['id'] in KEEP_TABS or n.get('z') in KEEP_TABS) and not pi_only(n)]
for n in keep:
    if n['id'].startswith('lab_mir'):
        n.pop('d', None)
    if 'wires' in n:
        n['wires'] = [[w for w in out if not w.startswith('lab_up')] for out in n['wires']]

# pull in config nodes referenced by kept nodes (recursively)
ids = {n['id'] for n in keep}
todo = list(keep)
while todo:
    for v in todo.pop().values():
        if isinstance(v, str) and v in by_id and v not in ids and not by_id[v].get('z') and by_id[v]['type'] != 'tab':
            ids.add(v); keep.append(by_id[v]); todo.append(by_id[v])

keep = [n for n in keep if n['type'] not in DROP_TYPES]
out = json.dumps(keep, indent=4, ensure_ascii=False).replace('/home/pi/.node-red', D)
open(os.path.join(D, 'flows-vps.json'), 'w').write(out)
print(f'flows-vps.json: {len(keep)} nodes (from {len(flows)})')
