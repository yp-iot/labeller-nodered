// Settings for the stand-alone VPS copy: same as settings.js, plus its own flow file
// and mandatory editor login. Secrets come from ~/.node-red/environment (not in git).
const settings = require('./settings.js');

settings.flowFile = 'flows-vps.json';

if (!process.env.NR_ADMIN_HASH) throw new Error('NR_ADMIN_HASH not set - refusing to start an open editor on a public server');
settings.adminAuth = {
    type: 'credentials',
    users: [{ username: process.env.NR_ADMIN_USER || 'admin', password: process.env.NR_ADMIN_HASH, permissions: '*' }]
};

// optional basic-auth on the dashboard pages
if (process.env.NR_PAGE_HASH) {
    settings.httpNodeAuth = { user: process.env.NR_PAGE_USER || 'viewer', pass: process.env.NR_PAGE_HASH };
}

module.exports = settings;
