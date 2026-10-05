// ===== EDIT THIS: line, shifts, analytics, storage, chat =====
// Read-only monitoring: nothing on this tab writes to the machine.
flow.set('labcfg', {
    line: 'Line 1',
    machine: 'Solo Labelling & Inspection',
    product: 'Hand Sanitizer 500 ml',
    batch: 'LOT-2610A',            // first batch only; after that batches are started from the dashboard
    batchSource: 'dashboard',      // 'dashboard' = operators start/end batches on the page | 'plc' = follow the batch_no tag
    batchPin: '',                  // supervisor PIN for starting/ending batches ('' = no PIN)
    products: ['Hand Sanitizer 500 ml', 'Hand Sanitizer 1 L', 'Liquid Soap 250 ml'],   // quick picks in the New batch form
    simulate: true,                // true = simulator feeds the tag map, false = real DI / PLC
    idealPpm: 120,                 // rated speed in PPM (products per minute) for Performance
    ngAlarmPct: 3.0,               // NG % treated as abnormal
    labelRollQty: 3000,            // labels per roll (estimates when no label_remain tag)
    ribbonQty: 9000,               // prints per ribbon
    offsetTolMm: 1.5,              // label position tolerance ±mm
    detailFreshMs: 3000,           // item details (reason, OCR...) must be this fresh to count as real
    shifts: [
        { name: 'A', start: '07:00', end: '15:00', operator: 'Aisyah' },
        { name: 'B', start: '15:00', end: '23:00', operator: 'Ravi' },
        { name: 'C', start: '23:00', end: '07:00', operator: 'Wei Ming' }
    ],
    // storage (SQLite ~/.node-red/data/labeller.db)
    retentionDays: 90,             // minute_stats + ng_events
    itemRetentionDays: 90,         // every-product audit trace (items table, ~10-30 MB/day)
    shiftRetentionDays: 730,
    maxDbMB: 4000,                 // storage guard trims the oldest week above this
    minFreeGB: 2,
    // chat: 'local' (on-device) or 'claude' (needs ANTHROPIC_API_KEY env var)
    chatProvider: 'local',
    claudeModel: 'claude-haiku-4-5-20251001',
    // Mitsubishi serial poller (node "PLC serial" is disabled until wired)
    plc: {
        protocol: 'fx-prog',       // 'fx-prog' (FX programming port) | 'mc-1c' (dedicated protocol format 1, FX-485BD/computer link)
        station: 0, pcNo: 'FF',    // mc-1c only
        pollMs: 500,
        reads: [                   // blocks read every cycle (read-only commands)
            { dev: 'D', start: 100, words: 12 },   // D100..D111  counters, speed, codes
            { dev: 'D', start: 130, words: 2 },    // D130..D131  consumables
            { dev: 'D', start: 200, words: 16 },   // D200..D215  OCR / barcode ASCII
            { dev: 'M', start: 0, words: 1 }       // M0..M15     status bits
        ]
    }
});
node.status({ fill: 'green', shape: 'dot', text: 'config loaded' });
return null;
