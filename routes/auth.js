const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const sessionStore = require('../middleware/sessionStore');
const bruteForceStore = require('../middleware/bruteForceStore');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditLog } = require('../middleware/audit');
const appState = require('../shared/appState');

// ========== PASSWORD HELPERS ==========
async function hashPasswordSecure(password) {
  const hash = await bcrypt.hash(password, 12);
  return { hash, salt: 'bcrypt' };
}

async function verifyPassword(password, storedHash) {
  return bcrypt.compare(password, storedHash);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ========== AUTH MIDDLEWARE ==========
async function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  const session = await sessionStore.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  await sessionStore.touch(token);
  req.user = session;
  next();
}

function adminRequired(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function superAdminRequired(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  next();
}

function siteAccessRequired(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  const users = appState.getUsers();
  const activeSiteId = appState.getActiveSiteId();
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  if (!userRecord) return res.status(403).json({ error: 'User not found' });
  const allowedSites = userRecord.allowedSites || [];
  if (allowedSites.length > 0 && !allowedSites.includes(activeSiteId)) {
    return res.status(403).json({ error: 'No access to this site' });
  }
  if (allowedSites.length === 0) {
    return res.status(403).json({ error: 'No sites assigned to your account' });
  }
  next();
}

// ========== AUTH ROUTES ==========
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const clientIP = req.ip || req.connection.remoteAddress;
  const bruteKey = `${clientIP}:${username.toLowerCase()}`;
  const bruteCheck = await bruteForceStore.check(bruteKey);
  if (bruteCheck.locked) {
    return res.status(429).json({ error: `Account temporarily locked. Try again in ${bruteCheck.remaining} seconds.` });
  }

  const users = appState.getUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await bruteForceStore.recordFailure(bruteKey);
    auditLog('login_failed', username, {}, req);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  await bruteForceStore.clear(bruteKey);

  const token = generateToken();
  await sessionStore.create(token, { username: user.username, role: user.role });
  auditLog('login_success', user.username, {}, req);
  res.json({ ok: true, token, username: user.username, role: user.role, allowedSites: user.allowedSites || [], allowedApps: user.allowedApps || [] });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const session = await sessionStore.get(token);
    auditLog('logout', session ? session.username : null, {}, req);
    await sessionStore.destroy(token);
  }
  res.json({ ok: true });
}));

router.get('/me', authRequired, (req, res) => {
  const users = appState.getUsers();
  const userRecord = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  res.json({
    username: req.user.username,
    role: req.user.role,
    allowedSites: userRecord ? userRecord.allowedSites || [] : [],
    allowedApps: userRecord ? userRecord.allowedApps || [] : []
  });
});

module.exports = router;
module.exports.authRequired = authRequired;
module.exports.adminRequired = adminRequired;
module.exports.superAdminRequired = superAdminRequired;
module.exports.siteAccessRequired = siteAccessRequired;
module.exports.hashPasswordSecure = hashPasswordSecure;
module.exports.verifyPassword = verifyPassword;
module.exports.generateToken = generateToken;
