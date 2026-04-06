const { pool } = require('../db');

function auditLog(action, username, details = {}, req = null) {
  const ip = req ? (req.ip || req.connection.remoteAddress) : null;
  pool.query(
    'INSERT INTO audit_log (action, username, ip_address, details) VALUES ($1, $2, $3, $4)',
    [action, username, ip, JSON.stringify(details)]
  ).catch(err => console.error('Audit log error:', err.message));
}

module.exports = { auditLog };
