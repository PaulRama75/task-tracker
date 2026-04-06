const { pool } = require('../db');
const config = require('../config');

class PgBruteForceStore {
  /**
   * Check if a key is currently locked out.
   * @param {string} key - 'ip:username' composite key
   * @returns {{ locked: boolean, remaining?: number }}
   */
  async check(key) {
    const { rows } = await pool.query(
      'SELECT attempt_count, locked_until FROM login_attempts WHERE key = $1',
      [key]
    );

    if (rows.length === 0) {
      return { locked: false };
    }

    const record = rows[0];

    if (record.locked_until) {
      const now = new Date();
      const lockedUntil = new Date(record.locked_until);

      if (lockedUntil > now) {
        const remaining = Math.ceil((lockedUntil - now) / 1000);
        return { locked: true, remaining };
      }

      // Lockout has expired — delete the record and return unlocked
      await pool.query('DELETE FROM login_attempts WHERE key = $1', [key]);
      return { locked: false };
    }

    return { locked: false };
  }

  /**
   * Record a failed login attempt. Upserts the attempt count and sets lockout
   * when the configured maximum is reached.
   * @param {string} key - 'ip:username' composite key
   */
  async recordFailure(key) {
    // Upsert: increment attempt_count, update last_attempt
    await pool.query(
      `INSERT INTO login_attempts (key, attempt_count, last_attempt)
       VALUES ($1, 1, NOW())
       ON CONFLICT (key) DO UPDATE
       SET attempt_count = login_attempts.attempt_count + 1,
           last_attempt = NOW()`,
      [key]
    );

    // Check if we've hit the lockout threshold
    const { rows } = await pool.query(
      'SELECT attempt_count FROM login_attempts WHERE key = $1',
      [key]
    );

    if (rows.length > 0 && rows[0].attempt_count >= config.maxLoginAttempts) {
      await pool.query(
        `UPDATE login_attempts
         SET locked_until = NOW() + $2 * INTERVAL '1 millisecond'
         WHERE key = $1`,
        [key, config.lockoutDuration]
      );
    }
  }

  /**
   * Clear the failure record for a key (e.g., after successful login).
   * @param {string} key - 'ip:username' composite key
   */
  async clear(key) {
    await pool.query('DELETE FROM login_attempts WHERE key = $1', [key]);
  }

  /**
   * Remove expired lockout records from the database.
   */
  async cleanup() {
    await pool.query(
      'DELETE FROM login_attempts WHERE locked_until IS NOT NULL AND locked_until < NOW()'
    );
  }
}

module.exports = new PgBruteForceStore();
