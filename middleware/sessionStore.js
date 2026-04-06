const { pool } = require('../db');
const config = require('../config');

class PgSessionStore {
  /**
   * Create a new session in the database.
   * @param {string} token - 64-char hex session token
   * @param {object} sessionData - { username, role }
   */
  async create(token, sessionData) {
    const { username, role } = sessionData;
    const timeoutMs = config.sessionTimeout;
    await pool.query(
      `INSERT INTO sessions (token, username, role, created_at, last_activity, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW(), NOW() + $4 * INTERVAL '1 millisecond')`,
      [token, username, role, timeoutMs]
    );
  }

  /**
   * Retrieve a session by token. Returns null if not found or expired.
   * @param {string} token
   * @returns {object|null} { token, username, role, created_at, last_activity, expires_at } or null
   */
  async get(token) {
    const { rows } = await pool.query(
      `SELECT token, username, role, created_at, last_activity, expires_at
       FROM sessions
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      token: row.token,
      username: row.username,
      role: row.role,
      createdAt: row.created_at,
      lastActivity: row.last_activity,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Update session activity — refreshes last_activity and extends expires_at.
   * @param {string} token
   */
  async touch(token) {
    const timeoutMs = config.sessionTimeout;
    await pool.query(
      `UPDATE sessions
       SET last_activity = NOW(), expires_at = NOW() + $2 * INTERVAL '1 millisecond'
       WHERE token = $1`,
      [token, timeoutMs]
    );
  }

  /**
   * Delete a session by token.
   * @param {string} token
   */
  async destroy(token) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  /**
   * Delete all sessions for a given username.
   * @param {string} username
   */
  async destroyByUsername(username) {
    await pool.query('DELETE FROM sessions WHERE username = $1', [username]);
  }

  /**
   * Remove all expired sessions from the database.
   */
  async cleanup() {
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
  }
}

module.exports = new PgSessionStore();
