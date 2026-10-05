// ===== EDIT THIS: tag map — one row per machine value =====
// src : 'di' (IRIV inputs DI0..DI3) | 'plc' (Mitsubishi device, e.g. D100, M3)
// type: bool | int16 | uint16 | int32 | uint32 | float32 | enum | ascii
// kind: 'counter' -> cumulative register, analytics uses the increase
//       'pulse'   -> counts one per edge of a DI/bit (edge:'rise'|'fall'); 'when' = only count if that key is on
// 32-bit types use two words (key, key+1, low word first). ascii uses 'words' words, 2 chars each.
// Order matters for counters: keep count_ng BEFORE count_total.
flow.set('tagmap', [
    // --- production counters (DI now; swap to the PLC rows below when ready) ---
    { tag: 'count_ng',      src: 'di',  key: 'DI0', type: 'bool', kind: 'pulse', edge: 'rise', when: 'DI1', desc: 'IV3 NG output at product trigger' },
    { tag: 'count_total',   src: 'di',  key: 'DI0', type: 'bool', kind: 'pulse', edge: 'rise', desc: 'Product sensor' },
    // { tag: 'count_ng',    src: 'plc', key: 'D102', type: 'uint32', kind: 'counter' },
    // { tag: 'count_total', src: 'plc', key: 'D100', type: 'uint32', kind: 'counter' },

    // --- machine status ---
    { tag: 'running',       src: 'di',  key: 'DI2', type: 'bool', desc: 'Machine running' },
    { tag: 'fault',         src: 'di',  key: 'DI3', type: 'bool', desc: 'Machine fault' },
    { tag: 'speed_ppm',     src: 'plc', key: 'D104', type: 'int16', scale: 0.1, unit: 'ppm' },

    // --- inspection result of the last item (KEYENCE IV3 via PLC) ---
    { tag: 'reject_code',   src: 'plc', key: 'D105', type: 'enum',
      map: { 0: 'None', 1: 'Label skew', 2: 'Missing label', 3: 'Wrong label', 4: 'OCR misread', 5: 'Barcode unreadable', 6: 'Wrinkle / bubble', 7: 'Cap / seal' } },
    { tag: 'ai_conf',       src: 'plc', key: 'D106', type: 'uint16', scale: 0.1, unit: '%' },
    { tag: 'label_offset',  src: 'plc', key: 'D107', type: 'int16', scale: 0.01, unit: 'mm' },
    { tag: 'ocr_text',      src: 'plc', key: 'D200', type: 'ascii', words: 10 },
    { tag: 'barcode',       src: 'plc', key: 'D210', type: 'ascii', words: 6 },

    // --- consumables ---
    { tag: 'label_remain',  src: 'plc', key: 'D130', type: 'uint16', unit: '%' },
    { tag: 'ribbon_remain', src: 'plc', key: 'D131', type: 'uint16', unit: '%' }
]);
flow.set('tagmapVer', Date.now());
node.status({ fill: 'green', shape: 'dot', text: flow.get('tagmap').length + ' tags' });
return null;
